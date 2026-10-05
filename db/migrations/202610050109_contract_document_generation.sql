-- Source-aware document evidence; original Contract/Agreement facts remain authoritative.
set search_path=public,app_auth,extensions;

create table public.contract_document_template_versions(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 template_key text not null check(template_key in ('channel-recruitment','student-program')),
 version_number integer not null check(version_number>0),definition jsonb not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','RETIRED')),
 active boolean not null default false,created_by uuid not null references app_auth.accounts(id),
 created_at timestamptz not null default clock_timestamp(),approved_by uuid references app_auth.accounts(id),approved_at timestamptz,
 unique(workspace_id,id),unique(workspace_id,template_key,version_number),
 check(not active or status='APPROVED'),check(status='DRAFT' or (approved_by is not null and approved_at is not null))
);
create unique index document_template_active on public.contract_document_template_versions(workspace_id,template_key) where active;
create table public.contract_document_configurations(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 encrypted_values jsonb not null,version_number integer not null check(version_number>0),
 status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','RETIRED')),active boolean not null default false,
 created_by uuid not null references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),
 approved_by uuid references app_auth.accounts(id),approved_at timestamptz,
 unique(workspace_id,id),unique(workspace_id,version_number),check(not active or status='APPROVED')
);
create unique index document_configuration_active on public.contract_document_configurations(workspace_id) where active;

create table public.generated_contract_documents(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
 source_kind text not null check(source_kind in ('CUSTOMER_CONTRACT','CHANNEL_AGREEMENT_VERSION')),source_id uuid not null,
 source_revision integer not null check(source_revision>0),source_reference text not null,
 template_id uuid not null,configuration_id uuid not null,document_version integer not null check(document_version>0),
 status text not null default 'QUEUED' check(status in ('QUEUED','GENERATED','FAILED','ERASURE_PENDING','ERASED')),
 input_snapshot jsonb,evidence jsonb,artifact_key text,artifact_sha256 text,mime_type text,bytes bigint,
 artifact_attempts text[] not null default array[]::text[],
 generated_job_id uuid unique references public.generated_jobs(id),generated_at timestamptz,
 created_by uuid not null references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),
 request_key text not null check(length(request_key) between 8 and 160),request_fingerprint text not null,
 regeneration_reason text not null default '' check(length(regeneration_reason)<=500),
 unique(workspace_id,id),unique(workspace_id,created_by,request_key),unique(workspace_id,source_kind,source_id,document_version),
 foreign key(workspace_id,template_id) references public.contract_document_template_versions(workspace_id,id),
 foreign key(workspace_id,configuration_id) references public.contract_document_configurations(workspace_id,id),
 check(status<>'GENERATED' or (artifact_key is not null and artifact_sha256~'^[a-f0-9]{64}$' and bytes>0 and evidence is not null))
);
alter table public.generated_jobs add column document_generation_id uuid unique references public.generated_contract_documents(id);
alter table public.generated_jobs drop constraint generated_jobs_origin_check;
alter table public.generated_jobs add constraint generated_jobs_origin_check check(
 (case when approval_request_id is null then 0 else 1 end)+(case when privacy_request_id is null then 0 else 1 end)
 +(case when document_generation_id is null then 0 else 1 end)=1);
alter table public.generated_jobs drop constraint generated_jobs_job_type_check;
alter table public.generated_jobs add constraint generated_jobs_job_type_check check(job_type in
 ('CONTRACT_EXPORT','PERFORMANCE_SUMMARY','MARKETING_CONTACT_EXPORT','CRM_EXPORT','PRIVACY_EXPORT','CONTRACT_DOCUMENT_GENERATION'));

create function public.document_source_access(kind text,source uuid,edit boolean default false) returns boolean
language sql stable security definer set search_path=public,app_auth as $$
 select coalesce(public.is_workspace_member(public.current_workspace_id()) and case kind
 when 'CUSTOMER_CONTRACT' then exists(select 1 from public.contracts c where c.id=source and c.workspace_id=public.current_workspace_id()
   and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,edit)
   and (c.household_id is null or public.customer_subject_access('HOUSEHOLD',c.household_id,false))
   and (c.organization_id is null or public.customer_subject_access('ORGANIZATION',c.organization_id,false)))
 when 'CHANNEL_AGREEMENT_VERSION' then exists(select 1 from public.channel_agreement_versions v join public.channel_agreements a on a.id=v.agreement_id
   where v.id=source and v.workspace_id=public.current_workspace_id() and public.channel_commercial_access(a.organization_id,edit)) else false end,false)
$$;

