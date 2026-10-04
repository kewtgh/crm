-- Enrollment-scoped Success Cases; existing domain facts remain authoritative.
set search_path=public,app_auth,extensions;
create table public.student_success_cases(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),
 enrollment_id uuid not null,status text not null default 'PLANNING' check(status in ('PLANNING','ACTIVE','PAUSED','COMPLETED','CLOSED')),
 health_status text not null default 'UNKNOWN' check(health_status in ('UNKNOWN','ON_TRACK','ATTENTION','AT_RISK')),
 owner_id uuid,next_review_on date,success_summary text check(length(success_summary)<=2000),plan_summary text check(length(plan_summary)<=4000),
 revision integer not null default 1 check(revision>0),created_by uuid references app_auth.accounts(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,id),unique(workspace_id,enrollment_id),
 foreign key(workspace_id,enrollment_id) references public.student_enrollments(workspace_id,id) on delete cascade,
 foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id)
);
create index success_case_review_idx on public.student_success_cases(workspace_id,next_review_on,id);
create table public.student_success_case_status_history(
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id),case_id uuid not null,
 from_status text check(from_status in ('PLANNING','ACTIVE','PAUSED','COMPLETED','CLOSED')),
 to_status text not null check(to_status in ('PLANNING','ACTIVE','PAUSED','COMPLETED','CLOSED')),
 changed_at timestamptz not null default clock_timestamp(),changed_by uuid references app_auth.accounts(id),
 reason text not null default '' check(length(reason)<=1000),case_revision integer not null check(case_revision>0),
 check(from_status is null or from_status<>to_status),unique(workspace_id,case_id,case_revision),
 foreign key(workspace_id,case_id) references public.student_success_cases(workspace_id,id) on delete cascade
);
create index success_history_time_idx on public.student_success_case_status_history(workspace_id,case_id,changed_at,id);
create table public.student_success_goals(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id),case_id uuid not null,
 goal_type text not null check(goal_type in ('ACADEMIC','LANGUAGE','ENGAGEMENT','ATTENDANCE','PROJECT','TRANSITION','CAREER','PERSONAL_DEVELOPMENT','OTHER')),
 title text not null check(length(trim(title)) between 1 and 200),description text check(length(description)<=2000),
 status text not null default 'PLANNED' check(status in ('PLANNED','ACTIVE','ACHIEVED','NOT_ACHIEVED','CANCELLED')),
 target_on date,achieved_at timestamptz,owner_id uuid,revision integer not null default 1 check(revision>0),
 created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(status<>'ACHIEVED' or achieved_at is not null),unique(workspace_id,id),unique(workspace_id,case_id,id),
 foreign key(workspace_id,case_id) references public.student_success_cases(workspace_id,id) on delete cascade,
 foreign key(workspace_id,owner_id) references public.workspace_memberships(workspace_id,user_id)
);
create index success_goals_case_idx on public.student_success_goals(workspace_id,case_id,updated_at desc,id);
create table public.student_success_task_links(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),case_id uuid not null,goal_id uuid,
 task_id uuid not null references public.crm_tasks(id) on delete cascade,revision integer not null default 1 check(revision>0),
 created_by uuid references app_auth.accounts(id),created_at timestamptz not null default clock_timestamp(),unique(workspace_id,task_id),
 foreign key(workspace_id,case_id) references public.student_success_cases(workspace_id,id) on delete cascade,
 foreign key(workspace_id,case_id,goal_id) references public.student_success_goals(workspace_id,case_id,id) on delete cascade
);
create index success_task_case_idx on public.student_success_task_links(workspace_id,case_id,id);

