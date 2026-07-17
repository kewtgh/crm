-- Real operational dashboard and approval-result notifications.

create or replace function public.dashboard_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare ws uuid:=public.current_workspace_id(); elevated boolean:=public.current_crm_role() in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR'); result jsonb;
begin
  if ws is null then raise exception 'dashboard_not_authorized'; end if;
  select jsonb_build_object(
    'todayTasks',(select count(*) from public.crm_tasks where workspace_id=ws and owner_id=auth.uid() and status<>'DONE' and due_at::date=current_date),
    'overdueTasks',(select count(*) from public.crm_tasks where workspace_id=ws and owner_id=auth.uid() and status<>'DONE' and due_at<now()),
    'pendingApprovals',(select count(*) from public.approval_requests where workspace_id=ws and status='PENDING' and (elevated or requester_id=auth.uid())),
    'renewalsDue',(select count(*) from public.contracts where workspace_id=ws and status in ('ACTIVE','RENEWAL_PREP','NEGOTIATING','RISK') and end_date between current_date and current_date+90 and (elevated or owner_id=auth.uid())),
    'riskContracts',(select count(*) from public.contracts where workspace_id=ws and status='RISK' and (elevated or owner_id=auth.uid())),
    'activeProducts',(select count(*) from public.products where workspace_id=ws and active),
    'unreadNotifications',(select count(*) from public.user_notifications where workspace_id=ws and user_id=auth.uid() and read_at is null),
    'monthRevenueByCurrency',coalesce((select jsonb_object_agg(currency,total) from (
      select p.currency,sum(p.amount) total from public.payments p join public.contracts c on c.id=p.contract_id
      where p.workspace_id=ws and p.status='CONFIRMED' and p.paid_at>=date_trunc('month',current_date) and (elevated or c.owner_id=auth.uid()) group by p.currency
    ) revenue),'{}'::jsonb),
    'focusTasks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'titleZh',title_zh,'titleEn',title_en,'related',related_label,'status',status,'priority',priority,'dueAt',due_at) order by due_at nulls last) from (
      select id,title_zh,title_en,related_label,status,priority,due_at from public.crm_tasks where workspace_id=ws and owner_id=auth.uid() and status<>'DONE' order by due_at nulls last limit 6
    ) tasks),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.dashboard_snapshot() from public;
grant execute on function public.dashboard_snapshot() to authenticated;

create or replace function public.notify_approval_result()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  if old.status='PENDING' and new.status in ('APPROVED','REJECTED','CANCELLED') then
    insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id)
    values(new.workspace_id,new.requester_id,'APPROVAL','notification.approval.title','notification.approval.body',jsonb_build_object('number',new.request_number,'status',lower(new.status)),'APPROVAL',new.id);
  end if;
  return new;
end; $$;
drop trigger if exists approval_result_notification on public.approval_requests;
create trigger approval_result_notification after update of status on public.approval_requests for each row execute procedure public.notify_approval_result();
