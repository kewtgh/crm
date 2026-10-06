-- v3.25 Phase 2: versioned import metadata and atomic canonical mutation adapters.
set search_path=public,app_auth,extensions;
-- Existing Contact mutation has an argument/column name collision, exposed by parity testing.
-- Qualify only that assignment in this forward migration; preserve the owning mutation contract.
do $$declare definition text;begin
 select pg_get_functiondef('public.update_contact_profile(uuid,timestamptz,text,text,text,text,text,text,text,text,integer,text,uuid,text,text,text,text,text[],timestamptz)'::regprocedure) into definition;
 if position('next_follow_up_at=next_follow_up_at' in definition)=0 then raise exception 'contact_mutation_definition_unexpected';end if;
 execute replace(definition,'next_follow_up_at=next_follow_up_at','next_follow_up_at=update_contact_profile.next_follow_up_at');
end $$;
alter table public.import_batches add column execution_contract text not null default 'LEGACY_SQL';
alter table public.import_batches add column template_version text not null default 'LEGACY_UNVERSIONED';
alter table public.import_batches add column payload_sha256 text;
alter table public.import_batches add column evidence_expires_at timestamptz;
alter table public.import_rows add column target_revision text;
alter table public.import_rows add column review_revision integer not null default 1;
alter table public.import_rows add column source_location jsonb not null default '{}';
alter table public.import_mapping_profiles add column template_version text not null default 'LEGACY_UNVERSIONED';
alter table public.import_mapping_profiles add column revision integer not null default 1;
alter table public.import_mapping_profiles drop constraint import_mapping_profiles_workspace_id_owned_by_resource_name_key;
alter table public.import_mapping_profiles add unique(workspace_id,owned_by,resource,template_version,name);

-- Same opaque-token pattern as email tokens: random bytes, hash at rest, actor/workspace/expiry.
create table public.import_reference_tokens(
 token_hash text primary key,workspace_id uuid not null references public.workspaces(id),
 actor_id uuid not null references app_auth.accounts(id),resource text not null,
 record_id uuid not null,expires_at timestamptz not null default now()+interval '24 hours'
);
alter table public.import_reference_tokens enable row level security;
revoke all on public.import_reference_tokens from public,crm_app,crm_worker,crm_system;

