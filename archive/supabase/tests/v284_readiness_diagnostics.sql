begin;
select plan(4);

select has_function(
  'public',
  'service_readiness_snapshot_for_workers',
  array['uuid','text[]'],
  'v2.8.4 preserves the enabled-worker readiness RPC'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.service_readiness_snapshot_for_workers(uuid,text[])',
    'EXECUTE'
  ),
  'the corrected readiness RPC remains service-role only'
);

delete from public.worker_heartbeats where worker_key='REMINDERS';

select is(
  (
    public.service_readiness_snapshot_for_workers(
      '00000000-0000-4000-8000-000000000001',
      array['REMINDERS']
    )->>'missingWorkers'
  )::integer,
  1,
  'a worker without a heartbeat is reported as missing'
);

select is(
  (
    public.service_readiness_snapshot_for_workers(
      '00000000-0000-4000-8000-000000000001',
      array['REMINDERS']
    )->>'staleWorkers'
  )::integer,
  0,
  'a missing worker is not also reported as stale'
);

select * from finish();
rollback;
