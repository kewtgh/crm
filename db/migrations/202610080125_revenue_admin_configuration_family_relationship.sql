-- Bounded administrator configuration; no approval/posting role bypass.
set search_path=public,app_auth,extensions;
alter table public.household_members add column family_relationship text not null default 'UNSPECIFIED'
 check(family_relationship in ('UNSPECIFIED','FATHER','MOTHER','GUARDIAN','OTHER'));
create or replace function public.create_household_with_people(data jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();r public.mutation_receipts;fingerprint text;family jsonb;person jsonb;identity uuid;members jsonb:='[]';result jsonb;zh text;en text;
begin
 if actor is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'PERMISSION_DENIED';end if;
 if length(coalesce(p_request_key,'')) not between 8 and 160 or jsonb_typeof(data->'household') is distinct from 'object' or jsonb_typeof(data->'people') is distinct from 'array' or jsonb_array_length(data->'people') not between 1 and 10 then raise exception 'INVALID_EDUCATION_INPUT';end if;
 if (select count(*) from jsonb_array_elements(data->'people') x where coalesce((x->>'primary')::boolean,false))>1 then raise exception 'INVALID_EDUCATION_INPUT';end if;
 fingerprint:=encode(digest(data::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':family-create:'||p_request_key,0));
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if r.created_by<>actor or r.operation<>'HOUSEHOLD_PEOPLE_CREATE' or r.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return r.result->'item';
 end if;
 if coalesce(data->'household'->>'preferredLanguage','') not in ('','zh-CN','zh-TW','en') then raise exception 'INVALID_EDUCATION_INPUT';end if;
 if data->'household' ?| array['primaryParentOccupation','secondaryParentOccupation'] then raise exception 'PERSON_FACT_REQUIRED';end if;
 family:=public.save_customer_record('HOUSEHOLDS',gen_random_uuid(),null,(data->'household')||jsonb_build_object('status','ACTIVE'));
 for person in select * from jsonb_array_elements(data->'people') loop
  if person ?| array['personId','householdId','workspaceId','ownerId'] then raise exception 'INVALID_REFERENCE';end if;
  if coalesce(person->>'relationship','UNSPECIFIED') not in ('UNSPECIFIED','FATHER','MOTHER','GUARDIAN','OTHER') then raise exception 'INVALID_EDUCATION_INPUT';end if;
  zh:=nullif(trim(person->>'nameZh'),'');en:=nullif(trim(person->>'nameEn'),'');
  if coalesce(zh,en) is null or length(coalesce(zh,en))>160 or length(coalesce(en,zh))>160 then raise exception 'INVALID_EDUCATION_INPUT';end if;
  if coalesce(person->>'role','') not in ('PARENT','GUARDIAN','OTHER','PAYER') then raise exception 'INVALID_EDUCATION_INPUT';end if;
  insert into public.contacts(workspace_id,name_zh,name_en,contact_type,owner_id,created_by,email,phone,occupation,employer,title)
  values(ws,coalesce(zh,en),coalesce(en,zh),'PARENT',actor,actor,nullif(person->>'email','')::citext,nullif(person->>'phone',''),coalesce(person->>'occupation',''),coalesce(person->>'employer',''),coalesce(person->>'title','')) returning id into identity;
  members:=members||jsonb_build_array(to_jsonb(public.save_household_member((family->>'id')::uuid,identity,person->>'role',coalesce((person->>'primary')::boolean,false))));
  update public.household_members set family_relationship=coalesce(person->>'relationship','UNSPECIFIED') where household_id=(family->>'id')::uuid and contact_id=identity;
 end loop;
 result:=jsonb_build_object('household',family,'members',members);
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'HOUSEHOLD_PEOPLE_CREATE','HOUSEHOLD',(family->>'id')::uuid,jsonb_build_object('memberCount',jsonb_array_length(members)));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'HOUSEHOLD_PEOPLE_CREATE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
create or replace function public.save_household_person(identity uuid,expected_updated_at timestamptz,data jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();m public.household_members;c public.contacts;r public.mutation_receipts;fingerprint text;result jsonb;
begin
 if actor is null or not public.is_workspace_member(ws) or length(coalesce(p_request_key,'')) not between 8 and 160 then raise exception 'PERMISSION_DENIED';end if;
 fingerprint:=encode(digest(jsonb_build_array(identity,expected_updated_at,data)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':family-person:'||p_request_key,0));
 select * into m from public.household_members where id=identity and workspace_id=ws;
 if not found or not public.contact_record_access(m.contact_id,true) or not public.customer_subject_access('HOUSEHOLD',m.household_id,true) then raise exception 'PERMISSION_DENIED';end if;
 select * into r from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if r.created_by<>actor or r.operation<>'HOUSEHOLD_PERSON_SAVE' or r.result->>'request_hash'<>fingerprint then raise exception 'PAYLOAD_REUSE';end if;
  return r.result->'item';
 end if;
 select * into c from public.contacts where id=m.contact_id for update;
 if c.updated_at is distinct from expected_updated_at then raise exception 'STALE_TARGET';end if;
 if nullif(trim(data->>'nameZh'),'') is null and nullif(trim(data->>'nameEn'),'') is null then raise exception 'INVALID_EDUCATION_INPUT';end if;
 if exists(select 1 from jsonb_object_keys(data) k where k not in ('nameZh','nameEn','phone','email','occupation','employer','title','relationship')) then raise exception 'INVALID_EDUCATION_INPUT';end if;
 update public.contacts set name_zh=coalesce(nullif(trim(data->>'nameZh'),''),trim(data->>'nameEn')),name_en=coalesce(nullif(trim(data->>'nameEn'),''),trim(data->>'nameZh')),
 phone=nullif(data->>'phone',''),email=nullif(data->>'email','')::citext,occupation=coalesce(data->>'occupation',''),employer=coalesce(data->>'employer',''),title=coalesce(data->>'title',''),updated_at=clock_timestamp() where id=c.id;
 if data ? 'relationship' then update public.household_members set family_relationship=data->>'relationship' where id=identity;end if;
 result:=jsonb_build_object('id',identity,'contactId',c.id);
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,'HOUSEHOLD_PERSON_SAVE','CONTACT',c.id,jsonb_build_object('memberId',identity));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'HOUSEHOLD_PERSON_SAVE',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
create or replace view public.household_person_records with(security_invoker=true) as
 select m.id,m.workspace_id,m.household_id,m.contact_id,m.member_role,m.primary_contact,
 c.name_zh,c.name_en,c.email,c.phone,c.occupation,c.employer,c.title,c.updated_at,
 public.contact_record_access(c.id,true) can_edit,m.family_relationship
 from public.household_members m join public.contacts c on c.id=m.contact_id and c.workspace_id=m.workspace_id;

