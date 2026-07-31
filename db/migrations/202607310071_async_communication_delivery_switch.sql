-- Lumina CRM v3.8.15: atomically transfer communication email ownership
-- from synchronous Web requests to the leased COMMUNICATION_DELIVERY Worker.
set search_path = public, extensions;

create or replace function public.queue_communication_message(
  target_thread uuid,
  target_body text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  thread public.communication_threads;
  result public.communication_messages;
  normalized_body text:=trim(coalesce(target_body,''));
  normalized_key text:=trim(coalesce(target_idempotency_key,''));
  should_deliver boolean:=false;
begin
  select candidate.* into thread
  from public.communication_threads candidate
  where candidate.id=target_thread
    and candidate.workspace_id=public.current_workspace_id()
    and candidate.status='OPEN'
  for update;
  if not found
    or length(normalized_body) not between 1 and 10000
    or length(normalized_key) not between 8 and 160
  then
    raise exception 'communication_message_invalid';
  end if;
  if not public.contact_channel_allowed(
    thread.contact_id,thread.channel,thread.purpose
  ) then
    raise exception 'communication_consent_required';
  end if;

  select message.* into result
  from public.communication_messages message
  where message.workspace_id=thread.workspace_id
    and message.idempotency_key=normalized_key
  for update;
  if found then
    if result.thread_id<>thread.id
      or result.direction<>'OUTBOUND'
      or result.body<>normalized_body
    then
      raise exception 'communication_idempotency_conflict';
    end if;
    if result.delivery_status='QUEUED'
      and result.last_attempt_at<=now()-interval '20 seconds'
    then
      update public.communication_messages
      set
        attempt_count=attempt_count+1,
        last_attempt_at=now(),
        next_attempt_at=coalesce(next_attempt_at,now()),
        updated_at=now()
      where id=result.id
      returning * into result;
      should_deliver:=true;
    end if;
    return jsonb_build_object(
      'message',to_jsonb(result),
      -- Retain the legacy signal for one rollback release. The v3.8.15 Web
      -- deliberately ignores it; deployment ordering prevents dual ownership.
      'shouldDeliver',should_deliver,
      'accepted',result.delivery_status='QUEUED'
    );
  end if;

  insert into public.communication_messages(
    workspace_id,thread_id,direction,body,delivery_status,sent_by,idempotency_key,
    attempt_count,last_attempt_at,next_attempt_at,updated_at
  )
  values(
    thread.workspace_id,thread.id,'OUTBOUND',normalized_body,'QUEUED',
    app_auth.current_user_id(),normalized_key,1,now(),now(),now()
  )
  on conflict(workspace_id,idempotency_key) do nothing
  returning * into result;

  if not found then
    select message.* into result
    from public.communication_messages message
    where message.workspace_id=thread.workspace_id
      and message.idempotency_key=normalized_key
    for update;
    if not found
      or result.thread_id<>thread.id
      or result.direction<>'OUTBOUND'
      or result.body<>normalized_body
    then
      raise exception 'communication_idempotency_conflict';
    end if;
    if result.delivery_status='QUEUED' and result.next_attempt_at is null then
      update public.communication_messages
      set next_attempt_at=now(),updated_at=now()
      where id=result.id
      returning * into result;
    end if;
    return jsonb_build_object(
      'message',to_jsonb(result),
      'shouldDeliver',false,
      'accepted',result.delivery_status='QUEUED'
    );
  end if;

  update public.communication_threads
  set last_message_at=result.created_at,updated_at=now()
  where id=thread.id;
  return jsonb_build_object(
    'message',to_jsonb(result),
    'shouldDeliver',true,
    'accepted',true
  );
end;
$$;

revoke all on function public.queue_communication_message(uuid,text,text)
  from public,crm_system,crm_worker;
grant execute on function public.queue_communication_message(uuid,text,text)
  to crm_app;

create or replace function public.communication_thread_snapshot(
  target_thread uuid,
  requested_message_page integer default null,
  requested_message_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_auth,extensions
as $$
declare
  thread record;
  message_items jsonb;
  message_total integer;
  message_page_size integer:=greatest(
    1,least(coalesce(requested_message_page_size,20),50)
  );
  message_total_pages integer;
  message_page integer;
begin
  select
    candidate.id,
    candidate.contact_id,
    contact.name_zh contact_zh,
    contact.name_en contact_en,
    contact.email::text contact_email,
    candidate.subject,
    candidate.channel,
    candidate.purpose,
    candidate.status,
    candidate.last_message_at
  into thread
  from public.communication_threads candidate
  join public.contacts contact on contact.id=candidate.contact_id
  where candidate.id=target_thread
    and candidate.workspace_id=public.current_workspace_id()
    and app_auth.current_user_id() is not null;
  if not found then raise exception 'communication_thread_not_found'; end if;

  select count(*)::integer into message_total
  from public.communication_messages message
  where message.thread_id=thread.id;
  message_total_pages:=greatest(
    1,ceil(message_total::numeric/message_page_size)::integer
  );
  message_page:=case
    when requested_message_page is null then message_total_pages
    else greatest(1,least(requested_message_page,message_total_pages))
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',message.id,
    'direction',message.direction,
    'body',message.body,
    'deliveryStatus',message.delivery_status,
    'failureCode',coalesce(message.delivery_failure_code,''),
    'retryAllowed',message.direction='OUTBOUND'
      and message.delivery_status='FAILED'
      and message.outcome_may_have_been_accepted=false,
    'attemptCount',message.attempt_count,
    'providerAttemptCount',message.provider_attempt_count,
    'createdAt',message.created_at
  ) order by message.created_at,message.id),'[]'::jsonb)
  into message_items
  from (
    select candidate.*
    from public.communication_messages candidate
    where candidate.thread_id=thread.id
    order by candidate.created_at,candidate.id
    limit message_page_size
    offset (message_page-1)*message_page_size
  ) message;

  return jsonb_build_object(
    'id',thread.id,
    'contactId',thread.contact_id,
    'contactZh',thread.contact_zh,
    'contactEn',thread.contact_en,
    'email',coalesce(thread.contact_email,''),
    'subject',thread.subject,
    'channel',thread.channel,
    'purpose',thread.purpose,
    'status',thread.status,
    'lastMessageAt',thread.last_message_at,
    'messages',message_items,
    'messageTotal',message_total,
    'messagePage',message_page,
    'messagePageSize',message_page_size
  );