create function public.import_reference_access(kind text,record_id uuid,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
 if not public.is_workspace_member(public.current_workspace_id()) then return false;end if;
 if kind in ('ORGANIZATION','HOUSEHOLD','CONTACT') then
  return public.customer_subject_access(kind,record_id,edit) and (kind<>'CONTACT' or not exists(select 1 from public.contacts where id=record_id and coalesce(do_not_contact_reason,'') like 'PRIVACY_DELETION:%'));
 elsif kind='STUDENT' then return public.education_business_student_access(record_id,edit);
 elsif kind='STAFF' then return exists(select 1 from public.workspace_memberships m join app_auth.accounts a on a.id=m.user_id where m.user_id=record_id and m.workspace_id=public.current_workspace_id() and m.status='ACTIVE' and a.status='ACTIVE')
  and (not edit or record_id=app_auth.current_user_id() or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'));
 elsif kind='PRODUCT' then return exists(select 1 from public.products where id=record_id and workspace_id=public.current_workspace_id() and archived_at is null);
 elsif kind='COHORT' then return exists(select 1 from public.product_cohorts where id=record_id and workspace_id=public.current_workspace_id() and status<>'CANCELLED');
 elsif kind='OPPORTUNITY' then return exists(select 1 from public.opportunities o where id=record_id and public.can_access_owned_record(o.workspace_id,'OPPORTUNITY',o.id,o.owner_id,edit));
 end if;
 return false;
end $$;
revoke all on function public.import_reference_access(text,uuid,boolean) from public,crm_system;
grant execute on function public.import_reference_access(text,uuid,boolean) to crm_app;

create function public.issue_import_reference(kind text,record_id uuid) returns text
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare token text:='ir_'||encode(extensions.gen_random_bytes(32),'hex');
begin
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') or not public.import_reference_access(kind,record_id,kind='STAFF') then raise exception 'INVALID_REFERENCE';end if;
 insert into public.import_reference_tokens(token_hash,workspace_id,actor_id,resource,record_id)
 values(encode(extensions.digest(token,'sha256'),'hex'),public.current_workspace_id(),app_auth.current_user_id(),kind,record_id);
 return token;
end $$;
revoke all on function public.issue_import_reference(text,uuid) from public,crm_system;
grant execute on function public.issue_import_reference(text,uuid) to crm_app;

create function public.resolve_import_reference(token text,kind text,edit boolean default false) returns uuid
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare identity uuid;
begin
 select record_id into identity from public.import_reference_tokens where token_hash=encode(extensions.digest(token,'sha256'),'hex')
 and workspace_id=public.current_workspace_id() and actor_id=app_auth.current_user_id() and resource=kind and expires_at>now();
 if identity is null or not public.import_reference_access(kind,identity,edit) then raise exception 'INVALID_REFERENCE';end if;
 return identity;
end $$;
revoke all on function public.resolve_import_reference(text,text,boolean) from public,crm_app,crm_system;

-- Owning create adapter. Regular forms and imports both use this entrypoint; update validation stays
-- with the existing domain RPCs. No import-only INSERT shortcut to business tables.
create function public.save_customer_record(resource text,record_id uuid,expected_updated_at timestamptz,data jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id(); actor uuid:=app_auth.current_user_id(); result jsonb; stamp timestamptz:=expected_updated_at;
begin
 if actor is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'PERMISSION_DENIED';end if;
 if expected_updated_at is null then
  data:='{"status":"UNVERIFIED","shortName":"","curriculum":"","address":"","courseCategories":[],"affiliationType":"INDEPENDENT","website":"","organizationOverviewMarkdown":"","structureOverviewMarkdown":""}'::jsonb||data;
  if resource='ORGANIZATIONS' then
   if data->>'ownerId' is not null and not public.import_reference_access('STAFF',(data->>'ownerId')::uuid,true) then raise exception 'INVALID_REFERENCE';end if;
   if public.current_crm_role()='SALES_SUPPORT' or coalesce(data->>'organizationType','SCHOOL') not in ('SCHOOL','PARTNER','OTHER') then raise exception 'PERMISSION_DENIED';end if;
   insert into public.organizations(id,workspace_id,name_zh,name_en,city,organization_type,owner_id,created_by)
   values(record_id,ws,data->>'nameZh',data->>'nameEn',data->>'city',coalesce(data->>'organizationType','SCHOOL'),coalesce((data->>'ownerId')::uuid,actor),actor) returning updated_at into stamp;
  elsif resource='HOUSEHOLDS' then
   insert into public.households(id,workspace_id,name_zh,name_en,created_by) values(record_id,ws,data->>'nameZh',data->>'nameEn',actor) returning updated_at into stamp;
  elsif resource='STUDENTS' then
   if not public.import_reference_access('CONTACT',(data->>'personId')::uuid,false) then raise exception 'INVALID_REFERENCE';end if;
   insert into public.students(id,workspace_id,person_id,household_id,current_grade,academic_year,created_by)
   values(record_id,ws,(data->>'personId')::uuid,(data->>'householdId')::uuid,data->>'currentGrade',data->>'academicYear',actor) returning updated_at into stamp;
  elsif resource='CONTACTS' then return to_jsonb(public.create_customer_contact(data));
  else raise exception 'UNSUPPORTED_OPERATION';end if;
 else
  if resource='STUDENTS' then
   if not public.import_reference_access('STUDENT',record_id,true) then raise exception 'INVALID_REFERENCE';end if;
  elsif not public.import_reference_access(case resource when 'ORGANIZATIONS' then 'ORGANIZATION' when 'HOUSEHOLDS' then 'HOUSEHOLD' when 'CONTACTS' then 'CONTACT' end,record_id,true) then raise exception 'INVALID_REFERENCE';end if;
 end if;
 if resource='ORGANIZATIONS' then result:=to_jsonb(public.update_school_customer_profile(record_id,stamp,data));
 elsif resource='HOUSEHOLDS' then result:=to_jsonb(public.update_household_profile(record_id,stamp,data->>'nameZh',data->>'nameEn',data->>'address',coalesce(data->>'status','ACTIVE'),data->>'primaryParentOccupation',data->>'secondaryParentOccupation',(data->>'annualIncomeAmount')::numeric,coalesce(data->>'incomeCurrency','CNY'),coalesce(data->>'preferredContactMethod','EMAIL'),data->>'preferredLanguage',data->>'educationExpectationsMarkdown',data->>'familyBackgroundMarkdown'));
 elsif resource='STUDENTS' then
  if data->>'householdId' is not null and not public.import_reference_access('HOUSEHOLD',(data->>'householdId')::uuid,false) then raise exception 'INVALID_REFERENCE';end if;
  result:=to_jsonb(public.update_student_profile(record_id,stamp,data->>'studentNumber',(data->>'birthDate')::date,data->>'currentGrade',data->>'currentClass',data->>'academicYear',(data->>'householdId')::uuid,coalesce(data->>'status','ACTIVE'),data->>'personalityMarkdown',data->>'learningExpectationsMarkdown',data->>'strengthsMarkdown',data->>'supportNeedsMarkdown',array(select jsonb_array_elements_text(coalesce(data->'interests','[]'))),coalesce(data->>'preferredLearningStyle','UNSPECIFIED')));
 elsif resource='CONTACTS' then result:=to_jsonb(public.update_contact_profile(record_id,stamp,data->>'nameZh',data->>'nameEn',data->>'email',data->>'phone',data->>'title',data->>'status',data->>'contactType',data->>'contactStatus',(data->>'communicationLevel')::integer,data->>'notesMarkdown',(data->>'ownerId')::uuid,data->>'preferredContactMethod',data->>'preferredLanguage',data->>'acquisitionSource',data->>'decisionRole',array(select jsonb_array_elements_text(coalesce(data->'tags','[]'))),(data->>'nextFollowUpAt')::timestamptz));
 else raise exception 'UNSUPPORTED_OPERATION';end if;
 return result;
end $$;
revoke all on function public.save_customer_record(text,uuid,timestamptz,jsonb) from public,crm_system;
grant execute on function public.save_customer_record(text,uuid,timestamptz,jsonb) to crm_app;

-- This catalog is generated from the typed registry during implementation, then frozen in this migration.
create function public.import_v2_catalog() returns jsonb language sql immutable as $$select '{"ORGANIZATIONS":[{"key":"nameZh","column":"name_zh","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"nameEn","column":"name_en","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"shortName","column":"short_name","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"organizationType","column":"organization_type","type":"enum","scope":"CORE","create":true,"update":false,"clear":false},{"key":"city","column":"city","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"curriculum","column":"curriculum","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"courseCategories","column":"course_categories","type":"array","scope":"CORE","create":true,"update":true,"clear":false},{"key":"affiliationType","column":"affiliation_type","type":"enum","scope":"CORE","create":true,"update":true,"clear":false},{"key":"parentOrganizationId","column":"parent_organization_id","type":"reference","scope":"CORE","create":true,"update":true,"clear":true},{"key":"address","column":"address","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"website","column":"website","type":"text","scope":"CORE","create":true,"update":true,"clear":true},{"key":"foundedYear","column":"founded_year","type":"integer","scope":"CORE","create":true,"update":true,"clear":true},{"key":"studentCount","column":"student_count","type":"integer","scope":"CORE","create":true,"update":true,"clear":true},{"key":"facultyCount","column":"faculty_count","type":"integer","scope":"CORE","create":true,"update":true,"clear":true},{"key":"campusCount","column":"campus_count","type":"integer","scope":"CORE","create":true,"update":true,"clear":true},{"key":"organizationOverviewMarkdown","column":"organization_overview_markdown","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"structureOverviewMarkdown","column":"structure_overview_markdown","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"status","column":"status","type":"enum","scope":"CORE","create":false,"update":true,"clear":false},{"key":"profile.organization_type","column":"organization_type","type":"enum","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.roles","column":"roles","type":"array","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.partnership_stage","column":"partnership_stage","type":"enum","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.primary_contact_id","column":"primary_contact_id","type":"reference","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.focus_regions","column":"focus_regions","type":"array","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.agreement_expires_on","column":"agreement_expires_on","type":"date","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.next_action","column":"next_action","type":"text","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.commercial_tier","column":"commercial_tier","type":"enum","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.partnership_potential_score","column":"partnership_potential_score","type":"integer","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.competitor_analysis_markdown","column":"competitor_analysis_markdown","type":"text","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.bd_plan_markdown","column":"bd_plan_markdown","type":"text","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.school_type","column":"school_type","type":"enum","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.grade_min","column":"grade_min","type":"integer","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.grade_max","column":"grade_max","type":"integer","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.tuition_min","column":"tuition_min","type":"decimal","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.tuition_max","column":"tuition_max","type":"decimal","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.tuition_currency","column":"tuition_currency","type":"enum","scope":"PROFILE","create":true,"update":true,"clear":true}],"HOUSEHOLDS":[{"key":"nameZh","column":"name_zh","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"nameEn","column":"name_en","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"address","column":"address","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"primaryParentOccupation","column":"primary_parent_occupation","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"secondaryParentOccupation","column":"secondary_parent_occupation","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"annualIncomeAmount","column":"annual_income_amount","type":"decimal","scope":"CORE","create":true,"update":true,"clear":true},{"key":"incomeCurrency","column":"income_currency","type":"currency","scope":"CORE","create":true,"update":true,"clear":false},{"key":"preferredContactMethod","column":"preferred_contact_method","type":"enum","scope":"CORE","create":true,"update":true,"clear":false},{"key":"preferredLanguage","column":"preferred_language","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"educationExpectationsMarkdown","column":"education_expectations_markdown","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"familyBackgroundMarkdown","column":"family_background_markdown","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"status","column":"status","type":"enum","scope":"CORE","create":false,"update":true,"clear":false},{"key":"profile.services","column":"services","type":"array","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.target_regions","column":"target_regions","type":"array","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.budget_min","column":"budget_min","type":"decimal","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.budget_max","column":"budget_max","type":"decimal","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.budget_currency","column":"budget_currency","type":"enum","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.target_intake","column":"target_intake","type":"date","scope":"PROFILE","create":true,"update":true,"clear":true},{"key":"profile.decision_stage","column":"decision_stage","type":"enum","scope":"PROFILE","create":true,"update":true,"clear":false},{"key":"profile.next_action","column":"next_action","type":"text","scope":"PROFILE","create":true,"update":true,"clear":false}],"CONTACTS":[{"key":"nameZh","column":"name_zh","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"nameEn","column":"name_en","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"email","column":"email","type":"text","scope":"CORE","create":true,"update":true,"clear":true},{"key":"phone","column":"phone","type":"text","scope":"CORE","create":true,"update":true,"clear":true},{"key":"title","column":"title","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"contactType","column":"contact_type","type":"enum","scope":"CORE","create":true,"update":true,"clear":false},{"key":"contactStatus","column":"contact_status","type":"enum","scope":"CORE","create":true,"update":true,"clear":false},{"key":"communicationLevel","column":"communication_level","type":"integer","scope":"CORE","create":true,"update":true,"clear":false},{"key":"notesMarkdown","column":"notes_markdown","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"preferredContactMethod","column":"preferred_contact_method","type":"enum","scope":"CORE","create":true,"update":true,"clear":false},{"key":"preferredLanguage","column":"preferred_language","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"acquisitionSource","column":"acquisition_source","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"decisionRole","column":"decision_role","type":"enum","scope":"CORE","create":true,"update":true,"clear":false},{"key":"tags","column":"tags","type":"array","scope":"CORE","create":true,"update":true,"clear":false},{"key":"nextFollowUpAt","column":"next_follow_up_at","type":"timestamp","scope":"CORE","create":true,"update":true,"clear":true},{"key":"ownerId","column":"owner_id","type":"reference","scope":"CORE","create":true,"update":true,"clear":false},{"key":"status","column":"status","type":"enum","scope":"CORE","create":false,"update":true,"clear":false},{"key":"organizationId","column":"organization_id","type":"reference","scope":"CORE","create":true,"update":false,"clear":false},{"key":"wechatId","column":"wechat_id","type":"text","scope":"CORE","create":false,"update":true,"clear":false}],"STUDENTS":[{"key":"personId","column":"person_id","type":"reference","scope":"CORE","create":true,"update":false,"clear":false},{"key":"householdId","column":"household_id","type":"reference","scope":"CORE","create":true,"update":true,"clear":false},{"key":"studentNumber","column":"student_number","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"birthDate","column":"birth_date","type":"date","scope":"CORE","create":true,"update":true,"clear":false},{"key":"currentGrade","column":"current_grade","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"currentClass","column":"current_class","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"academicYear","column":"academic_year","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"interests","column":"interests","type":"array","scope":"CORE","create":true,"update":true,"clear":false},{"key":"preferredLearningStyle","column":"preferred_learning_style","type":"enum","scope":"CORE","create":true,"update":true,"clear":false},{"key":"personalityMarkdown","column":"personality_markdown","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"learningExpectationsMarkdown","column":"learning_expectations_markdown","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"strengthsMarkdown","column":"strengths_markdown","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"supportNeedsMarkdown","column":"support_needs_markdown","type":"text","scope":"CORE","create":true,"update":true,"clear":false},{"key":"status","column":"status","type":"enum","scope":"CORE","create":false,"update":true,"clear":false}]}'::jsonb$$;
revoke all on function public.import_v2_catalog() from public,crm_app,crm_system;

create function public.import_v2_context(resource text,item jsonb,expected jsonb default null,restore boolean default false) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare catalog jsonb:=public.import_v2_catalog()->resource; patch jsonb:=coalesce(item->'patch','{}'); prof jsonb:=coalesce(item->'profile','{}');
 operation text:=item->>'operation'; identity uuid; old_row jsonb; old_profile jsonb; core jsonb; defaults jsonb; profile_defaults jsonb; field jsonb; key text; value jsonb; kind text; table_name text; profile_table text; candidates jsonb; before_core jsonb:='{}';before_prof jsonb:='{}';
begin
 if catalog is null or operation not in ('CREATE','UPDATE','SKIP') or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') or not public.is_workspace_member(public.current_workspace_id()) then raise exception 'PERMISSION_DENIED';end if;
 if operation='SKIP' then return jsonb_build_object('operation','SKIP');end if;
 table_name:=case resource when 'ORGANIZATIONS' then 'organizations' when 'HOUSEHOLDS' then 'households' when 'CONTACTS' then 'contacts' when 'STUDENTS' then 'students' end;
 kind:=case resource when 'ORGANIZATIONS' then 'ORGANIZATION' when 'HOUSEHOLDS' then 'HOUSEHOLD' when 'CONTACTS' then 'CONTACT' when 'STUDENTS' then 'STUDENT' end;
 profile_table:=case resource when 'ORGANIZATIONS' then 'organization_business_profiles' when 'HOUSEHOLDS' then 'family_education_needs' end;
 if operation='UPDATE' then
  identity:=case when restore then (item->>'targetReference')::uuid else public.resolve_import_reference(item->>'targetReference',kind,true) end;
  if not public.import_reference_access(kind,identity,true) then raise exception 'INVALID_REFERENCE';end if;
  execute format('select to_jsonb(r) from public.%I r where id=$1 and workspace_id=$2 for update',table_name) into old_row using identity,public.current_workspace_id();
  if old_row is null then raise exception 'INVALID_REFERENCE';end if;
  if expected is not null and old_row->>'updated_at' is distinct from expected->>'updated_at' then raise exception 'STALE_TARGET';end if;
 else identity:=gen_random_uuid();end if;
 defaults:='{"nameZh":"","nameEn":"","shortName":"","city":"","curriculum":"","address":"","courseCategories":[],"affiliationType":"INDEPENDENT","website":"","foundedYear":null,"studentCount":null,"facultyCount":null,"campusCount":null,"parentOrganizationId":null,"organizationOverviewMarkdown":"","structureOverviewMarkdown":"","primaryParentOccupation":"","secondaryParentOccupation":"","annualIncomeAmount":null,"incomeCurrency":"CNY","preferredContactMethod":"EMAIL","preferredLanguage":"","educationExpectationsMarkdown":"","familyBackgroundMarkdown":"","email":null,"phone":null,"title":"","contactType":"CONTACT","contactStatus":"NEW","communicationLevel":1,"notesMarkdown":"","acquisitionSource":"","decisionRole":"UNKNOWN","tags":[],"nextFollowUpAt":null,"organizationId":null,"studentNumber":null,"birthDate":null,"currentGrade":"","currentClass":"","academicYear":"","householdId":null,"personalityMarkdown":"","learningExpectationsMarkdown":"","strengthsMarkdown":"","supportNeedsMarkdown":"","interests":[],"preferredLearningStyle":"UNSPECIFIED"}'::jsonb;
 core:=defaults||jsonb_build_object('ownerId',app_auth.current_user_id(),'status',case when resource in ('HOUSEHOLDS','STUDENTS') then 'ACTIVE' else 'UNVERIFIED' end);
 for field in select f.value from jsonb_array_elements(catalog) f where f.value->>'scope'='CORE' loop
  key:=field->>'key';if old_row is not null then core:=core||jsonb_build_object(key,old_row->(field->>'column'));end if;
 end loop;
 for key,value in select * from jsonb_each(patch) loop
  select f into field from jsonb_array_elements(catalog) f where f->>'key'=key and f->>'scope'='CORE';
  if field is null or not restore and not coalesce((field->>lower(operation))::boolean,false) then raise exception 'UNSUPPORTED_OPERATION';end if;
  if value='null'::jsonb and not restore and (operation<>'UPDATE' or not (field->>'clear')::boolean) then raise exception 'CLEAR_NOT_ALLOWED';end if;
  if field->>'type'='decimal' and value<>'null'::jsonb and value#>>'{}'!~'^\d{1,12}(\.\d{1,2})?$' then raise exception 'INVALID_DECIMAL';end if;
  if field->>'type'='reference' and value<>'null'::jsonb then
   kind:=case key when 'parentOrganizationId' then 'ORGANIZATION' when 'organizationId' then 'ORGANIZATION' when 'ownerId' then 'STAFF' when 'personId' then 'CONTACT' when 'householdId' then 'HOUSEHOLD' end;
   if restore then
    if not public.import_reference_access(kind,(value#>>'{}')::uuid,kind='STAFF') then raise exception 'INVALID_REFERENCE';end if;
   else value:=to_jsonb(public.resolve_import_reference(value#>>'{}',kind,kind='STAFF'));end if;
  end if;
  before_core:=before_core||jsonb_build_object(key,core->key);core:=core||jsonb_build_object(key,value);
 end loop;
 if operation='CREATE' then
  if nullif(core->>'nameZh','') is null then core:=core||jsonb_build_object('nameZh',core->>'nameEn');end if;
  if nullif(core->>'nameEn','') is null then core:=core||jsonb_build_object('nameEn',core->>'nameZh');end if;
  if resource='CONTACTS' then
   select coalesce(jsonb_agg(c.id),'[]') into candidates from public.contacts c where c.workspace_id=public.current_workspace_id() and c.archived_at is null and public.import_reference_access('CONTACT',c.id,false)
    and (nullif(core->>'email','') is not null and c.email=(core->>'email')::citext or nullif(core->>'phone','') is not null and c.phone=core->>'phone');
  elsif resource in ('ORGANIZATIONS','HOUSEHOLDS') then
   execute format('select coalesce(jsonb_agg(r.id),''[]''::jsonb) from public.%I r where workspace_id=$1 and archived_at is null and public.import_reference_access($2,r.id,false) and (lower(name_zh)=lower($3) or lower(name_en)=lower($4))',table_name) into candidates using public.current_workspace_id(),case resource when 'ORGANIZATIONS' then 'ORGANIZATION' else 'HOUSEHOLD' end,core->>'nameZh',core->>'nameEn';
  else select coalesce(jsonb_agg(s.id),'[]') into candidates from public.students s where s.workspace_id=public.current_workspace_id() and public.import_reference_access('STUDENT',s.id,false) and s.person_id=(core->>'personId')::uuid;end if;
  if jsonb_array_length(candidates)>0 and not coalesce((item->>'duplicateAcknowledged')::boolean,false) then return jsonb_build_object('operation','DUPLICATE_REVIEW');end if;
 end if;
 if prof<>'{}' then
  if profile_table is null then raise exception 'UNKNOWN_COLUMN';end if;
  execute format('select to_jsonb(r) from public.%I r where id=$1 and workspace_id=$2 for update',profile_table) into old_profile using identity,public.current_workspace_id();
  if operation='UPDATE' and old_profile is null then raise exception 'UNSUPPORTED_OPERATION';end if;
  if expected is not null and old_profile->>'revision' is distinct from expected->>'profile_revision' then raise exception 'STALE_TARGET';end if;
  profile_defaults:=case resource when 'ORGANIZATIONS' then '{"organization_type":"SCHOOL","roles":[],"partnership_stage":"PROSPECT","primary_contact_id":null,"focus_regions":[],"agreement_expires_on":null,"next_action":"","commercial_tier":null,"partnership_potential_score":null,"competitor_analysis_markdown":"","bd_plan_markdown":"","school_type":null,"grade_min":null,"grade_max":null,"tuition_min":null,"tuition_max":null,"tuition_currency":null}'::jsonb else '{"services":[],"target_regions":[],"budget_min":null,"budget_max":null,"budget_currency":"CNY","target_intake":null,"decision_stage":"DISCOVERY","next_action":""}'::jsonb end;
  if old_profile is not null then for field in select f.value from jsonb_array_elements(catalog) f where f.value->>'scope'='PROFILE' loop profile_defaults:=profile_defaults||jsonb_build_object(field->>'column',old_profile->(field->>'column'));end loop;end if;
  for key,value in select * from jsonb_each(prof) loop
   select f into field from jsonb_array_elements(catalog) f where f->>'key'='profile.'||key;
   if field is null then raise exception 'UNKNOWN_COLUMN';end if;
   if value='null'::jsonb and not restore and (operation<>'UPDATE' or not (field->>'clear')::boolean) then raise exception 'CLEAR_NOT_ALLOWED';end if;
   if field->>'type'='decimal' and value<>'null'::jsonb and value#>>'{}'!~'^\d{1,12}(\.\d{1,2})?$' then raise exception 'INVALID_DECIMAL';end if;
   if field->>'type'='reference' and value<>'null'::jsonb then
    value:=case when restore then value else to_jsonb(public.resolve_import_reference(value#>>'{}','CONTACT',false)) end;
    if not public.import_reference_access('CONTACT',(value#>>'{}')::uuid,false) then raise exception 'INVALID_REFERENCE';end if;
   end if;
   before_prof:=before_prof||jsonb_build_object(key,profile_defaults->key);profile_defaults:=profile_defaults||jsonb_build_object(key,value);
  end loop;
  if resource='ORGANIZATIONS' and patch ? 'organizationType' and prof ? 'organization_type' and core->>'organizationType' is distinct from profile_defaults->>'organization_type' then raise exception 'INVALID_ENUM';end if;
  prof:=profile_defaults||jsonb_build_object('id',identity);
 end if;
 return jsonb_build_object('operation',operation,'id',identity,'core',core,'profile',prof,'updated_at',old_row->'updated_at','profile_revision',old_profile->'revision','before',jsonb_build_object('patch',before_core,'profile',before_prof));
end $$;
revoke all on function public.import_v2_context(text,jsonb,jsonb,boolean) from public,crm_app,crm_system;

create function public.import_v2_apply(resource text,item jsonb,expected jsonb default null,restore boolean default false) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare context jsonb:=public.import_v2_context(resource,item,expected,restore);result jsonb;profile jsonb;identity uuid:=(context->>'id')::uuid;
begin
 if context->>'operation'='DUPLICATE_REVIEW' then raise exception 'DUPLICATE_REVIEW';end if;
 if context->>'operation'='SKIP' then return context;end if;
 result:=public.save_customer_record(resource,identity,(context->>'updated_at')::timestamptz,context->'core');
 if resource='CONTACTS' and (item->'patch') ? 'wechatId' then result:=to_jsonb(public.save_contact_communication((result->>'id')::uuid,(result->>'updated_at')::timestamptz,context->'core'->>'wechatId'));end if;
 if context->'profile'<>'{}' then
  profile:=public.save_education_business(case resource when 'ORGANIZATIONS' then 'organizations' else 'needs' end,(result->>'id')::uuid,(context->>'profile_revision')::integer,(context->'profile')||jsonb_build_object('id',result->'id'));
  if resource='ORGANIZATIONS' then select to_jsonb(o) into result from public.organizations o where id=(result->>'id')::uuid;end if;
 end if;
 return jsonb_build_object('id',result->'id','updated_at',result->'updated_at','profile_revision',profile->'revision','before',context->'before');
end $$;
revoke all on function public.import_v2_apply(text,jsonb,jsonb,boolean) from public,crm_app,crm_system;

create function public.import_v2_preflight(resource text,item jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare context jsonb;probe jsonb;
begin
 context:=public.import_v2_context(resource,item);
 if context->>'operation' in ('SKIP','DUPLICATE_REVIEW') then return context;end if;
 begin
  probe:=public.import_v2_apply(resource,item,context);
  raise exception using errcode='PZ002',message='IMPORT_VALIDATION_ROLLBACK';
 exception when sqlstate 'PZ002' then null;
 end;
 return jsonb_build_object('operation',item->>'operation','id',case when item->>'operation'='UPDATE' then context->'id' else null end,'targetLabel',case when item->>'operation'='UPDATE' then coalesce(context->'core'->>'nameZh',context->'core'->>'studentNumber','') else null end,'updated_at',context->'updated_at','profile_revision',context->'profile_revision');
end $$;
revoke all on function public.import_v2_preflight(text,jsonb) from public,crm_app,crm_system;

create function public.import_v2_error(message text) returns text language sql immutable as $$
 select case when message=any(array['INVALID_REFERENCE','STALE_TARGET','CLEAR_NOT_ALLOWED','UNSUPPORTED_OPERATION','UNKNOWN_COLUMN','INVALID_DECIMAL','DUPLICATE_REVIEW','INVALID_ENUM','PERMISSION_DENIED']) then message
 when message like '%version_conflict%' then 'STALE_TARGET'
 when message like '%forbidden%' or message like '%not_found%' or message like '%not_assignable%' then 'INVALID_REFERENCE'
 else 'DOMAIN_VALIDATION_FAILED' end
$$;
revoke all on function public.import_v2_error(text) from public,crm_app,crm_system;

-- Import-generated audit contains identities/outcomes only, never raw inputs or rollback evidence.
create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid;entity text;before_row jsonb;after_row jsonb;
begin
 if current_setting('app.import_v2',true)='1' and tg_table_name in ('import_batches','import_rows') then return coalesce(new,old);end if;
 before_row:=case when tg_op='INSERT' then null else to_jsonb(old) end;after_row:=case when tg_op='DELETE' then null else to_jsonb(new) end;
 ws:=coalesce((after_row->>'workspace_id')::uuid,(before_row->>'workspace_id')::uuid,public.current_workspace_id());
 entity:=coalesce(after_row->>'id',before_row->>'id',after_row->>'user_id',before_row->>'user_id');
 if entity is null then raise exception 'audit_entity_identity_missing for %',tg_table_name;end if;
 if current_setting('app.import_v2',true)='1' then
  before_row:=case when before_row is null then null else jsonb_build_object('id',entity,'workspace_id',ws) end;
  after_row:=case when after_row is null then null else jsonb_build_object('id',entity,'workspace_id',ws) end;
 else
  if tg_table_name='contacts' then before_row:=before_row-'email'-'phone'-'notes_markdown';after_row:=after_row-'email'-'phone'-'notes_markdown';end if;
  if tg_table_name='payments' then before_row:=before_row-'reference';after_row:=after_row-'reference';end if;
 end if;
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data,request_id)
 values(ws,app_auth.current_user_id(),tg_table_name,entity,tg_op,before_row,after_row,txid_current()::text);
 return coalesce(new,old);
end $$;

create function public.refresh_import_v2(target_batch uuid) returns public.import_batches language plpgsql security definer set search_path=public as $$
declare result public.import_batches;
begin
 update public.import_batches b set total_rows=(select count(*) from public.import_rows where batch_id=b.id),
 valid_rows=(select count(*) from public.import_rows where batch_id=b.id and status in ('VALID','DECIDED')),
 invalid_rows=(select count(*) from public.import_rows where batch_id=b.id and status='INVALID'),
 duplicate_rows=(select count(*) from public.import_rows where batch_id=b.id and status='DUPLICATE'),
 applied_rows=(select count(*) from public.import_rows where batch_id=b.id and status='APPLIED'),
 failed_rows=(select count(*) from public.import_rows where batch_id=b.id and status='FAILED'),
 status=case when exists(select 1 from public.import_rows where batch_id=b.id and status='DUPLICATE') then 'NEEDS_DECISION'
 when exists(select 1 from public.import_rows where batch_id=b.id and status in ('INVALID','FAILED')) then 'PARTIAL_FAILED'
 when not exists(select 1 from public.import_rows where batch_id=b.id and status in ('VALID','DECIDED')) then 'COMPLETED' else 'READY' end,
 updated_at=clock_timestamp() where id=target_batch returning * into result;
 return result;
end $$;
revoke all on function public.refresh_import_v2(uuid) from public,crm_app,crm_system;

create function public.create_import_batch_v2(resource text,filename text,content_hash text,request_key text,headers jsonb,rows jsonb) returns public.import_batches
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare batch public.import_batches;fingerprint text;item jsonb;probe jsonb;ordinal integer:=0;issues jsonb;catalog jsonb:=public.import_v2_catalog()->resource;expected_headers jsonb;
begin
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') or not public.is_workspace_member(public.current_workspace_id()) then raise exception 'PERMISSION_DENIED';end if;
 if catalog is null or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows) not between 1 and 10000 or length(request_key) not between 8 and 160 or content_hash!~'^[a-f0-9]{64}$' then raise exception 'TEMPLATE_SCHEMA_INVALID';end if;
 select jsonb_agg(key order by key) into expected_headers from (select value->>'key' key from jsonb_array_elements(catalog) where (value->>'create')::boolean or (value->>'update')::boolean union all select 'operation' union all select 'targetReference') h;
 if (select jsonb_agg(value order by value) from jsonb_array_elements_text(headers)) is distinct from expected_headers then raise exception 'TEMPLATE_SCHEMA_INVALID';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('actor',app_auth.current_user_id(),'resource',resource,'version','2','filename',filename,'hash',content_hash,'headers',headers,'rows',rows)::text,'sha256'),'hex');
 perform set_config('app.import_v2','1',true);
 insert into public.import_batches(workspace_id,resource_type,original_filename,file_hash,idempotency_key,field_mapping,created_by,template_version,payload_sha256,evidence_expires_at,execution_contract)
 values(public.current_workspace_id(),resource,filename,content_hash,request_key,jsonb_build_object('headers',headers),app_auth.current_user_id(),'2',fingerprint,clock_timestamp()+interval '30 days','CANONICAL_V2')
 on conflict(workspace_id,idempotency_key) do nothing returning * into batch;
 if batch.id is null then
  select * into batch from public.import_batches where workspace_id=public.current_workspace_id() and idempotency_key=request_key for update;
  if batch.created_by<>app_auth.current_user_id() or batch.execution_contract<>'CANONICAL_V2' or batch.payload_sha256<>fingerprint then raise exception 'IMPORT_REQUEST_CONFLICT';end if;
  return batch;
 end if;
 for item in select f.value from jsonb_array_elements(rows) f loop
  ordinal:=ordinal+1;issues:=coalesce(item->'errors','[]');probe:=null;
  if jsonb_typeof(item->'patch')<>'object' or jsonb_typeof(item->'profile')<>'object' or exists(select 1 from jsonb_object_keys(item) k where k<>all(array['operation','targetReference','patch','profile','location','errors'])) then raise exception 'TEMPLATE_SCHEMA_INVALID';end if;
  if issues='[]' then
   begin probe:=public.import_v2_preflight(resource,item);
   exception when others then issues:=jsonb_build_array(jsonb_build_object('code',public.import_v2_error(sqlerrm),'field','row')||coalesce(item->'location','{}'));end;
  end if;
  insert into public.import_rows(workspace_id,batch_id,row_number,raw_data,normalized_data,status,decision,errors,target_revision,source_location,duplicate_reasons)
  values(batch.workspace_id,batch.id,ordinal,item,item||jsonb_build_object('expected',probe),case when issues<>'[]' then 'INVALID' when probe->>'operation'='DUPLICATE_REVIEW' then 'DUPLICATE' when probe->>'operation'='SKIP' then 'SKIPPED' else 'VALID' end,
  case when probe->>'operation'='DUPLICATE_REVIEW' then null else item->>'operation' end,issues,probe->>'updated_at',coalesce(item->'location','{}'),case when probe->>'operation'='DUPLICATE_REVIEW' then '["DUPLICATE_REVIEW"]'::jsonb else '[]'::jsonb end);
 end loop;
 return public.refresh_import_v2(batch.id);
end $$;
revoke all on function public.create_import_batch_v2(text,text,text,text,jsonb,jsonb) from public,crm_system;
grant execute on function public.create_import_batch_v2(text,text,text,text,jsonb,jsonb) to crm_app;

create function public.process_import_batch_v2(target_batch uuid,batch_size integer default 100) returns public.import_batches
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare batch public.import_batches;item public.import_rows;result jsonb;
begin
 perform set_config('app.import_v2','1',true);
 select * into batch from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() and execution_contract='CANONICAL_V2' for update;
 if not found or not public.is_workspace_member(public.current_workspace_id()) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'PERMISSION_DENIED';end if;
 if batch.evidence_expires_at<=now() then raise exception 'IMPORT_EVIDENCE_EXPIRED';end if;
 if batch.status='ROLLED_BACK' or exists(select 1 from public.import_rows where batch_id=batch.id and status='DUPLICATE') then raise exception 'IMPORT_NOT_READY';end if;
 for item in select * from public.import_rows where batch_id=batch.id and status in ('VALID','DECIDED') order by row_number limit greatest(1,least(batch_size,100)) for update loop
  begin
   result:=public.import_v2_apply(batch.resource_type,item.normalized_data,item.normalized_data->'expected');
   update public.import_rows set status='APPLIED',applied_entity_id=(result->>'id')::uuid,before_snapshot=case when item.decision='UPDATE' then result->'before' else null end,
    after_snapshot=result-'before',applied_at=clock_timestamp(),last_error=null where id=item.id;
  exception when others then update public.import_rows set status='FAILED',last_error=public.import_v2_error(sqlerrm) where id=item.id;end;
 end loop;
 return public.refresh_import_v2(batch.id);
end $$;
revoke all on function public.process_import_batch_v2(uuid,integer) from public,crm_system;
grant execute on function public.process_import_batch_v2(uuid,integer) to crm_app;

create function public.repair_import_row_v2(target_row uuid,expected_revision integer,replacement jsonb) returns public.import_rows
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare item public.import_rows;batch public.import_batches;probe jsonb;issues jsonb;
begin
 perform set_config('app.import_v2','1',true);
 select r.* into item from public.import_rows r join public.import_batches b on b.id=r.batch_id where r.id=target_row and b.created_by=app_auth.current_user_id() and b.workspace_id=public.current_workspace_id() and b.execution_contract='CANONICAL_V2' and b.evidence_expires_at>now() for update of r;
 if not found or not public.is_workspace_member(public.current_workspace_id()) or item.status not in ('INVALID','FAILED','DUPLICATE') or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'PERMISSION_DENIED';end if;
 if item.review_revision<>expected_revision then raise exception 'STALE_TARGET';end if;
 select * into batch from public.import_batches where id=item.batch_id for update;
 if replacement ? 'duplicateAcknowledged' or replacement ? 'expected' then raise exception 'TEMPLATE_SCHEMA_INVALID';end if;
 issues:=coalesce(replacement->'errors','[]');
 if issues='[]' then begin probe:=public.import_v2_preflight(batch.resource_type,replacement);exception when others then issues:=jsonb_build_array(jsonb_build_object('code',public.import_v2_error(sqlerrm)));end;end if;
 update public.import_rows set raw_data=replacement,normalized_data=replacement||jsonb_build_object('expected',probe),target_revision=probe->>'updated_at',review_revision=review_revision+1,
 status=case when issues<>'[]' then 'INVALID' when probe->>'operation'='DUPLICATE_REVIEW' then 'DUPLICATE' when replacement->>'operation'='SKIP' then 'SKIPPED' else 'VALID' end,
 decision=case when probe->>'operation'='DUPLICATE_REVIEW' then null else replacement->>'operation' end,errors=issues,last_error=null,decided_by=app_auth.current_user_id(),decided_at=clock_timestamp() where id=item.id returning * into item;
 perform public.refresh_import_v2(batch.id);return item;
end $$;
revoke all on function public.repair_import_row_v2(uuid,integer,jsonb) from public,crm_system;
grant execute on function public.repair_import_row_v2(uuid,integer,jsonb) to crm_app;

create function public.decide_import_row_v2(target_row uuid,expected_revision integer,chosen_action text) returns public.import_rows
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare item public.import_rows;batch public.import_batches;replacement jsonb;probe jsonb;
begin
 perform set_config('app.import_v2','1',true);
 select r.* into item from public.import_rows r join public.import_batches b on b.id=r.batch_id where r.id=target_row and b.workspace_id=public.current_workspace_id() and b.created_by=app_auth.current_user_id() and b.execution_contract='CANONICAL_V2' and b.evidence_expires_at>now() for update of r;
 if not found or not public.is_workspace_member(public.current_workspace_id()) or item.status<>'DUPLICATE' or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'PERMISSION_DENIED';end if;
 if expected_revision<>item.review_revision then raise exception 'STALE_TARGET';end if;
 if chosen_action not in ('CREATE','SKIP') then raise exception 'UNSUPPORTED_OPERATION';end if;
 select * into batch from public.import_batches where id=item.batch_id for update;
 replacement:=(item.raw_data-'expected')||jsonb_build_object('operation',chosen_action,'duplicateAcknowledged',true);
 probe:=public.import_v2_preflight(batch.resource_type,replacement);
 update public.import_rows set normalized_data=replacement||jsonb_build_object('expected',probe),status=case chosen_action when 'SKIP' then 'SKIPPED' else 'DECIDED' end,decision=chosen_action,review_revision=review_revision+1,decided_by=app_auth.current_user_id(),decided_at=clock_timestamp() where id=item.id returning * into item;
 perform public.refresh_import_v2(batch.id);return item;
end $$;
revoke all on function public.decide_import_row_v2(uuid,integer,text) from public,crm_system;
grant execute on function public.decide_import_row_v2(uuid,integer,text) to crm_app;

create function public.save_import_mapping_v2(resource text,profile_name text,mapping jsonb,version text,expected_revision integer default null) returns public.import_mapping_profiles
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result public.import_mapping_profiles;
begin
 if not public.is_workspace_member(public.current_workspace_id()) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') or version not in ('2','LEGACY_UNVERSIONED') or length(profile_name) not between 1 and 80 then raise exception 'PERMISSION_DENIED';end if;
 if version='2' and (public.import_v2_catalog()->resource is null or exists(select 1 from jsonb_each_text(mapping) m where m.value<>m.key or (m.key not in ('operation','targetReference') and not exists(select 1 from jsonb_array_elements(public.import_v2_catalog()->resource) f where f->>'key'=m.key)))) then raise exception 'UNKNOWN_COLUMN';end if;
 perform pg_advisory_xact_lock(hashtextextended(public.current_workspace_id()::text||app_auth.current_user_id()::text||resource||version||profile_name,0));
 select * into result from public.import_mapping_profiles p where p.workspace_id=public.current_workspace_id() and p.owned_by=app_auth.current_user_id() and p.resource=save_import_mapping_v2.resource and p.template_version=version and p.name=profile_name for update;
 if found then
  if expected_revision is distinct from result.revision then raise exception 'STALE_TARGET';end if;
  update public.import_mapping_profiles set mapping=save_import_mapping_v2.mapping,revision=revision+1,updated_at=clock_timestamp() where id=result.id returning * into result;
 else
  if expected_revision is not null then raise exception 'STALE_TARGET';end if;
  insert into public.import_mapping_profiles(resource,name,mapping,template_version) values(resource,profile_name,mapping,version) returning * into result;
 end if;
 return result;
end $$;
revoke all on function public.save_import_mapping_v2(text,text,jsonb,text,integer) from public,crm_system;
grant execute on function public.save_import_mapping_v2(text,text,jsonb,text,integer) to crm_app;

-- Existing guarded rollback semantics, with minimal field snapshots and owning update mutations.
create function public.rollback_import_batch_v2(target_batch uuid,request_key text) returns public.import_batches
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare batch public.import_batches;item public.import_rows;result jsonb;receipt public.mutation_receipts; table_name text;current_row jsonb;dependency record;has_dependency boolean;
begin
 perform set_config('app.import_v2','1',true);
 if length(request_key) not between 8 and 160 then raise exception 'INVALID_REQUEST_KEY';end if;
 select * into batch from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() and execution_contract='CANONICAL_V2' for update;
 if not found or not public.is_workspace_member(public.current_workspace_id()) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'PERMISSION_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(batch.workspace_id::text||request_key,0));
 select * into receipt from public.mutation_receipts r where r.workspace_id=batch.workspace_id and r.request_key=rollback_import_batch_v2.request_key;
 if found then
  if receipt.operation<>'IMPORT_V2_ROLLBACK' or receipt.created_by<>app_auth.current_user_id() or receipt.result->>'id'<>target_batch::text then raise exception 'PAYLOAD_REUSE';end if;
  return batch;
 end if;
 if batch.evidence_expires_at<=now() or batch.status not in ('COMPLETED','PARTIAL_FAILED') then raise exception 'IMPORT_NOT_READY';end if;
 table_name:=case batch.resource_type when 'ORGANIZATIONS' then 'organizations' when 'HOUSEHOLDS' then 'households' when 'CONTACTS' then 'contacts' when 'STUDENTS' then 'students' end;
 for item in select * from public.import_rows where batch_id=batch.id and status='APPLIED' order by row_number desc for update loop
  if item.before_snapshot is not null then
   result:=public.import_v2_apply(batch.resource_type,jsonb_build_object('operation','UPDATE','targetReference',item.applied_entity_id,'patch',item.before_snapshot->'patch','profile',item.before_snapshot->'profile'),item.after_snapshot,true);
  else
   if not public.import_reference_access(case batch.resource_type when 'ORGANIZATIONS' then 'ORGANIZATION' when 'HOUSEHOLDS' then 'HOUSEHOLD' when 'CONTACTS' then 'CONTACT' else 'STUDENT' end,item.applied_entity_id,true) then raise exception 'INVALID_REFERENCE';end if;
   execute format('select to_jsonb(r) from public.%I r where id=$1 for update',table_name) into current_row using item.applied_entity_id;
   if current_row->>'updated_at' is distinct from item.after_snapshot->>'updated_at' then raise exception 'STALE_TARGET';end if;
   -- Never cascade-delete subsequent business relationships. Own profile is the sole exception.
   for dependency in select c.conrelid::regclass as relation,a.attname as column_name from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] where c.contype='f' and c.confrelid=format('public.%I',table_name)::regclass and array_length(c.conkey,1)=1 and c.conrelid not in ('public.organization_business_profiles'::regclass,'public.family_education_needs'::regclass) loop
    execute format('select exists(select 1 from %s where %I=$1)',dependency.relation,dependency.column_name) into has_dependency using item.applied_entity_id;
    if has_dependency then raise exception 'IMPORT_ROLLBACK_HAS_DEPENDENCIES';end if;
   end loop;
   if batch.resource_type in ('ORGANIZATIONS','HOUSEHOLDS') and exists(select 1 from jsonb_array_elements(public.import_v2_catalog()->batch.resource_type) f where f->>'scope'='PROFILE') then
    execute format('select revision from public.%I where id=$1',case batch.resource_type when 'ORGANIZATIONS' then 'organization_business_profiles' else 'family_education_needs' end) into result using item.applied_entity_id;
    if result is not null and result is distinct from item.after_snapshot->'profile_revision' then raise exception 'STALE_TARGET';end if;
   end if;
   execute format('delete from public.%I where id=$1',table_name) using item.applied_entity_id;
  end if;
  update public.import_rows set status='ROLLED_BACK' where id=item.id;
 end loop;
 update public.import_batches set status='ROLLED_BACK',rolled_back_at=clock_timestamp(),updated_at=clock_timestamp() where id=batch.id returning * into batch;
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(batch.workspace_id,request_key,'IMPORT_V2_ROLLBACK',jsonb_build_object('id',batch.id),app_auth.current_user_id());
 return batch;
end $$;
revoke all on function public.rollback_import_batch_v2(uuid,text) from public,crm_system;
grant execute on function public.rollback_import_batch_v2(uuid,text) to crm_app;

create function public.import_v2_row_visible(batch_id uuid,normalized jsonb,applied_id uuid) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare batch public.import_batches;identity uuid;
begin
 select * into batch from public.import_batches where id=batch_id and workspace_id=public.current_workspace_id();
 if not found then return false;end if;
 if batch.execution_contract<>'CANONICAL_V2' then return true;end if;
 if batch.evidence_expires_at<=now() or batch.created_by<>app_auth.current_user_id() then return false;end if;
 identity:=coalesce(applied_id,(normalized->'expected'->>'id')::uuid);
 return identity is null or public.import_reference_access(case batch.resource_type when 'ORGANIZATIONS' then 'ORGANIZATION' when 'HOUSEHOLDS' then 'HOUSEHOLD' when 'CONTACTS' then 'CONTACT' else 'STUDENT' end,identity,false);
end $$;
revoke all on function public.import_v2_row_visible(uuid,jsonb,uuid) from public,crm_system;
grant execute on function public.import_v2_row_visible(uuid,jsonb,uuid) to crm_app;
create policy "v2 evidence current parent access" on public.import_rows as restrictive for select to crm_app using(public.import_v2_row_visible(batch_id,normalized_data,applied_entity_id));

create function public.purge_expired_import_v2_evidence() returns integer
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ids uuid[];count_rows integer;
begin
 perform set_config('app.import_v2','1',true);
 select array_agg(id) into ids from (select id from public.import_batches where execution_contract='CANONICAL_V2' and evidence_expires_at<=now() and field_mapping<>'{}' order by evidence_expires_at limit 100 for update skip locked) b;
 update public.import_rows set raw_data='{}',normalized_data='{}',errors='[]',before_snapshot=null,after_snapshot=null,duplicate_reasons='[]',last_error=null where batch_id=any(ids);
 get diagnostics count_rows=row_count;
 update public.import_batches set field_mapping='{}',original_filename='[expired import evidence]' where id=any(ids);
 delete from public.import_reference_tokens where token_hash in (select token_hash from public.import_reference_tokens where expires_at<=now() limit 1000);
 return count_rows;
end $$;
revoke all on function public.purge_expired_import_v2_evidence() from public,crm_app,crm_system;
grant execute on function public.purge_expired_import_v2_evidence() to crm_worker;

-- v2 batches cannot be routed through the independent legacy write/repair/rollback paths.
alter function public.process_import_batch(uuid,integer) rename to process_import_batch_before_v2;
alter function public.repair_import_row(uuid,jsonb) rename to repair_import_row_before_v2;
alter function public.decide_import_row(uuid,text) rename to decide_import_row_before_v2;
alter function public.rollback_import_batch(uuid) rename to rollback_import_batch_before_v2;
revoke all on function public.process_import_batch_before_v2(uuid,integer),public.repair_import_row_before_v2(uuid,jsonb),public.decide_import_row_before_v2(uuid,text),public.rollback_import_batch_before_v2(uuid) from public,crm_app,crm_system;
create function public.process_import_batch(target_batch uuid,batch_size integer default 100) returns public.import_batches language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() and execution_contract='CANONICAL_V2') then raise exception 'TEMPLATE_VERSION_UNSUPPORTED';end if;
 return public.process_import_batch_before_v2(target_batch,batch_size);end $$;
create function public.repair_import_row(target_row uuid,replacement jsonb) returns public.import_rows language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from public.import_rows r join public.import_batches b on b.id=r.batch_id where r.id=target_row and b.execution_contract='CANONICAL_V2') then raise exception 'TEMPLATE_VERSION_UNSUPPORTED';end if;
 return public.repair_import_row_before_v2(target_row,replacement);end $$;
create function public.decide_import_row(target_row uuid,chosen_action text) returns public.import_rows language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from public.import_rows r join public.import_batches b on b.id=r.batch_id where r.id=target_row and b.execution_contract='CANONICAL_V2') then raise exception 'TEMPLATE_VERSION_UNSUPPORTED';end if;
 return public.decide_import_row_before_v2(target_row,chosen_action);end $$;
create function public.rollback_import_batch(target_batch uuid) returns public.import_batches language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() and execution_contract='CANONICAL_V2') then raise exception 'TEMPLATE_VERSION_UNSUPPORTED';end if;
 return public.rollback_import_batch_before_v2(target_batch);end $$;
revoke all on function public.process_import_batch(uuid,integer),public.repair_import_row(uuid,jsonb),public.decide_import_row(uuid,text),public.rollback_import_batch(uuid) from public,crm_system;
grant execute on function public.process_import_batch(uuid,integer),public.repair_import_row(uuid,jsonb),public.decide_import_row(uuid,text),public.rollback_import_batch(uuid) to crm_app;

create function public.search_import_references(kind text,query text) returns jsonb
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare result jsonb;table_name text;label_expression text;
begin
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') or not public.is_workspace_member(public.current_workspace_id()) then raise exception 'PERMISSION_DENIED';end if;
 if kind='STAFF' then
  select coalesce(jsonb_agg(x),'[]') into result from (select a.id,a.username as label from app_auth.accounts a where public.import_reference_access('STAFF',a.id,true) and a.username ilike '%'||left(query,120)||'%' order by a.username,a.id limit 20) x;
  return result;
 end if;
 table_name:=case kind when 'ORGANIZATION' then 'organizations' when 'HOUSEHOLD' then 'households' when 'CONTACT' then 'contacts' when 'STUDENT' then 'students' when 'PRODUCT' then 'products' when 'COHORT' then 'product_cohorts' when 'OPPORTUNITY' then 'opportunities' end;
 if table_name is null then raise exception 'INVALID_REFERENCE';end if;
 label_expression:=case kind when 'STUDENT' then 'coalesce(r.student_number,''Student'')' when 'OPPORTUNITY' then 'r.title_zh||'' / ''||r.title_en' else 'r.name_zh||'' / ''||r.name_en' end;
 execute format('select coalesce(jsonb_agg(x),''[]''::jsonb) from (select r.id,%s as label from public.%I r where r.workspace_id=$1 and public.import_reference_access($2,r.id,false) and %s ilike $3 order by label,r.id limit 20) x',label_expression,table_name,label_expression) into result using public.current_workspace_id(),kind,'%'||left(query,120)||'%';
 return result;
end $$;
revoke all on function public.search_import_references(text,text) from public,crm_system;
grant execute on function public.search_import_references(text,text) to crm_app;

-- Legacy file identity stays explicit. Only newly submitted batches use canonical semantics;
-- existing legacy SQL batches and their repair/rollback history remain unchanged.
alter function public.create_import_batch(text,text,text,text,jsonb,jsonb) rename to create_import_batch_before_v2;
revoke all on function public.create_import_batch_before_v2(text,text,text,text,jsonb,jsonb) from public,crm_app,crm_system;
create function public.create_import_batch(resource text,filename text,content_hash text,request_key text,mapping jsonb,rows jsonb) returns public.import_batches
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result public.import_batches;fingerprint text;item jsonb;normalized jsonb:='[]';patch jsonb;field jsonb;value text;typed_value jsonb;kind text;headers jsonb;ordinal integer:=0;
begin
 if resource in ('COHORTS','ENROLLMENTS') then return public.create_import_batch_before_v2(resource,filename,content_hash,request_key,mapping,rows);end if;
 if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') or public.import_v2_catalog()->resource is null or not public.is_workspace_member(public.current_workspace_id()) then raise exception 'PERMISSION_DENIED';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('resource',resource,'actor',app_auth.current_user_id(),'filename',filename,'hash',content_hash,'mapping',mapping,'rows',rows)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(public.current_workspace_id()::text||request_key,0));
 select * into result from public.import_batches where workspace_id=public.current_workspace_id() and idempotency_key=request_key for update;
 if found then
  if result.created_by<>app_auth.current_user_id() or result.template_version<>'LEGACY_UNVERSIONED' or result.payload_sha256 is distinct from fingerprint then raise exception 'IMPORT_REQUEST_CONFLICT';end if;
  return result;
 end if;
 for item in select f.value from jsonb_array_elements(rows) f loop
  patch:='{}';ordinal:=ordinal+1;
  for field in select f.value from jsonb_array_elements(public.import_v2_catalog()->resource) f where f.value->>'scope'='CORE' and (f.value->>'create')::boolean loop
   value:=nullif(trim(item->>(field->>'key')),'');if value is null then continue;end if;
   typed_value:=to_jsonb(value);
   if field->>'type'='reference' then
    kind:=case field->>'key' when 'parentOrganizationId' then 'ORGANIZATION' when 'organizationId' then 'ORGANIZATION' when 'personId' then 'CONTACT' when 'householdId' then 'HOUSEHOLD' when 'ownerId' then 'STAFF' end;
    if value!~'^[0-9a-fA-F-]{36}$' then raise exception 'INVALID_REFERENCE';end if;
    typed_value:=to_jsonb(public.issue_import_reference(kind,value::uuid));
   elsif field->>'type'='integer' then if value!~'^\d+$' then raise exception 'INVALID_INTEGER';end if;typed_value:=to_jsonb(value::integer);
   elsif field->>'type'='array' then typed_value:=to_jsonb(regexp_split_to_array(value,'\s*[,，]\s*'));
   end if;
   patch:=patch||jsonb_build_object(field->>'key',typed_value);
  end loop;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('operation','CREATE','targetReference','','patch',patch,'profile','{}'::jsonb,'location',jsonb_build_object('row',ordinal+1),'errors','[]'::jsonb));
 end loop;
 select jsonb_agg(key order by key) into headers from (select f.value->>'key' key from jsonb_array_elements(public.import_v2_catalog()->resource) f union all select 'operation' union all select 'targetReference') x;
 result:=public.create_import_batch_v2(resource,filename,content_hash,request_key,headers,normalized);
 update public.import_batches set template_version='LEGACY_UNVERSIONED',payload_sha256=fingerprint,field_mapping=mapping||jsonb_build_object('_execution_contract','CANONICAL_V2') where id=result.id returning * into result;
 return result;
end $$;
revoke all on function public.create_import_batch(text,text,text,text,jsonb,jsonb) from public,crm_system;
grant execute on function public.create_import_batch(text,text,text,text,jsonb,jsonb) to crm_app;

alter function public.import_dry_run(uuid) rename to import_dry_run_before_v2;
revoke all on function public.import_dry_run_before_v2(uuid) from public,crm_app,crm_system;
create function public.import_dry_run(target_batch uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare batch public.import_batches;
begin
 select * into batch from public.import_batches where id=target_batch and workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id();
 if not found or not public.is_workspace_member(public.current_workspace_id()) then raise exception 'PERMISSION_DENIED';end if;
 if batch.execution_contract<>'CANONICAL_V2' then return public.import_dry_run_before_v2(target_batch);end if;
 if batch.evidence_expires_at<=now() then raise exception 'IMPORT_EVIDENCE_EXPIRED';end if;
 return jsonb_build_object('create',(select count(*) from public.import_rows where batch_id=batch.id and decision='CREATE' and status in ('VALID','DECIDED')),'update',(select count(*) from public.import_rows where batch_id=batch.id and decision='UPDATE' and status in ('VALID','DECIDED')),'skip',(select count(*) from public.import_rows where batch_id=batch.id and status='SKIPPED'),'merge',0,'invalid',batch.invalid_rows+batch.failed_rows,'unresolved',batch.duplicate_rows,'canExecute',batch.duplicate_rows=0 and batch.valid_rows>0 and batch.status<>'ROLLED_BACK');
end $$;
revoke all on function public.import_dry_run(uuid) from public,crm_system;
grant execute on function public.import_dry_run(uuid) to crm_app;

create policy "v2 mapping update revision RPC" on public.import_mapping_profiles as restrictive for update to crm_app using(template_version<>'2') with check(template_version<>'2');
create policy "v2 mapping insert revision RPC" on public.import_mapping_profiles as restrictive for insert to crm_app with check(template_version<>'2');
create policy "v2 mapping deletion RPC" on public.import_mapping_profiles as restrictive for delete to crm_app using(template_version<>'2');