create function public.revenue_admin_configuration_read() returns jsonb
language plpgsql stable security definer set search_path=public,app_auth as $$
declare ws uuid:=public.revenue_workspace_id();begin
 if ws is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('ADMIN','SUPER_ADMIN') then raise exception 'ROLE_FORBIDDEN';end if;
 return jsonb_build_object('timezone',(select business_timezone from public.workspaces where id=ws),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('can_submit',p.status='DRAFT' and p.created_by=app_auth.current_user_id() and public.revenue_has_authority(p.reporting_entity_id,'POLICY_OWNER'),'can_approve',p.status='IN_REVIEW' and p.created_by<>app_auth.current_user_id() and public.revenue_has_authority(p.reporting_entity_id,'POLICY_APPROVER')) order by p.created_at) from public.revenue_reporting_profiles p where workspace_id=ws),'[]'),
 'periods',coalesce((select jsonb_agg(to_jsonb(p) order by p.start_on desc) from public.revenue_accounting_periods p where workspace_id=ws),'[]'),
 'administrators',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',a.username) order by a.username) from public.workspace_memberships m join app_auth.accounts a on a.id=m.user_id where m.workspace_id=ws and m.status='ACTIVE' and m.role in ('ADMIN','SUPER_ADMIN')),'[]'));