create function public.student_success_case_access(record jsonb,edit boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,app_auth,extensions as $$
begin
 if app_auth.current_user_id() is null or record->>'workspace_id' is distinct from public.current_workspace_id()::text
  or not public.is_workspace_member(public.current_workspace_id()) then return false;end if;
 if edit and public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then return false;end if;
 return exists(select 1 from public.student_enrollments e where e.workspace_id=public.current_workspace_id() and e.id=(record->>'enrollment_id')::uuid and public.student_enrollment_access(to_jsonb(e),edit))
  and (record->>'owner_id' is null or public.can_access_owned_record(public.current_workspace_id(),'STUDENT_SUCCESS_CASE',(record->>'id')::uuid,(record->>'owner_id')::uuid,edit));
end $$;
create function public.student_success_parent_access(target_case uuid,edit boolean default false) returns boolean
language sql stable security definer set search_path=public,app_auth,extensions as $$
 select exists(select 1 from public.student_success_cases c where c.id=target_case and c.workspace_id=public.current_workspace_id() and public.student_success_case_access(to_jsonb(c),edit));
$$;
revoke all on function public.student_success_case_access(jsonb,boolean),public.student_success_parent_access(uuid,boolean) from public;
grant execute on function public.student_success_case_access(jsonb,boolean),public.student_success_parent_access(uuid,boolean) to crm_app;
alter table public.student_success_cases enable row level security;
alter table public.student_success_case_status_history enable row level security;
alter table public.student_success_goals enable row level security;
alter table public.student_success_task_links enable row level security;
revoke all on public.student_success_cases,public.student_success_case_status_history,public.student_success_goals,public.student_success_task_links from public,crm_app;
grant select on public.student_success_cases,public.student_success_case_status_history,public.student_success_goals,public.student_success_task_links to crm_app,crm_worker;
create policy success_case_read on public.student_success_cases for select to crm_app using(public.student_success_case_access(to_jsonb(student_success_cases),false));
create policy success_history_read on public.student_success_case_status_history for select to crm_app using(public.student_success_parent_access(case_id,false));
create policy success_goal_read on public.student_success_goals for select to crm_app using(public.student_success_parent_access(case_id,false));
create policy success_task_link_read on public.student_success_task_links for select to crm_app using(public.student_success_parent_access(case_id,false)
 and exists(select 1 from public.crm_tasks t where t.id=task_id and t.workspace_id=student_success_task_links.workspace_id));
create policy success_case_privacy on public.student_success_cases for select to crm_worker using(true);
create policy success_history_privacy on public.student_success_case_status_history for select to crm_worker using(true);
create policy success_goal_privacy on public.student_success_goals for select to crm_worker using(true);
create policy success_link_privacy on public.student_success_task_links for select to crm_worker using(true);
create function public.guard_student_success_identity() returns trigger language plpgsql as $$
begin
 if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
  or (tg_table_name='student_success_cases' and to_jsonb(new)->>'enrollment_id' is distinct from to_jsonb(old)->>'enrollment_id')
  or (tg_table_name='student_success_goals' and to_jsonb(new)->>'case_id' is distinct from to_jsonb(old)->>'case_id') then raise exception 'success_parent_immutable';end if;
 return new;end $$;
create trigger success_case_identity before update on public.student_success_cases for each row execute function public.guard_student_success_identity();
create trigger success_goal_identity before update on public.student_success_goals for each row execute function public.guard_student_success_identity();
create function public.guard_success_history() returns trigger language plpgsql as $$begin raise exception 'success_history_immutable';end $$;
create trigger success_history_immutable before update on public.student_success_case_status_history for each row execute function public.guard_success_history();
create function public.record_success_status() returns trigger language plpgsql security definer set search_path=public,app_auth,extensions as $$begin
 if tg_op='INSERT' or new.status is distinct from old.status then
  insert into public.student_success_case_status_history(workspace_id,case_id,from_status,to_status,changed_at,changed_by,reason,case_revision)
   values(new.workspace_id,new.id,case when tg_op='INSERT' then null else old.status end,new.status,new.updated_at,app_auth.current_user_id(),coalesce(current_setting('app.success_status_reason',true),''),new.revision);
 end if;return new;end $$;
create trigger success_status_record after insert or update of status on public.student_success_cases for each row execute function public.record_success_status();
revoke all on function public.guard_student_success_identity(),public.guard_success_history(),public.record_success_status() from public;

-- Shared implementation is internal; only typed domain wrappers are granted.
create function public.save_student_success_record(resource text,record_id uuid,expected_revision integer,data jsonb,p_request_key text,status_reason text default '') returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();fields text[];table_name text;parent uuid;en public.student_enrollments;
 old_row jsonb;candidate jsonb;result jsonb;receipt public.mutation_receipts;request_hash text;column_list text;update_list text;changed_fields jsonb;
begin
 if actor is null or ws is null or not public.is_workspace_member(ws) or public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT') then raise exception 'success_update_forbidden';end if;
 if resource='CASE' then table_name:='student_success_cases';fields:=array['enrollment_id','status','health_status','owner_id','next_review_on','success_summary','plan_summary'];
 elsif resource='GOAL' then table_name:='student_success_goals';fields:=array['case_id','goal_type','title','description','status','target_on','achieved_at','owner_id'];
 else raise exception 'success_input_invalid';end if;
 if record_id is null or expected_revision<=0 or p_request_key is null or length(p_request_key) not between 8 and 160 or status_reason is null or length(status_reason)>1000
  or jsonb_typeof(data) is distinct from 'object' or not data ?& fields or exists(select 1 from jsonb_object_keys(data) k where not k=any(fields)) then raise exception 'success_input_invalid';end if;
 request_hash:=encode(extensions.digest(jsonb_build_object('resource',resource,'actor',actor,'id',record_id,'revision',expected_revision,'data',data,'reason',status_reason)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
 if resource='CASE' then parent:=(data->>'enrollment_id')::uuid;
 else
  select c.enrollment_id into parent from public.student_success_cases c where c.id=(data->>'case_id')::uuid and c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),true);
  if not found then raise exception 'success_case_not_found';end if;
 end if;
 perform 1 from public.student_enrollments e join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id
  join public.contacts c on c.id=s.person_id and c.workspace_id=s.workspace_id where e.id=parent and e.workspace_id=ws
  and public.student_enrollment_access(to_jsonb(e),true) for share of e,s,c;
 if not found then raise exception 'success_enrollment_not_found';end if;
 select * into en from public.student_enrollments where id=parent and workspace_id=ws;
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.operation<>'SUCCESS_'||resource||'_SAVE' or receipt.created_by<>actor or receipt.result->>'request_hash' is distinct from request_hash then raise exception 'success_request_conflict';end if;
  if resource='CASE' and not exists(select 1 from public.student_success_cases c where c.id=record_id and c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),true)) then raise exception 'success_update_forbidden';end if;
  if resource='GOAL' and not exists(select 1 from public.student_success_goals g where g.id=record_id and g.workspace_id=ws and public.student_success_parent_access(g.case_id,true)) then raise exception 'success_update_forbidden';end if;
  return receipt.result->'item';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('success-enrollment:'||ws::text||':'||parent::text,0));
 if resource='GOAL' then
  perform 1 from public.student_success_cases c where c.id=(data->>'case_id')::uuid and c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),true) for share;
  if not found then raise exception 'success_update_forbidden';end if;
 end if;
 execute format('select to_jsonb(r) from public.%I r where id=$1 and workspace_id=$2 for update',table_name) into old_row using record_id,ws;
 candidate:=data||jsonb_build_object('id',record_id,'workspace_id',ws,'revision',coalesce((old_row->>'revision')::integer,0)+1,'created_by',coalesce(old_row->>'created_by',actor::text),'created_at',coalesce(old_row->>'created_at',clock_timestamp()::text),'updated_at',clock_timestamp());
 if old_row is not null then
  if expected_revision is null or (old_row->>'revision')::integer<>expected_revision then raise exception 'success_version_conflict';end if;
  if resource='CASE' then
   if old_row->>'enrollment_id' is distinct from data->>'enrollment_id' then raise exception 'success_parent_immutable';end if;
   if not public.student_success_case_access(old_row,true) then raise exception 'success_update_forbidden';end if;
  elsif old_row->>'case_id' is distinct from data->>'case_id' then raise exception 'success_parent_immutable';end if;
 else
  if expected_revision is not null then raise exception 'success_not_found';end if;
  if resource='CASE' then
   if en.status not in ('REGISTERING','ACTIVE','COMPLETED') then raise exception 'success_enrollment_status_invalid';end if;
   if exists(select 1 from public.student_success_cases where enrollment_id=parent and workspace_id=ws) then raise exception 'success_case_exists';end if;
  end if;
 end if;
 if data->>'owner_id' is not null and (not exists(select 1 from public.workspace_memberships m where m.workspace_id=ws and m.user_id=(data->>'owner_id')::uuid and m.status='ACTIVE')
  or ((old_row is null or old_row->>'owner_id' is distinct from data->>'owner_id') and not public.can_assign_crm_task((data->>'owner_id')::uuid))) then raise exception 'success_owner_invalid';end if;
 if resource='CASE' and not public.student_success_case_access(candidate,true) then raise exception 'success_update_forbidden';end if;
 perform set_config('app.success_status_reason',status_reason,true);
 if old_row is null then
  execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).* returning to_jsonb(%I.*)',table_name,table_name,table_name) into result using candidate;
 else
  select string_agg(format('%I=r.%I',f,f),',') into update_list from unnest(fields||array['revision','updated_at']) f;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where t.id=$2 and t.workspace_id=$3 returning to_jsonb(t.*)',table_name,update_list,table_name) into result using candidate,record_id,ws;
 end if;
 select coalesce(jsonb_agg(k),'[]') into changed_fields from unnest(fields) k where old_row is null or old_row->k is distinct from result->k;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data)
  values(ws,actor,'STUDENT_SUCCESS_'||resource||case when old_row is null then '_CREATED' else '_UPDATED' end,'STUDENT_SUCCESS_'||resource,record_id,
   jsonb_build_object('revision',result->'revision','changedFields',changed_fields,'parentId',parent));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(ws,p_request_key,'SUCCESS_'||resource||'_SAVE',jsonb_build_object('request_hash',request_hash,'item',result),actor);
 return result;