end;
$$;

revoke all on function public.communication_thread_snapshot(uuid,integer,integer)
  from public,crm_system,crm_worker;
grant execute on function public.communication_thread_snapshot(uuid,integer,integer)
  to crm_app;

alter table public.worker_heartbeats
  drop constraint if exists worker_heartbeats_worker_key_check;
alter table public.worker_heartbeats
  add constraint worker_heartbeats_worker_key_check
  check(worker_key in (
    'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
    'COMMUNICATION_DELIVERY','GENERATED_JOBS','WEBHOOK_INBOX',
    'INTEGRATION_SYNC'
  ));

create or replace function public.record_worker_heartbeat(
  worker text,
  successful boolean,
  failure text default null,
  details jsonb default '{}'::jsonb
)
returns public.worker_heartbeats
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  result public.worker_heartbeats;
  normalized text:=upper(worker);
begin
  if normalized not in (
    'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
    'COMMUNICATION_DELIVERY','GENERATED_JOBS','WEBHOOK_INBOX',
    'INTEGRATION_SYNC'
  ) then raise exception 'worker_key_invalid'; end if;
  insert into public.worker_heartbeats(
    worker_key,last_seen_at,last_success_at,last_failure_at,
    consecutive_failures,last_error,metadata,updated_at
  ) values(
    normalized,now(),case when successful then now() end,
    case when not successful then now() end,
    case when successful then 0 else 1 end,
    case when successful then null else left(coalesce(failure,'UNKNOWN'),500) end,
    coalesce(details,'{}'::jsonb),now()
  ) on conflict(worker_key) do update set
    last_seen_at=now(),
    last_success_at=case
      when successful then now() else worker_heartbeats.last_success_at end,
    last_failure_at=case
      when successful then worker_heartbeats.last_failure_at else now() end,
    consecutive_failures=case
      when successful then 0 else worker_heartbeats.consecutive_failures+1 end,
    last_error=case
      when successful then null else left(coalesce(failure,'UNKNOWN'),500) end,
    metadata=coalesce(details,'{}'::jsonb),updated_at=now()
  returning * into result;
  return result;
end;
$$;

revoke all on function public.record_worker_heartbeat(text,boolean,text,jsonb)
  from public,crm_app,crm_system,crm_worker;
grant execute on function public.record_worker_heartbeat(text,boolean,text,jsonb)
  to crm_system,crm_worker;

