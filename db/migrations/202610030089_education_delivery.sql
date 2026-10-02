-- Delivery facts remain separate from referral, admissions and financial statuses.
set search_path=public,extensions;
create table public.education_event_participations(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),
 event_id uuid not null,household_id uuid not null,
 party_size integer not null check(party_size between 1 and 1000),
 status text not null check(status in ('INTERESTED','REGISTERED','ATTENDED','CANCELLED')),
 next_action text not null default '' check(length(next_action)<=1000),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default now(),
 unique(workspace_id,event_id,household_id),
 foreign key(workspace_id,event_id) references public.education_outreach_events(workspace_id,id) on delete cascade,
 foreign key(workspace_id,household_id) references public.households(workspace_id,id) on delete cascade
);
create index event_participation_family_idx on public.education_event_participations(workspace_id,household_id,updated_at desc);
create table public.student_application_tasks(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),student_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200),due_on date,
 status text not null check(status in ('TODO','IN_PROGRESS','DONE','WAIVED')),
 next_action text not null default '' check(length(next_action)<=1000),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default now(),
 foreign key(workspace_id,student_id) references public.students(workspace_id,id) on delete cascade,
 check(status not in ('DONE','WAIVED') or length(trim(next_action))>0)
);
create index student_application_tasks_subject_idx on public.student_application_tasks(workspace_id,student_id,updated_at desc);
create or replace function public.education_business_access(resource text,record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
  if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
    or not public.is_workspace_member(public.current_workspace_id()) then return false; end if;
  if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false; end if;
  case resource
    when 'participations' then return public.customer_subject_access('HOUSEHOLD',(record->>'household_id')::uuid,edit)
      and exists(select 1 from public.education_outreach_events e where e.id=(record->>'event_id')::uuid and e.workspace_id=public.current_workspace_id()
        and public.education_business_access('events',to_jsonb(e),false));
    when 'applications' then return public.education_business_student_access((record->>'student_id')::uuid,edit);
    when 'organizations' then return public.customer_subject_access('ORGANIZATION',(record->>'id')::uuid,edit);
    when 'needs' then return public.customer_subject_access('HOUSEHOLD',(record->>'id')::uuid,edit);
    when 'pathways' then return public.education_business_student_access((record->>'student_id')::uuid,edit)
      and (record->>'target_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'target_organization_id')::uuid,false));
    when 'events' then return public.customer_subject_access('ORGANIZATION',(record->>'organization_id')::uuid,edit)
      and (record->>'partner_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'partner_organization_id')::uuid,false));
    when 'referrals' then return public.customer_subject_access('HOUSEHOLD',(record->>'household_id')::uuid,edit)
      and public.customer_subject_access('ORGANIZATION',(record->>'source_organization_id')::uuid,false)
      and (record->>'event_id' is null or exists(select 1 from public.education_outreach_events e where e.id=(record->>'event_id')::uuid
        and e.workspace_id=public.current_workspace_id() and public.education_business_access('events',to_jsonb(e),false)));
    else return false;
  end case;
end $$;
create or replace function public.save_education_business(resource text,record_id uuid,expected_revision integer,data jsonb) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare table_name text; fields text[]; old_row jsonb; candidate jsonb; result jsonb; column_list text; update_list text; related uuid;
begin
  case resource
    when 'participations' then table_name:='education_event_participations';fields:=array['event_id','household_id','party_size','status','next_action'];
    when 'applications' then table_name:='student_application_tasks';fields:=array['student_id','title','due_on','status','next_action'];
    when 'organizations' then table_name:='organization_business_profiles';fields:=array['organization_type','roles','partnership_stage','primary_contact_id','focus_regions','agreement_expires_on','next_action'];
    when 'needs' then table_name:='family_education_needs';fields:=array['services','target_regions','budget_min','budget_max','budget_currency','target_intake','decision_stage','next_action'];
    when 'pathways' then table_name:='student_pathways';fields:=array['student_id','program_type','target_organization_id','target_region','target_major','intake_date','application_deadline','language_test','language_score','stage','next_action'];
    when 'events' then table_name:='education_outreach_events';fields:=array['name','organization_id','partner_organization_id','kind','starts_on','ends_on','location','capacity','attendee_count','status','next_action'];
    when 'referrals' then table_name:='education_family_referrals';fields:=array['source_organization_id','household_id','event_id','introduced_by_contact_id','referred_on','status','next_action'];
    else raise exception 'business_input_invalid';
  end case;
  if record_id is null or jsonb_typeof(data) is distinct from 'object' or expected_revision<=0
    or not data ?& fields or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields||case when resource in ('organizations','needs') then array['id'] else array[]::text[] end))
    or (resource in ('organizations','needs') and (data->>'id') is distinct from record_id::text)
    then raise exception 'business_input_invalid'; end if;
  candidate:=data||jsonb_build_object('id',record_id,'workspace_id',public.current_workspace_id(),'revision',1,'updated_at',clock_timestamp());
  if resource='needs' and ((data->>'budget_min')::numeric<>round((data->>'budget_min')::numeric,2)
    or (data->>'budget_max')::numeric<>round((data->>'budget_max')::numeric,2)) then raise exception 'business_input_invalid'; end if;
  if not public.education_business_access(resource,candidate,true) then raise exception 'business_update_forbidden'; end if;
  -- Optional people are checked separately; referential integrity alone is not authorization.
  related:=coalesce((data->>'primary_contact_id')::uuid,(data->>'introduced_by_contact_id')::uuid);
  if related is not null and (not public.customer_subject_access('CONTACT',related,false) or not exists(select 1 from public.contacts c
    where c.id=related and c.workspace_id=public.current_workspace_id() and coalesce(c.do_not_contact_reason,'') not like 'PRIVACY_DELETION:%'))
    then raise exception 'business_related_not_found'; end if;
  if resource='referrals' and data->>'event_id' is not null then
    perform 1 from public.education_outreach_events e where e.id=(data->>'event_id')::uuid and e.workspace_id=public.current_workspace_id() for share;
  end if;
  if resource='referrals' and data->>'event_id' is not null and not exists(select 1 from public.education_outreach_events e
    where e.id=(data->>'event_id')::uuid and e.workspace_id=public.current_workspace_id()
      and (e.organization_id=(data->>'source_organization_id')::uuid or e.partner_organization_id=(data->>'source_organization_id')::uuid))
    then raise exception 'business_event_source_mismatch'; end if;
  -- One workspace/id lock serializes create and edit, including uncertain retries.
  perform pg_advisory_xact_lock(hashtextextended('education-business:'||public.current_workspace_id()::text||resource||record_id::text,0));
  execute format('select to_jsonb(r) from public.%I r where id=$1 and workspace_id=$2 for update',table_name)
    into old_row using record_id,public.current_workspace_id();
  if old_row is not null then
    if not public.education_business_access(resource,old_row,true) then raise exception 'business_update_forbidden'; end if;
    -- Parents of persisted records are immutable; move identity via the existing customer workflows.
    if resource in ('pathways','applications') and old_row->'student_id' is distinct from data->'student_id'
      or resource='participations' and (old_row->'event_id' is distinct from data->'event_id' or old_row->'household_id' is distinct from data->'household_id')
      or resource='events' and old_row->'organization_id' is distinct from data->'organization_id'
      or resource='referrals' and (old_row->'source_organization_id' is distinct from data->'source_organization_id' or old_row->'household_id' is distinct from data->'household_id')
      then raise exception 'business_parent_immutable'; end if;
    if expected_revision is null or (old_row->>'revision')::integer<>expected_revision then
      if (expected_revision is null and (old_row->>'revision')::integer=1 or (old_row->>'revision')::integer=expected_revision+1)
        and not exists(select 1 from unnest(fields) f where old_row->f is distinct from data->f) then return old_row; end if;
      raise exception 'business_version_conflict';
    end if;
    candidate:=candidate||jsonb_build_object('revision',expected_revision+1);
    select string_agg(format('%I=v.%I',f,f),',') into update_list from unnest(fields||array['revision','updated_at']) f;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2 and t.workspace_id=$3 returning to_jsonb(t)',table_name,update_list,table_name)
      into result using candidate,record_id,public.current_workspace_id();
  else
    if expected_revision is not null then raise exception 'business_record_not_found'; end if;
    fields:=fields||array['id','workspace_id','revision','updated_at'];
    select string_agg(format('%I',f),',') into column_list from unnest(fields) f;
    execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) returning to_jsonb(%I)',table_name,column_list,column_list,table_name,table_name)
      into result using candidate;
  end if;
  if resource='organizations' then
    update public.organizations set organization_type=data->>'organization_type',updated_at=clock_timestamp() where id=record_id and workspace_id=public.current_workspace_id();
  end if;
  -- Do not allow an activity edit to invalidate already-recorded attribution.
  if resource='events' and exists(select 1 from public.education_family_referrals r where r.event_id=record_id
    and r.workspace_id=public.current_workspace_id() and r.source_organization_id<>(result->>'organization_id')::uuid
    and r.source_organization_id is distinct from (result->>'partner_organization_id')::uuid)
    then raise exception 'business_event_source_mismatch'; end if;
  insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data)
    values(public.current_workspace_id(),app_auth.current_user_id(),'EDUCATION_BUSINESS_SAVED','EDUCATION_BUSINESS',record_id,
      jsonb_build_object('resource',resource,'revision',result->'revision'));
  return result;
