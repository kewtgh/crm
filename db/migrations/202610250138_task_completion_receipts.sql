set search_path=public,app_auth,extensions;

alter table public.crm_tasks add column revision integer not null default 1 check(revision>0);
create function public.advance_task_revision() returns trigger language plpgsql as $$
begin new.revision:=old.revision+1;return new;end $$;
create trigger task_revision before update on public.crm_tasks
for each row execute function public.advance_task_revision();

-- Generic editing and worker updates keep their existing authorization and advance revisions too.
create function public.complete_crm_tasks_command(command jsonb,p_request_key text) returns jsonb
language plpgsql security definer set search_path=public,app_auth,extensions as $$
declare
 actor uuid:=app_auth.current_user_id();ws uuid:=public.current_workspace_id();
 op text:=command->>'operation';targets jsonb:=command->'tasks';target jsonb;
 item public.crm_tasks;receipt public.mutation_receipts;fingerprint text;result jsonb;
 ids uuid[]:='{}';reason text:=trim(command->>'reason');
begin
 if actor is null or not public.is_workspace_member(ws) or public.current_crm_role()='' then
  raise exception 'task_completion_forbidden';
 end if;
 if jsonb_typeof(command) is distinct from 'object' or op is null or op not in ('complete','bulkComplete')
  or jsonb_typeof(targets) is distinct from 'array'
  or p_request_key is null or p_request_key<>trim(p_request_key) or length(p_request_key) not between 8 and 160
  or command-array['operation','tasks','reason']<>'{}'::jsonb then raise exception 'task_completion_invalid';end if;
 if jsonb_array_length(targets) not between 1 and 50
  or (op='complete' and (jsonb_array_length(targets)<>1 or command ? 'reason'))
  or (op='bulkComplete' and (reason is null or length(reason) not between 3 and 500)) then
  raise exception 'task_completion_invalid';
 end if;
 for target in select value from jsonb_array_elements(targets) loop
  if jsonb_typeof(target) is distinct from 'object' or target-array['id','expectedRevision']<>'{}'::jsonb
   or jsonb_typeof(target->'id') is distinct from 'string'
   or jsonb_typeof(target->'expectedRevision') is distinct from 'number'
   or (target->>'expectedRevision') !~ '^[1-9][0-9]{0,9}$'
   or (target->>'expectedRevision')::numeric>2147483647 then raise exception 'task_completion_invalid';end if;
  ids:=array_append(ids,(target->>'id')::uuid);
 end loop;
 if (select count(distinct id) from unnest(ids) id)<>cardinality(ids) then raise exception 'task_completion_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(ws::text||':task-completion:'||p_request_key,0));
 -- Lock in canonical order and recheck current access even for receipt replay.
 for target in select value from jsonb_array_elements(targets) order by value->>'id' loop
  select * into item from public.crm_tasks t where t.id=(target->>'id')::uuid and t.workspace_id=ws
   and t.archived_at is null and public.can_access_owned_record(t.workspace_id,'TASK',t.id,t.owner_id,true) for update;
  if not found then raise exception 'task_completion_forbidden';end if;
 end loop;
 fingerprint:=encode(digest(command::text,'sha256'),'hex');
 select * into receipt from public.mutation_receipts r where r.workspace_id=ws and r.request_key=p_request_key;
 if found then
  if receipt.created_by is distinct from actor or receipt.operation<>'TASK_COMPLETION'
   or receipt.result->>'request_hash' is distinct from fingerprint then raise exception 'task_request_conflict';end if;
  return receipt.result->'item';
 end if;
 for target in select value from jsonb_array_elements(targets) loop
  select * into item from public.crm_tasks where id=(target->>'id')::uuid and workspace_id=ws;
  if item.status='DONE' or item.revision<>(target->>'expectedRevision')::integer then raise exception 'task_version_conflict';end if;
 end loop;
 update public.crm_tasks set status='DONE',completed_at=coalesce(completed_at,now()),updated_at=now()
 where workspace_id=ws and id=any(ids);
 result:=jsonb_build_object('ids',to_jsonb(ids),'affected',cardinality(ids));
 insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id)
  values(ws,actor,'crm_task_completion',p_request_key,'TASK_COMPLETE',jsonb_build_object('taskIds',ids,'reason',reason),p_request_key);
 insert into public.mutation_receipts(workspace_id,request_key,operation,result,created_by)
  values(ws,p_request_key,'TASK_COMPLETION',jsonb_build_object('request_hash',fingerprint,'item',result),actor);
 return result;
end $$;
revoke all on function public.complete_crm_tasks_command(jsonb,text) from public,crm_system,crm_worker;
grant execute on function public.complete_crm_tasks_command(jsonb,text) to crm_app;
revoke execute on function public.bulk_complete_crm_tasks(uuid[],text) from crm_app;

-- Keep the bounded workspace and dashboard projections declarative.
create or replace function public.crm_task_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_auth,extensions
as $$
declare
  actor_role text:=public.current_crm_role();
  can_view_team boolean:=actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER');
  result jsonb;