create function public.document_generation_context(kind text,source uuid,context jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id(); c public.contracts; e public.student_enrollments; h public.households;
 s public.students; person public.contacts;p public.products;co public.product_cohorts;
 v public.channel_agreement_versions;a public.channel_agreements;o public.organizations;r public.channel_commission_rules;
 canon jsonb;rev integer;refs jsonb;
begin
 if not public.document_source_access(kind,source,false) then raise exception 'document_source_not_found';end if;
 if jsonb_typeof(context) is distinct from 'object' or exists(select 1 from jsonb_object_keys(context) k where k not in ('enrollmentId','productId','cohortId','commissionRuleId')) then raise exception 'document_input_invalid';end if;
 if kind='CUSTOMER_CONTRACT' then
  select * into c from public.contracts where id=source and workspace_id=ws;
  select max(version) into rev from public.contract_versions where contract_id=c.id and workspace_id=ws;
  select * into e from public.student_enrollments where id=(context->>'enrollmentId')::uuid and workspace_id=ws;
  if e.id is null or not public.student_enrollment_access(to_jsonb(e),false) or not exists(select 1 from public.contract_enrollment_links
    where workspace_id=ws and contract_id=c.id and enrollment_id=e.id and status='ACTIVE') then raise exception 'document_enrollment_not_found';end if;
  select * into h from public.households where id=c.household_id and workspace_id=ws;
  if h.id is null or not public.customer_subject_access('HOUSEHOLD',h.id,false) then raise exception 'document_buyer_not_found';end if;
  select * into s from public.students where id=e.student_id and workspace_id=ws;
  select * into person from public.contacts where id=s.person_id and workspace_id=ws;
  if person.id is null or not public.can_access_owned_record(ws,'CONTACT',person.id,person.owner_id,false) then raise exception 'document_participant_not_found';end if;
  select * into co from public.product_cohorts where id=e.cohort_id and workspace_id=ws;
  select * into p from public.products where id=co.product_id and workspace_id=ws;
  canon:=jsonb_build_object('contract.reference',c.contract_number,'contract.amount',c.contract_value::text,'contract.currency',c.currency,
   'buyer.household_name',coalesce(nullif(h.name_zh,''),h.name_en),'participant.name',coalesce(nullif(person.name_zh,''),person.name_en),
   'program.name',coalesce(nullif(p.name_zh,''),p.name_en),'cohort.name',coalesce(nullif(co.name_zh,''),co.name_en),
   'program.start_on',co.start_on,'program.end_on',co.end_on);
  refs:=jsonb_build_object('enrollmentId',e.id,'enrollmentRevision',e.revision,'studentId',s.id,'contactId',person.id,'householdId',h.id,'productId',p.id,'cohortId',co.id);
 else
  select * into v from public.channel_agreement_versions where id=source and workspace_id=ws;
  select * into a from public.channel_agreements where id=v.agreement_id and workspace_id=ws;
  select * into o from public.organizations where id=a.organization_id and workspace_id=ws;
  select * into r from public.channel_commission_rules where id=(context->>'commissionRuleId')::uuid and workspace_id=ws and agreement_version_id=v.id;
  if r.id is null then raise exception 'document_commission_rule_not_found';end if;
  if r.basis_type<>'FIXED_PER_ENROLLMENT' then raise exception 'document_commission_basis_unsupported';end if;
  select * into p from public.products where id=(context->>'productId')::uuid and workspace_id=ws;
  select * into co from public.product_cohorts where id=(context->>'cohortId')::uuid and workspace_id=ws and product_id=p.id;
  if p.id is null or co.id is null or (r.product_id is not null and r.product_id<>p.id) or (r.cohort_id is not null and r.cohort_id<>co.id) then raise exception 'document_program_context_invalid';end if;
  rev:=v.revision;
  canon:=jsonb_build_object('agreement.reference',a.agreement_code,'channel.organization_name',coalesce(nullif(o.name_zh,''),o.name_en),
   'agreement.signing_date',v.signed_on,'agreement.effective_from',v.effective_from,'agreement.effective_to',v.effective_to,
   'commission.amount',r.fixed_amount::text,'commission.currency',r.fixed_currency,
   'program.name',coalesce(nullif(p.name_zh,''),p.name_en),'cohort.name',coalesce(nullif(co.name_zh,''),co.name_en));
  refs:=jsonb_build_object('agreementId',a.id,'agreementVersionId',v.id,'agreementVersion',v.version,'organizationId',o.id,'commissionRuleId',r.id,'productId',p.id,'cohortId',co.id);
 end if;
 return jsonb_build_object('sourceKind',kind,'sourceId',source,'sourceRevision',rev,'canonical',canon,'references',refs,'actorId',app_auth.current_user_id(),'workspaceId',ws);
end $$;

create function public.document_governance_allowed() returns boolean language sql stable security definer set search_path=public,app_auth as $$
 select public.is_workspace_member(public.current_workspace_id()) and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR') and app_auth.current_claims()->>'aal'='aal2'
$$;
create function public.register_document_template(definition jsonb) returns uuid language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result uuid;ws uuid:=public.current_workspace_id();begin
 if not public.document_governance_allowed() then raise exception 'document_governance_forbidden';end if;
 if definition->>'template_key' not in ('channel-recruitment','student-program') or definition->>'template_sha256' !~ '^[a-f0-9]{64}$'
  or definition->>'template_path' !~ '^templates/contracts/[a-z0-9-]+-v[0-9]+\.docx$' or jsonb_array_length(definition->'fields')<1
  or definition->>'status'<>'DRAFT' or (definition->>'version_number')::integer<1 then raise exception 'document_template_invalid';end if;
 select id into result from public.contract_document_template_versions where workspace_id=ws and template_key=register_document_template.definition->>'template_key' and version_number=(register_document_template.definition->>'version_number')::integer;
 if result is not null then
  if not exists(select 1 from public.contract_document_template_versions where id=result and contract_document_template_versions.definition=register_document_template.definition) then raise exception 'document_template_immutable';end if;
  return result;
 end if;
 insert into public.contract_document_template_versions(workspace_id,template_key,version_number,definition,created_by)
 values(ws,register_document_template.definition->>'template_key',(register_document_template.definition->>'version_number')::integer,register_document_template.definition,app_auth.current_user_id()) returning id into result;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,app_auth.current_user_id(),'DOCUMENT_TEMPLATE_REGISTERED','DOCUMENT_TEMPLATE',result,jsonb_build_object('sha256',definition->>'template_sha256'));
 return result;
