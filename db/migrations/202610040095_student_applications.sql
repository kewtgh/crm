-- Formal Applications are Enrollment 1:N facts; no historical inference or legacy sync.
set search_path=public,app_auth,extensions;
create table public.student_applications(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
 enrollment_id uuid not null,target_organization_id uuid,
 external_application_id text check(external_application_id is null or (length(trim(external_application_id)) between 1 and 160)),
 deadline_on date,
 status text not null default 'DRAFT' check(status in ('DRAFT','PREPARING','SUBMITTED','UNDER_REVIEW','DECIDED','WITHDRAWN','CLOSED')),
 decision text check(decision in ('ADMITTED','CONDITIONAL_ADMIT','WAITLISTED','REJECTED','DEFERRED','OTHER')),
 submitted_at timestamptz,decision_at timestamptz,withdrawn_at timestamptz,owner_id uuid,
 revision integer not null default 1 check(revision>0),created_by uuid references app_auth.accounts(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),
 foreign key(workspace_id,enrollment_id) references public.student_enrollments(workspace_id,id) on delete cascade,
 foreign key(workspace_id,target_organization_id) references public.organizations(workspace_id,id) on delete set null(target_organization_id),
 foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id),
 constraint student_applications_lifecycle_check check(
  (status not in ('SUBMITTED','UNDER_REVIEW','DECIDED') or submitted_at is not null)
  and (status<>'DECIDED' or (decision is not null and decision_at is not null))
  and (decision is null or decision_at is not null)
  and (decision_at is null or submitted_at is null or decision_at>=submitted_at)
  and (status<>'WITHDRAWN' or withdrawn_at is not null)
  and (withdrawn_at is null or submitted_at is null or withdrawn_at>=submitted_at))
);
create index student_applications_enrollment_idx on public.student_applications(workspace_id,enrollment_id,updated_at desc,id);
create index student_applications_status_idx on public.student_applications(workspace_id,status,updated_at desc,id);
create index student_applications_owner_idx on public.student_applications(workspace_id,owner_id,updated_at desc,id);
create index student_applications_target_idx on public.student_applications(workspace_id,target_organization_id,updated_at desc,id) where target_organization_id is not null;
create index student_applications_deadline_idx on public.student_applications(workspace_id,deadline_on,id) where deadline_on is not null;
create table public.student_application_status_history(
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),application_id uuid not null,
 application_revision integer not null check(application_revision>0),
 from_status text check(from_status in ('DRAFT','PREPARING','SUBMITTED','UNDER_REVIEW','DECIDED','WITHDRAWN','CLOSED')),
 to_status text not null check(to_status in ('DRAFT','PREPARING','SUBMITTED','UNDER_REVIEW','DECIDED','WITHDRAWN','CLOSED')),
 changed_at timestamptz not null default clock_timestamp(),changed_by uuid references app_auth.accounts(id),
 reason text not null default '' check(length(reason)<=1000),check(from_status is null or from_status<>to_status),
 unique(workspace_id,application_id,application_revision),
 foreign key(workspace_id,application_id) references public.student_applications(workspace_id,id) on delete cascade
);
create index application_history_time_idx on public.student_application_status_history(workspace_id,application_id,changed_at,id);