begin
  if app_auth.current_user_id() is null or not public.is_workspace_member(public.current_workspace_id()) then raise exception 'task_workspace_forbidden'; end if;
  select jsonb_build_object(
    'canViewTeam',can_view_team,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',task_rows.id,'titleZh',task_rows.title_zh,'titleEn',task_rows.title_en,
        'related',task_rows.related_label,'status',task_rows.status,'priority',task_rows.priority,
        'ownerId',task_rows.owner_id,
        'ownerName',coalesce(task_rows.owner_name,'—'),
        'dueAt',task_rows.due_at,'slaDueAt',task_rows.sla_due_at,'revision',task_rows.revision
      ) order by task_rows.sort_bucket,task_rows.due_at nulls last,task_rows.created_at,task_rows.id)
      from (
        select t.*,p.display_name_zh||' / '||p.display_name_en owner_name,
          case when t.due_at<now() then 0 when t.sla_due_at<now() then 1 else 2 end sort_bucket
        from public.crm_tasks t
        left join public.user_profiles p on p.user_id=t.owner_id
        where t.workspace_id=public.current_workspace_id()
          and t.archived_at is null and t.status<>'DONE'
          and (t.owner_id=app_auth.current_user_id() or (can_view_team and public.can_assign_crm_task(t.owner_id)))
        order by sort_bucket,t.due_at nulls last,t.created_at,t.id
        limit 100
      ) task_rows
    ),'[]'::jsonb),
    'capacity',case when can_view_team then coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId',directory.user_id,
        'name',directory.display_name_zh||' / '||directory.display_name_en,
        'role',directory.role,'team',directory.team,
        'open',coalesce(counts.open_count,0),
        'overdue',coalesce(counts.overdue_count,0),
        'dueThisWeek',coalesce(counts.week_count,0),
        'slaBreached',coalesce(counts.sla_count,0)
      ) order by coalesce(counts.open_count,0) desc,directory.display_name_en)
      from public.list_assignable_crm_users('') directory
      left join lateral(
        select
          count(*) filter(where t.status<>'DONE' and t.archived_at is null) open_count,
          count(*) filter(where t.status<>'DONE' and t.archived_at is null and t.due_at<now()) overdue_count,
          count(*) filter(where t.status<>'DONE' and t.archived_at is null and t.due_at>=now() and t.due_at<now()+interval '7 days') week_count,
          count(*) filter(where t.status<>'DONE' and t.archived_at is null and t.sla_due_at<now()) sla_count
        from public.crm_tasks t
        where t.workspace_id=public.current_workspace_id() and t.owner_id=directory.user_id
      ) counts on true
    ),'[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end;
$$;

create or replace function public.dashboard_snapshot(reporting_timezone text default null)
returns jsonb
language plpgsql stable security definer set search_path=public,app_auth,extensions
as $$
declare
  ws uuid:=public.current_workspace_id();
  actor_role text:=public.current_crm_role();
  elevated boolean:=actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR');
  progression_visible boolean:=actor_role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER');
  tz text;
  local_today date;
  month_start timestamptz;
  result jsonb;
begin
  if ws is null then raise exception 'dashboard_not_authorized'; end if;
  select coalesce(nullif(reporting_timezone,''),preference.timezone,'Asia/Taipei') into tz
  from (select 1) seed
  left join public.user_preferences preference on preference.user_id=app_auth.current_user_id();
  if not exists(select 1 from pg_timezone_names where name=tz) then tz:='Asia/Taipei'; end if;
  local_today:=(now() at time zone tz)::date;
  month_start:=date_trunc('month',now() at time zone tz) at time zone tz;
  select jsonb_build_object(
    'todayTasks',(select count(*) from public.crm_tasks where workspace_id=ws and archived_at is null and owner_id=app_auth.current_user_id() and status<>'DONE' and (due_at at time zone tz)::date=local_today),
    'overdueTasks',(select count(*) from public.crm_tasks where workspace_id=ws and archived_at is null and owner_id=app_auth.current_user_id() and status<>'DONE' and due_at<now()),
    'pendingApprovals',(select count(*) from public.approval_requests where workspace_id=ws and status='PENDING' and (elevated or requester_id=app_auth.current_user_id())),
    'renewalsDue',(select count(*) from public.contracts where workspace_id=ws and archived_at is null and status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') and end_date between local_today and local_today+90 and (elevated or owner_id=app_auth.current_user_id())),
    'riskContracts',(select count(*) from public.contracts where workspace_id=ws and archived_at is null and status='RISK' and (elevated or owner_id=app_auth.current_user_id())),
    'activeProducts',(select count(*) from public.products where workspace_id=ws and archived_at is null and active),
    'unreadNotifications',(select count(*) from public.user_notifications where workspace_id=ws and user_id=app_auth.current_user_id() and read_at is null),
    'newLeads',(select count(*) from public.leads where workspace_id=ws and archived_at is null and (created_at at time zone tz)::date>=local_today-30),
    'activeStudents',(select count(*) from public.students where workspace_id=ws and archived_at is null and status='ACTIVE'),
    'pendingProgression',case when progression_visible then
      (select count(*) from public.progression_batches where workspace_id=ws and status='PREVIEWED')
      else 0 end,
    'monthRevenueByCurrency',coalesce((select jsonb_object_agg(currency,total) from (
      select payment.currency,sum(payment.amount) total
      from public.payments payment join public.contracts contract on contract.id=payment.contract_id
      where payment.workspace_id=ws and payment.status='CONFIRMED'
        and payment.paid_at>=month_start and (elevated or contract.owner_id=app_auth.current_user_id())
      group by payment.currency
    ) revenue),'{}'::jsonb),
    'focusTasks',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'titleZh',title_zh,'titleEn',title_en,'related',related_label,
      'status',status,'priority',priority,'dueAt',due_at,'revision',revision
    ) order by due_at nulls last,id) from (
      select id,title_zh,title_en,related_label,status,priority,due_at,revision
      from public.crm_tasks where workspace_id=ws and archived_at is null and owner_id=app_auth.current_user_id() and status<>'DONE'
      order by due_at nulls last,id limit 6
    ) tasks),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
