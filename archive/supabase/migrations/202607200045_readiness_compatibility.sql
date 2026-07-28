-- Preserve the public one-argument readiness contract while exposing an
-- explicit enabled-worker variant to the service runtime.

alter function public.service_readiness_snapshot(uuid,text[])
  rename to service_readiness_snapshot_for_workers;

create or replace function public.service_readiness_snapshot(target_workspace uuid)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
begin
  if target_workspace is null then raise exception 'workspace_required'; end if;
  return public.service_readiness_snapshot_for_workers(
    target_workspace,
    array[
      'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
      'GENERATED_JOBS','WEBHOOK_INBOX','INTEGRATION_SYNC'
    ]::text[]
  );
end;
$$;

revoke all on function public.service_readiness_snapshot_for_workers(uuid,text[]),
  public.service_readiness_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.service_readiness_snapshot_for_workers(uuid,text[]),
  public.service_readiness_snapshot(uuid) to service_role;

notify pgrst,'reload schema';