end $$;
create function public.save_document_configuration(encrypted_values jsonb) returns uuid language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result uuid;ws uuid:=public.current_workspace_id();begin
 if not public.document_governance_allowed() then raise exception 'document_governance_forbidden';end if;
 if encrypted_values->>'version'<>'1' or length(encrypted_values->>'ciphertext') not between 1 and 60000 or encrypted_values->>'iv' is null or encrypted_values->>'tag' is null then raise exception 'document_configuration_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||'document-configuration',0));
 insert into public.contract_document_configurations(workspace_id,version_number,encrypted_values,created_by) select ws,coalesce(max(version_number),0)+1,save_document_configuration.encrypted_values,app_auth.current_user_id() from public.contract_document_configurations where workspace_id=ws returning id into result;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id) values(ws,app_auth.current_user_id(),'DOCUMENT_CONFIGURATION_CREATED','DOCUMENT_CONFIGURATION',result);
 return result;
end $$;
create function public.govern_document_configuration(record_id uuid,next_status text) returns void language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare item public.contract_document_configurations;ws uuid:=public.current_workspace_id();begin
 if not public.document_governance_allowed() then raise exception 'document_governance_forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||'document-configuration',0));
 select * into item from public.contract_document_configurations where id=record_id and workspace_id=ws for update;
 if item.id is null or next_status not in ('APPROVED','RETIRED') then raise exception 'document_configuration_invalid';end if;
 if item.status=next_status then return;end if;
 if next_status='APPROVED' then
  if item.status<>'DRAFT' or item.created_by=app_auth.current_user_id() then raise exception 'document_maker_checker_required';end if;
  update public.contract_document_configurations set active=false where workspace_id=ws and active;
  update public.contract_document_configurations set status='APPROVED',active=true,approved_by=app_auth.current_user_id(),approved_at=clock_timestamp() where id=item.id;
 else if item.status<>'APPROVED' then raise exception 'document_configuration_invalid';end if;update public.contract_document_configurations set status='RETIRED',active=false where id=item.id;end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,app_auth.current_user_id(),'DOCUMENT_CONFIGURATION_'||next_status,'DOCUMENT_CONFIGURATION',item.id,jsonb_build_object('status',next_status));
end $$;
create function public.govern_document_template(record_id uuid,next_status text) returns void language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare item public.contract_document_template_versions;ws uuid:=public.current_workspace_id();begin
 if not public.document_governance_allowed() then raise exception 'document_governance_forbidden';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||'document-template',0));
 select * into item from public.contract_document_template_versions where id=record_id and workspace_id=ws for update;
 if item.id is null or next_status not in ('APPROVED','RETIRED') then raise exception 'document_template_invalid';end if;
 if item.status=next_status then return;end if;
 if next_status='APPROVED' then
  if item.status<>'DRAFT' or item.created_by=app_auth.current_user_id() then raise exception 'document_maker_checker_required';end if;
  if jsonb_array_length(item.definition->'review_items')<>0 or exists(select 1 from jsonb_array_elements(item.definition->'fields') f where f->>'category'='UNSUPPORTED') then raise exception 'document_template_review_required';end if;
  update public.contract_document_template_versions set active=false where workspace_id=ws and template_key=item.template_key and active;
  update public.contract_document_template_versions set status='APPROVED',active=true,approved_by=app_auth.current_user_id(),approved_at=clock_timestamp() where id=item.id;
 else if item.status<>'APPROVED' then raise exception 'document_template_invalid';end if;update public.contract_document_template_versions set status='RETIRED',active=false where id=item.id;end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,app_auth.current_user_id(),'DOCUMENT_TEMPLATE_'||next_status,'DOCUMENT_TEMPLATE',item.id,jsonb_build_object('sha256',item.definition->>'template_sha256','status',next_status));
end $$;

create function public.request_contract_document(template_id uuid,kind text,source uuid,expected_revision integer,context jsonb,confirmed_values jsonb,p_request_key text,regeneration_reason text default '') returns uuid
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();t public.contract_document_template_versions;cfg public.contract_document_configurations;
 ctx jsonb;input jsonb;fingerprint text;result public.generated_contract_documents;job uuid;field jsonb;fkey text;