end $$;
revoke all on function public.save_student_success_record(text,uuid,integer,jsonb,text,text) from public,crm_app,crm_worker;
create function public.save_student_success_case(record_id uuid,expected_revision integer,data jsonb,p_request_key text,status_reason text default '') returns public.student_success_cases
language sql security definer set search_path=public,app_auth,extensions as $$select jsonb_populate_record(null::public.student_success_cases,public.save_student_success_record('CASE',record_id,expected_revision,data,p_request_key,status_reason));$$;
create function public.save_student_success_goal(record_id uuid,expected_revision integer,data jsonb,p_request_key text) returns public.student_success_goals
language sql security definer set search_path=public,app_auth,extensions as $$select jsonb_populate_record(null::public.student_success_goals,public.save_student_success_record('GOAL',record_id,expected_revision,data,p_request_key,''));$$;
revoke all on function public.save_student_success_case(uuid,integer,jsonb,text,text),public.save_student_success_goal(uuid,integer,jsonb,text) from public;
grant execute on function public.save_student_success_case(uuid,integer,jsonb,text,text),public.save_student_success_goal(uuid,integer,jsonb,text) to crm_app;

create function public.guard_success_task_context() returns trigger language plpgsql security definer set search_path=public as $$
declare student uuid;enrollment uuid;t public.crm_tasks;
begin
 if tg_table_name='crm_tasks' then
  if exists(select 1 from public.student_success_task_links l join public.student_success_cases c on c.id=l.case_id and c.workspace_id=l.workspace_id
   join public.student_enrollments e on e.id=c.enrollment_id and e.workspace_id=c.workspace_id
   where l.task_id=new.id and (new.workspace_id<>l.workspace_id or new.related_type<>'STUDENT' or new.related_id is distinct from e.student_id)) then raise exception 'success_task_context_mismatch';end if;
 else
  select e.student_id,e.id into student,enrollment from public.student_success_cases c join public.student_enrollments e on e.id=c.enrollment_id and e.workspace_id=c.workspace_id where c.id=new.case_id and c.workspace_id=new.workspace_id;
  select * into t from public.crm_tasks where id=new.task_id;
  if student is null or t.workspace_id is distinct from new.workspace_id or t.related_type<>'STUDENT' or t.related_id is distinct from student
   or exists(select 1 from public.workflow_step_instances s join public.workflow_instances i on i.id=s.workflow_instance_id and i.workspace_id=s.workspace_id where s.task_id=new.task_id and i.enrollment_id<>enrollment) then raise exception 'success_task_context_mismatch';end if;
 end if;return new;
