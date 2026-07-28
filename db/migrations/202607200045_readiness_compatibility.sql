-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- Preserve the public one-argument readiness contract while exposing an
-- explicit enabled-worker variant to the service runtime.

alter function public.service_readiness_snapshot(uuid,text[])
  rename to service_readiness_snapshot_for_workers;

create or replace function public.service_readiness_snapshot(target_workspace uuid)
returns jsonb
language plpgsql stable security definer set search_path=public,app_auth,extensions
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
  public.service_readiness_snapshot(uuid) from public,crm_system,crm_app;
grant execute on function public.service_readiness_snapshot_for_workers(uuid,text[]),
  public.service_readiness_snapshot(uuid) to crm_system, crm_worker;

notify pgrst,'reload schema';