begin
 if not public.document_source_access(kind,source,true) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') then raise exception 'document_source_not_found';end if;
 if expected_revision is null or expected_revision<1 or p_request_key is null or length(p_request_key) not between 8 and 160 or jsonb_typeof(confirmed_values) is distinct from 'object' or length(confirmed_values::text)>100000 or length(regeneration_reason)>500 then raise exception 'document_input_invalid';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('actor',actor,'template',template_id,'kind',kind,'source',source,'revision',expected_revision,'context',context,'confirmed',confirmed_values,'reason',regeneration_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||actor::text||p_request_key,0));
 select * into result from public.generated_contract_documents where workspace_id=ws and created_by=actor and request_key=p_request_key;
 if found then if result.request_fingerprint<>fingerprint then raise exception 'document_request_conflict';end if;return result.id;end if;
 if kind='CUSTOMER_CONTRACT' then perform 1 from public.contracts where id=source and workspace_id=ws for update;
 else perform 1 from public.channel_agreement_versions where id=source and workspace_id=ws for update;end if;
 ctx:=public.document_generation_context(kind,source,context);
 if (ctx->>'sourceRevision')::integer<>expected_revision then raise exception 'document_source_conflict';end if;
 select * into t from public.contract_document_template_versions where id=request_contract_document.template_id and workspace_id=ws for share;
 if t.id is null or t.status<>'APPROVED' or not t.active then raise exception 'document_template_not_approved';end if;
 if (kind='CUSTOMER_CONTRACT')<>(t.template_key='student-program') then raise exception 'document_template_type_mismatch';end if;
 if exists(select 1 from jsonb_array_elements(t.definition->'fields') f where f->>'category'='UNSUPPORTED') or jsonb_array_length(t.definition->'review_items')<>0 then raise exception 'document_generation_blocked';end if;
 select * into cfg from public.contract_document_configurations where workspace_id=ws and active and status='APPROVED' for share;
 if cfg.id is null then raise exception 'document_configuration_required';end if;
 for fkey in select jsonb_object_keys(confirmed_values) loop
  if not exists(select 1 from jsonb_array_elements(t.definition->'fields') f where f->>'key'=fkey and f->>'category'='USER_CONFIRMED' and fkey !~ '^company\.' and (kind='CHANNEL_AGREEMENT_VERSION' or fkey !~ '^bank\.')) then raise exception 'document_field_override_forbidden';end if;
  if length(confirmed_values->>fkey)>5000 or confirmed_values->>fkey ~ '\{\{|\}\}' then raise exception 'document_field_invalid';end if;
 end loop;
 for field in select value from jsonb_array_elements(t.definition->'fields') loop
  fkey:=field->>'key';
  if field->>'category'='CANONICAL' and coalesce((ctx->'canonical'->>fkey),'')='' and field->>'required'='true' then raise exception 'document_required_field_missing';end if;
  if field->>'category'='USER_CONFIRMED' and fkey !~ '^company\.' and (kind='CHANNEL_AGREEMENT_VERSION' or fkey !~ '^bank\.') and (field->>'required'='true' or (field->'required_if' is not null and confirmed_values->(field->'required_if'->>'field')=field->'required_if'->'equals'))
   and coalesce(confirmed_values->>fkey,'')='' then raise exception 'document_required_field_missing';end if;
 end loop;
 -- Only consumed canonical fields are retained, never full source records.
 ctx:=jsonb_set(ctx,'{canonical}',coalesce((select jsonb_object_agg(f->>'key',ctx->'canonical'->(f->>'key')) from jsonb_array_elements(t.definition->'fields') f where f->>'category'='CANONICAL'),'{}'));
 input:=jsonb_build_object('context',ctx,'selectedContext',context,'confirmed',confirmed_values,'confirmedBy',actor,'confirmedAt',clock_timestamp());
 if kind='CUSTOMER_CONTRACT' then
  input:=input||jsonb_build_object('privacyContactIds',coalesce((select jsonb_agg(distinct contact_id) from (
   select contact_id from public.household_members where workspace_id=ws and household_id=(ctx->'references'->>'householdId')::uuid
   union select guardian_contact_id from public.student_guardian_relationships where workspace_id=ws and student_id=(ctx->'references'->>'studentId')::uuid
   union select (ctx->'references'->>'contactId')::uuid) subjects),'[]'));
 else
  input:=input||jsonb_build_object('privacyContactIds',coalesce((select jsonb_agg(distinct contact_id) from (
   select id contact_id from public.contacts where workspace_id=ws and organization_id=(ctx->'references'->>'organizationId')::uuid
   union select contact_id from public.organization_contact_intelligence where workspace_id=ws and organization_id=(ctx->'references'->>'organizationId')::uuid
   union select primary_contact_id from public.organization_business_profiles where workspace_id=ws and id=(ctx->'references'->>'organizationId')::uuid and primary_contact_id is not null) subjects),'[]'));
 end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||kind||source::text,0));
 insert into public.generated_contract_documents(workspace_id,source_kind,source_id,source_revision,source_reference,template_id,configuration_id,document_version,input_snapshot,created_by,request_key,request_fingerprint,regeneration_reason)
 select ws,kind,source,expected_revision,coalesce(ctx->'canonical'->>'contract.reference',ctx->'canonical'->>'agreement.reference','Document'),t.id,cfg.id,coalesce(max(document_version),0)+1,input,actor,p_request_key,fingerprint,request_contract_document.regeneration_reason
 from public.generated_contract_documents where workspace_id=ws and source_kind=kind and source_id=source returning * into result;
 insert into public.generated_jobs(workspace_id,job_type,parameters,created_by,document_generation_id)
 values(ws,'CONTRACT_DOCUMENT_GENERATION',jsonb_build_object('format','DOCX','documentId',result.id),actor,result.id) returning id into job;
 update public.generated_contract_documents set generated_job_id=job where id=result.id;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'CONTRACT_DOCUMENT_GENERATION_REQUESTED','GENERATED_CONTRACT_DOCUMENT',result.id,jsonb_build_object('sourceKind',kind,'sourceId',source,'templateId',t.id));
 return result.id;
