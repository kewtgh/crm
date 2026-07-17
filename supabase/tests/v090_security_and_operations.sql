begin;
select plan(56);

select ok(
  to_regprocedure('public.refund_payment(uuid,numeric,text)') is null,
  'the legacy refund RPC no longer exists'
);
select ok(
  not has_table_privilege('authenticated','public.approval_requests','INSERT'),
  'authenticated users cannot insert approval requests directly'
);
select ok(
  not has_table_privilege('authenticated','public.approval_actions','INSERT'),
  'authenticated users cannot insert approval actions directly'
);
select ok(
  has_function_privilege(
    'authenticated','public.create_approval(text,text,text,text)','EXECUTE'
  ),
  'authenticated users use the controlled approval RPC'
);
select ok(
  pg_get_functiondef('public.create_approval(text,text,text,text)'::regprocedure)
    like '%can_access_owned_record%',
  'approval creation enforces record scope in the database'
);
select ok(
  pg_get_functiondef('public.request_refund(uuid,numeric,text)'::regprocedure)
    like '%can_access_owned_record%',
  'refund requests enforce contract record scope'
);
select ok(
  pg_get_functiondef(
    'public.create_quote(text,uuid,uuid,uuid,text,numeric,numeric,date,text,text)'::regprocedure
  ) like '%workspace_id=organization.workspace_id%',
  'quote relationships are validated in one workspace'
);
select ok(
  pg_get_functiondef(
    'public.create_appointment_with_delivery(text,text,text,text,uuid,text,timestamptz,timestamptz,text,integer[],jsonb)'::regprocedure
  ) like '%workspace_id=public.current_workspace_id()%',
  'appointment relationships are workspace scoped'
);
select ok(
  pg_get_functiondef('public.process_import_batch(uuid,integer)'::regprocedure)
    like '%workspace_id=batch.workspace_id%',
  'import updates cannot cross workspace boundaries'
);

select has_table('public','login_throttle_buckets','durable login throttle buckets exist');
select ok(
  (select relrowsecurity from pg_class where oid='public.login_throttle_buckets'::regclass),
  'login throttle buckets enforce RLS'
);
select ok(
  not has_function_privilege(
    'anon','public.apply_login_throttle(text,text,text)','EXECUTE'
  ),
  'anonymous callers cannot access the login throttle'
);
select ok(
  not has_function_privilege(
    'authenticated','public.apply_login_throttle(text,text,text)','EXECUTE'
  ),
  'browser-authenticated callers cannot access the login throttle'
);
select ok(
  has_function_privilege(
    'service_role','public.apply_login_throttle(text,text,text)','EXECUTE'
  ),
  'only the server service role can access the login throttle'
);
select is(
  public.apply_login_throttle(repeat('a',64),repeat('b',64),'SUCCESS')->>'allowed',
  'true',
  'login throttle reset is allowed'
);
select is(
  public.apply_login_throttle(repeat('a',64),repeat('b',64),'CHECK')->>'allowed',
  'true',
  'a clean login identity is initially allowed'
);
do $$
begin
  for attempt in 1..8 loop
    perform public.apply_login_throttle(repeat('a',64),repeat('b',64),'FAILURE');
  end loop;
end
$$;
select is(
  public.apply_login_throttle(repeat('a',64),repeat('b',64),'CHECK')->>'allowed',
  'false',
  'eight account failures block the shared login identity'
);
select is(
  public.apply_login_throttle(repeat('a',64),repeat('b',64),'SUCCESS')->>'allowed',
  'true',
  'successful authentication clears both throttle buckets'
);

select has_table('public','staff_identity_changes','identity compensation records exist');
select ok(
  (select relrowsecurity from pg_class where oid='public.staff_identity_changes'::regclass),
  'identity compensation records enforce RLS'
);
select ok(
  not has_table_privilege('authenticated','public.workspace_memberships','UPDATE'),
  'browser sessions cannot update memberships directly'
);
select ok(
  not has_table_privilege('authenticated','public.sales_team_members','UPDATE'),
  'browser sessions cannot update sales-team identity state directly'
);
select ok(
  has_function_privilege(
    'service_role','public.prepare_staff_identity_change(uuid,text,text,uuid)','EXECUTE'
  ),
  'the service role can prepare transactional identity changes'
);
select ok(
  has_function_privilege(
    'service_role','public.complete_staff_identity_change(uuid)','EXECUTE'
  ),
  'the service role can complete identity changes'
);
select ok(
  has_function_privilege(
    'service_role','public.rollback_staff_identity_change(uuid,text)','EXECUTE'
  ),
  'the service role can compensate identity changes'
);

