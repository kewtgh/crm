set search_path=public,extensions;

alter table public.organizations add column if not exists short_name text not null default '';
alter table public.organizations add constraint organizations_short_name_length check(length(short_name)<=80);
create index organizations_short_name_idx on public.organizations(workspace_id,lower(short_name));

-- Atomic create resolves owner selection vs INSERT RLS without weakening RLS.
create function public.create_customer_contact(profile jsonb) returns public.contacts
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result public.contacts; actor uuid:=app_auth.current_user_id(); ws uuid:=public.current_workspace_id();
  assigned uuid:=coalesce(nullif(profile->>'ownerId','')::uuid,actor); organization uuid:=nullif(profile->>'organizationId','')::uuid;
begin
  if actor is null or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST')
    or not public.is_workspace_member(ws) then raise exception 'crm_create_forbidden'; end if;
  if assigned<>actor and (public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR')
    or not exists(select 1 from public.workspace_memberships where workspace_id=ws and user_id=assigned and status='ACTIVE'))
    then raise exception 'contact_owner_not_assignable'; end if;
  if organization is not null and not exists(select 1 from public.organizations o where o.id=organization and o.archived_at is null
    and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,false)) then raise exception 'related_record_not_found'; end if;
  if nullif(trim(profile->>'nameZh'),'') is null or nullif(trim(profile->>'nameEn'),'') is null
    or length(profile->>'nameZh')>160 or length(profile->>'nameEn')>160
    or (nullif(trim(profile->>'email'),'') is null and nullif(trim(profile->>'phone'),'') is null)
    then raise exception 'contact_profile_invalid'; end if;
  insert into public.contacts(workspace_id,organization_id,name_zh,name_en,email,phone,title,contact_type,contact_status,
    communication_level,notes_markdown,preferred_contact_method,preferred_language,acquisition_source,decision_role,tags,next_follow_up_at,
    status,completeness,owner_id,created_by)
  values(ws,organization,trim(profile->>'nameZh'),trim(profile->>'nameEn'),nullif(trim(profile->>'email'),'')::citext,
    nullif(trim(profile->>'phone'),''),coalesce(profile->>'title',''),coalesce(profile->>'contactType','CONTACT'),coalesce(profile->>'contactStatus','NEW'),
    coalesce((profile->>'communicationLevel')::integer,1),coalesce(profile->>'notesMarkdown',''),coalesce(profile->>'preferredContactMethod','EMAIL'),
    coalesce(profile->>'preferredLanguage',''),coalesce(profile->>'acquisitionSource',''),coalesce(profile->>'decisionRole','UNKNOWN'),
    array(select jsonb_array_elements_text(coalesce(profile->'tags','[]'::jsonb))),nullif(profile->>'nextFollowUpAt','')::timestamptz,
    'UNVERIFIED',90,assigned,actor) returning * into result;
  return result;
end $$;
revoke all on function public.create_customer_contact(jsonb) from public,crm_system;
grant execute on function public.create_customer_contact(jsonb) to crm_app;