end $$;

create function public.document_worker_input(job_id uuid,token uuid) returns jsonb language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare j public.generated_jobs;d public.generated_contract_documents;t public.contract_document_template_versions;cfg public.contract_document_configurations;ctx jsonb;begin
 select * into j from public.generated_jobs where id=job_id and job_type='CONTRACT_DOCUMENT_GENERATION' and status='PROCESSING' and lease_token=token and lease_expires_at>=now();
 if j.id is null then raise exception 'worker_lease_lost';end if;
 select * into d from public.generated_contract_documents where id=j.document_generation_id and workspace_id=j.workspace_id;
 if d.status not in ('QUEUED','FAILED') or d.input_snapshot is null then raise exception 'document_erased';end if;
 perform set_config('app.user_id',d.created_by::text,true);perform set_config('app.workspace_id',d.workspace_id::text,true);perform set_config('app.aal','aal2',true);
 ctx:=public.document_generation_context(d.source_kind,d.source_id,d.input_snapshot->'selectedContext');
 if (ctx->>'sourceRevision')::integer<>d.source_revision then raise exception 'document_source_conflict';end if;
 select * into t from public.contract_document_template_versions where id=d.template_id;
 select * into cfg from public.contract_document_configurations where id=d.configuration_id;
 if t.status<>'APPROVED' or not t.active or cfg.status<>'APPROVED' then raise exception 'document_template_not_approved';end if;
 return jsonb_build_object('document',to_jsonb(d),'template',to_jsonb(t),'configuration',to_jsonb(cfg));
end $$;
create function public.complete_contract_document(job_id uuid,token uuid,artifact_sha text,artifact_bytes bigint,field_evidence jsonb) returns void language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare j public.generated_jobs;d public.generated_contract_documents;key text;begin
 select * into j from public.generated_jobs where id=job_id and status='PROCESSING' and lease_token=token for update;
 select * into d from public.generated_contract_documents where id=j.document_generation_id for update;
 if j.id is null or d.status not in ('QUEUED','FAILED') then raise exception 'worker_lease_lost';end if;
 perform public.document_worker_input(job_id,token);
 if artifact_sha !~ '^[a-f0-9]{64}$' or artifact_bytes not between 1 and 32000000 or jsonb_typeof(field_evidence) is distinct from 'array' then raise exception 'document_artifact_invalid';end if;
 key:='contract-documents/'||d.workspace_id::text||'/'||d.id::text||'/'||token::text||'.docx';
 update public.generated_contract_documents set status='GENERATED',artifact_key=key,artifact_sha256=artifact_sha,mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes=artifact_bytes,evidence=field_evidence,generated_at=clock_timestamp() where id=d.id;
 perform public.complete_generated_job_leased(job_id,token,key,null);
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(d.workspace_id,d.created_by,'CONTRACT_DOCUMENT_GENERATED','GENERATED_CONTRACT_DOCUMENT',d.id,jsonb_build_object('sourceKind',d.source_kind,'sourceId',d.source_id,'sha256',artifact_sha));
end $$;
create function public.fail_contract_document(job_id uuid,token uuid) returns void language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
 if not exists(select 1 from public.generated_jobs where id=job_id and status='PROCESSING' and lease_token=token) then raise exception 'worker_lease_lost';end if;
 update public.generated_contract_documents d set status='FAILED' from public.generated_jobs j where j.id=job_id and d.id=j.document_generation_id and d.status in ('QUEUED','FAILED');
 perform public.fail_generated_job_leased(job_id,token,'DOCUMENT_GENERATION_FAILED');
end $$;

create function public.document_immutable() returns trigger language plpgsql as $$begin
 if tg_table_name='generated_contract_documents' then
  if (to_jsonb(new)-array['status','evidence','artifact_key','artifact_sha256','mime_type','bytes','generated_at','generated_job_id','input_snapshot','artifact_attempts'])<>(to_jsonb(old)-array['status','evidence','artifact_key','artifact_sha256','mime_type','bytes','generated_at','generated_job_id','input_snapshot','artifact_attempts'])
   or (new.input_snapshot is distinct from old.input_snapshot and new.status not in ('ERASURE_PENDING','ERASED'))
   or (old.status='GENERATED' and new.status not in ('GENERATED','ERASURE_PENDING'))
   or (old.status='GENERATED' and new.status='GENERATED' and (new.artifact_key is distinct from old.artifact_key or new.artifact_sha256 is distinct from old.artifact_sha256 or new.bytes is distinct from old.bytes or new.generated_at is distinct from old.generated_at or new.artifact_attempts is distinct from old.artifact_attempts))
   or (old.evidence is not null and new.evidence is distinct from old.evidence and new.status not in ('ERASURE_PENDING','ERASED')) then raise exception 'document_immutable';end if;
 else
  if (to_jsonb(new)-array['status','active','approved_by','approved_at'])<>(to_jsonb(old)-array['status','active','approved_by','approved_at']) then raise exception 'document_template_immutable';end if;
 end if;return new;end $$;