end $$;
create trigger success_task_link_guard before insert or update on public.student_success_task_links for each row execute function public.guard_success_task_context();
create trigger success_task_identity_guard before update of related_type,related_id,workspace_id on public.crm_tasks for each row execute function public.guard_success_task_context();
revoke all on function public.guard_success_task_context() from public;
create function public.save_student_success_task_link(record_id uuid,target_case uuid,target_task uuid,target_goal uuid,expected_revision integer,unlink boolean,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare ws uuid:=public.current_workspace_id();actor uuid:=app_auth.current_user_id();receipt public.mutation_receipts;fingerprint text;item public.student_success_task_links;
begin
 if not public.student_success_parent_access(target_case,true) then raise exception 'success_update_forbidden';end if;
 if record_id is null or unlink is null or p_request_key is null or length(p_request_key) not between 8 and 160 then raise exception 'success_input_invalid';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('actor',actor,'id',record_id,'case',target_case,'task',target_task,'goal',target_goal,'revision',expected_revision,'unlink',unlink)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':'||p_request_key,0));
 perform 1 from public.student_success_cases c join public.student_enrollments e on e.id=c.enrollment_id and e.workspace_id=c.workspace_id
 join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id join public.contacts p on p.id=s.person_id and p.workspace_id=s.workspace_id where c.id=target_case and c.workspace_id=ws for share of c,e,s,p;
 perform 1 from public.crm_tasks t where t.id=target_task and t.workspace_id=ws and t.archived_at is null and public.can_access_owned_record(ws,'TASK',t.id,t.owner_id,true) for update;
 if not found then raise exception 'success_task_forbidden';end if;
 if target_goal is not null and not exists(select 1 from public.student_success_goals where id=target_goal and case_id=target_case and workspace_id=ws) then raise exception 'success_goal_context_mismatch';end if;
 select * into receipt from public.mutation_receipts where workspace_id=ws and request_key=p_request_key;
 if found then
  if receipt.operation<>'SUCCESS_TASK_LINK' or receipt.created_by<>actor or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'success_request_conflict';end if;return receipt.result->'item';
 end if;
 select * into item from public.student_success_task_links where id=record_id and workspace_id=ws for update;
 if unlink then
  if item.id is null or item.revision is distinct from expected_revision then raise exception 'success_version_conflict';end if;
  if item.case_id<>target_case or item.task_id<>target_task or item.goal_id is distinct from target_goal then raise exception 'success_task_context_mismatch';end if;
  delete from public.student_success_task_links where id=item.id;
 else
  if expected_revision is not null or item.id is not null then raise exception 'success_version_conflict';end if;
  if exists(select 1 from public.student_success_task_links where workspace_id=ws and task_id=target_task) then raise exception 'success_task_already_linked';end if;
  insert into public.student_success_task_links(id,workspace_id,case_id,goal_id,task_id,created_by) values(record_id,ws,target_case,target_goal,target_task,actor) returning * into item;
 end if;
 insert into public.audit_events(workspace_id,actor_id,action,entity_type,entity_id,after_data) values(ws,actor,case when unlink then 'STUDENT_SUCCESS_TASK_UNLINKED' else 'STUDENT_SUCCESS_TASK_LINKED' end,'STUDENT_SUCCESS_CASE',target_case,jsonb_build_object('taskId',target_task,'goalId',target_goal,'revision',item.revision));
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by) values(ws,p_request_key,'SUCCESS_TASK_LINK',jsonb_build_object('request_hash',fingerprint,'item',to_jsonb(item)),actor);
 return to_jsonb(item);