create function public.customer_subject_access(subject_kind text,subject uuid,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
  if app_auth.current_user_id() is null then return false; end if;
  if subject_kind='ORGANIZATION' then return exists(select 1 from public.organizations o where o.id=subject and o.archived_at is null
    and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,edit));
  elsif subject_kind='CONTACT' then return exists(select 1 from public.contacts c where c.id=subject and c.archived_at is null
    and public.can_access_owned_record(c.workspace_id,'CONTACT',c.id,c.owner_id,edit));
  elsif subject_kind='HOUSEHOLD' then return exists(select 1 from public.households h where h.id=subject and h.status<>'ARCHIVED'
    and h.workspace_id=public.current_workspace_id() and public.is_workspace_member(h.workspace_id)
    and (not edit or public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')));
  end if;
  return false;
end $$;
revoke all on function public.customer_subject_access(text,uuid,boolean) from public;
grant execute on function public.customer_subject_access(text,uuid,boolean) to crm_app;

create table public.customer_follow_up_plans(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  subject_kind text not null check(subject_kind in ('ORGANIZATION','CONTACT','HOUSEHOLD')),subject_id uuid not null,
  title text not null check(length(trim(title)) between 1 and 200),target_level integer not null check(target_level between 1 and 4),
  target_count integer not null check(target_count between 1 and 1000),start_date date not null,due_date date not null check(due_date>=start_date),
  owner_id uuid not null default app_auth.current_user_id() references app_auth.accounts(id),updated_at timestamptz not null default now(),
  unique(workspace_id,subject_kind,subject_id)
);
create table public.customer_follow_up_entries(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  subject_kind text not null check(subject_kind in ('ORGANIZATION','CONTACT','HOUSEHOLD')),subject_id uuid not null,
  kind text not null check(kind in ('CALL','EMAIL','MEETING','VISIT','NOTE')),summary text not null check(length(trim(summary)) between 1 and 2000),
  next_step text not null check(length(trim(next_step)) between 1 and 1000),occurred_at timestamptz not null default now(),
  owner_id uuid not null default app_auth.current_user_id() references app_auth.accounts(id),request_key uuid not null,
  activity_id uuid unique references public.crm_activities(id) on delete set null,
  unique(workspace_id,request_key)
);
create index customer_follow_up_entries_subject_idx on public.customer_follow_up_entries(workspace_id,subject_kind,subject_id,occurred_at desc);
alter table public.customer_follow_up_plans enable row level security;
alter table public.customer_follow_up_entries enable row level security;
create policy customer_plan_read on public.customer_follow_up_plans for select to crm_app using(workspace_id=public.current_workspace_id() and public.customer_subject_access(subject_kind,subject_id,false));
create policy customer_entry_read on public.customer_follow_up_entries for select to crm_app using(workspace_id=public.current_workspace_id() and public.customer_subject_access(subject_kind,subject_id,false));
grant select on public.customer_follow_up_plans,public.customer_follow_up_entries to crm_app;

-- One operational history includes legacy activities and avoids counting mirrors
-- twice. security_invoker retains both source tables' RLS, plus subject scoping.
create view public.customer_follow_up_history with(security_invoker=true) as
  select id,workspace_id,subject_kind,subject_id,kind,summary,next_step,occurred_at,owner_id
  from public.customer_follow_up_entries
  union all
  select a.id,a.workspace_id,'ORGANIZATION',a.organization_id,a.activity_type,a.summary_zh,a.next_step_zh,a.occurred_at,a.owner_id
  from public.crm_activities a where a.workspace_id=public.current_workspace_id() and a.organization_id is not null
    and public.customer_subject_access('ORGANIZATION',a.organization_id,false)
    and not exists(select 1 from public.customer_follow_up_entries e where e.activity_id=a.id and e.subject_kind='ORGANIZATION' and e.subject_id=a.organization_id)
  union all
  select a.id,a.workspace_id,'CONTACT',a.contact_id,a.activity_type,a.summary_zh,a.next_step_zh,a.occurred_at,a.owner_id
  from public.crm_activities a where a.workspace_id=public.current_workspace_id() and a.contact_id is not null
    and public.customer_subject_access('CONTACT',a.contact_id,false)
    and not exists(select 1 from public.customer_follow_up_entries e where e.activity_id=a.id and e.subject_kind='CONTACT' and e.subject_id=a.contact_id);
grant select on public.customer_follow_up_history to crm_app;

create table public.customer_contract_links(
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
  subject_kind text not null check(subject_kind in ('CONTACT','HOUSEHOLD')),subject_id uuid not null,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  created_by uuid not null default app_auth.current_user_id() references app_auth.accounts(id),
  created_at timestamptz not null default now(),primary key(workspace_id,subject_kind,subject_id,contract_id)
);
alter table public.customer_contract_links enable row level security;
create policy customer_contract_link_read on public.customer_contract_links for select to crm_app
  using(workspace_id=public.current_workspace_id() and public.customer_subject_access(subject_kind,subject_id,false));
grant select on public.customer_contract_links to crm_app;

-- Polymorphic subjects cannot use a conventional foreign key. Delete their
-- operational rows atomically when the existing lifecycle hard-deletes them.
create function public.cleanup_customer_operation_subject() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare v_subject_kind text:=case tg_table_name when 'organizations' then 'ORGANIZATION' when 'contacts' then 'CONTACT' else 'HOUSEHOLD' end;
begin
  delete from public.customer_contract_links where workspace_id=old.workspace_id and subject_kind=v_subject_kind and subject_id=old.id;
  delete from public.customer_follow_up_entries where workspace_id=old.workspace_id and subject_kind=v_subject_kind and subject_id=old.id;
  delete from public.customer_follow_up_plans where workspace_id=old.workspace_id and subject_kind=v_subject_kind and subject_id=old.id;
  return old;
end $$;
revoke all on function public.cleanup_customer_operation_subject() from public,crm_app,crm_system;
create trigger organization_operations_cleanup after delete on public.organizations for each row execute function public.cleanup_customer_operation_subject();
create trigger contact_operations_cleanup after delete on public.contacts for each row execute function public.cleanup_customer_operation_subject();
create trigger household_operations_cleanup after delete on public.households for each row execute function public.cleanup_customer_operation_subject();

create function public.save_customer_follow_up(p_subject_kind text,subject uuid,operation text,details jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result jsonb; token uuid; activity uuid; organization uuid; existing public.customer_follow_up_entries;
begin
  if not public.customer_subject_access(p_subject_kind,subject,true) then raise exception 'crm_update_forbidden'; end if;
  if operation='plan' then
    insert into public.customer_follow_up_plans(subject_kind,subject_id,title,target_level,target_count,start_date,due_date)
    values(p_subject_kind,subject,details->>'title',(details->>'targetLevel')::integer,(details->>'targetCount')::integer,
      (details->>'startDate')::date,(details->>'dueDate')::date)
    on conflict(workspace_id,subject_kind,subject_id) do update set title=excluded.title,target_level=excluded.target_level,target_count=excluded.target_count,
      start_date=excluded.start_date,due_date=excluded.due_date,owner_id=excluded.owner_id,updated_at=now() returning to_jsonb(customer_follow_up_plans.*) into result;
  elsif operation='contract' then
    if p_subject_kind not in ('CONTACT','HOUSEHOLD') or not exists(select 1 from public.contracts c
      where c.id=(details->>'contractId')::uuid and c.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(c.workspace_id,'CONTRACT',c.id,c.owner_id,false)) then raise exception 'related_record_not_found'; end if;
    insert into public.customer_contract_links(subject_kind,subject_id,contract_id)
      values(p_subject_kind,subject,(details->>'contractId')::uuid) on conflict do nothing;
    result:=jsonb_build_object('contractId',details->>'contractId');
  elsif operation='entry' then
    if (details->>'occurredAt')::timestamptz>now()+interval '5 minutes' then raise exception 'activity_invalid'; end if;
    token:=(details->>'requestKey')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(public.current_workspace_id()::text||token::text,0));
    select * into existing from public.customer_follow_up_entries where workspace_id=public.current_workspace_id() and request_key=token;
    if found then
      if existing.subject_kind<>p_subject_kind or existing.subject_id<>subject or existing.summary<>details->>'summary'
        or existing.kind<>details->>'kind' or existing.next_step<>details->>'nextStep' or existing.occurred_at<>(details->>'occurredAt')::timestamptz
        then raise exception 'follow_up_idempotency_conflict'; end if;
      return to_jsonb(existing);
    end if;
    if p_subject_kind in ('ORGANIZATION','CONTACT') then
      if p_subject_kind='ORGANIZATION' then organization:=subject;
      else select organization_id into organization from public.contacts where id=subject; end if;
      insert into public.crm_activities(workspace_id,organization_id,contact_id,activity_type,occurred_at,summary_zh,summary_en,next_step_zh,next_step_en,owner_id,created_by)
        values(public.current_workspace_id(),organization,case when p_subject_kind='CONTACT' then subject else null end,
          details->>'kind',(details->>'occurredAt')::timestamptz,details->>'summary',details->>'summary',details->>'nextStep',details->>'nextStep',app_auth.current_user_id(),app_auth.current_user_id())
        returning id into activity;
    end if;
    insert into public.customer_follow_up_entries(subject_kind,subject_id,kind,summary,next_step,occurred_at,request_key,activity_id)
    values(p_subject_kind,subject,details->>'kind',details->>'summary',details->>'nextStep',(details->>'occurredAt')::timestamptz,token,activity)
    returning to_jsonb(customer_follow_up_entries.*) into result;
    if p_subject_kind='CONTACT' then update public.contacts set last_interaction_at=greatest(last_interaction_at,(details->>'occurredAt')::timestamptz),updated_at=now() where id=subject;
    elsif p_subject_kind='ORGANIZATION' then update public.organizations set last_contact_at=greatest(last_contact_at,(details->>'occurredAt')::timestamptz),updated_at=now() where id=subject; end if;
  else raise exception 'invalid_input'; end if;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data)
    values(public.current_workspace_id(),app_auth.current_user_id(),'CUSTOMER_FOLLOW_UP_SAVED',p_subject_kind,subject,jsonb_build_object('operation',operation));
  return result;
end $$;
revoke all on function public.save_customer_follow_up(text,uuid,text,jsonb) from public,crm_system;
grant execute on function public.save_customer_follow_up(text,uuid,text,jsonb) to crm_app;

-- Existing locked/versioned writer remains authoritative; alias is atomic.
create function public.update_school_customer_profile(target_school uuid,expected_updated_at timestamptz,profile jsonb)
returns public.organizations language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare result public.organizations;
begin
  result:=public.update_school_profile(target_school,expected_updated_at,profile->>'nameZh',profile->>'nameEn',profile->>'city',
    profile->>'curriculum',profile->>'status',array(select jsonb_array_elements_text(coalesce(profile->'courseCategories','[]'::jsonb))),
    coalesce(profile->>'affiliationType','INDEPENDENT'),nullif(profile->>'parentOrganizationId','')::uuid,
    profile->>'organizationOverviewMarkdown',profile->>'structureOverviewMarkdown',profile->>'website',
    (profile->>'foundedYear')::integer,(profile->>'studentCount')::integer,(profile->>'facultyCount')::integer,(profile->>'campusCount')::integer);
  update public.organizations set short_name=coalesce(trim(profile->>'shortName'),short_name) where id=target_school returning * into result;
  return result;
end $$;
revoke all on function public.update_school_customer_profile(uuid,timestamptz,jsonb) from public,crm_system;
grant execute on function public.update_school_customer_profile(uuid,timestamptz,jsonb) to crm_app;

-- Counts use exactly the same searchable fields/status as the paged lists.
create or replace function public.crm_resource_metrics(resource_key text,search_query text default '',status_filter text default 'all')
returns jsonb language plpgsql stable security invoker set search_path=public,app_auth,extensions as $$
declare result jsonb; pattern text:='%'||trim(coalesce(search_query,''))||'%';
begin
  if resource_key='schools' then
    select jsonb_build_object('total',count(*),'needsAttention',count(*) filter(where status in ('ATTENTION','RISK')),
      'averageCompleteness',coalesce(round(avg(completeness)),0)) into result from public.organizations
    where workspace_id=public.current_workspace_id() and archived_at is null and (status_filter='all' or status=status_filter)
      and (name_zh ilike pattern or name_en ilike pattern or short_name ilike pattern or city ilike pattern or curriculum ilike pattern);
  elsif resource_key='people' then
    select jsonb_build_object('total',count(*),'needsAttention',count(*) filter(where contact_status in ('FOLLOW_UP','NEW','DORMANT')),
      'averageCompleteness',coalesce(round(avg(completeness)),0)) into result from public.contacts
    where workspace_id=public.current_workspace_id() and archived_at is null and (status_filter='all' or contact_status=status_filter)
      and (name_zh ilike pattern or name_en ilike pattern or email::text ilike pattern or phone ilike pattern or title ilike pattern or notes_markdown ilike pattern);
  elsif resource_key='tasks' then
    select jsonb_build_object('total',count(*),'needsAttention',count(*) filter(where status in ('WAITING_APPROVAL','OVERDUE')),
      'averageCompleteness',coalesce(round(avg(case when status='DONE' then 100 else 70 end)),0)) into result from public.crm_tasks
    where workspace_id=public.current_workspace_id() and archived_at is null and (status_filter='all' or status=status_filter)
      and (title_zh ilike pattern or title_en ilike pattern or related_label ilike pattern);
  else raise exception 'unknown_resource'; end if;
  return result;
end $$;