create trigger immutable_generated_document before update on public.generated_contract_documents for each row execute function public.document_immutable();
create trigger immutable_document_template before update on public.contract_document_template_versions for each row execute function public.document_immutable();
create trigger immutable_document_configuration before update on public.contract_document_configurations for each row execute function public.document_immutable();

create function public.erase_personal_document_evidence() returns trigger language plpgsql security definer set search_path=public,app_auth as $$
declare erased uuid[];begin
 with changed as (update public.generated_contract_documents set status='ERASURE_PENDING',input_snapshot=null,evidence=null
 where workspace_id=old.workspace_id and (input_snapshot->'context'->'references'->>case when tg_table_name='students' then 'studentId' else 'contactId' end=old.id::text
 or (tg_table_name='contacts' and input_snapshot->'privacyContactIds' ? old.id::text)) returning id)
 select array_agg(id) into erased from changed;
 update public.generated_jobs set status='QUEUED',attempts=0,available_at=now(),artifact_path=null,lease_token=null,locked_by=null,locked_at=null,lease_expires_at=null
 where document_generation_id=any(erased) and workspace_id=old.workspace_id;
 return old;end $$;
create trigger student_document_erasure before delete on public.students for each row execute function public.erase_personal_document_evidence();
create trigger contact_document_erasure before delete on public.contacts for each row execute function public.erase_personal_document_evidence();

alter table public.contract_document_template_versions enable row level security;
alter table public.contract_document_configurations enable row level security;
alter table public.generated_contract_documents enable row level security;
create policy document_template_read on public.contract_document_template_versions for select to crm_app using(workspace_id=public.current_workspace_id() and public.is_workspace_member(workspace_id));
create policy document_configuration_read on public.contract_document_configurations for select to crm_app using(workspace_id=public.current_workspace_id() and public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST') and public.is_workspace_member(workspace_id));
create policy generated_document_read on public.generated_contract_documents for select to crm_app using(workspace_id=public.current_workspace_id() and public.document_source_access(source_kind,source_id,false)
 and (source_kind<>'CUSTOMER_CONTRACT' or input_snapshot is null or exists(select 1 from public.student_enrollments e where e.id=(input_snapshot->'context'->'references'->>'enrollmentId')::uuid and public.student_enrollment_access(to_jsonb(e),false))));
grant select on public.contract_document_template_versions,public.contract_document_configurations to crm_app;
-- Evidence is privileged; ordinary listing/download uses a source-scoped summary RPC below.
create function public.list_contract_documents(kind text,source uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$begin
 if not public.document_source_access(kind,source,false) then raise exception 'document_source_not_found';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'documentVersion',d.document_version,'status',d.status,'sourceRevision',d.source_revision,'templateKey',t.template_key,'templateVersion',t.version_number,'templateSHA256',t.definition->>'template_sha256','generatedAt',d.generated_at,'generatedBy',d.created_by,'artifactSHA256',d.artifact_sha256) order by d.document_version desc)
 from public.generated_contract_documents d join public.contract_document_template_versions t on t.id=d.template_id where d.workspace_id=public.current_workspace_id() and d.source_kind=kind and d.source_id=source
 and (kind<>'CUSTOMER_CONTRACT' or d.input_snapshot is null or exists(select 1 from public.student_enrollments e where e.id=(d.input_snapshot->'context'->'references'->>'enrollmentId')::uuid and public.student_enrollment_access(to_jsonb(e),false)))),'[]');