end $$;
create or replace function public.education_business_permissions(resource text,record_ids uuid[]) returns table(id uuid,can_edit boolean)
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
declare table_name text;
begin
  if cardinality(record_ids)>50 then raise exception 'business_input_invalid'; end if;
  table_name:=case resource when 'organizations' then 'organization_business_profiles' when 'needs' then 'family_education_needs'
    when 'pathways' then 'student_pathways' when 'events' then 'education_outreach_events' when 'referrals' then 'education_family_referrals' when 'participations' then 'education_event_participations' when 'applications' then 'student_application_tasks' end;
  if table_name is null then raise exception 'business_input_invalid'; end if;
  return query execute format('select r.id,public.education_business_access($1,to_jsonb(r),true) from public.%I r where r.id=any($2) and r.workspace_id=public.current_workspace_id() and public.education_business_access($1,to_jsonb(r),false)',table_name)
    using resource,record_ids;
end $$;
alter table public.education_event_participations enable row level security;
create policy education_business_read on public.education_event_participations for select to crm_app using(public.education_business_access('participations',to_jsonb(education_event_participations),false));
grant select on public.education_event_participations to crm_app,crm_worker;
create policy education_business_worker_read on public.education_event_participations for select to crm_worker using(true);
alter table public.student_application_tasks enable row level security;
create policy education_business_read on public.student_application_tasks for select to crm_app using(public.education_business_access('applications',to_jsonb(student_application_tasks),false));
grant select on public.student_application_tasks to crm_app,crm_worker;
create policy education_business_worker_read on public.student_application_tasks for select to crm_worker using(true);

