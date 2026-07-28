create or replace function public.admin_dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,auth
as $$
declare ws uuid:=public.current_workspace_id(); result jsonb;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') then
    raise exception 'admin_required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'staff_total',count(*),
    'active_staff',count(*) filter(where m.status='ACTIVE'),
    'privileged_total',count(*) filter(where m.role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')),
    'privileged_mfa',count(*) filter(where m.role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') and exists(select 1 from auth.mfa_factors f where f.user_id=m.user_id and f.status='verified')),
    'mfa_missing',count(*) filter(where m.role in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER') and not exists(select 1 from auth.mfa_factors f where f.user_id=m.user_id and f.status='verified')),
    'pending_approvals',(select count(*) from public.approval_requests a where a.workspace_id=ws and a.status='PENDING'),
    'failed_jobs',(select count(*) from public.generated_jobs j where j.workspace_id=ws and j.status='FAILED'),
    'unread_notifications',(select count(*) from public.user_notifications n where n.workspace_id=ws and n.user_id=auth.uid() and n.read_at is null)
  ) into result
  from public.workspace_memberships m
  where m.workspace_id=ws;
  return result;
end;
$$;

revoke all on function public.admin_dashboard_metrics() from public;
grant execute on function public.admin_dashboard_metrics() to authenticated;