end $$;
revoke all on function public.save_student_success_task_link(uuid,uuid,uuid,uuid,integer,boolean,text) from public;
grant execute on function public.save_student_success_task_link(uuid,uuid,uuid,uuid,integer,boolean,text) to crm_app;

create view public.student_success_task_records with(security_invoker=true) as
 select l.*,t.title_zh,t.title_en,t.status,t.priority,t.due_at,t.owner_id,public.can_access_owned_record(t.workspace_id,'TASK',t.id,t.owner_id,true) can_edit
 from public.student_success_task_links l join public.crm_tasks t on t.id=l.task_id and t.workspace_id=l.workspace_id where t.archived_at is null;
create view public.student_success_goal_records with(security_invoker=true) as
 select g.*,u.display_name_zh owner_name_zh,u.display_name_en owner_name_en
 from public.student_success_goals g left join public.user_profiles u on u.user_id=g.owner_id;
grant select on public.student_success_goal_records to crm_app;
create view public.student_success_records with(security_invoker=true) as
 select c.*,e.student_id,e.cohort_id,co.product_id,e.status enrollment_status,e.owner_id enrollment_owner_id,
 p.name_zh student_name_zh,p.name_en student_name_en,s.student_number,co.name_zh cohort_name_zh,co.name_en cohort_name_en,pr.name_zh product_name_zh,pr.name_en product_name_en,
 u.display_name_zh owner_name_zh,u.display_name_en owner_name_en,eu.display_name_zh enrollment_owner_name_zh,eu.display_name_en enrollment_owner_name_en,public.student_success_case_access(to_jsonb(c),true) can_edit,
 (select count(*) from public.student_success_goals g where g.case_id=c.id and g.workspace_id=c.workspace_id and g.status='ACTIVE') active_goal_count,
 (select count(*) from public.student_success_task_records t where t.case_id=c.id and t.workspace_id=c.workspace_id and t.status<>'DONE') open_task_count
 from public.student_success_cases c join public.student_enrollments e on e.id=c.enrollment_id and e.workspace_id=c.workspace_id
 join public.students s on s.id=e.student_id and s.workspace_id=e.workspace_id join public.contacts p on p.id=s.person_id and p.workspace_id=s.workspace_id
 join public.product_cohorts co on co.id=e.cohort_id and co.workspace_id=e.workspace_id join public.products pr on pr.id=co.product_id and pr.workspace_id=co.workspace_id
 left join public.user_profiles u on u.user_id=c.owner_id left join public.user_profiles eu on eu.user_id=e.owner_id;
grant select on public.student_success_records,public.student_success_task_records to crm_app;
create function public.cleanup_student_success() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='student_success_cases' then
  delete from public.crm_tasks where workspace_id=old.workspace_id and id in(select task_id from public.student_success_task_links where case_id=old.id and workspace_id=old.workspace_id);
  delete from public.mutation_receipts where workspace_id=old.workspace_id and operation='SUCCESS_TASK_LINK' and result->'item'->>'case_id'=old.id::text;
 end if;
 delete from public.mutation_receipts where workspace_id=old.workspace_id and operation in ('SUCCESS_CASE_SAVE','SUCCESS_GOAL_SAVE') and result->'item'->>'id'=old.id::text;
 delete from public.data_quality_issues where workspace_id=old.workspace_id and entity_id=old.id and entity_type in ('STUDENT_SUCCESS_CASE','STUDENT_SUCCESS_GOAL');
 return old;
end $$;
create trigger success_case_privacy_cleanup before delete on public.student_success_cases for each row execute function public.cleanup_student_success();
create trigger success_goal_privacy_cleanup before delete on public.student_success_goals for each row execute function public.cleanup_student_success();
revoke all on function public.cleanup_student_success() from public;