create function public.student_application_access(record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
 if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
  or not public.is_workspace_member(public.current_workspace_id()) then return false; end if;
 if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false; end if;
 return exists(select 1 from public.student_enrollments e where e.id=(record->>'enrollment_id')::uuid and e.workspace_id=public.current_workspace_id()
  and public.student_enrollment_access(to_jsonb(e),edit))
  and (record->>'target_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'target_organization_id')::uuid,false))
  and (record->>'owner_id' is null or public.can_access_owned_record(public.current_workspace_id(),'APPLICATION',(record->>'id')::uuid,(record->>'owner_id')::uuid,edit));
end $$;
revoke all on function public.student_application_access(jsonb,boolean) from public;
grant execute on function public.student_application_access(jsonb,boolean) to crm_app;
alter table public.student_applications enable row level security;
alter table public.student_application_status_history enable row level security;
revoke all on public.student_applications,public.student_application_status_history from public,crm_app;
grant select on public.student_applications,public.student_application_status_history to crm_app,crm_worker;
create policy application_read on public.student_applications for select to crm_app using(public.student_application_access(to_jsonb(student_applications),false));
create policy application_history_read on public.student_application_status_history for select to crm_app using(exists(
 select 1 from public.student_applications a where a.id=application_id and a.workspace_id=student_application_status_history.workspace_id));
create policy application_privacy_read on public.student_applications for select to crm_worker using(true);
create policy application_history_privacy_read on public.student_application_status_history for select to crm_worker using(true);

create function public.guard_application_identity() returns trigger language plpgsql as $$
begin
 if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.enrollment_id is distinct from old.enrollment_id then raise exception 'application_parent_immutable'; end if;
 return new;
end $$;
create trigger application_identity_immutable before update on public.student_applications for each row execute function public.guard_application_identity();
create function public.guard_application_history() returns trigger language plpgsql as $$ begin raise exception 'application_history_immutable'; end $$;
create trigger application_history_immutable before update on public.student_application_status_history for each row execute function public.guard_application_history();
create function public.record_application_status() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$
begin
 if tg_op='INSERT' or new.status is distinct from old.status then
  insert into public.student_application_status_history(workspace_id,application_id,application_revision,from_status,to_status,changed_at,changed_by,reason)
   values(new.workspace_id,new.id,new.revision,case when tg_op='INSERT' then null else old.status end,new.status,new.updated_at,app_auth.current_user_id(),coalesce(current_setting('app.application_status_reason',true),''));
 end if;return new;
end $$;
revoke all on function public.guard_application_identity(),public.guard_application_history(),public.record_application_status() from public;
create trigger application_status_record after insert or update of status on public.student_applications for each row execute function public.record_application_status();

create function public.save_student_application(record_id uuid,expected_revision integer,data jsonb,p_request_key text,status_reason text default '')
returns public.student_applications language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();previous public.student_applications;candidate public.student_applications;
 result public.student_applications;receipt public.mutation_receipts;request_hash text;
 fields text[]:=array['enrollment_id','target_organization_id','external_application_id','deadline_on','status','decision','submitted_at','decision_at','withdrawn_at','owner_id'];
begin
 if actor is null or ws is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'application_update_forbidden'; end if;
 if record_id is null or expected_revision<=0 or p_request_key is null or length(p_request_key) not between 8 and 160
  or status_reason is null or length(status_reason)>1000 or jsonb_typeof(data) is distinct from 'object' or not data ?& fields
  or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields)) then raise exception 'application_input_invalid'; end if;
 request_hash:=encode(extensions.digest(jsonb_build_object('actor',actor,'id',record_id,'revision',expected_revision,'data',data,'reason',status_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
 candidate:=jsonb_populate_record(null::public.student_applications,data);candidate.id:=record_id;candidate.workspace_id:=ws;
 -- Same Contact/Student lock boundary as Enrollment privacy and immutable parents.
 perform 1 from public.student_enrollments e join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id
  join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id
  where e.id=candidate.enrollment_id and e.workspace_id=ws and public.student_enrollment_access(to_jsonb(e),true) for share of e,s,c;
 if not found then raise exception 'application_enrollment_not_found'; end if;
 if candidate.target_organization_id is not null then
  perform 1 from public.organizations o where o.id=candidate.target_organization_id and o.workspace_id=ws
   and public.customer_subject_access('ORGANIZATION',o.id,false) for share;
  if not found then raise exception 'application_target_forbidden'; end if;
 end if;
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.operation<>'APPLICATION_SAVE' or receipt.created_by<>actor or receipt.result->>'request_hash' is distinct from request_hash then raise exception 'application_request_conflict'; end if;
  if not exists(select 1 from public.student_applications a where a.id=record_id and a.workspace_id=ws and public.student_application_access(to_jsonb(a),true)) then raise exception 'application_update_forbidden'; end if;
  return jsonb_populate_record(null::public.student_applications,receipt.result->'item');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('student-application:'||record_id::text,0));
 select * into previous from public.student_applications where id=record_id and workspace_id=ws for update;
 if found then
  if not public.student_application_access(to_jsonb(previous),true) then raise exception 'application_update_forbidden'; end if;
  if previous.enrollment_id is distinct from candidate.enrollment_id then raise exception 'application_parent_immutable'; end if;
  if expected_revision is null or previous.revision<>expected_revision then raise exception 'application_version_conflict'; end if;
 else
  if expected_revision is not null then raise exception 'application_not_found'; end if;
 end if;
 if candidate.owner_id is not null and (not exists(select 1 from public.workspace_memberships m where m.workspace_id=ws and m.user_id=candidate.owner_id and m.status='ACTIVE')
  or ((previous.id is null or previous.owner_id is distinct from candidate.owner_id) and not public.can_assign_crm_task(candidate.owner_id))) then raise exception 'application_owner_invalid'; end if;
 if not public.student_application_access(to_jsonb(candidate),true) then raise exception 'application_update_forbidden'; end if;
 perform set_config('app.application_status_reason',status_reason,true);
 if previous.id is null then
  insert into public.student_applications(id,workspace_id,enrollment_id,target_organization_id,external_application_id,deadline_on,status,decision,submitted_at,decision_at,withdrawn_at,owner_id,created_by)
   values(record_id,ws,candidate.enrollment_id,candidate.target_organization_id,nullif(trim(candidate.external_application_id),''),candidate.deadline_on,candidate.status,candidate.decision,candidate.submitted_at,candidate.decision_at,candidate.withdrawn_at,candidate.owner_id,actor) returning * into result;
 else
  update public.student_applications set target_organization_id=candidate.target_organization_id,external_application_id=nullif(trim(candidate.external_application_id),''),deadline_on=candidate.deadline_on,
   status=candidate.status,decision=candidate.decision,submitted_at=candidate.submitted_at,decision_at=candidate.decision_at,withdrawn_at=candidate.withdrawn_at,owner_id=candidate.owner_id,revision=revision+1,updated_at=clock_timestamp()
   where id=record_id and workspace_id=ws returning * into result;
 end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data)
  values(ws,actor,case when previous.id is null then 'STUDENT_APPLICATION_CREATED' else 'STUDENT_APPLICATION_UPDATED' end,'STUDENT_APPLICATION',record_id,
   jsonb_build_object('revision',result.revision,'enrollmentId',result.enrollment_id,'fromStatus',previous.status,'status',result.status,'fromDecision',previous.decision,'decision',result.decision));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(ws,p_request_key,'APPLICATION_SAVE',jsonb_build_object('request_hash',request_hash,'item',to_jsonb(result)),actor);
 return result;
end $$;
revoke all on function public.save_student_application(uuid,integer,jsonb,text,text) from public;
grant execute on function public.save_student_application(uuid,integer,jsonb,text,text) to crm_app;

alter table public.student_application_tasks add column application_id uuid;
alter table public.student_application_tasks add constraint application_task_workspace_fk foreign key(workspace_id,application_id) references public.student_applications(workspace_id,id) on delete cascade;
create index application_tasks_application_idx on public.student_application_tasks(workspace_id,application_id,updated_at desc,id) where application_id is not null;
create function public.guard_application_task_context() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.application_id is not null and not exists(select 1 from public.student_applications a join public.student_enrollments e on e.id=a.enrollment_id and e.workspace_id=a.workspace_id
  where a.id=new.application_id and a.workspace_id=new.workspace_id and e.student_id=new.student_id) then raise exception 'application_task_student_mismatch'; end if;
 return new;
end $$;
revoke all on function public.guard_application_task_context() from public;
create trigger application_task_context before insert or update of application_id,student_id,workspace_id on public.student_application_tasks for each row execute function public.guard_application_task_context();

create view public.student_application_records with(security_invoker=true) as
 select a.*,e.student_id,e.cohort_id,c.product_id,c.application_deadline cohort_application_deadline,
  s.student_number,p.name_zh student_name_zh,p.name_en student_name_en,c.name_zh cohort_name_zh,c.name_en cohort_name_en,
  product.name_zh product_name_zh,product.name_en product_name_en,o.name_zh target_name_zh,o.name_en target_name_en,
  u.display_name_zh owner_name_zh,u.display_name_en owner_name_en,public.student_application_access(to_jsonb(a),true) can_edit
 from public.student_applications a join public.student_enrollments e on e.id=a.enrollment_id and e.workspace_id=a.workspace_id
 join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id join public.contacts p on p.id=s.person_id and p.workspace_id=s.workspace_id
 join public.product_cohorts c on c.id=e.cohort_id and c.workspace_id=e.workspace_id join public.products product on product.id=c.product_id and product.workspace_id=c.workspace_id
 left join public.organizations o on o.id=a.target_organization_id and o.workspace_id=a.workspace_id left join public.user_profiles u on u.user_id=a.owner_id;
grant select on public.student_application_records to crm_app;
create function public.cleanup_application_receipts() returns trigger language plpgsql security definer set search_path=public as $$
begin delete from public.mutation_receipts where workspace_id=old.workspace_id and operation='APPLICATION_SAVE' and result->'item'->>'id'=old.id::text;return old;end $$;
revoke all on function public.cleanup_application_receipts() from public;
create trigger application_receipt_cleanup before delete on public.student_applications for each row execute function public.cleanup_application_receipts();
-- Enrollment deletion already cascades from the existing Student privacy cleanup.
-- Financial parents and legacy admission_journeys are never written here.

-- Extend the existing Task mutation/access functions, preserving every other resource.
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
    when 'applications' then return public.education_business_student_access((record->>'student_id')::uuid,edit)
      and (record->>'application_id' is null or exists(select 1 from public.student_applications a where a.id=(record->>'application_id')::uuid
        and a.workspace_id=public.current_workspace_id() and public.student_application_access(to_jsonb(a),edit)));
    when 'organizations' then return public.customer_subject_access('ORGANIZATION',(record->>'id')::uuid,edit);
    when 'needs' then return public.customer_subject_access('HOUSEHOLD',(record->>'id')::uuid,edit);
    when 'pathways' then return public.education_business_student_access((record->>'student_id')::uuid,edit)
      and (record->>'target_organization_id' is null or public.customer_subject_access('ORGANIZATION',(record->>'target_organization_id')::uuid,false));
    when 'events' then return
      (record->>'campaign_id' is null or exists(select 1 from public.growth_campaigns g where g.id=(record->>'campaign_id')::uuid and g.workspace_id=public.current_workspace_id()))
      and (record->>'product_id' is null or exists(select 1 from public.products p where p.id=(record->>'product_id')::uuid and p.workspace_id=public.current_workspace_id()))
      and (record->>'cohort_id' is null or exists(select 1 from public.product_cohorts c where c.id=(record->>'cohort_id')::uuid and c.workspace_id=public.current_workspace_id() and c.product_id=(record->>'product_id')::uuid))
      and public.customer_subject_access('ORGANIZATION',(record->>'organization_id')::uuid,edit)
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
  if resource='applications' and jsonb_typeof(data)='object' and not data ? 'application_id' then
    select jsonb_build_object('application_id',application_id) into old_row from public.student_application_tasks where id=record_id and workspace_id=public.current_workspace_id();
    data:=data||coalesce(old_row,jsonb_build_object('application_id',null));
  end if;
  if resource='events' then perform public.lock_commercial_relations(public.current_workspace_id()); end if;
  if resource='events' and jsonb_typeof(data)='object' and not data ?| array['campaign_id','product_id','cohort_id'] then
    select jsonb_build_object('campaign_id',campaign_id,'product_id',product_id,'cohort_id',cohort_id)
      into old_row from public.education_outreach_events where id=record_id and workspace_id=public.current_workspace_id();
    data:=data||coalesce(old_row,jsonb_build_object('campaign_id',null,'product_id',null,'cohort_id',null));
  end if;
  case resource
    when 'participations' then table_name:='education_event_participations';fields:=array['event_id','household_id','party_size','status','next_action'];
    when 'applications' then table_name:='student_application_tasks';fields:=array['student_id','application_id','title','due_on','status','next_action'];
    when 'organizations' then table_name:='organization_business_profiles';fields:=array['organization_type','roles','partnership_stage','primary_contact_id','focus_regions','agreement_expires_on','next_action'];
    when 'needs' then table_name:='family_education_needs';fields:=array['services','target_regions','budget_min','budget_max','budget_currency','target_intake','decision_stage','next_action'];
    when 'pathways' then table_name:='student_pathways';fields:=array['student_id','program_type','target_organization_id','target_region','target_major','intake_date','application_deadline','language_test','language_score','stage','next_action'];
    when 'events' then table_name:='education_outreach_events';fields:=array['campaign_id','product_id','cohort_id','name','organization_id','partner_organization_id','kind','starts_on','ends_on','location','capacity','attendee_count','status','next_action'];
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
create or replace function public.run_data_quality_rules()
returns integer language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare marker timestamptz:=clock_timestamp();affected integer;ws uuid:=public.current_workspace_id();
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') then raise exception 'quality_not_authorized'; end if;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select c.workspace_id,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.contactMethod',jsonb_build_object('nameZh',c.name_zh,'nameEn',c.name_en),marker
  from public.contacts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='CONTACT_METHOD_MISSING' and config.enabled
  where c.workspace_id=ws and c.email is null and coalesce(c.phone,'')=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select o.workspace_id,config.rule_key,'OPPORTUNITY',o.id,config.severity,'quality.rule.nextAction',jsonb_build_object('titleZh',o.title_zh,'titleEn',o.title_en),marker
  from public.opportunities o join public.data_quality_rule_configs config on config.workspace_id=o.workspace_id and config.rule_key='OPPORTUNITY_NEXT_ACTION_MISSING' and config.enabled
  where o.workspace_id=ws and o.stage not in ('WON','LOST') and o.next_action_zh='' and o.next_action_en=''
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select organization.workspace_id,config.rule_key,'ORGANIZATION',organization.id,config.severity,'quality.rule.owner',jsonb_build_object('nameZh',organization.name_zh,'nameEn',organization.name_en),marker
  from public.organizations organization join public.data_quality_rule_configs config on config.workspace_id=organization.workspace_id and config.rule_key='ORGANIZATION_OWNER_MISSING' and config.enabled
  where organization.workspace_id=ws and organization.owner_id is null
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select student.workspace_id,config.rule_key,'STUDENT',student.id,config.severity,'quality.rule.guardianMissing',jsonb_build_object('studentId',student.student_number),marker
  from public.students student join public.data_quality_rule_configs config on config.workspace_id=student.workspace_id and config.rule_key='STUDENT_GUARDIAN_MISSING' and config.enabled
  where student.workspace_id=ws and student.status='ACTIVE' and not exists(select 1 from public.student_guardian_relationships relation where relation.student_id=student.id)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select distinct on(consent.contact_id) consent.workspace_id,config.rule_key,'CONTACT',consent.contact_id,config.severity,'quality.rule.consentExpired',jsonb_build_object('channel',consent.channel,'purpose',consent.purpose,'retentionUntil',consent.retention_until),marker
  from public.contact_consents consent join public.data_quality_rule_configs config on config.workspace_id=consent.workspace_id and config.rule_key='CONSENT_EXPIRED' and config.enabled
  where consent.workspace_id=ws and consent.status='GRANTED' and consent.retention_until<current_date order by consent.contact_id,consent.retention_until
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select opportunity.workspace_id,config.rule_key,'OPPORTUNITY',opportunity.id,config.severity,'quality.rule.exchangeRateMissing',jsonb_build_object('currency',opportunity.currency,'amount',opportunity.amount),marker
  from public.opportunities opportunity join public.workspaces workspace on workspace.id=opportunity.workspace_id
  join public.data_quality_rule_configs config on config.workspace_id=opportunity.workspace_id and config.rule_key='OPPORTUNITY_EXCHANGE_RATE_MISSING' and config.enabled
  where opportunity.workspace_id=ws and opportunity.stage not in ('WON','LOST') and opportunity.currency<>workspace.default_currency
    and not exists(select 1 from public.exchange_rate_snapshots rate where rate.workspace_id=opportunity.workspace_id and rate.base_currency=workspace.default_currency and rate.quote_currency=opportunity.currency and rate.effective_at<=now())
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select lead.workspace_id,config.rule_key,'LEAD',lead.id,config.severity,'quality.rule.attributionMissing',jsonb_build_object('nameZh',lead.name_zh,'nameEn',lead.name_en,'source',lead.source),marker
  from public.leads lead join public.data_quality_rule_configs config on config.workspace_id=lead.workspace_id and config.rule_key='LEAD_ATTRIBUTION_MISSING' and config.enabled
  where lead.workspace_id=ws and lead.status not in ('CONVERTED','LOST') and not exists(select 1 from public.lead_attribution_touches touch where touch.lead_id=lead.id)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select duplicate.workspace_id,config.rule_key,'CONTACT',duplicate.id,config.severity,'quality.rule.duplicateContact',jsonb_build_object('duplicateKey',duplicate.duplicate_key,'canonicalId',duplicate.canonical_id),marker
  from (
    select ranked.*,first_value(ranked.id) over(partition by ranked.workspace_id,ranked.duplicate_key order by ranked.created_at,ranked.id) canonical_id
    from (
      select c.*,coalesce(nullif(lower(c.email::text),''),nullif(regexp_replace(c.phone,'\D','','g'),'')) duplicate_key,
        count(*) over(partition by c.workspace_id,coalesce(nullif(lower(c.email::text),''),nullif(regexp_replace(c.phone,'\D','','g'),''))) duplicate_count
      from public.contacts c where c.workspace_id=ws
    ) ranked where ranked.duplicate_key is not null and ranked.duplicate_count>1
  ) duplicate join public.data_quality_rule_configs config on config.workspace_id=duplicate.workspace_id and config.rule_key='CONTACT_DUPLICATE' and config.enabled
  where duplicate.id<>duplicate.canonical_id
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_MISSING_APPLICATION_DEADLINE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_MISSING_APPLICATION_DEADLINE' and config.enabled
 where c.workspace_id=ws and (c.status in ('DRAFT','RECRUITING') and c.application_deadline is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_MISSING_OWNER',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_MISSING_OWNER' and config.enabled
 where c.workspace_id=ws and (c.status in ('DRAFT','RECRUITING','ACTIVE') and c.owner_id is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_RECRUITING_AFTER_DEADLINE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_RECRUITING_AFTER_DEADLINE' and config.enabled
 where c.workspace_id=ws and (c.status='RECRUITING' and c.application_deadline<public.current_business_date()::date)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_ACTIVE_WITHOUT_START_DATE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_ACTIVE_WITHOUT_START_DATE' and config.enabled
 where c.workspace_id=ws and (c.status='ACTIVE' and c.start_on is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'COHORT',c.id,config.severity,'quality.rule.COHORT_COMPLETED_WITHOUT_END_DATE',jsonb_build_object('reference',c.id),marker
 from public.product_cohorts c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='COHORT_COMPLETED_WITHOUT_END_DATE' and config.enabled
 where c.workspace_id=ws and (c.status='COMPLETED' and c.end_on is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_MISSING_HOUSEHOLD',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_MISSING_HOUSEHOLD' and config.enabled
 where c.workspace_id=ws and (c.status in ('REGISTERING','ACTIVE') and c.household_id is null) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION' and config.enabled
 where c.workspace_id=ws and (c.status in ('INTERESTED','REGISTERING','ACTIVE') and not exists(select 1 from public.enrollment_attributions a where a.enrollment_id=c.id and a.workspace_id=c.workspace_id and a.attribution_type='PRIMARY')) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select c.workspace_id,config.rule_key,'ENROLLMENT',c.id,config.severity,'quality.rule.ENROLLMENT_ACTIVE_WITHOUT_CONTRACT',jsonb_build_object('reference',c.id),marker
 from public.student_enrollments c join public.data_quality_rule_configs config on config.workspace_id=c.workspace_id and config.rule_key='ENROLLMENT_ACTIVE_WITHOUT_CONTRACT' and config.enabled
 where c.workspace_id=ws and (c.status='ACTIVE' and not exists(select 1 from public.contract_enrollment_links l where l.enrollment_id=c.id and l.workspace_id=c.workspace_id and l.status='ACTIVE')) and public.student_enrollment_access(to_jsonb(c),false)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select a.workspace_id,config.rule_key,'APPLICATION',a.id,config.severity,'quality.rule.APPLICATION_PAST_DEADLINE_NOT_SUBMITTED',jsonb_build_object('reference',a.id),marker
  from public.student_applications a join public.data_quality_rule_configs config on config.workspace_id=a.workspace_id and config.rule_key='APPLICATION_PAST_DEADLINE_NOT_SUBMITTED' and config.enabled
  where a.workspace_id=ws and a.status in ('DRAFT','PREPARING') and a.deadline_on<public.current_business_date()::date and public.student_application_access(to_jsonb(a),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=app_auth.current_user_id()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;

insert into public.data_quality_rule_configs(workspace_id,rule_key,enabled,severity)
select id,'APPLICATION_PAST_DEADLINE_NOT_SUBMITTED',true,'MEDIUM' from public.workspaces on conflict do nothing;
create function public.seed_application_quality() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into public.data_quality_rule_configs(workspace_id,rule_key,enabled,severity) values(new.id,'APPLICATION_PAST_DEADLINE_NOT_SUBMITTED',true,'MEDIUM') on conflict do nothing;return new;end $$;
revoke all on function public.seed_application_quality() from public;
create trigger seed_application_quality after insert on public.workspaces for each row execute function public.seed_application_quality();