end $$;
create function public.contract_document_download(record_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare d public.generated_contract_documents;begin
 select * into d from public.generated_contract_documents where id=record_id and workspace_id=public.current_workspace_id();
 if d.id is null or d.status<>'GENERATED' or not public.document_source_access(d.source_kind,d.source_id,false) then raise exception 'document_source_not_found';end if;
 if d.source_kind='CUSTOMER_CONTRACT' and not exists(select 1 from public.student_enrollments e where e.id=(d.input_snapshot->'context'->'references'->>'enrollmentId')::uuid and public.student_enrollment_access(to_jsonb(e),false)) then raise exception 'document_source_not_found';end if;
 return jsonb_build_object('id',d.id,'key',d.artifact_key,'sha256',d.artifact_sha256,'bytes',d.bytes,'reference',d.source_reference,'version',d.document_version);
end $$;

revoke all on function public.document_source_access(text,uuid,boolean),public.document_generation_context(text,uuid,jsonb),public.document_governance_allowed(),public.register_document_template(jsonb),public.save_document_configuration(jsonb),public.govern_document_configuration(uuid,text),public.govern_document_template(uuid,text),public.request_contract_document(uuid,text,uuid,integer,jsonb,jsonb,text,text),public.document_worker_input(uuid,uuid),public.complete_contract_document(uuid,uuid,text,bigint,jsonb),public.fail_contract_document(uuid,uuid),public.list_contract_documents(text,uuid),public.contract_document_download(uuid) from public;
grant execute on function public.document_source_access(text,uuid,boolean),public.document_generation_context(text,uuid,jsonb),public.document_governance_allowed(),public.register_document_template(jsonb),public.save_document_configuration(jsonb),public.govern_document_configuration(uuid,text),public.govern_document_template(uuid,text),public.request_contract_document(uuid,text,uuid,integer,jsonb,jsonb,text,text),public.list_contract_documents(text,uuid),public.contract_document_download(uuid) to crm_app;
grant execute on function public.document_worker_input(uuid,uuid),public.complete_contract_document(uuid,uuid,text,bigint,jsonb),public.fail_contract_document(uuid,uuid) to crm_worker,crm_system;
-- Worker document access is exclusively lease-scoped RPCs; no document-table DML.
grant select on public.contract_document_template_versions,public.contract_document_configurations to crm_worker,crm_system;

create function public.document_source_options(kind text,source uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare ws uuid:=public.current_workspace_id();revision integer;contexts jsonb;rules jsonb;begin
 if not public.document_source_access(kind,source,false) then raise exception 'document_source_not_found';end if;
 if kind='CUSTOMER_CONTRACT' then
  select max(version) into revision from public.contract_versions where contract_id=source and workspace_id=ws;
  select coalesce(jsonb_agg(jsonb_build_object('enrollmentId',e.id,'cohortId',co.id,'productId',p.id,'label',coalesce(nullif(p.name_zh,''),p.name_en)||' / '||coalesce(nullif(co.name_zh,''),co.name_en))),'[]') into contexts
  from public.contract_enrollment_links l join public.student_enrollments e on e.id=l.enrollment_id join public.product_cohorts co on co.id=e.cohort_id join public.products p on p.id=co.product_id
  where l.workspace_id=ws and l.contract_id=source and l.status='ACTIVE' and public.student_enrollment_access(to_jsonb(e),false);
 else
  select v.revision into revision from public.channel_agreement_versions v where v.id=source and v.workspace_id=ws;
  select coalesce(jsonb_agg(jsonb_build_object('commissionRuleId',r.id,'basis',r.basis_type,'scope',r.scope_type,'productId',r.product_id,'cohortId',r.cohort_id)),'[]') into rules from public.channel_commission_rules r where r.workspace_id=ws and r.agreement_version_id=source;
  select coalesce(jsonb_agg(jsonb_build_object('cohortId',co.id,'productId',p.id,'label',coalesce(nullif(p.name_zh,''),p.name_en)||' / '||coalesce(nullif(co.name_zh,''),co.name_en))),'[]') into contexts from public.product_cohorts co join public.products p on p.id=co.product_id where co.workspace_id=ws;
 end if;
 return jsonb_build_object('sourceRevision',revision,'contexts',contexts,'rules',coalesce(rules,'[]'));
end $$;
revoke all on function public.document_source_options(text,uuid) from public;
grant execute on function public.document_source_options(text,uuid) to crm_app;

create function public.document_job_visible(record_id uuid) returns boolean language sql stable security definer set search_path=public,app_auth as $$
 select exists(select 1 from public.generated_contract_documents d where d.id=record_id and d.workspace_id=public.current_workspace_id() and public.document_source_access(d.source_kind,d.source_id,false)
 and (d.source_kind<>'CUSTOMER_CONTRACT' or d.input_snapshot is null or exists(select 1 from public.student_enrollments e where e.id=(d.input_snapshot->'context'->'references'->>'enrollmentId')::uuid and public.student_enrollment_access(to_jsonb(e),false))))
$$;
revoke all on function public.document_job_visible(uuid) from public;
grant execute on function public.document_job_visible(uuid) to crm_app;
create policy document_job_parent_scope on public.generated_jobs as restrictive for select to crm_app using(document_generation_id is null or public.document_job_visible(document_generation_id));

-- Attempt paths are housekeeping metadata, not document versions. Record before storage I/O.
create function public.reserve_document_artifact(job_id uuid,token uuid) returns text language plpgsql security definer set search_path=public,app_auth as $$
declare j public.generated_jobs;k text;begin
 perform public.document_worker_input(job_id,token);
 select * into j from public.generated_jobs where id=job_id for update;
 k:='contract-documents/'||j.workspace_id::text||'/'||j.document_generation_id::text||'/'||token::text||'.docx';
 update public.generated_contract_documents set artifact_attempts=array_append(artifact_attempts,k) where id=j.document_generation_id and not(k=any(artifact_attempts));
 return k;
end $$;
revoke all on function public.reserve_document_artifact(uuid,uuid) from public;
grant execute on function public.reserve_document_artifact(uuid,uuid) to crm_worker,crm_system;

create function public.document_attempt_status(job_id uuid,token uuid) returns jsonb language sql stable security definer set search_path=public,app_auth as $$
 select coalesce((select jsonb_build_object('id',d.id,'status',d.status,'artifact_key',d.artifact_key) from public.generated_contract_documents d join public.generated_jobs j on j.document_generation_id=d.id
 where j.id=job_id and (j.lease_token=token or d.artifact_key='contract-documents/'||d.workspace_id::text||'/'||d.id::text||'/'||token::text||'.docx')),'null'::jsonb)
$$;
-- Erasure is tied to the existing document job and its current, unexpired lease.
create function public.document_erasure_input(job_id uuid,token uuid) returns jsonb language sql stable security definer set search_path=public,app_auth as $$
 select (select jsonb_build_object('id',d.id,'keys',to_jsonb(d.artifact_attempts)) from public.generated_contract_documents d join public.generated_jobs j on j.document_generation_id=d.id and j.workspace_id=d.workspace_id
 where j.id=job_id and j.job_type='CONTRACT_DOCUMENT_GENERATION' and j.status='PROCESSING' and j.lease_token=token and j.lease_expires_at>=now() and d.status='ERASURE_PENDING')
$$;
create function public.finish_document_erasure(job_id uuid,token uuid) returns void language plpgsql security definer set search_path=public,app_auth as $$begin
 if public.document_erasure_input(job_id,token) is null then raise exception 'worker_lease_lost';end if;
 perform 1 from public.generated_jobs where id=job_id for update;
 update public.generated_contract_documents d set status='ERASED',artifact_attempts=array[]::text[],artifact_key=null,artifact_sha256=null,mime_type=null,bytes=null
 from public.generated_jobs j where j.id=job_id and j.workspace_id=d.workspace_id and d.id=j.document_generation_id and d.status='ERASURE_PENDING';
 perform public.complete_generated_job_leased(job_id,token,null,null);
end $$;
revoke all on function public.document_attempt_status(uuid,uuid),public.document_erasure_input(uuid,uuid),public.finish_document_erasure(uuid,uuid) from public;
grant execute on function public.document_attempt_status(uuid,uuid),public.document_erasure_input(uuid,uuid),public.finish_document_erasure(uuid,uuid) to crm_worker,crm_system;

-- Privacy exports disclose lineage and the requester's own mapped identity, not other parties' evidence.
create function public.document_privacy_records(job_id uuid,token uuid) returns jsonb language plpgsql stable security definer set search_path=public,app_auth as $$
declare j public.generated_jobs;subject uuid;begin
 select * into j from public.generated_jobs where id=job_id and job_type='PRIVACY_EXPORT' and status='PROCESSING' and lease_token=token and lease_expires_at>=now();
 if j.id is null then raise exception 'worker_lease_lost';end if;
 select requester_contact_id into subject from public.privacy_requests where id=j.privacy_request_id and workspace_id=j.workspace_id and identity_status='VERIFIED';
 if subject is null or subject::text<>j.parameters->>'contactId' then raise exception 'privacy_scope_invalid';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'source_kind',d.source_kind,'source_id',d.source_id,'source_revision',d.source_revision,'document_version',d.document_version,'status',d.status,'template_id',d.template_id,'artifact_sha256',d.artifact_sha256,'generated_at',d.generated_at,
 'subject_fields',coalesce((select jsonb_agg(f) from jsonb_array_elements(d.evidence) f where f->>'source_kind'='STUDENT_CONTACT' and f->>'source_id'=subject::text),'[]'))) from public.generated_contract_documents d where d.workspace_id=j.workspace_id and d.input_snapshot->'privacyContactIds' ? subject::text),'[]');