-- Extend the current runner in a forward migration; no duplicated quality engine.
insert into public.data_quality_rule_configs(workspace_id,rule_key,severity,enabled) select w.id,k,'MEDIUM',true from public.workspaces w cross join unnest(array['ACTIVE_SUCCESS_CASE_WITHOUT_OWNER','ACTIVE_SUCCESS_CASE_WITHOUT_NEXT_REVIEW','SUCCESS_CASE_HEALTH_NOT_ASSESSED','ACTIVE_GOAL_PAST_TARGET_DATE']) k on conflict do nothing;
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
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select m.workspace_id,config.rule_key,'ADMISSION_MILESTONE',m.id,config.severity,'quality.rule.MILESTONE_OVERDUE',jsonb_build_object('reference',m.id,'enrollmentId',m.enrollment_id),marker
  from public.admission_milestones m join public.data_quality_rule_configs config on config.workspace_id=m.workspace_id and config.rule_key='MILESTONE_OVERDUE' and config.enabled
  where m.workspace_id=ws and (m.due_at<now() and m.status not in ('COMPLETED','WAIVED','CANCELLED')) and public.admission_milestone_access(to_jsonb(m),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select m.workspace_id,config.rule_key,'ADMISSION_MILESTONE',m.id,config.severity,'quality.rule.MILESTONE_BLOCKED',jsonb_build_object('reference',m.id,'enrollmentId',m.enrollment_id),marker
  from public.admission_milestones m join public.data_quality_rule_configs config on config.workspace_id=m.workspace_id and config.rule_key='MILESTONE_BLOCKED' and config.enabled
  where m.workspace_id=ws and (m.status='BLOCKED') and public.admission_milestone_access(to_jsonb(m),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
  insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
  select m.workspace_id,config.rule_key,'ADMISSION_MILESTONE',m.id,config.severity,'quality.rule.VISA_RESULT_MISSING_OUTCOME',jsonb_build_object('reference',m.id,'enrollmentId',m.enrollment_id),marker
  from public.admission_milestones m join public.data_quality_rule_configs config on config.workspace_id=m.workspace_id and config.rule_key='VISA_RESULT_MISSING_OUTCOME' and config.enabled
  where m.workspace_id=ws and (m.milestone_type='VISA_RESULT' and m.status='COMPLETED' and m.outcome is null and not m.metadata ? 'result') and public.admission_milestone_access(to_jsonb(m),false)
  on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select w.workspace_id,c.rule_key,'WORKFLOW',w.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('enrollmentId',w.enrollment_id),marker
 from public.workflow_instances w join public.data_quality_rule_configs c on c.workspace_id=w.workspace_id and c.enabled
 where w.workspace_id=ws and public.workflow_instance_access(to_jsonb(w),false) and w.cancelled_at is null and
 ((c.rule_key='WORKFLOW_INSTANCE_BLOCKED' and public.workflow_projection(w.id)->>'status'='BLOCKED')
 or (c.rule_key='WORKFLOW_STEP_OVERDUE' and exists(select 1 from public.workflow_states(w.id) x where x.due_at<now() and x.status not in ('COMPLETED','WAIVED','CANCELLED')))
 or (c.rule_key='WORKFLOW_MISSING_CONTEXT' and exists(select 1 from public.workflow_states(w.id) x where x.context_warning is not null)))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set last_seen_at=excluded.last_seen_at,status=case when data_quality_issues.status='DISMISSED' then 'DISMISSED' else 'OPEN' end;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'ORGANIZATION',o.id,config.severity,'quality.rule.STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT',jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.workspace_id=o.workspace_id and b.id=o.id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT' and config.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and (b.commercial_tier='S' and not exists(select 1 from public.organization_contact_intelligence i where i.organization_id=o.id and i.workspace_id=ws and i.key_contact_status='KEY'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'ORGANIZATION',o.id,config.severity,'quality.rule.HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION',jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.workspace_id=o.workspace_id and b.id=o.id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION' and config.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and (b.commercial_tier in ('S','A') and trim(coalesce(b.next_action,''))='')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'ORGANIZATION',o.id,config.severity,'quality.rule.CHANNEL_ACCOUNT_WITHOUT_OWNER',jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.workspace_id=o.workspace_id and b.id=o.id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='CHANNEL_ACCOUNT_WITHOUT_OWNER' and config.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and (o.owner_id is null and b.organization_type in ('SCHOOL','PARTNER'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.KEY_CONTACT_WITHOUT_DECISION_ROLE',jsonb_build_object('reference',c.id),marker
 from public.organization_contact_intelligence i join public.contacts c on c.workspace_id=i.workspace_id and c.id=i.contact_id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='KEY_CONTACT_WITHOUT_DECISION_ROLE' and config.enabled
 where i.workspace_id=ws and i.key_contact_status='KEY' and public.channel_intelligence_access('intelligence',to_jsonb(i),false) and (c.decision_role='UNKNOWN')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'CONTACT',c.id,config.severity,'quality.rule.KEY_CONTACT_WITHOUT_DECISION_POWER',jsonb_build_object('reference',c.id),marker
 from public.organization_contact_intelligence i join public.contacts c on c.workspace_id=i.workspace_id and c.id=i.contact_id
 join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='KEY_CONTACT_WITHOUT_DECISION_POWER' and config.enabled
 where i.workspace_id=ws and i.key_contact_status='KEY' and public.channel_intelligence_access('intelligence',to_jsonb(i),false) and (i.decision_power_score is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;
insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'LEAD',l.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',l.id),marker
 from public.leads l join public.organizations o on o.id=l.organization_id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='CLAIMED_LEAD_WITHOUT_NEXT_ACTION' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and l.subject_type='SCHOOL' and public.lead_record_access(to_jsonb(l),false) and (l.owner_id is not null and l.status in ('NEW','QUALIFYING','QUALIFIED') and trim(l.next_action)='')
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'LEAD',l.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',l.id),marker
 from public.leads l join public.organizations o on o.id=l.organization_id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='QUALIFYING_SCHOOL_LEAD_WITHOUT_KEY_CONTACT' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and l.subject_type='SCHOOL' and public.lead_record_access(to_jsonb(l),false) and (l.status='QUALIFYING' and not exists(select 1 from public.organization_contact_intelligence i where i.organization_id=l.organization_id and i.key_contact_status='KEY'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'LEAD',l.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',l.id),marker
 from public.leads l join public.organizations o on o.id=l.organization_id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='QUALIFIED_SCHOOL_LEAD_WITHOUT_ORGANIZATION_OWNER' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false) and l.subject_type='SCHOOL' and public.lead_record_access(to_jsonb(l),false) and (l.status='QUALIFIED' and o.owner_id is null)
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.id=o.id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='RECRUITMENT_ACTIVATED_WITHOUT_KEY_CONTACT' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false)  and (b.partnership_stage='RECRUITMENT_ACTIVATED' and not exists(select 1 from public.organization_contact_intelligence i where i.organization_id=o.id and i.key_contact_status='KEY'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.organization_business_profiles b on b.id=o.id
 join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='SOLUTION_PROPOSED_WITHOUT_OPPORTUNITY' and c.enabled
 where o.workspace_id=ws and public.customer_subject_access('ORGANIZATION',o.id,false)  and (b.partnership_stage='SOLUTION_PROPOSED' and not exists(select 1 from public.opportunities p where p.organization_id=o.id and p.stage not in ('WON','LOST')))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='ACTIVE_CHANNEL_WITHOUT_AGREEMENT' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from public.organization_business_profiles b where b.id=o.id and b.partnership_stage in ('ACTIVE','RECRUITMENT_ACTIVATED','ONGOING_ENABLEMENT')) and not exists(select 1 from public.channel_agreements a join public.channel_agreement_versions v on v.agreement_id=a.id where a.organization_id=o.id and v.status='ACTIVE' and v.effective_from<=public.current_business_date()::date and (v.effective_to is null or v.effective_to>=public.current_business_date()::date)))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='ACTIVE_AGREEMENT_WITHOUT_RULE' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from public.channel_agreements a join public.channel_agreement_versions v on v.agreement_id=a.id where a.organization_id=o.id and v.status='ACTIVE' and not exists(select 1 from public.channel_commission_rules r where r.agreement_version_id=v.id)))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='COMMISSION_SHARED_CONTRACT_UNALLOCATED' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from jsonb_array_elements(public.commission_eligibility(o.id)->'items') item join public.channel_agreement_versions v on v.id=(item->>'agreementVersionId')::uuid where v.status in ('ACTIVE','SUPERSEDED') and item->>'eligibilityStatus'='SHARED_CONTRACT_UNALLOCATED'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='COMMISSION_MULTIPLE_ELIGIBLE_CHANNELS' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from jsonb_array_elements(public.commission_eligibility(o.id)->'items') mine where mine->>'eligibilityStatus'='ELIGIBLE' and exists(select 1 from public.channel_agreements other join public.organizations channel on channel.id=other.organization_id and public.channel_commercial_access(channel.id,false) cross join lateral jsonb_array_elements(public.commission_eligibility(channel.id,(mine->>'enrollmentId')::uuid)->'items') eligible where other.workspace_id=ws and other.organization_id<>o.id and eligible->>'eligibilityStatus'='ELIGIBLE')))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,c.rule_key,'ORGANIZATION',o.id,c.severity,'quality.rule.'||c.rule_key,jsonb_build_object('reference',o.id),marker
 from public.organizations o join public.data_quality_rule_configs c on c.workspace_id=ws and c.rule_key='APPROVED_SETTLEMENT_NOT_PAID' and c.enabled
 where o.workspace_id=ws and public.channel_commercial_access(o.id,false) and (exists(select 1 from public.commission_settlements s where s.organization_id=o.id and s.workspace_id=ws and s.status='APPROVED'))
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;


 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_CASE',c.id,config.severity,'quality.rule.ACTIVE_SUCCESS_CASE_WITHOUT_OWNER',jsonb_build_object('reference',c.id),marker
 from public.student_success_cases c join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='ACTIVE_SUCCESS_CASE_WITHOUT_OWNER' and config.enabled
 where c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),false) and c.status='ACTIVE' and c.owner_id is null
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_CASE',c.id,config.severity,'quality.rule.ACTIVE_SUCCESS_CASE_WITHOUT_NEXT_REVIEW',jsonb_build_object('reference',c.id),marker
 from public.student_success_cases c join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='ACTIVE_SUCCESS_CASE_WITHOUT_NEXT_REVIEW' and config.enabled
 where c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),false) and c.status='ACTIVE' and c.next_review_on is null
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_CASE',c.id,config.severity,'quality.rule.SUCCESS_CASE_HEALTH_NOT_ASSESSED',jsonb_build_object('reference',c.id),marker
 from public.student_success_cases c join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='SUCCESS_CASE_HEALTH_NOT_ASSESSED' and config.enabled
 where c.workspace_id=ws and public.student_success_case_access(to_jsonb(c),false) and c.status='ACTIVE' and c.health_status='UNKNOWN' and c.created_at < (public.current_business_date()::date-30)::timestamptz
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

 insert into public.data_quality_issues(workspace_id,rule_key,entity_type,entity_id,severity,title_key,details,last_seen_at)
 select ws,config.rule_key,'STUDENT_SUCCESS_GOAL',g.id,config.severity,'quality.rule.ACTIVE_GOAL_PAST_TARGET_DATE',jsonb_build_object('reference',g.id),marker
 from public.student_success_goals g join public.data_quality_rule_configs config on config.workspace_id=ws and config.rule_key='ACTIVE_GOAL_PAST_TARGET_DATE' and config.enabled
 where g.workspace_id=ws and public.student_success_parent_access(g.case_id,false) and g.status='ACTIVE' and g.target_on<public.current_business_date()::date
 on conflict(workspace_id,rule_key,entity_type,entity_id) do update set severity=excluded.severity,status=case when data_quality_issues.status='RESOLVED' then 'OPEN' else data_quality_issues.status end,details=excluded.details,last_seen_at=marker;

