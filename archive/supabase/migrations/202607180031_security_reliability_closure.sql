-- v0.9.1: close identity, tenant, webhook, queue lease, readiness and
-- duplicate-merge gaps found by the 2026-07-18 supplemental audit.

-- ---------------------------------------------------------------------------
-- Identity provisioning must never reactivate an explicitly suspended member.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_crm_membership()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  new_role text:=upper(coalesce(new.raw_app_meta_data->>'role',''));
  requested_workspace uuid;
begin
  if new_role not in (
    'SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER',
    'SALES_SPECIALIST','SALES_SUPPORT'
  ) then
    return new;
  end if;

  begin
    requested_workspace:=nullif(new.raw_app_meta_data->>'workspace_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'workspace_context_invalid';
  end;

  if requested_workspace is null then
    select min(id) into requested_workspace from public.workspaces;
    if (select count(*) from public.workspaces)<>1 then
      raise exception 'workspace_context_required';
    end if;
  end if;
  if not exists(select 1 from public.workspaces where id=requested_workspace) then
    raise exception 'workspace_context_invalid';
  end if;

  insert into public.workspace_memberships(workspace_id,user_id,role,status)
  values(requested_workspace,new.id,new_role,'ACTIVE')
  on conflict(workspace_id,user_id) do update set role=excluded.role;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_crm_membership on auth.users;
create trigger on_auth_user_created_crm_membership
after insert on auth.users
for each row execute procedure public.handle_new_crm_membership();

create table if not exists public.staff_identity_repair_jobs(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  identity_change_id uuid not null unique references public.staff_identity_changes(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  target_role text not null,
  target_status text not null,
  status text not null default 'PENDING'
    check(status in ('PENDING','PROCESSING','COMPLETED','FAILED','DEAD')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_identity_repair_queue_idx
  on public.staff_identity_repair_jobs(workspace_id,status,available_at);
alter table public.staff_identity_repair_jobs enable row level security;
create policy "administrators read identity repair jobs"
  on public.staff_identity_repair_jobs for select to authenticated
  using(public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));
grant select on public.staff_identity_repair_jobs to authenticated;
revoke insert,update,delete on public.staff_identity_repair_jobs from authenticated;

create or replace function public.queue_failed_identity_repair()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.state='FAILED' and old.state is distinct from new.state then
    insert into public.staff_identity_repair_jobs(
      workspace_id,identity_change_id,target_user_id,target_role,target_status,last_error
    )
    select new.workspace_id,new.id,new.target_user_id,m.role,m.status,new.error_message
    from public.workspace_memberships m
    where m.workspace_id=new.workspace_id and m.user_id=new.target_user_id
    on conflict(identity_change_id) do update set
      target_role=excluded.target_role,target_status=excluded.target_status,
      status='PENDING',available_at=now(),last_error=excluded.last_error,updated_at=now();
  end if;
  return new;
end;
$$;
drop trigger if exists queue_failed_identity_repair on public.staff_identity_changes;
create trigger queue_failed_identity_repair
after update of state on public.staff_identity_changes
for each row execute procedure public.queue_failed_identity_repair();

create or replace function public.complete_identity_repair(repair_id uuid,successful boolean,failure text default null)
returns public.staff_identity_repair_jobs
language plpgsql
security definer
set search_path=public
as $$
declare result public.staff_identity_repair_jobs;
begin
  update public.staff_identity_repair_jobs set
    status=case when successful then 'COMPLETED'
      when attempts>=8 then 'DEAD' else 'FAILED' end,
    attempts=attempts+1,
    available_at=case when successful then available_at
      else now()+make_interval(mins=>least(360,power(2,greatest(attempts+1,1))::integer)) end,
    last_error=case when successful then null else left(coalesce(failure,'IDENTITY_REPAIR_FAILED'),500) end,
    updated_at=now()
  where id=repair_id
  returning * into result;
  if not found then raise exception 'identity_repair_not_found'; end if;
  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id
  ) values(
    result.workspace_id,auth.uid(),'staff_identity_repair',result.id::text,
    case when successful then 'REPAIR_COMPLETED' else 'REPAIR_FAILED' end,
    jsonb_build_object('targetUserId',result.target_user_id,'status',result.status,'error',result.last_error),
    txid_current()::text
  );
  return result;
end;
$$;
revoke all on function public.complete_identity_repair(uuid,boolean,text)
  from public,anon,authenticated;
grant execute on function public.complete_identity_repair(uuid,boolean,text) to service_role;

-- ---------------------------------------------------------------------------
-- Uniform leases for externally processed queues.
-- ---------------------------------------------------------------------------

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'notification_outbox','calendar_deliveries','generated_jobs','webhook_inbox'
  ] loop
    execute format('alter table public.%I add column if not exists locked_at timestamptz',table_name);
    execute format('alter table public.%I add column if not exists lease_expires_at timestamptz',table_name);
    execute format('alter table public.%I add column if not exists locked_by text',table_name);
    execute format('alter table public.%I add column if not exists lease_token uuid',table_name);
  end loop;
end
$$;

alter table public.generated_jobs add column if not exists attempts integer not null default 0;
alter table public.generated_jobs add column if not exists error_message text;
alter table public.generated_jobs add column if not exists available_at timestamptz not null default now();
alter table public.webhook_inbox add column if not exists signed_at timestamptz;
alter table public.webhook_inbox add column if not exists canonical_digest text;

alter table public.calendar_deliveries drop constraint if exists calendar_deliveries_status_check;
alter table public.calendar_deliveries add constraint calendar_deliveries_status_check
  check(status in ('QUEUED','SENDING','DELIVERED','FAILED','DEAD','CANCELLED'));
alter table public.generated_jobs drop constraint if exists generated_jobs_status_check;
alter table public.generated_jobs add constraint generated_jobs_status_check
  check(status in ('QUEUED','PROCESSING','READY','FAILED','DEAD','EXPIRED'));

create or replace function public.claim_notification_outbox_leased(
  batch_size integer,worker_id text,lease_seconds integer default 300
)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path=public
as $$
begin
  if nullif(trim(worker_id),'') is null or lease_seconds not between 30 and 3600 then
    raise exception 'worker_lease_invalid';
  end if;
  return query
  with claimed as (
    select id from public.notification_outbox
    where ((
      status in ('PENDING','FAILED') and next_attempt_at<=now()
    ) or (
      status='SENDING' and lease_expires_at<now()
    ))
    and attempts<8
    order by created_at for update skip locked limit greatest(1,least(batch_size,100))
  )
  update public.notification_outbox q set
    status='SENDING',attempts=q.attempts+1,locked_at=now(),
    lease_expires_at=now()+make_interval(secs=>lease_seconds),
    locked_by=left(trim(worker_id),120),lease_token=gen_random_uuid(),updated_at=now()
  from claimed where q.id=claimed.id returning q.*;
end;
$$;

create or replace function public.complete_notification_outbox_leased(job_id uuid,token uuid)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  update public.notification_outbox set
    status='SENT',delivered_at=now(),last_error=null,locked_at=null,
    lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
  where id=job_id and status='SENDING' and lease_token=token and lease_expires_at>=now();
  if not found then raise exception 'worker_lease_lost'; end if;
end;
$$;

create or replace function public.fail_notification_outbox_leased(job_id uuid,token uuid,failure text)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  update public.notification_outbox set
    status=case when attempts>=8 then 'DEAD' else 'FAILED' end,
    last_error=left(coalesce(failure,'UNKNOWN'),500),
    next_attempt_at=now()+make_interval(mins=>least(360,power(2,greatest(attempts,1))::integer)),
    locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
  where id=job_id and status='SENDING' and lease_token=token;
  if not found then raise exception 'worker_lease_lost'; end if;
end;
$$;

create or replace function public.claim_calendar_deliveries_leased(
  batch_size integer,worker_id text,lease_seconds integer default 300
)
returns setof public.calendar_deliveries
language plpgsql security definer set search_path=public
as $$
begin
  if nullif(trim(worker_id),'') is null or lease_seconds not between 30 and 3600 then
    raise exception 'worker_lease_invalid';
  end if;
  return query
  with claimed as (
    select id from public.calendar_deliveries
    where ((
      status in ('QUEUED','FAILED') and available_at<=now()
    ) or (
      status='SENDING' and lease_expires_at<now()
    ))
    and attempts<5
    order by available_at for update skip locked limit greatest(1,least(batch_size,100))
  )
  update public.calendar_deliveries q set
    status='SENDING',attempts=q.attempts+1,locked_at=now(),
    lease_expires_at=now()+make_interval(secs=>lease_seconds),
    locked_by=left(trim(worker_id),120),lease_token=gen_random_uuid(),updated_at=now()
  from claimed where q.id=claimed.id returning q.*;
end;
$$;

create or replace function public.complete_calendar_delivery_leased(
  delivery_id uuid,token uuid,provider_id text default null
)
returns void language plpgsql security definer set search_path=public
as $$
begin
  update public.calendar_deliveries set
    status='DELIVERED',delivered_at=now(),provider_message_id=provider_id,last_error=null,
    locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
  where id=delivery_id and status='SENDING' and lease_token=token and lease_expires_at>=now();
  if not found then raise exception 'worker_lease_lost'; end if;
end;
$$;

create or replace function public.fail_calendar_delivery_leased(
  delivery_id uuid,token uuid,failure text
)
returns void language plpgsql security definer set search_path=public
as $$
begin
  update public.calendar_deliveries set
    status=case when attempts>=5 then 'DEAD' else 'FAILED' end,
    last_error=left(coalesce(failure,'UNKNOWN'),500),
    available_at=now()+make_interval(mins=>least(60,power(2,greatest(attempts,1))::integer)),
    locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
  where id=delivery_id and status='SENDING' and lease_token=token;
  if not found then raise exception 'worker_lease_lost'; end if;
end;
$$;

create or replace function public.claim_generated_jobs_leased(
  batch_size integer,worker_id text,lease_seconds integer default 900
)
returns setof public.generated_jobs
language plpgsql security definer set search_path=public
as $$
begin
  if nullif(trim(worker_id),'') is null or lease_seconds not between 60 and 3600 then
    raise exception 'worker_lease_invalid';
  end if;
  return query
  with claimed as (
    select id from public.generated_jobs
    where ((
      status in ('QUEUED','FAILED') and available_at<=now()
    ) or (
      status='PROCESSING' and lease_expires_at<now()
    ))
    and attempts<5
    order by created_at for update skip locked limit greatest(1,least(batch_size,100))
  )
  update public.generated_jobs q set
    status='PROCESSING',attempts=q.attempts+1,locked_at=now(),
    lease_expires_at=now()+make_interval(secs=>lease_seconds),
    locked_by=left(trim(worker_id),120),lease_token=gen_random_uuid(),updated_at=now()
  from claimed where q.id=claimed.id returning q.*;
end;
$$;

create or replace function public.complete_generated_job_leased(
  job_id uuid,token uuid,object_path text,artifact_expires_at timestamptz
)
returns void language plpgsql security definer set search_path=public
as $$
begin
  update public.generated_jobs set
    status='READY',artifact_path=object_path,expires_at=artifact_expires_at,error_message=null,
    locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
  where id=job_id and status='PROCESSING' and lease_token=token and lease_expires_at>=now();
  if not found then raise exception 'worker_lease_lost'; end if;
end;
$$;

create or replace function public.fail_generated_job_leased(job_id uuid,token uuid,failure text)
returns void language plpgsql security definer set search_path=public
as $$
begin
  update public.generated_jobs set
    status=case when attempts>=5 then 'DEAD' else 'FAILED' end,
    artifact_path=null,expires_at=null,error_message=left(coalesce(failure,'UNKNOWN'),500),
    available_at=now()+make_interval(mins=>least(360,power(2,greatest(attempts,1))::integer)),
    locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
  where id=job_id and status='PROCESSING' and lease_token=token;
  if not found then raise exception 'worker_lease_lost'; end if;
end;
$$;

create or replace function public.claim_webhook_events_leased(
  batch_size integer,worker_id text,lease_seconds integer default 300
)
returns setof public.webhook_inbox
language plpgsql security definer set search_path=public
as $$
begin
  if nullif(trim(worker_id),'') is null or lease_seconds not between 30 and 3600 then
    raise exception 'worker_lease_invalid';
  end if;
  return query
  with claimed as (
    select id from public.webhook_inbox
    where ((
      status in ('RECEIVED','FAILED') and available_at<=now()
    ) or (
      status='PROCESSING' and lease_expires_at<now()
    ))
    and attempts<8
    order by received_at for update skip locked limit greatest(1,least(batch_size,100))
  )
  update public.webhook_inbox q set
    status='PROCESSING',attempts=q.attempts+1,locked_at=now(),
    lease_expires_at=now()+make_interval(secs=>lease_seconds),
    locked_by=left(trim(worker_id),120),lease_token=gen_random_uuid(),updated_at=now()
  from claimed where q.id=claimed.id returning q.*;
end;
$$;

create or replace function public.complete_webhook_event_leased(target_event uuid,token uuid)
returns void language plpgsql security definer set search_path=public
as $$
begin
  update public.webhook_inbox set
    status='PROCESSED',processed_at=now(),last_error=null,locked_at=null,
    lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
  where id=target_event and status='PROCESSING' and lease_token=token and lease_expires_at>=now();
  if not found then raise exception 'worker_lease_lost'; end if;
end;
$$;

create or replace function public.fail_webhook_event_leased(
  target_event uuid,token uuid,failure text
)
returns void language plpgsql security definer set search_path=public
as $$
begin
  update public.webhook_inbox set
    status=case when attempts>=8 then 'DEAD' else 'FAILED' end,
    last_error=left(coalesce(failure,'UNKNOWN'),500),
    available_at=now()+make_interval(mins=>least(360,power(2,greatest(attempts,1))::integer)),
    locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
  where id=target_event and status='PROCESSING' and lease_token=token;
  if not found then raise exception 'worker_lease_lost'; end if;
end;
$$;

revoke all on function
  public.claim_notification_outbox_leased(integer,text,integer),
  public.complete_notification_outbox_leased(uuid,uuid),
  public.fail_notification_outbox_leased(uuid,uuid,text),
  public.claim_calendar_deliveries_leased(integer,text,integer),
  public.complete_calendar_delivery_leased(uuid,uuid,text),
  public.fail_calendar_delivery_leased(uuid,uuid,text),
  public.claim_generated_jobs_leased(integer,text,integer),
  public.complete_generated_job_leased(uuid,uuid,text,timestamptz),
  public.fail_generated_job_leased(uuid,uuid,text),
  public.claim_webhook_events_leased(integer,text,integer),
  public.complete_webhook_event_leased(uuid,uuid),
  public.fail_webhook_event_leased(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function
  public.claim_notification_outbox_leased(integer,text,integer),
  public.complete_notification_outbox_leased(uuid,uuid),
  public.fail_notification_outbox_leased(uuid,uuid,text),
  public.claim_calendar_deliveries_leased(integer,text,integer),
  public.complete_calendar_delivery_leased(uuid,uuid,text),
  public.fail_calendar_delivery_leased(uuid,uuid,text),
  public.claim_generated_jobs_leased(integer,text,integer),
  public.complete_generated_job_leased(uuid,uuid,text,timestamptz),
  public.fail_generated_job_leased(uuid,uuid,text),
  public.claim_webhook_events_leased(integer,text,integer),
  public.complete_webhook_event_leased(uuid,uuid),
  public.fail_webhook_event_leased(uuid,uuid,text)
to service_role;

-- The reminder processor is one database transaction. Recovering stale
-- PROCESSING rows is sufficient because a crash before commit rolls back.
create or replace function public.process_due_reminders(batch_size integer default 50)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  processed integer:=0;
  item public.reminders;
  preference public.user_preferences;
  wants_email boolean;
  wants_in_app boolean;
  local_time time;
  quiet boolean;
begin
  update public.reminders set
    status='FAILED',last_error='STALE_PROCESSING_RECOVERED'
  where status='PROCESSING' and scheduled_at<now()-interval '15 minutes';

  for item in
    select * from public.reminders
    where status in ('PENDING','FAILED') and scheduled_at<=now() and attempts<5
    order by scheduled_at for update skip locked limit greatest(1,least(batch_size,200))
  loop
    select * into preference from public.user_preferences where user_id=item.recipient_id;
    local_time:=(now() at time zone coalesce(preference.timezone,'UTC'))::time;
    quiet:=preference.quiet_hours_start is not null and preference.quiet_hours_end is not null
      and case when preference.quiet_hours_start<=preference.quiet_hours_end
        then local_time>=preference.quiet_hours_start and local_time<preference.quiet_hours_end
        else local_time>=preference.quiet_hours_start or local_time<preference.quiet_hours_end end;
    if quiet then
      update public.reminders set scheduled_at=now()+interval '30 minutes' where id=item.id;
      continue;
    end if;
    update public.reminders set status='PROCESSING',attempts=attempts+1 where id=item.id;
    wants_in_app:=coalesce((preference.notifications->'tasks'->>'inApp')::boolean,true);
    wants_email:=coalesce((preference.notifications->'tasks'->>'email')::boolean,false);
    if wants_in_app then
      insert into public.user_notifications(
        workspace_id,user_id,kind,title_key,body_key,values,source_type,source_id
      ) values(
        item.workspace_id,item.recipient_id,'REMINDER','notification.reminder.title',
        'notification.reminder.body',jsonb_build_object('type',item.reminder_type),
        item.source_type,item.source_id
      );
    end if;
    if wants_email then
      insert into public.notification_outbox(
        workspace_id,recipient_id,channel,template_key,payload
      ) values(
        item.workspace_id,item.recipient_id,'EMAIL','reminder',
        jsonb_build_object('reminderId',item.id,'locale',coalesce(preference.locale,'zh-CN'),
          'timezone',coalesce(preference.timezone,'UTC'))
      );
    end if;
    update public.reminders set
      status='DELIVERED',delivered_at=now(),last_error=null where id=item.id;
    processed:=processed+1;
  end loop;
  return processed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workspace-safe, auditable replay and complete operations/readiness metrics.
-- ---------------------------------------------------------------------------

create or replace function public.retry_operational_job(job_type text,job_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  normalized text:=upper(job_type);
  ws uuid:=public.current_workspace_id();
  previous_status text;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or ws is null then
    raise exception 'operations_not_authorized';
  end if;
  if normalized='NOTIFICATION_OUTBOX' then
    select status into previous_status from public.notification_outbox
      where id=job_id and workspace_id=ws and status in ('FAILED','DEAD') for update;
    update public.notification_outbox set
      status='PENDING',next_attempt_at=now(),last_error=null,locked_at=null,
      lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
    where id=job_id and workspace_id=ws and status in ('FAILED','DEAD');
  elsif normalized='CALENDAR_DELIVERIES' then
    select status into previous_status from public.calendar_deliveries
      where id=job_id and workspace_id=ws and status in ('FAILED','DEAD') for update;
    update public.calendar_deliveries set
      status='QUEUED',available_at=now(),last_error=null,locked_at=null,
      lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
    where id=job_id and workspace_id=ws and status in ('FAILED','DEAD');
  elsif normalized='GENERATED_JOBS' then
    select status into previous_status from public.generated_jobs
      where id=job_id and workspace_id=ws and status in ('FAILED','DEAD') for update;
    update public.generated_jobs set
      status='QUEUED',available_at=now(),artifact_path=null,expires_at=null,error_message=null,
      locked_at=null,lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
    where id=job_id and workspace_id=ws and status in ('FAILED','DEAD');
  elsif normalized='REMINDERS' then
    select status into previous_status from public.reminders
      where id=job_id and workspace_id=ws and status='FAILED' for update;
    update public.reminders set status='PENDING',scheduled_at=now(),last_error=null
      where id=job_id and workspace_id=ws and status='FAILED';
  elsif normalized='WEBHOOK_INBOX' then
    select status into previous_status from public.webhook_inbox
      where id=job_id and workspace_id=ws and status in ('FAILED','DEAD') for update;
    update public.webhook_inbox set
      status='RECEIVED',available_at=now(),last_error=null,locked_at=null,
      lease_expires_at=null,locked_by=null,lease_token=null,updated_at=now()
    where id=job_id and workspace_id=ws and status in ('FAILED','DEAD');
  else
    raise exception 'operational_job_type_invalid';
  end if;
  if previous_status is null or not found then
    raise exception 'operational_job_not_retryable';
  end if;
  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data,request_id
  ) values(
    ws,auth.uid(),'operational_job',job_id::text,'RETRY',
    jsonb_build_object('type',normalized,'status',previous_status),
    jsonb_build_object('type',normalized,'status','REQUEUED'),txid_current()::text
  );
end;
$$;

create or replace function public.operational_retryable_jobs()
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare ws uuid:=public.current_workspace_id();result jsonb;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or ws is null then
    raise exception 'operations_not_authorized';
  end if;
  select coalesce(jsonb_agg(to_jsonb(j) order by j."updatedAt" desc),'[]'::jsonb)
  into result from (
    select id,'NOTIFICATION_OUTBOX'::text type,template_key label,status,
      coalesce(last_error,'') error,updated_at "updatedAt"
    from public.notification_outbox where workspace_id=ws and status in ('FAILED','DEAD')
    union all
    select id,'CALENDAR_DELIVERIES',delivery_type,status,coalesce(last_error,''),updated_at
    from public.calendar_deliveries where workspace_id=ws and status in ('FAILED','DEAD')
    union all
    select id,'GENERATED_JOBS',job_type,status,coalesce(error_message,''),updated_at
    from public.generated_jobs where workspace_id=ws and status in ('FAILED','DEAD')
    union all
    select id,'REMINDERS',reminder_type,status,coalesce(last_error,''),created_at
    from public.reminders where workspace_id=ws and status='FAILED'
    union all
    select id,'WEBHOOK_INBOX',provider||' / '||event_type,status,coalesce(last_error,''),updated_at
    from public.webhook_inbox where workspace_id=ws and status in ('FAILED','DEAD')
    union all
    select id,'IDENTITY_REPAIR',target_user_id::text,status,coalesce(last_error,''),updated_at
    from public.staff_identity_repair_jobs
    where workspace_id=ws and status in ('PENDING','FAILED','DEAD')
    order by "updatedAt" desc limit 100
  ) j;
  return result;
end;
$$;

create or replace function public.operational_snapshot()
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare ws uuid:=public.current_workspace_id();
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN') or ws is null then
    raise exception 'operations_not_authorized';
  end if;
  return jsonb_build_object(
    'generatedAt',now(),
    'queues',jsonb_build_array(
      jsonb_build_object('key','APPROVALS','slaMinutes',1440,
        'pending',(select count(*) from public.approval_requests where workspace_id=ws and status='PENDING'),
        'failed',(select count(*) from public.approval_requests where workspace_id=ws and execution_status='FAILED'),
        'stuck',0,
        'breached',(select count(*) from public.approval_requests where workspace_id=ws and status='PENDING' and created_at<now()-interval '24 hours'),
        'oldest',(select min(created_at) from public.approval_requests where workspace_id=ws and status='PENDING')),
      jsonb_build_object('key','NOTIFICATION_OUTBOX','slaMinutes',15,
        'pending',(select count(*) from public.notification_outbox where workspace_id=ws and status in ('PENDING','SENDING','FAILED')),
        'failed',(select count(*) from public.notification_outbox where workspace_id=ws and status in ('FAILED','DEAD')),
        'stuck',(select count(*) from public.notification_outbox where workspace_id=ws and status='SENDING' and lease_expires_at<now()),
        'breached',(select count(*) from public.notification_outbox where workspace_id=ws and status not in ('SENT') and created_at<now()-interval '15 minutes'),
        'oldest',(select min(created_at) from public.notification_outbox where workspace_id=ws and status not in ('SENT'))),
      jsonb_build_object('key','CALENDAR_DELIVERIES','slaMinutes',15,
        'pending',(select count(*) from public.calendar_deliveries where workspace_id=ws and status in ('QUEUED','SENDING','FAILED')),
        'failed',(select count(*) from public.calendar_deliveries where workspace_id=ws and status in ('FAILED','DEAD')),
        'stuck',(select count(*) from public.calendar_deliveries where workspace_id=ws and status='SENDING' and lease_expires_at<now()),
        'breached',(select count(*) from public.calendar_deliveries where workspace_id=ws and status not in ('DELIVERED','CANCELLED') and created_at<now()-interval '15 minutes'),
        'oldest',(select min(created_at) from public.calendar_deliveries where workspace_id=ws and status not in ('DELIVERED','CANCELLED'))),
      jsonb_build_object('key','GENERATED_JOBS','slaMinutes',30,
        'pending',(select count(*) from public.generated_jobs where workspace_id=ws and status in ('QUEUED','PROCESSING','FAILED')),
        'failed',(select count(*) from public.generated_jobs where workspace_id=ws and status in ('FAILED','DEAD')),
        'stuck',(select count(*) from public.generated_jobs where workspace_id=ws and status='PROCESSING' and lease_expires_at<now()),
        'breached',(select count(*) from public.generated_jobs where workspace_id=ws and status not in ('READY','EXPIRED') and created_at<now()-interval '30 minutes'),
        'oldest',(select min(created_at) from public.generated_jobs where workspace_id=ws and status not in ('READY','EXPIRED'))),
      jsonb_build_object('key','REMINDERS','slaMinutes',15,
        'pending',(select count(*) from public.reminders where workspace_id=ws and status in ('PENDING','PROCESSING','FAILED')),
        'failed',(select count(*) from public.reminders where workspace_id=ws and status='FAILED'),
        'stuck',(select count(*) from public.reminders where workspace_id=ws and status='PROCESSING' and scheduled_at<now()-interval '15 minutes'),
        'breached',(select count(*) from public.reminders where workspace_id=ws and status in ('PENDING','PROCESSING','FAILED') and scheduled_at<now()-interval '15 minutes'),
        'oldest',(select min(scheduled_at) from public.reminders where workspace_id=ws and status in ('PENDING','PROCESSING','FAILED'))),
      jsonb_build_object('key','WEBHOOK_INBOX','slaMinutes',10,
        'pending',(select count(*) from public.webhook_inbox where workspace_id=ws and status in ('RECEIVED','PROCESSING','FAILED')),
        'failed',(select count(*) from public.webhook_inbox where workspace_id=ws and status in ('FAILED','DEAD')),
        'stuck',(select count(*) from public.webhook_inbox where workspace_id=ws and status='PROCESSING' and lease_expires_at<now()),
        'breached',(select count(*) from public.webhook_inbox where workspace_id=ws and status not in ('PROCESSED') and received_at<now()-interval '10 minutes'),
        'oldest',(select min(received_at) from public.webhook_inbox where workspace_id=ws and status not in ('PROCESSED'))),
      jsonb_build_object('key','IMPORTS','slaMinutes',60,
        'pending',(select count(*) from public.import_batches where workspace_id=ws and status in ('VALIDATING','NEEDS_DECISION','READY','PROCESSING','PARTIAL_FAILED')),
        'failed',(select count(*) from public.import_batches where workspace_id=ws and status='PARTIAL_FAILED'),
        'stuck',(select count(*) from public.import_batches where workspace_id=ws and status='PROCESSING' and updated_at<now()-interval '60 minutes'),
        'breached',(select count(*) from public.import_batches where workspace_id=ws and status not in ('COMPLETED','ROLLED_BACK') and created_at<now()-interval '60 minutes'),
        'oldest',(select min(created_at) from public.import_batches where workspace_id=ws and status not in ('COMPLETED','ROLLED_BACK'))),
      jsonb_build_object('key','IDENTITY_REPAIR','slaMinutes',15,
        'pending',(select count(*) from public.staff_identity_repair_jobs where workspace_id=ws and status in ('PENDING','PROCESSING','FAILED')),
        'failed',(select count(*) from public.staff_identity_repair_jobs where workspace_id=ws and status in ('FAILED','DEAD')),
        'stuck',(select count(*) from public.staff_identity_repair_jobs where workspace_id=ws and status='PROCESSING' and updated_at<now()-interval '15 minutes'),
        'breached',(select count(*) from public.staff_identity_repair_jobs where workspace_id=ws and status not in ('COMPLETED') and created_at<now()-interval '15 minutes'),
        'oldest',(select min(created_at) from public.staff_identity_repair_jobs where workspace_id=ws and status not in ('COMPLETED')))
    ),
    'workers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'key',worker_key,'lastSeenAt',last_seen_at,'lastSuccessAt',last_success_at,
        'lastFailureAt',last_failure_at,'consecutiveFailures',consecutive_failures,
        'lastError',last_error,'stale',last_seen_at<now()-interval '15 minutes',
        'metadata',metadata
      ) order by worker_key) from public.worker_heartbeats
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.service_readiness_snapshot(
  target_workspace uuid default '00000000-0000-4000-8000-000000000001'
)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
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
  select count(*) into stale_workers from public.worker_heartbeats
    where last_seen_at<now()-interval '15 minutes' or consecutive_failures>0;
  select count(*) into registered_workers from public.worker_heartbeats;
  missing_workers:=greatest(0,5-registered_workers);
  stale_workers:=stale_workers+missing_workers;
  select
    (select count(*) from public.notification_outbox where workspace_id=target_workspace and status in ('FAILED','DEAD'))
    +(select count(*) from public.calendar_deliveries where workspace_id=target_workspace and status in ('FAILED','DEAD'))
    +(select count(*) from public.generated_jobs where workspace_id=target_workspace and status in ('FAILED','DEAD'))
    +(select count(*) from public.reminders where workspace_id=target_workspace and status='FAILED')
    +(select count(*) from public.webhook_inbox where workspace_id=target_workspace and status in ('FAILED','DEAD'))
    +(select count(*) from public.import_batches where workspace_id=target_workspace and status='PARTIAL_FAILED')
    +(select count(*) from public.approval_requests where workspace_id=target_workspace and execution_status='FAILED')
    +(select count(*) from public.staff_identity_repair_jobs where workspace_id=target_workspace and status in ('FAILED','DEAD'))
  into failed_jobs;
  select
    (select count(*) from public.notification_outbox where workspace_id=target_workspace and status='SENDING' and lease_expires_at<now())
    +(select count(*) from public.calendar_deliveries where workspace_id=target_workspace and status='SENDING' and lease_expires_at<now())
    +(select count(*) from public.generated_jobs where workspace_id=target_workspace and status='PROCESSING' and lease_expires_at<now())
    +(select count(*) from public.webhook_inbox where workspace_id=target_workspace and status='PROCESSING' and lease_expires_at<now())
    +(select count(*) from public.reminders where workspace_id=target_workspace and status='PROCESSING' and scheduled_at<now()-interval '15 minutes')
  into stuck_jobs;
  select min(value) into oldest_pending from (
    select min(created_at) value from public.notification_outbox where workspace_id=target_workspace and status in ('PENDING','SENDING','FAILED')
    union all select min(created_at) from public.calendar_deliveries where workspace_id=target_workspace and status in ('QUEUED','SENDING','FAILED')
    union all select min(created_at) from public.generated_jobs where workspace_id=target_workspace and status in ('QUEUED','PROCESSING','FAILED')
    union all select min(received_at) from public.webhook_inbox where workspace_id=target_workspace and status in ('RECEIVED','PROCESSING','FAILED')
    union all select min(scheduled_at) from public.reminders where workspace_id=target_workspace and status in ('PENDING','PROCESSING','FAILED')
  ) pending;
  return jsonb_build_object(
    'database',true,'workspaceId',target_workspace,'staleWorkers',stale_workers,
    'registeredWorkers',registered_workers,'missingWorkers',missing_workers,
    'failedJobs',failed_jobs,'stuckJobs',stuck_jobs,'oldestPendingAt',oldest_pending,
    'ready',stale_workers=0 and failed_jobs=0 and stuck_jobs=0,'checkedAt',now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Duplicate preview and merge: reject unknown choices, preserve restrictive
-- consent, and migrate all current organization relationships.
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_merge_preview(
  resource text,target_record uuid,source_record uuid
)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare target_json jsonb;source_json jsonb;impact jsonb;normalized text:=upper(resource);
begin
  if target_record=source_record then raise exception 'duplicate_same_record'; end if;
  if normalized='CONTACTS' then
    select jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'email',email,
      'phone',phone,'title',title,'status',status) into target_json
    from public.contacts c where c.id=target_record and c.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(c.workspace_id,'CONTACT',c.id,c.owner_id,true);
    select jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'email',email,
      'phone',phone,'title',title,'status',status) into source_json
    from public.contacts c where c.id=source_record and c.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(c.workspace_id,'CONTACT',c.id,c.owner_id,true);
    select jsonb_build_object(
      'activities',(select count(*) from public.crm_activities where contact_id=source_record),
      'opportunities',(select count(*) from public.opportunities where primary_contact_id=source_record),
      'consents',(select count(*) from public.contact_consents where contact_id=source_record),
      'appointments',(select count(*) from public.appointment_attendees where contact_id=source_record)
    ) into impact;
  elsif normalized='ORGANIZATIONS' then
    select jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'city',city,
      'curriculum',curriculum,'status',status) into target_json
    from public.organizations o where o.id=target_record and o.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,true);
    select jsonb_build_object('id',id,'nameZh',name_zh,'nameEn',name_en,'city',city,
      'curriculum',curriculum,'status',status) into source_json
    from public.organizations o where o.id=source_record and o.workspace_id=public.current_workspace_id()
      and public.can_access_owned_record(o.workspace_id,'ORGANIZATION',o.id,o.owner_id,true);
    select jsonb_build_object(
      'contacts',(select count(*) from public.contacts where organization_id=source_record),
      'opportunities',(select count(*) from public.opportunities where organization_id=source_record),
      'contracts',(select count(*) from public.contracts where organization_id=source_record),
      'activities',(select count(*) from public.crm_activities where organization_id=source_record),
      'quotes',(select count(*) from public.quotes where organization_id=source_record),
      'nextBestActions',(select count(*) from public.next_best_actions where organization_id=source_record)
    ) into impact;
  else
    raise exception 'duplicate_resource_invalid';
  end if;
  if target_json is null or source_json is null then
    raise exception 'duplicate_record_not_authorized';
  end if;
  return jsonb_build_object(
    'resource',normalized,'target',target_json,'source',source_json,'impact',impact,
    'editableFields',case when normalized='CONTACTS'
      then jsonb_build_array('nameZh','nameEn','email','phone','title','status')
      else jsonb_build_array('nameZh','nameEn','city','curriculum','status') end,
    'recommendedMaster',case
      when coalesce((select completeness from public.contacts where id=target_record),
        (select completeness from public.organizations where id=target_record),0)
        >=coalesce((select completeness from public.contacts where id=source_record),
          (select completeness from public.organizations where id=source_record),0)
      then target_record else source_record end,
    'requiresConfirmation',true
  );