end $$;
revoke all on function public.document_privacy_records(uuid,uuid) from public;
grant execute on function public.document_privacy_records(uuid,uuid) to crm_worker,crm_system;

-- Reconcile an already-accepted request before checking today's template/revision eligibility.
create function public.document_request_receipt(template_key text,template_version integer,kind text,source uuid,expected_revision integer,context jsonb,confirmed_values jsonb,p_request_key text,regeneration_reason text) returns uuid language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare d public.generated_contract_documents;tid uuid;fingerprint text;begin
 if not public.document_source_access(kind,source,true) then raise exception 'document_source_not_found';end if;
 select * into d from public.generated_contract_documents where workspace_id=public.current_workspace_id() and created_by=app_auth.current_user_id() and request_key=p_request_key;
 if d.id is null then return null;end if;
 perform public.document_generation_context(kind,source,context);
 select id into tid from public.contract_document_template_versions t where t.workspace_id=public.current_workspace_id() and t.template_key=document_request_receipt.template_key and t.version_number=template_version;
 fingerprint:=encode(extensions.digest(jsonb_build_object('actor',app_auth.current_user_id(),'template',tid,'kind',kind,'source',source,'revision',expected_revision,'context',context,'confirmed',confirmed_values,'reason',regeneration_reason)::text,'sha256'),'hex');
 if d.request_fingerprint<>fingerprint then raise exception 'document_request_conflict';end if;return d.id;
end $$;
revoke all on function public.document_request_receipt(text,integer,text,uuid,integer,jsonb,jsonb,text,text) from public;
grant execute on function public.document_request_receipt(text,integer,text,uuid,integer,jsonb,jsonb,text,text) to crm_app;

create function public.document_source_integrity() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.source_kind='CUSTOMER_CONTRACT' then
  if not exists(select 1 from public.contracts where id=new.source_id and workspace_id=new.workspace_id) then raise exception 'document_source_not_found';end if;
 else if not exists(select 1 from public.channel_agreement_versions where id=new.source_id and workspace_id=new.workspace_id) then raise exception 'document_source_not_found';end if;end if;
 return new;
end $$;
create trigger document_parent_integrity before insert on public.generated_contract_documents for each row execute function public.document_source_integrity();
