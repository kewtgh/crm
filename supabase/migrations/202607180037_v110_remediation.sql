begin;

create or replace function public.crm_resource_metrics(
  resource_key text,
  search_query text default '',
  status_filter text default 'all'
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  ws uuid := public.current_workspace_id();
  pattern text := '%' || trim(coalesce(search_query,'')) || '%';
  result jsonb;
begin
  if resource_key = 'schools' then
    select jsonb_build_object(
      'total',count(*)::integer,
      'needsAttention',count(*) filter(where status in ('ATTENTION','RISK'))::integer,
      'averageCompleteness',coalesce(round(avg(completeness)),0)::integer
    ) into result
    from public.organizations
    where workspace_id=ws
      and (status_filter='all' or status=status_filter)
      and (trim(coalesce(search_query,''))='' or name_zh ilike pattern or name_en ilike pattern or city ilike pattern or curriculum ilike pattern);
  elsif resource_key = 'people' then
    select jsonb_build_object(
      'total',count(*)::integer,
      'needsAttention',count(*) filter(where status in ('FOLLOW_UP','UNVERIFIED'))::integer,
      'averageCompleteness',coalesce(round(avg(completeness)),0)::integer
    ) into result
    from public.contacts
    where workspace_id=ws
      and (status_filter='all' or status=status_filter)
      and (trim(coalesce(search_query,''))='' or name_zh ilike pattern or name_en ilike pattern or coalesce(email::text,'') ilike pattern or coalesce(phone,'') ilike pattern or title ilike pattern);
  elsif resource_key = 'tasks' then
    select jsonb_build_object(
      'total',count(*)::integer,
      'needsAttention',count(*) filter(where status in ('WAITING_APPROVAL','OVERDUE'))::integer,
      'averageCompleteness',coalesce(round(avg(case when status='DONE' then 100 else 70 end)),0)::integer
    ) into result
    from public.crm_tasks
    where workspace_id=ws
      and (status_filter='all' or status=status_filter)
      and (trim(coalesce(search_query,''))='' or title_zh ilike pattern or title_en ilike pattern or related_label ilike pattern);
  else
    raise exception 'unknown_resource' using errcode='22023';
  end if;
  return result;
end;
$$;

revoke all on function public.crm_resource_metrics(text,text,text) from public,anon;
grant execute on function public.crm_resource_metrics(text,text,text) to authenticated,service_role;

drop function if exists public.dashboard_snapshot();
create function public.dashboard_snapshot(reporting_timezone text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  ws uuid:=public.current_workspace_id();
  elevated boolean:=public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR');
  tz text;
  local_today date;
  month_start timestamptz;
  result jsonb;
begin
  if ws is null then raise exception 'dashboard_not_authorized'; end if;
  select coalesce(nullif(reporting_timezone,''),p.timezone,'Asia/Taipei') into tz
  from (select 1) seed
  left join public.user_preferences p on p.user_id=auth.uid();
  if not exists(select 1 from pg_timezone_names where name=tz) then tz:='Asia/Taipei'; end if;
  local_today:=(now() at time zone tz)::date;
  month_start:=date_trunc('month',now() at time zone tz) at time zone tz;
  select jsonb_build_object(
    'todayTasks',(select count(*) from public.crm_tasks where workspace_id=ws and owner_id=auth.uid() and status<>'DONE' and (due_at at time zone tz)::date=local_today),
    'overdueTasks',(select count(*) from public.crm_tasks where workspace_id=ws and owner_id=auth.uid() and status<>'DONE' and due_at<now()),
    'pendingApprovals',(select count(*) from public.approval_requests where workspace_id=ws and status='PENDING' and (elevated or requester_id=auth.uid())),
    'renewalsDue',(select count(*) from public.contracts where workspace_id=ws and status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') and end_date between local_today and local_today+90 and (elevated or owner_id=auth.uid())),
    'riskContracts',(select count(*) from public.contracts where workspace_id=ws and status='RISK' and (elevated or owner_id=auth.uid())),
    'activeProducts',(select count(*) from public.products where workspace_id=ws and active),
    'unreadNotifications',(select count(*) from public.user_notifications where workspace_id=ws and user_id=auth.uid() and read_at is null),
    'monthRevenueByCurrency',coalesce((select jsonb_object_agg(currency,total) from (
      select p.currency,sum(p.amount) total from public.payments p join public.contracts c on c.id=p.contract_id
      where p.workspace_id=ws and p.status='CONFIRMED' and p.paid_at>=month_start and (elevated or c.owner_id=auth.uid()) group by p.currency
    ) revenue),'{}'::jsonb),
    'focusTasks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'titleZh',title_zh,'titleEn',title_en,'related',related_label,'status',status,'priority',priority,'dueAt',due_at) order by due_at nulls last) from (
      select id,title_zh,title_en,related_label,status,priority,due_at from public.crm_tasks where workspace_id=ws and owner_id=auth.uid() and status<>'DONE' order by due_at nulls last limit 6
    ) tasks),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.dashboard_snapshot(text) from public,anon;
grant execute on function public.dashboard_snapshot(text) to authenticated,service_role;

create or replace function public.generate_next_best_actions(target_organization uuid default null)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  generated integer;
  batch public.next_action_generation_batches;
  organization public.organizations;
  rule_name text;
  action public.next_best_actions;
begin
  generated:=public.generate_next_best_actions_core_v091(target_organization);
  insert into public.next_action_generation_batches(
    workspace_id,requested_by,target_organization_id,generated_count
  ) values(
    public.current_workspace_id(),auth.uid(),target_organization,generated
  ) returning * into batch;
  for organization in select * from public.organizations
    where workspace_id=public.current_workspace_id()
      and (target_organization is null or id=target_organization)
      and public.can_access_owned_record(workspace_id,'ORGANIZATION',id,owner_id,false)
  loop
    if exists(
      select 1
      from public.receivable_schedules schedule
      join public.contracts contract on contract.id=schedule.contract_id
      where contract.workspace_id=organization.workspace_id
        and contract.organization_id=organization.id
        and schedule.status<>'PAID'
        and schedule.due_date<current_date
    ) then
      insert into public.next_best_actions(
        workspace_id,organization_id,rule_key,rule_version,priority,title_zh,title_en,
        rationale_zh,rationale_en,evidence,confidence,valid_until
      ) values(
        organization.workspace_id,organization.id,'PAYMENT_OVERDUE','rules-2026.07.2','HIGH',
        '跟进逾期应收','Follow up overdue receivables',
        '该客户存在已经超过到期日且尚未付清的应收。','This customer has an unpaid receivable past its due date.',
        jsonb_build_object('rule','OVERDUE_RECEIVABLE','evaluatedAt',now()),
        0.99,now()+interval '3 days'
      ) on conflict(workspace_id,organization_id,rule_key) where status='SUGGESTED'
        do update set evidence=excluded.evidence,valid_until=excluded.valid_until,updated_at=now();
      generated:=generated+1;
    end if;
    foreach rule_name in array array['STALE_RELATIONSHIP','RENEWAL_WINDOW','PIPELINE_HYGIENE','PAYMENT_OVERDUE'] loop
      action:=null;
      select * into action from public.next_best_actions
        where workspace_id=organization.workspace_id and organization_id=organization.id
          and rule_key=rule_name and status='SUGGESTED'
        order by updated_at desc limit 1;
      insert into public.next_action_evaluations(
        workspace_id,batch_id,organization_id,rule_key,rule_version,
        applicable,reason,action_id
      ) values(
        organization.workspace_id,batch.id,organization.id,rule_name,
        case when rule_name='PAYMENT_OVERDUE' then 'rules-2026.07.2' else 'rules-2026.07.1' end,
        action.id is not null,
        case when action.id is not null then 'RULE_MATCHED' else 'RULE_NOT_APPLICABLE' end,
        action.id
      );
    end loop;
  end loop;
  update public.next_action_generation_batches set generated_count=generated where id=batch.id;
  return generated;
end;
$$;
revoke all on function public.generate_next_best_actions(uuid) from public,anon;
grant execute on function public.generate_next_best_actions(uuid) to authenticated,service_role;

-- Smoke tests and operational recovery must be able to snapshot and restore a
-- worker heartbeat without broadening access for authenticated CRM users.
grant select,insert,update,delete on public.worker_heartbeats to service_role;

commit;