select has_table('public','worker_heartbeats','worker heartbeats are persisted');
select ok(
  (select relrowsecurity from pg_class where oid='public.worker_heartbeats'::regclass),
  'worker heartbeats enforce RLS'
);
select ok(
  has_function_privilege(
    'service_role','public.record_worker_heartbeat(text,boolean,text,jsonb)','EXECUTE'
  ),
  'workers can report heartbeat state through a controlled RPC'
);
select ok(
  has_function_privilege('authenticated','public.operational_snapshot()','EXECUTE'),
  'administrators can request the authorized operations snapshot'
);
select ok(
  has_function_privilege(
    'authenticated','public.operational_retryable_jobs()','EXECUTE'
  ),
  'administrators can list retryable jobs through a controlled RPC'
);
select ok(
  has_function_privilege(
    'authenticated','public.retry_operational_job(text,uuid)','EXECUTE'
  ),
  'administrators can request an audited controlled retry'
);

select has_table('public','integration_connections','integration states are persisted');
select ok(
  (select relrowsecurity from pg_class where oid='public.integration_connections'::regclass),
  'integration states enforce RLS'
);
select has_table('public','webhook_inbox','signed webhook events use a durable inbox');
select ok(
  (select relrowsecurity from pg_class where oid='public.webhook_inbox'::regclass),
  'webhook inbox events enforce RLS'
);
select ok(
  has_table_privilege('service_role','public.webhook_inbox','INSERT'),
  'the signed server endpoint can ingest webhook events'
);
select ok(
  not has_table_privilege('authenticated','public.webhook_inbox','INSERT'),
  'browser sessions cannot fabricate webhook events'
);
select ok(
  has_function_privilege(
    'service_role','public.claim_webhook_events(integer)','EXECUTE'
  ),
  'the integration worker can claim webhook events'
);
select ok(
  has_function_privilege(
    'service_role','public.complete_webhook_event(uuid)','EXECUTE'
  ),
  'the integration worker can complete webhook events'
);

select has_table('public','product_bundles','product bundles are durable');
select has_table('public','product_bundle_items','product bundle items are durable');
select ok(
  not has_table_privilege('authenticated','public.product_bundles','INSERT'),
  'product bundles cannot be inserted directly'
);
select ok(
  not has_table_privilege('authenticated','public.product_bundle_items','INSERT'),
  'product bundle items cannot be inserted directly'
);
select ok(
  has_function_privilege(
    'authenticated','public.create_product_bundle(text,text,text,jsonb)','EXECUTE'
  ),
  'leaders create bundles atomically through a controlled RPC'
);
select has_table(
  'public','exchange_rate_snapshots','locked exchange-rate snapshots are durable'
);
select has_table('public','next_best_actions','rules-first next actions are durable');
select ok(
  not has_table_privilege('authenticated','public.next_best_actions','INSERT'),
  'next actions cannot be fabricated through direct table inserts'
);
select ok(
  has_function_privilege(
    'authenticated','public.generate_next_best_actions(uuid)','EXECUTE'
  ),
  'authorized users can run deterministic next-action rules'
);

select has_table(
  'public','contract_renewal_playbooks','renewal playbooks are persisted'
);
select has_table(
  'public','opportunity_stage_history','opportunity stage history is persisted'
);
select ok(
  has_function_privilege(
    'authenticated','public.import_dry_run(uuid)','EXECUTE'
  ),
  'authorized import users can run a non-mutating dry run'
);
select ok(
  has_function_privilege(
    'authenticated','public.duplicate_merge_preview(text,uuid,uuid)','EXECUTE'
  ),
  'authorized users can preview duplicate merges'
);
select ok(
  has_function_privilege(
    'authenticated','public.workspace_relationship_health()','EXECUTE'
  ),
  'relationship health is calculated from authorized real records'
);
select ok(
  has_function_privilege(
    'authenticated','public.explain_record_access(text,uuid,text)','EXECUTE'
  ),
  'permission explanations are computed by the database boundary'
);
select ok(
  has_function_privilege(
    'service_role','public.service_readiness_snapshot(uuid)','EXECUTE'
  ),
  'readiness telemetry is service-role only'
);
select ok(
  not has_function_privilege(
    'anon','public.service_readiness_snapshot(uuid)','EXECUTE'
  ),
  'anonymous callers cannot inspect readiness internals'
);

select * from finish();
rollback;