end;
$$;

create or replace function public.merge_duplicate_records(
  resource text,target_record uuid,source_record uuid,field_choices jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  normalized text:=upper(resource);
  target_contact public.contacts;source_contact public.contacts;
  target_org public.organizations;source_org public.organizations;
  source_consent public.contact_consents;
  target_consent public.contact_consents;
begin
  if public.current_crm_role() not in ('SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER')
    or target_record=source_record then
    raise exception 'duplicate_merge_not_authorized';
  end if;
  if normalized='CONTACTS' then
    if exists(select 1 from jsonb_object_keys(field_choices) as choices(key)
      where key not in ('nameZh','nameEn','email','phone','title','status')) then
      raise exception 'duplicate_field_choice_invalid';
    end if;
    select * into target_contact from public.contacts
      where id=target_record and workspace_id=public.current_workspace_id() for update;
    select * into source_contact from public.contacts
      where id=source_record and workspace_id=public.current_workspace_id() for update;
    if target_contact.id is null or source_contact.id is null
      or not public.can_access_owned_record(target_contact.workspace_id,'CONTACT',target_contact.id,target_contact.owner_id,true)
      or not public.can_access_owned_record(source_contact.workspace_id,'CONTACT',source_contact.id,source_contact.owner_id,true) then
      raise exception 'duplicate_merge_not_authorized';
    end if;
    update public.crm_activities set contact_id=target_contact.id where contact_id=source_contact.id;
    update public.opportunities set primary_contact_id=target_contact.id where primary_contact_id=source_contact.id;
    update public.appointment_attendees set contact_id=target_contact.id where contact_id=source_contact.id;
    for source_consent in select * from public.contact_consents where contact_id=source_contact.id for update loop
      select * into target_consent from public.contact_consents
        where workspace_id=source_consent.workspace_id and contact_id=target_contact.id
          and channel=source_consent.channel and purpose=source_consent.purpose for update;
      if not found then
        update public.contact_consents set contact_id=target_contact.id where id=source_consent.id;
      else
        if (case source_consent.status when 'REVOKED' then 3 when 'EXPIRED' then 2 else 1 end)
          > (case target_consent.status when 'REVOKED' then 3 when 'EXPIRED' then 2 else 1 end)
          or (
            source_consent.status=target_consent.status
            and source_consent.updated_at>target_consent.updated_at
          ) then
          update public.contact_consents set
            status=source_consent.status,source=source_consent.source,
            evidence_note=source_consent.evidence_note,obtained_at=source_consent.obtained_at,
            revoked_at=source_consent.revoked_at,retention_until=source_consent.retention_until,
            quiet_hours_start=source_consent.quiet_hours_start,
            quiet_hours_end=source_consent.quiet_hours_end,
            updated_by=auth.uid(),updated_at=now()
          where id=target_consent.id;
        end if;
        delete from public.contact_consents where id=source_consent.id;
      end if;
    end loop;
    update public.crm_tasks set related_id=target_contact.id,related_label=target_contact.name_zh
      where related_type='CONTACT' and related_id=source_contact.id;
    update public.appointments set related_id=target_contact.id,related_label=target_contact.name_zh
      where related_type='CONTACT' and related_id=source_contact.id;
    delete from public.contacts where id=source_contact.id;
    update public.contacts set
      name_zh=case when field_choices->>'nameZh'='SOURCE' then source_contact.name_zh else target_contact.name_zh end,
      name_en=case when field_choices->>'nameEn'='SOURCE' then source_contact.name_en else target_contact.name_en end,
      email=case when field_choices->>'email'='SOURCE' then source_contact.email else target_contact.email end,
      phone=case when field_choices->>'phone'='SOURCE' then source_contact.phone else target_contact.phone end,
      title=case when field_choices->>'title'='SOURCE' then source_contact.title else target_contact.title end,
      status=case when field_choices->>'status'='SOURCE' then source_contact.status else target_contact.status end,
      completeness=greatest(target_contact.completeness,source_contact.completeness),updated_at=now()
    where id=target_contact.id;
  elsif normalized='ORGANIZATIONS' then
    if exists(select 1 from jsonb_object_keys(field_choices) as choices(key)
      where key not in ('nameZh','nameEn','city','curriculum','status')) then
      raise exception 'duplicate_field_choice_invalid';
    end if;
    select * into target_org from public.organizations
      where id=target_record and workspace_id=public.current_workspace_id() for update;
    select * into source_org from public.organizations
      where id=source_record and workspace_id=public.current_workspace_id() for update;
    if target_org.id is null or source_org.id is null
      or not public.can_access_owned_record(target_org.workspace_id,'ORGANIZATION',target_org.id,target_org.owner_id,true)
      or not public.can_access_owned_record(source_org.workspace_id,'ORGANIZATION',source_org.id,source_org.owner_id,true) then
      raise exception 'duplicate_merge_not_authorized';
    end if;
    update public.next_best_actions n set status='EXPIRED',updated_at=now()
    where n.organization_id=source_org.id and n.status='SUGGESTED'
      and exists(select 1 from public.next_best_actions t
        where t.organization_id=target_org.id and t.rule_key=n.rule_key and t.status='SUGGESTED');
    update public.next_best_actions set organization_id=target_org.id
      where organization_id=source_org.id;
    update public.contacts set organization_id=target_org.id where organization_id=source_org.id;
    update public.opportunities set organization_id=target_org.id where organization_id=source_org.id;
    update public.contracts set organization_id=target_org.id where organization_id=source_org.id;
    update public.crm_activities set organization_id=target_org.id where organization_id=source_org.id;
    update public.quotes set organization_id=target_org.id where organization_id=source_org.id;
    delete from public.account_plans where organization_id=source_org.id
      and exists(select 1 from public.account_plans where organization_id=target_org.id);
    update public.account_plans set organization_id=target_org.id where organization_id=source_org.id;
    insert into public.relationship_milestones(
      workspace_id,organization_id,milestone_type,achieved_at,evidence_note,evidence_status,
      achieved_by,verified_by,verified_at,created_at,updated_at
    )
    select workspace_id,target_org.id,milestone_type,achieved_at,evidence_note,evidence_status,
      achieved_by,verified_by,verified_at,created_at,updated_at
    from public.relationship_milestones where organization_id=source_org.id
    on conflict(workspace_id,organization_id,milestone_type) do update set
      achieved_at=greatest(relationship_milestones.achieved_at,excluded.achieved_at),
      evidence_note=case when excluded.evidence_note<>'' then excluded.evidence_note
        else relationship_milestones.evidence_note end,updated_at=now();
    delete from public.relationship_milestones where organization_id=source_org.id;
    update public.crm_tasks set related_id=target_org.id,related_label=target_org.name_zh
      where related_type='ORGANIZATION' and related_id=source_org.id;
    update public.appointments set related_id=target_org.id,related_label=target_org.name_zh
      where related_type='ORGANIZATION' and related_id=source_org.id;
    delete from public.organizations where id=source_org.id;
    update public.organizations set
      name_zh=case when field_choices->>'nameZh'='SOURCE' then source_org.name_zh else target_org.name_zh end,
      name_en=case when field_choices->>'nameEn'='SOURCE' then source_org.name_en else target_org.name_en end,
      city=case when field_choices->>'city'='SOURCE' then source_org.city else target_org.city end,
      curriculum=case when field_choices->>'curriculum'='SOURCE' then source_org.curriculum else target_org.curriculum end,
      status=case when field_choices->>'status'='SOURCE' then source_org.status else target_org.status end,
      completeness=greatest(target_org.completeness,source_org.completeness),
      key_contact_coverage=greatest(target_org.key_contact_coverage,source_org.key_contact_coverage),
      updated_at=now()
    where id=target_org.id;
  else
    raise exception 'duplicate_resource_invalid';
  end if;
  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,after_data,request_id
  ) values(
    public.current_workspace_id(),auth.uid(),'duplicate_merge',target_record::text,'MERGE',
    jsonb_build_object('resource',normalized,'sourceId',source_record,'fieldChoices',field_choices),
    txid_current()::text
  );
  return target_record;
end;
$$;

revoke all on function public.retry_operational_job(text,uuid),
  public.operational_retryable_jobs(),public.operational_snapshot(),
  public.duplicate_merge_preview(text,uuid,uuid),
  public.merge_duplicate_records(text,uuid,uuid,jsonb)
from public,anon;
grant execute on function public.retry_operational_job(text,uuid),
  public.operational_retryable_jobs(),public.operational_snapshot(),
  public.duplicate_merge_preview(text,uuid,uuid),
  public.merge_duplicate_records(text,uuid,uuid,jsonb)
to authenticated;
revoke all on function public.service_readiness_snapshot(uuid)
from public,anon,authenticated;
grant execute on function public.service_readiness_snapshot(uuid) to service_role;

drop trigger if exists audit_staff_identity_repair_jobs on public.staff_identity_repair_jobs;
create trigger audit_staff_identity_repair_jobs
after insert or update or delete on public.staff_identity_repair_jobs
for each row execute procedure public.audit_row_change();