create or replace function public.service_readiness_snapshot_for_workers(
  target_workspace uuid default '00000000-0000-4000-8000-000000000001',
  enabled_workers text[] default array[
    'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
    'COMMUNICATION_DELIVERY','GENERATED_JOBS','WEBHOOK_INBOX',
    'INTEGRATION_SYNC'
  ]::text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_auth,extensions
as $$
declare
  workers text[];
  stale_workers integer;
  registered_workers integer;
  missing_workers integer;
  failed_jobs integer;
  stuck_jobs integer;
  oldest_pending timestamptz;
  communication_queued integer;
  communication_processing integer;
  communication_expired integer;
  communication_failed integer;
  communication_uncertain integer;
  communication_breached integer;
  communication_oldest_due timestamptz;
begin
  if not exists(
    select 1 from public.workspaces where id=target_workspace
  ) then raise exception 'workspace_not_found'; end if;
  select coalesce(
    array_agg(distinct upper(value) order by upper(value)),'{}'::text[]
  ) into workers
  from unnest(coalesce(enabled_workers,'{}'::text[])) value
  where upper(value)=any(array[
    'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
    'COMMUNICATION_DELIVERY','GENERATED_JOBS','WEBHOOK_INBOX',
    'INTEGRATION_SYNC'
  ]::text[]);
  if cardinality(workers)<>cardinality(coalesce(enabled_workers,'{}'::text[]))
  then raise exception 'worker_key_invalid'; end if;

  select count(*) into stale_workers
  from public.worker_heartbeats
  where worker_key=any(workers)
    and (last_seen_at<now()-interval '15 minutes' or consecutive_failures>0);
  select count(*) into registered_workers
  from public.worker_heartbeats where worker_key=any(workers);
  missing_workers:=greatest(0,cardinality(workers)-registered_workers);

  select
    count(*) filter(
      where delivery_status='QUEUED' and next_attempt_at<=now()
    ),
    count(*) filter(where delivery_status='PROCESSING'),
    count(*) filter(
      where delivery_status='PROCESSING' and lease_expires_at<now()
    ),
    count(*) filter(where delivery_status='FAILED'),
    count(*) filter(where delivery_status='UNCERTAIN'),
    count(*) filter(
      where delivery_status='QUEUED'
        and next_attempt_at<=now()-interval '15 minutes'
    ),
    min(next_attempt_at) filter(
      where delivery_status='QUEUED' and next_attempt_at<=now()
    )
  into
    communication_queued,communication_processing,communication_expired,
    communication_failed,communication_uncertain,communication_breached,
    communication_oldest_due
  from public.communication_messages
  where workspace_id=target_workspace and direction='OUTBOUND';

  select
    (case when 'NOTIFICATION_OUTBOX'=any(workers) then
      (select count(*) from public.notification_outbox where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(case when 'CALENDAR_DELIVERIES'=any(workers) then
      (select count(*) from public.calendar_deliveries where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(case when 'COMMUNICATION_DELIVERY'=any(workers) then
      communication_failed+communication_uncertain else 0 end)
    +(case when 'GENERATED_JOBS'=any(workers) then
      (select count(*) from public.generated_jobs where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(case when 'REMINDERS'=any(workers) then
      (select count(*) from public.reminders where workspace_id=target_workspace and status='FAILED') else 0 end)
    +(case when 'WEBHOOK_INBOX'=any(workers) then
      (select count(*) from public.webhook_inbox where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(case when 'INTEGRATION_SYNC'=any(workers) then
      (select count(*) from public.integration_sync_jobs where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(select count(*) from public.import_batches where workspace_id=target_workspace and status='PARTIAL_FAILED')
    +(select count(*) from public.approval_requests where workspace_id=target_workspace and execution_status='FAILED')
    +(select count(*) from public.staff_identity_repair_jobs where workspace_id=target_workspace and status in ('FAILED','DEAD'))
  into failed_jobs;

  select
    (case when 'NOTIFICATION_OUTBOX'=any(workers) then
      (select count(*) from public.notification_outbox where workspace_id=target_workspace and status='SENDING' and lease_expires_at<now()) else 0 end)
    +(case when 'CALENDAR_DELIVERIES'=any(workers) then
      (select count(*) from public.calendar_deliveries where workspace_id=target_workspace and status='SENDING' and lease_expires_at<now()) else 0 end)
    +(case when 'COMMUNICATION_DELIVERY'=any(workers) then
      communication_expired+communication_breached else 0 end)
    +(case when 'GENERATED_JOBS'=any(workers) then
      (select count(*) from public.generated_jobs where workspace_id=target_workspace and status='PROCESSING' and lease_expires_at<now()) else 0 end)
    +(case when 'WEBHOOK_INBOX'=any(workers) then
      (select count(*) from public.webhook_inbox where workspace_id=target_workspace and status='PROCESSING' and lease_expires_at<now()) else 0 end)
    +(case when 'REMINDERS'=any(workers) then
      (select count(*) from public.reminders where workspace_id=target_workspace and status='PROCESSING' and scheduled_at<now()-interval '15 minutes') else 0 end)
    +(case when 'INTEGRATION_SYNC'=any(workers) then
      (select count(*) from public.integration_sync_jobs where workspace_id=target_workspace and status='PROCESSING' and lease_expires_at<now()) else 0 end)
  into stuck_jobs;

  select min(value) into oldest_pending from (
    select min(created_at) value from public.notification_outbox
      where 'NOTIFICATION_OUTBOX'=any(workers) and workspace_id=target_workspace and status in ('PENDING','SENDING','FAILED')
    union all select min(created_at) from public.calendar_deliveries
      where 'CALENDAR_DELIVERIES'=any(workers) and workspace_id=target_workspace and status in ('QUEUED','SENDING','FAILED')
    union all select communication_oldest_due
      where 'COMMUNICATION_DELIVERY'=any(workers)
    union all select min(created_at) from public.generated_jobs
      where 'GENERATED_JOBS'=any(workers) and workspace_id=target_workspace and status in ('QUEUED','PROCESSING','FAILED')
    union all select min(received_at) from public.webhook_inbox
      where 'WEBHOOK_INBOX'=any(workers) and workspace_id=target_workspace and status in ('RECEIVED','PROCESSING','FAILED')
    union all select min(scheduled_at) from public.reminders
      where 'REMINDERS'=any(workers) and workspace_id=target_workspace and status in ('PENDING','PROCESSING','FAILED')
    union all select min(created_at) from public.integration_sync_jobs
      where 'INTEGRATION_SYNC'=any(workers) and workspace_id=target_workspace and status in ('QUEUED','PROCESSING','FAILED')
  ) pending;

  return jsonb_build_object(
    'database',true,
    'workspaceId',target_workspace,
    'enabledWorkers',workers,
    'staleWorkers',stale_workers,
    'registeredWorkers',registered_workers,
    'missingWorkers',missing_workers,
    'failedJobs',failed_jobs,
    'stuckJobs',stuck_jobs,
    'oldestPendingAt',oldest_pending,
    'communicationDelivery',jsonb_build_object(
      'queued',communication_queued,
      'processing',communication_processing,
      'expiredLeases',communication_expired,
      'failed',communication_failed,
      'uncertain',communication_uncertain,
      'slaBreaches',communication_breached,
      'oldestDueAt',communication_oldest_due,
      'oldestDueAgeSeconds',case
        when communication_oldest_due is null then 0
        else greatest(0,extract(epoch from now()-communication_oldest_due)::integer)
      end
    ),
    'ready',stale_workers=0 and missing_workers=0
      and failed_jobs=0 and stuck_jobs=0,
    'checkedAt',now()
  );
end;
$$;

create or replace function public.service_readiness_snapshot(target_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_auth,extensions
as $$
begin
  if target_workspace is null then raise exception 'workspace_required'; end if;
  return public.service_readiness_snapshot_for_workers(
    target_workspace,
    array[
      'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
      'COMMUNICATION_DELIVERY','GENERATED_JOBS','WEBHOOK_INBOX',
      'INTEGRATION_SYNC'
    ]::text[]
  );
end;
$$;

revoke all on function public.service_readiness_snapshot_for_workers(uuid,text[])
  from public,crm_app,crm_system,crm_worker;
revoke all on function public.service_readiness_snapshot(uuid)
  from public,crm_app,crm_system,crm_worker;
grant execute on function public.service_readiness_snapshot_for_workers(uuid,text[])
  to crm_system,crm_worker;
grant execute on function public.service_readiness_snapshot(uuid)
  to crm_system,crm_worker;

alter function public.operational_snapshot()
  rename to operational_snapshot_core_v3814;

create function public.operational_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,app_auth,extensions
as $$
declare
  base jsonb;
  ws uuid:=public.current_workspace_id();
  metric jsonb;
begin
  base:=public.operational_snapshot_core_v3814();
  metric:=jsonb_build_object(
    'key','COMMUNICATION_DELIVERY',
    'slaMinutes',15,
    'pending',(select count(*) from public.communication_messages
      where workspace_id=ws and direction='OUTBOUND'
        and delivery_status in ('QUEUED','PROCESSING')),
    'failed',(select count(*) from public.communication_messages
      where workspace_id=ws and direction='OUTBOUND'
        and delivery_status in ('FAILED','UNCERTAIN')),
    'stuck',(select count(*) from public.communication_messages
      where workspace_id=ws and direction='OUTBOUND'
        and delivery_status='PROCESSING' and lease_expires_at<now()),
    'breached',(select count(*) from public.communication_messages
      where workspace_id=ws and direction='OUTBOUND'
        and delivery_status='QUEUED'
        and next_attempt_at<=now()-interval '15 minutes'),
    'oldest',(select min(next_attempt_at) from public.communication_messages
      where workspace_id=ws and direction='OUTBOUND'
        and delivery_status='QUEUED' and next_attempt_at<=now())
  );
  return jsonb_set(
    base,'{queues}',
    coalesce(base->'queues','[]'::jsonb)||jsonb_build_array(metric)
  );
end;
$$;

revoke all on function public.operational_snapshot()
  from public,crm_system,crm_worker;
grant execute on function public.operational_snapshot() to crm_app;

notify pgrst,'reload schema';
