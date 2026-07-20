-- v2.2.0: enabled-worker readiness, recoverable integration jobs, and
-- deterministic manual retry semantics.

drop function if exists public.service_readiness_snapshot(uuid);
create function public.service_readiness_snapshot(
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
  workers text[];
  stale_workers integer;
  registered_workers integer;
  missing_workers integer;
  failed_jobs integer;
  stuck_jobs integer;
  oldest_pending timestamptz;
begin
  if not exists(select 1 from public.workspaces where id=target_workspace) then
    raise exception 'workspace_not_found';
  end if;
  select coalesce(array_agg(distinct upper(value) order by upper(value)),'{}'::text[])
  into workers from unnest(coalesce(enabled_workers,'{}'::text[])) value
  where upper(value)=any(array[
    'REMINDERS','NOTIFICATION_OUTBOX','CALENDAR_DELIVERIES',
    'GENERATED_JOBS','WEBHOOK_INBOX','INTEGRATION_SYNC'
  ]::text[]);
  if cardinality(workers)<>cardinality(coalesce(enabled_workers,'{}'::text[])) then
    raise exception 'worker_key_invalid';
  end if;

  select count(*) into stale_workers from public.worker_heartbeats
    where worker_key=any(workers)
      and (last_seen_at<now()-interval '15 minutes' or consecutive_failures>0);
  select count(*) into registered_workers from public.worker_heartbeats
    where worker_key=any(workers);
  missing_workers:=greatest(0,cardinality(workers)-registered_workers);
  stale_workers:=stale_workers+missing_workers;

  select
    (case when 'NOTIFICATION_OUTBOX'=any(workers) then (select count(*) from public.notification_outbox where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(case when 'CALENDAR_DELIVERIES'=any(workers) then (select count(*) from public.calendar_deliveries where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(case when 'GENERATED_JOBS'=any(workers) then (select count(*) from public.generated_jobs where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(case when 'REMINDERS'=any(workers) then (select count(*) from public.reminders where workspace_id=target_workspace and status='FAILED') else 0 end)
    +(case when 'WEBHOOK_INBOX'=any(workers) then (select count(*) from public.webhook_inbox where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(case when 'INTEGRATION_SYNC'=any(workers) then (select count(*) from public.integration_sync_jobs where workspace_id=target_workspace and status in ('FAILED','DEAD')) else 0 end)
    +(select count(*) from public.import_batches where workspace_id=target_workspace and status='PARTIAL_FAILED')
    +(select count(*) from public.approval_requests where workspace_id=target_workspace and execution_status='FAILED')
    +(select count(*) from public.staff_identity_repair_jobs where workspace_id=target_workspace and status in ('FAILED','DEAD'))
  into failed_jobs;

  select
    (case when 'NOTIFICATION_OUTBOX'=any(workers) then (select count(*) from public.notification_outbox where workspace_id=target_workspace and status='SENDING' and lease_expires_at<now()) else 0 end)
    +(case when 'CALENDAR_DELIVERIES'=any(workers) then (select count(*) from public.calendar_deliveries where workspace_id=target_workspace and status='SENDING' and lease_expires_at<now()) else 0 end)
    +(case when 'GENERATED_JOBS'=any(workers) then (select count(*) from public.generated_jobs where workspace_id=target_workspace and status='PROCESSING' and lease_expires_at<now()) else 0 end)
    +(case when 'WEBHOOK_INBOX'=any(workers) then (select count(*) from public.webhook_inbox where workspace_id=target_workspace and status='PROCESSING' and lease_expires_at<now()) else 0 end)
    +(case when 'REMINDERS'=any(workers) then (select count(*) from public.reminders where workspace_id=target_workspace and status='PROCESSING' and scheduled_at<now()-interval '15 minutes') else 0 end)
    +(case when 'INTEGRATION_SYNC'=any(workers) then (select count(*) from public.integration_sync_jobs where workspace_id=target_workspace and status='PROCESSING' and lease_expires_at<now()) else 0 end)
  into stuck_jobs;

  select min(value) into oldest_pending from (
    select min(created_at) value from public.notification_outbox where 'NOTIFICATION_OUTBOX'=any(workers) and workspace_id=target_workspace and status in ('PENDING','SENDING','FAILED')
    union all select min(created_at) from public.calendar_deliveries where 'CALENDAR_DELIVERIES'=any(workers) and workspace_id=target_workspace and status in ('QUEUED','SENDING','FAILED')
    union all select min(created_at) from public.generated_jobs where 'GENERATED_JOBS'=any(workers) and workspace_id=target_workspace and status in ('QUEUED','PROCESSING','FAILED')
    union all select min(received_at) from public.webhook_inbox where 'WEBHOOK_INBOX'=any(workers) and workspace_id=target_workspace and status in ('RECEIVED','PROCESSING','FAILED')
    union all select min(scheduled_at) from public.reminders where 'REMINDERS'=any(workers) and workspace_id=target_workspace and status in ('PENDING','PROCESSING','FAILED')
    union all select min(created_at) from public.integration_sync_jobs where 'INTEGRATION_SYNC'=any(workers) and workspace_id=target_workspace and status in ('QUEUED','PROCESSING','FAILED')
  ) pending;

  return jsonb_build_object(
    'database',true,'workspaceId',target_workspace,'enabledWorkers',workers,
    'staleWorkers',stale_workers,'registeredWorkers',registered_workers,
    'missingWorkers',missing_workers,'failedJobs',failed_jobs,'stuckJobs',stuck_jobs,
    'oldestPendingAt',oldest_pending,
    'ready',stale_workers=0 and failed_jobs=0 and stuck_jobs=0,'checkedAt',now()
  );
end;
$$;

revoke all on function public.service_readiness_snapshot(uuid,text[])
  from public,anon,authenticated;
grant execute on function public.service_readiness_snapshot(uuid,text[]) to service_role;

create or replace function public.retry_operational_job(job_type text,job_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
declare normalized text:=upper(job_type);ws uuid:=public.current_workspace_id();previous_status text;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or ws is null then
    raise exception 'operations_not_authorized';
  end if;
  if normalized='NOTIFICATION_OUTBOX' then
    select status into previous_status from public.notification_outbox where id=job_id and workspace_id=ws and status in ('FAILED','DEAD') for update;
    update public.notification_outbox set status='PENDING',attempts=0,next_attempt_at=now(),last_error=null,locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now() where id=job_id and workspace_id=ws and status in ('FAILED','DEAD');
  elsif normalized='CALENDAR_DELIVERIES' then
    select status into previous_status from public.calendar_deliveries where id=job_id and workspace_id=ws and status in ('FAILED','DEAD') for update;
    update public.calendar_deliveries set status='QUEUED',attempts=0,available_at=now(),last_error=null,locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now() where id=job_id and workspace_id=ws and status in ('FAILED','DEAD');
  elsif normalized='GENERATED_JOBS' then
    select status into previous_status from public.generated_jobs where id=job_id and workspace_id=ws and status in ('FAILED','DEAD') for update;
    update public.generated_jobs set status='QUEUED',attempts=0,available_at=now(),artifact_path=null,expires_at=null,error_message=null,locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now() where id=job_id and workspace_id=ws and status in ('FAILED','DEAD');
  elsif normalized='REMINDERS' then
    select status into previous_status from public.reminders where id=job_id and workspace_id=ws and status='FAILED' for update;
    update public.reminders set status='PENDING',attempts=0,scheduled_at=now(),last_error=null where id=job_id and workspace_id=ws and status='FAILED';
  elsif normalized='WEBHOOK_INBOX' then
    select status into previous_status from public.webhook_inbox where id=job_id and workspace_id=ws and status in ('FAILED','DEAD') for update;
    update public.webhook_inbox set status='RECEIVED',attempts=0,available_at=now(),last_error=null,locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now() where id=job_id and workspace_id=ws and status in ('FAILED','DEAD');
  elsif normalized='INTEGRATION_SYNC' then
    select status into previous_status from public.integration_sync_jobs where id=job_id and workspace_id=ws and status in ('FAILED','DEAD') for update;
    update public.integration_sync_jobs set status='QUEUED',attempts=0,available_at=now(),last_error=null,locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now() where id=job_id and workspace_id=ws and status in ('FAILED','DEAD');
  else
    raise exception 'operational_job_type_invalid';
  end if;
  if previous_status is null or not found then raise exception 'operational_job_not_retryable'; end if;
  insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data,request_id)
  values(ws,auth.uid(),'operational_job',job_id::text,'RETRY',jsonb_build_object('type',normalized,'status',previous_status),jsonb_build_object('type',normalized,'status','REQUEUED','attempts',0),txid_current()::text);
end;
$$;

create or replace function public.operational_retryable_jobs_page(page_number integer default 1,page_size integer default 10)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare ws uuid:=public.current_workspace_id();result jsonb;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or ws is null then raise exception 'operations_not_authorized'; end if;
  if page_number<1 or page_size not in (10,20,50) then raise exception 'invalid_pagination'; end if;
  with jobs as materialized (
    select id::text id,'NOTIFICATION_OUTBOX'::text type,template_key::text label,status::text status,coalesce(last_error,'')::text error,updated_at "updatedAt" from public.notification_outbox where workspace_id=ws and status in ('FAILED','DEAD')
    union all select id::text,'CALENDAR_DELIVERIES',delivery_type::text,status::text,coalesce(last_error,'')::text,updated_at from public.calendar_deliveries where workspace_id=ws and status in ('FAILED','DEAD')
    union all select id::text,'GENERATED_JOBS',job_type::text,status::text,coalesce(error_message,'')::text,updated_at from public.generated_jobs where workspace_id=ws and status in ('FAILED','DEAD')
    union all select id::text,'REMINDERS',reminder_type::text,status::text,coalesce(last_error,'')::text,created_at from public.reminders where workspace_id=ws and status='FAILED'
    union all select id::text,'WEBHOOK_INBOX',(provider||' / '||event_type)::text,status::text,coalesce(last_error,'')::text,updated_at from public.webhook_inbox where workspace_id=ws and status in ('FAILED','DEAD')
    union all select id::text,'INTEGRATION_SYNC',provider::text,status::text,coalesce(last_error,'')::text,updated_at from public.integration_sync_jobs where workspace_id=ws and status in ('FAILED','DEAD')
    union all select id::text,'IDENTITY_REPAIR',target_user_id::text,status::text,coalesce(last_error,'')::text,updated_at from public.staff_identity_repair_jobs where workspace_id=ws and status in ('PENDING','FAILED','DEAD')
  ), page_rows as (
    select * from jobs order by "updatedAt" desc,id offset (page_number-1)*page_size limit page_size
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(page_rows) order by "updatedAt" desc,id) from page_rows),'[]'::jsonb),
    'total',(select count(*) from jobs),'page',page_number,'pageSize',page_size
  ) into result;
  return result;
end;
$$;

revoke all on function public.operational_retryable_jobs_page(integer,integer) from public,anon;
grant execute on function public.operational_retryable_jobs_page(integer,integer) to authenticated;

notify pgrst,'reload schema';