update public.data_quality_issues issue set status='RESOLVED',resolution_note='AUTO_RESOLVED',resolved_at=now(),resolved_by=app_auth.current_user_id()
  where issue.workspace_id=ws and issue.status in ('OPEN','ASSIGNED') and issue.last_seen_at<marker
    and issue.rule_key in (select rule_key from public.data_quality_rule_configs where workspace_id=ws);
  select count(*) into affected from public.data_quality_issues where workspace_id=ws and status in ('OPEN','ASSIGNED');
  return affected;
end;
$$;
create function public.seed_success_quality_rules() returns trigger language plpgsql security definer set search_path=public as $$begin
insert into public.data_quality_rule_configs(workspace_id,rule_key,severity,enabled) select new.id,k,'MEDIUM',true from unnest(array['ACTIVE_SUCCESS_CASE_WITHOUT_OWNER','ACTIVE_SUCCESS_CASE_WITHOUT_NEXT_REVIEW','SUCCESS_CASE_HEALTH_NOT_ASSESSED','ACTIVE_GOAL_PAST_TARGET_DATE']) k on conflict do nothing;return new;end $$;
revoke all on function public.seed_success_quality_rules() from public;
create trigger seed_success_quality after insert on public.workspaces for each row execute function public.seed_success_quality_rules();

-- Cached quality findings must not leak a Case or Goal hidden by owner/Enrollment scope.
create policy success_quality_scope on public.data_quality_issues as restrictive for select to crm_app using(
 (entity_type<>'STUDENT_SUCCESS_CASE' or public.student_success_parent_access(entity_id,false))
 and (entity_type<>'STUDENT_SUCCESS_GOAL' or exists(select 1 from public.student_success_goals g where g.id=entity_id and g.workspace_id=data_quality_issues.workspace_id))
);
-- Privacy-only projection: task facts exported once, with case/goal links separately.
create view public.student_success_privacy_tasks as select t.* from public.crm_tasks t
 where exists(select 1 from public.student_success_task_links l where l.task_id=t.id and l.workspace_id=t.workspace_id);
revoke all on public.student_success_privacy_tasks from public,crm_app;
grant select on public.student_success_privacy_tasks to crm_worker;