end $$;
create function public.revenue_admin_configuration_command(command text,entity uuid,data jsonb,request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.revenue_workspace_id();actor uuid:=app_auth.current_user_id();payload jsonb:=jsonb_build_object('command',command,'entity',entity,'data',data);result jsonb;
begin
 if current_setting('app.aal',true) is distinct from 'aal2' then raise exception 'MFA_REQUIRED';end if;
 if ws is null or actor is null then raise exception 'ROLE_FORBIDDEN';end if;
 perform 1 from public.workspace_memberships where workspace_id=ws and user_id=actor and status='ACTIVE' and role in ('ADMIN','SUPER_ADMIN') for share;
 if not found then raise exception 'ROLE_FORBIDDEN';end if;
 if length(coalesce(request_key,'')) not between 8 and 160 or entity is null then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended('revenue:'||ws::text,0));
 result:=public.commission_receipt(request_key,'REVENUE_ADMIN_CONFIGURATION',payload);if result is not null then return result;end if;
 if command='PROFILE_CREATE' then
  if (select count(*) from public.workspace_memberships where workspace_id=ws and user_id in ((data->>'owner')::uuid,(data->>'approver')::uuid) and status='ACTIVE' and role in ('ADMIN','SUPER_ADMIN'))<>2 then raise exception 'revenue_membership_required';end if;
  result:=public.provision_revenue_profile(entity,(data->>'owner')::uuid,(data->>'approver')::uuid,data->'profile',request_key||':profile');
 elsif command in ('PROFILE_SUBMIT','PROFILE_APPROVE') then
  select to_jsonb(p) into result from public.revenue_reporting_profiles p where workspace_id=ws and reporting_entity_id=entity for update;
  if result is null then raise exception 'revenue_profile_required';end if;
  if command='PROFILE_SUBMIT' then
   result:=public.revenue_foundation_command(entity,'PROFILE_SUBMIT',(result->>'id')::uuid,(data->>'revision')::integer,'{}',request_key||':submit');
  else
   result:=public.decide_revenue_approval((result->>'approval_reference')::uuid,(data->>'revision')::integer,'APPROVED',data->>'reference',request_key||':approve');
  end if;
 elsif command='PERIOD_CREATE' then
  if not exists(select 1 from public.revenue_reporting_profiles where workspace_id=ws and reporting_entity_id=entity and status<>'RETIRED') then raise exception 'revenue_profile_required';end if;
  if nullif(trim(data->>'period_key'),'') is null or length(data->>'period_key')>80 or data->>'start_on' is null or data->>'end_on' is null or (data->>'start_on')::date>(data->>'end_on')::date then raise exception 'revenue_period_invalid';end if;
  if exists(select 1 from public.revenue_accounting_periods where workspace_id=ws and reporting_entity_id=entity and daterange(start_on,end_on,'[]') && daterange((data->>'start_on')::date,(data->>'end_on')::date,'[]')) then raise exception 'revenue_period_overlap';end if;
  insert into public.revenue_accounting_periods(workspace_id,reporting_entity_id,period_key,start_on,end_on,created_by) values(ws,entity,data->>'period_key',(data->>'start_on')::date,(data->>'end_on')::date,actor) returning to_jsonb(revenue_accounting_periods.*) into result;
 else raise exception 'INVALID_INPUT';end if;
 perform public.revenue_audit('REVENUE_ADMIN_CONFIGURATION',(result->>'id')::uuid,jsonb_build_object('command',command,'entity',entity));
 return public.commission_finish(request_key,'REVENUE_ADMIN_CONFIGURATION',payload,result);
end $$;
revoke all on function public.revenue_admin_configuration_read(),public.revenue_admin_configuration_command(text,uuid,jsonb,text) from public,crm_system,crm_worker;
grant execute on function public.revenue_admin_configuration_read(),public.revenue_admin_configuration_command(text,uuid,jsonb,text) to crm_app;