create function public.check_education_event_capacity() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare event public.education_outreach_events; occupied bigint;
begin
 select * into event from public.education_outreach_events where id=new.event_id and workspace_id=new.workspace_id for update;
 if not found then raise exception 'business_related_not_found'; end if;
 if new.status in ('REGISTERED','ATTENDED') then
   if event.status='CANCELLED' then raise exception 'business_event_cancelled'; end if;
   select coalesce(sum(party_size),0) into occupied from public.education_event_participations
    where workspace_id=new.workspace_id and event_id=new.event_id and id<>new.id and status in ('REGISTERED','ATTENDED');
   if event.capacity is not null and occupied+new.party_size>event.capacity then raise exception 'business_capacity_exceeded'; end if;
 end if;
 return new;
end $$;
revoke all on function public.check_education_event_capacity() from public,crm_app,crm_system;
create trigger check_education_event_capacity before insert or update on public.education_event_participations for each row execute function public.check_education_event_capacity();
create function public.protect_education_event_capacity() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare occupied bigint;
begin
 select coalesce(sum(party_size),0) into occupied from public.education_event_participations
  where workspace_id=new.workspace_id and event_id=new.id and status in ('REGISTERED','ATTENDED');
 if new.capacity is not null and new.capacity<occupied then raise exception 'business_capacity_exceeded'; end if;
 if new.status='CANCELLED' and occupied>0 then raise exception 'business_active_participations'; end if;
 return new;
end $$;
revoke all on function public.protect_education_event_capacity() from public,crm_app,crm_system;
create trigger protect_education_event_capacity before update on public.education_outreach_events for each row execute function public.protect_education_event_capacity();
create or replace function public.cleanup_education_business_privacy() returns trigger
language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
  if new.do_not_contact_reason like 'PRIVACY_DELETION:%' and old.do_not_contact_reason is distinct from new.do_not_contact_reason then
    delete from public.student_application_tasks where workspace_id=new.workspace_id and student_id in(select id from public.students where person_id=new.id and workspace_id=new.workspace_id);
    delete from public.student_pathways where workspace_id=new.workspace_id and student_id in(select id from public.students where person_id=new.id and workspace_id=new.workspace_id);
    update public.organization_business_profiles set primary_contact_id=null,next_action='',revision=revision+1,updated_at=clock_timestamp()
      where workspace_id=new.workspace_id and primary_contact_id=new.id;
    update public.education_family_referrals set introduced_by_contact_id=null,next_action='',revision=revision+1,updated_at=clock_timestamp()
      where workspace_id=new.workspace_id and introduced_by_contact_id=new.id;
  end if;
  return new;
end $$;
