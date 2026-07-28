-- Lumina CRM v2.8.4: keep missing and stale worker telemetry distinct.
--
-- The v2.2 implementation deliberately failed closed, but added missing workers
-- into stale_workers before returning both fields. Preserve the reviewed query
-- and public RPC signature while correcting that output contract forward-only.

alter function public.service_readiness_snapshot_for_workers(uuid,text[])
  rename to service_readiness_snapshot_for_workers_v283;

create function public.service_readiness_snapshot_for_workers(
  target_workspace uuid default '00000000-0000-4000-8000-000000000001',
  enabled_workers text[] default array[
    'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
    'GENERATED_JOBS','WEBHOOK_INBOX','INTEGRATION_SYNC'
  ]::text[]
)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  snapshot jsonb;
  missing_workers integer;
  combined_stale_workers integer;
begin
  snapshot := public.service_readiness_snapshot_for_workers_v283(
    target_workspace,
    enabled_workers
  );
  missing_workers := greatest(0,coalesce((snapshot->>'missingWorkers')::integer,0));
  combined_stale_workers := greatest(0,coalesce((snapshot->>'staleWorkers')::integer,0));
  return jsonb_set(
    snapshot,
    '{staleWorkers}',
    to_jsonb(greatest(0,combined_stale_workers-missing_workers)),
    true
  );
end;
$$;

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

revoke all on function public.service_readiness_snapshot_for_workers_v283(uuid,text[])
  from public,anon,authenticated,service_role;
revoke all on function public.service_readiness_snapshot_for_workers(uuid,text[])
  from public,anon,authenticated;
revoke all on function public.service_readiness_snapshot(uuid)
  from public,anon,authenticated;
grant execute on function public.service_readiness_snapshot_for_workers(uuid,text[])
  to service_role;
grant execute on function public.service_readiness_snapshot(uuid) to service_role;

notify pgrst,'reload schema';
