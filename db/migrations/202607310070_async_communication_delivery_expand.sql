-- Lumina CRM v3.8.14: expand-only database foundation for governed,
-- asynchronous communication-message delivery. This migration does not change
-- the currently deployed synchronous Web owner or make historical rows due.
set search_path = public, extensions;

alter table public.communication_messages
  add column if not exists next_attempt_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists lease_token uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists provider_attempt_count integer not null default 0,
  add column if not exists first_provider_attempt_at timestamptz,
  add column if not exists last_provider_attempt_at timestamptz,
  add column if not exists last_provider_attempt_lease_token uuid,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists outcome_may_have_been_accepted boolean not null default false,
  add column if not exists delivery_failure_code text;

alter table public.communication_messages
  drop constraint if exists communication_messages_delivery_status_check;
alter table public.communication_messages
  add constraint communication_messages_delivery_status_check
  check (
    delivery_status in (
      'QUEUED','PROCESSING','SENT','FAILED','UNCERTAIN',
      'RECEIVED','DELIVERED'
    )
  ) not valid;

alter table public.communication_messages
  add constraint communication_messages_delivery_direction_check
  check (
    (direction='INBOUND' and delivery_status='RECEIVED')
    or
    (
      direction='OUTBOUND'
      and delivery_status in (
        'QUEUED','PROCESSING','SENT','FAILED','UNCERTAIN','DELIVERED'
      )
    )
  ) not valid;

alter table public.communication_messages
  add constraint communication_messages_delivery_lease_check
  check (
    (
      delivery_status='PROCESSING'
      and locked_at is not null
      and lease_expires_at is not null
      and locked_by is not null
      and length(trim(locked_by)) between 1 and 120
      and lease_token is not null
      and lease_expires_at>locked_at
    )
    or
    (
      delivery_status<>'PROCESSING'
      and locked_at is null
      and lease_expires_at is null
      and locked_by is null
      and lease_token is null
    )
  ) not valid;

alter table public.communication_messages
  add constraint communication_messages_provider_attempt_check
  check (
    provider_attempt_count>=0
    and (
      (
        provider_attempt_count=0
        and first_provider_attempt_at is null
        and last_provider_attempt_at is null
        and last_provider_attempt_lease_token is null
        and outcome_may_have_been_accepted=false
      )
      or
      (
        provider_attempt_count>0
        and first_provider_attempt_at is not null
        and last_provider_attempt_at is not null
        and last_provider_attempt_lease_token is not null
        and first_provider_attempt_at<=last_provider_attempt_at
      )
    )
  ) not valid;

alter table public.communication_messages
  add constraint communication_messages_sent_receipt_check
  check (
    delivery_status<>'SENT'
    or (
      nullif(trim(provider_message_id),'') is not null
      and length(provider_message_id)<=240
      and provider_message_id!~E'[\\r\\n]'
    )
  ) not valid;

alter table public.communication_messages
  add constraint communication_messages_uncertain_check
  check (
    delivery_status<>'UNCERTAIN'
    or outcome_may_have_been_accepted=true
  ) not valid;

alter table public.communication_messages
  add constraint communication_messages_dead_letter_check
  check (
    dead_lettered_at is null
    or delivery_status in ('FAILED','UNCERTAIN')
  ) not valid;

alter table public.communication_messages
  add constraint communication_messages_provider_timestamps_check
  check (
    (first_provider_attempt_at is null or first_provider_attempt_at>=created_at)
    and (last_provider_attempt_at is null or last_provider_attempt_at>=created_at)
    and (dead_lettered_at is null or dead_lettered_at>=created_at)
    and updated_at>=created_at
  ) not valid;

alter table public.communication_messages
  add constraint communication_messages_delivery_failure_code_check
  check (
    delivery_failure_code is null
    or (
      length(delivery_failure_code) between 1 and 80
      and delivery_failure_code=upper(delivery_failure_code)
      and delivery_failure_code~'^[A-Z0-9_]+$'
      and delivery_failure_code=any(array[
        'PROVIDER_REJECTED',
        'PROVIDER_UNAVAILABLE',
        'PROVIDER_INVALID_RESPONSE',
        'RECIPIENT_EMAIL_UNAVAILABLE',
        'CONSENT_REVOKED',
        'DELIVERY_CONFIGURATION_UNAVAILABLE',
        'THREAD_CLOSED',
        'MAX_PROVIDER_ATTEMPTS',
        'LEASE_EXPIRED_BEFORE_PROVIDER_ATTEMPT',
        'LEASE_EXPIRED_AFTER_PROVIDER_ATTEMPT',
        'IDEMPOTENCY_WINDOW_EXPIRED'
      ]::text[])
    )
  ) not valid;

create index if not exists communication_messages_delivery_due_idx
  on public.communication_messages(next_attempt_at,created_at,id)
  where direction='OUTBOUND'
    and delivery_status='QUEUED'
    and next_attempt_at is not null;

create index if not exists communication_messages_delivery_expired_lease_idx
  on public.communication_messages(lease_expires_at,id)
  where direction='OUTBOUND' and delivery_status='PROCESSING';

create index if not exists communication_messages_delivery_terminal_idx
  on public.communication_messages(workspace_id,delivery_status,updated_at desc)
  where direction='OUTBOUND' and delivery_status in ('FAILED','UNCERTAIN');

create or replace function public.communication_delivery_max_provider_attempts()
returns integer
language sql
immutable
set search_path=public,app_auth,extensions
as $$ select 8 $$;

create or replace function public.communication_delivery_retry_delay(provider_attempts integer)
returns interval
language sql
immutable
set search_path=public,app_auth,extensions
as $$
  select make_interval(
    mins=>least(360,power(2,greatest(coalesce(provider_attempts,1),1))::integer)
  )
$$;

create or replace function public.communication_delivery_contact_allowed(
  target_workspace uuid,
  target_contact uuid,
  target_channel text,
  target_purpose text
)
returns boolean
language sql
stable
security definer
set search_path=public,app_auth,extensions
as $$
  select exists(
    select 1
    from public.contacts contact
    join public.contact_consents consent
      on consent.contact_id=contact.id
      and consent.workspace_id=contact.workspace_id
    where contact.id=target_contact
      and contact.workspace_id=target_workspace
      and not contact.do_not_contact
      and not exists(
        select 1
        from public.privacy_restrictions restriction
        where restriction.workspace_id=contact.workspace_id
          and restriction.contact_id=contact.id
          and restriction.active
          and (restriction.ends_at is null or restriction.ends_at>now())
          and (
            'COMMUNICATION'=any(restriction.scopes)
            or upper(target_purpose)=any(restriction.scopes)
          )
      )
      and consent.channel=upper(target_channel)
      and consent.purpose=upper(target_purpose)
      and consent.status='GRANTED'
      and (
        consent.retention_until is null
        or consent.retention_until>=current_date
      )
  )
$$;

revoke all on function public.communication_delivery_max_provider_attempts()
  from public,crm_app,crm_system,crm_worker;
revoke all on function public.communication_delivery_retry_delay(integer)
  from public,crm_app,crm_system,crm_worker;
revoke all on function public.communication_delivery_contact_allowed(
  uuid,uuid,text,text
) from public,crm_app,crm_system,crm_worker;

create or replace function public.claim_communication_deliveries_leased(
  target_workspace uuid,
  batch_size integer,
  worker_id text,
  lease_seconds integer default 300
)
returns table(
  message_id uuid,
  thread_id uuid,
  recipient_email text,
  subject text,
  body text,
  recipient_display_name text,
  consent_purpose text,
  lease_token uuid,
  provider_attempt_count integer,
  first_provider_attempt_at timestamptz,
  last_provider_attempt_at timestamptz
)
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
begin
  if target_workspace is null
    or not exists(select 1 from public.workspaces where id=target_workspace)
    or batch_size not between 1 and 40
    or nullif(trim(worker_id),'') is null
    or length(trim(worker_id))>120
    or lease_seconds not between 30 and 3600
  then
    raise exception 'communication_delivery_claim_invalid';
  end if;

  perform set_config('app.workspace_id',target_workspace::text,true);

  -- An expired owner that never crossed the provider boundary is safe to
  -- release. No existing row is changed unless a future Worker first leased it.
  update public.communication_messages message
  set delivery_status='QUEUED',
      next_attempt_at=now(),
      locked_at=null,
      lease_expires_at=null,
      locked_by=null,
      lease_token=null,
      delivery_failure_code='LEASE_EXPIRED_BEFORE_PROVIDER_ATTEMPT',
      last_error='LEASE_EXPIRED_BEFORE_PROVIDER_ATTEMPT',
      updated_at=now()
  where message.workspace_id=target_workspace
    and message.direction='OUTBOUND'
    and message.delivery_status='PROCESSING'
    and message.lease_expires_at<now()
    and message.outcome_may_have_been_accepted=false;

  -- Once an external attempt may have started, lease expiry is never treated
  -- as proof that the provider rejected the message.
  update public.communication_messages message
  set delivery_status='UNCERTAIN',
      next_attempt_at=null,
      locked_at=null,
      lease_expires_at=null,
      locked_by=null,
      lease_token=null,
      delivery_failure_code='LEASE_EXPIRED_AFTER_PROVIDER_ATTEMPT',
      last_error='LEASE_EXPIRED_AFTER_PROVIDER_ATTEMPT',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      outcome_may_have_been_accepted=true,
      updated_at=now()
  where message.workspace_id=target_workspace
    and message.direction='OUTBOUND'
    and message.delivery_status='PROCESSING'
    and message.lease_expires_at<now()
    and message.outcome_may_have_been_accepted=true;

  update public.communication_messages message
  set delivery_status='UNCERTAIN',
      next_attempt_at=null,
      delivery_failure_code='IDEMPOTENCY_WINDOW_EXPIRED',
      last_error='IDEMPOTENCY_WINDOW_EXPIRED',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  where message.workspace_id=target_workspace
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and message.outcome_may_have_been_accepted=true
    and message.first_provider_attempt_at<=now()-interval '23 hours';

  update public.communication_messages message
  set delivery_status=case
        when message.outcome_may_have_been_accepted then 'UNCERTAIN'
        else 'FAILED'
      end,
      next_attempt_at=null,
      delivery_failure_code='MAX_PROVIDER_ATTEMPTS',
      last_error='MAX_PROVIDER_ATTEMPTS',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  where message.workspace_id=target_workspace
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and message.provider_attempt_count>=public.communication_delivery_max_provider_attempts();

  update public.communication_messages message
  set delivery_status='FAILED',
      next_attempt_at=null,
      delivery_failure_code='THREAD_CLOSED',
      last_error='THREAD_CLOSED',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  from public.communication_threads thread
  where message.workspace_id=target_workspace
    and message.thread_id=thread.id
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and thread.status<>'OPEN';

  update public.communication_messages message
  set delivery_status='FAILED',
      next_attempt_at=null,
      delivery_failure_code='RECIPIENT_EMAIL_UNAVAILABLE',
      last_error='RECIPIENT_EMAIL_UNAVAILABLE',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  from public.communication_threads thread
  join public.contacts contact on contact.id=thread.contact_id
  where message.workspace_id=target_workspace
    and message.thread_id=thread.id
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and nullif(trim(contact.email::text),'') is null;

  update public.communication_messages message
  set delivery_status='FAILED',
      next_attempt_at=null,
      delivery_failure_code='CONSENT_REVOKED',
      last_error='CONSENT_REVOKED',
      dead_lettered_at=coalesce(message.dead_lettered_at,now()),
      updated_at=now()
  from public.communication_threads thread
  join public.contacts contact on contact.id=thread.contact_id
  where message.workspace_id=target_workspace
    and message.thread_id=thread.id
    and message.direction='OUTBOUND'
    and message.delivery_status='QUEUED'
    and message.next_attempt_at<=now()
    and nullif(trim(contact.email::text),'') is not null
    and not public.communication_delivery_contact_allowed(
      target_workspace,thread.contact_id,thread.channel,thread.purpose
    );

  return query
  with candidates as (
    select candidate.id
    from public.communication_messages candidate
    where candidate.workspace_id=target_workspace
      and candidate.direction='OUTBOUND'
      and candidate.delivery_status='QUEUED'
      and candidate.next_attempt_at<=now()
      and candidate.provider_attempt_count<
        public.communication_delivery_max_provider_attempts()
      and (
        candidate.outcome_may_have_been_accepted=false
        or candidate.first_provider_attempt_at>now()-interval '23 hours'
      )
    order by candidate.next_attempt_at,candidate.created_at,candidate.id
    for update skip locked
    limit batch_size
  ),
  claimed as (
    update public.communication_messages message
    set delivery_status='PROCESSING',
        next_attempt_at=null,
        locked_at=now(),
        lease_expires_at=now()+make_interval(secs=>lease_seconds),
        locked_by=left(trim(worker_id),120),
        lease_token=gen_random_uuid(),
        delivery_failure_code=null,
        last_error=null,
        dead_lettered_at=null,
        updated_at=now()
    from candidates
    where message.id=candidates.id
    returning message.*
  )
  select
    claimed.id,
    claimed.thread_id,
    contact.email::text,
    thread.subject,
    claimed.body,
    coalesce(
      nullif(trim(contact.name_en),''),
      nullif(trim(contact.name_zh),''),
      ''
    ),
    thread.purpose,
    claimed.lease_token,
    claimed.provider_attempt_count,
    claimed.first_provider_attempt_at,
    claimed.last_provider_attempt_at
  from claimed
  join public.communication_threads thread on thread.id=claimed.thread_id
  join public.contacts contact on contact.id=thread.contact_id
  order by claimed.created_at,claimed.id;
end;
$$;

create or replace function public.mark_communication_delivery_attempt_started_leased(
  target_message uuid,
  worker_id text,
  token uuid
)
returns integer
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare message public.communication_messages;
begin
  select candidate.* into message
  from public.communication_messages candidate
  where candidate.id=target_message
  for update;

  if not found
    or message.delivery_status<>'PROCESSING'
    or message.lease_token is distinct from token
    or message.locked_by is distinct from left(trim(coalesce(worker_id,'')),120)
    or message.lease_expires_at<now()
  then
    raise exception 'communication_delivery_lease_lost';
  end if;

  if message.last_provider_attempt_lease_token=token then
    return message.provider_attempt_count;
  end if;
  if message.provider_attempt_count>=public.communication_delivery_max_provider_attempts() then
    raise exception 'communication_delivery_max_attempts';
  end if;

  update public.communication_messages
  set provider_attempt_count=provider_attempt_count+1,
      first_provider_attempt_at=coalesce(first_provider_attempt_at,now()),
      last_provider_attempt_at=now(),
      last_provider_attempt_lease_token=token,
      outcome_may_have_been_accepted=true,
      updated_at=now()
  where id=target_message
  returning provider_attempt_count into message.provider_attempt_count;
  return message.provider_attempt_count;
end;
$$;

create or replace function public.complete_communication_delivery_leased(
  target_message uuid,
  worker_id text,
  token uuid,
  provider_id text
)
returns void
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare message public.communication_messages;
declare normalized_provider_id text:=trim(coalesce(provider_id,''));
begin
  if length(normalized_provider_id) not between 1 and 240
    or normalized_provider_id~E'[\\r\\n]'
  then
    raise exception 'communication_delivery_provider_receipt_invalid';
  end if;

  select candidate.* into message
  from public.communication_messages candidate
  where candidate.id=target_message
  for update;

  if message.delivery_status='SENT'
    and message.provider_message_id=normalized_provider_id
    and message.last_provider_attempt_lease_token=token
  then
    return;
  end if;

  if not found
    or message.delivery_status<>'PROCESSING'
    or message.lease_token is distinct from token
    or message.locked_by is distinct from left(trim(coalesce(worker_id,'')),120)
    or message.lease_expires_at<now()
    or message.last_provider_attempt_lease_token is distinct from token
  then
    raise exception 'communication_delivery_lease_lost';
  end if;

  update public.communication_messages
  set delivery_status='SENT',
      provider_message_id=normalized_provider_id,
      delivered_at=now(),
      next_attempt_at=null,
      locked_at=null,
      lease_expires_at=null,
      locked_by=null,
      lease_token=null,
      delivery_failure_code=null,
      last_error=null,
      dead_lettered_at=null,
      outcome_may_have_been_accepted=false,
      updated_at=now()
  where id=target_message;
end;
$$;

create or replace function public.fail_communication_delivery_leased(
  target_message uuid,
  worker_id text,
  token uuid,
  failure_code text,
  outcome_class text
)
returns text
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare message public.communication_messages;
declare normalized_code text:=upper(trim(coalesce(failure_code,'')));
declare normalized_outcome text:=upper(trim(coalesce(outcome_class,'')));
declare next_status text;
declare next_attempt timestamptz;
declare terminal_at timestamptz;
declare uncertain boolean;
begin
  if normalized_code<>all(array[
      'PROVIDER_REJECTED',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_INVALID_RESPONSE',
      'RECIPIENT_EMAIL_UNAVAILABLE',
      'CONSENT_REVOKED',
      'DELIVERY_CONFIGURATION_UNAVAILABLE'
    ]::text[])
    or normalized_outcome not in (
      'DEFINITE_RETRYABLE','DEFINITE_PERMANENT','POSSIBLY_ACCEPTED'
    )
  then
    raise exception 'communication_delivery_failure_invalid';
  end if;

  select candidate.* into message
  from public.communication_messages candidate
  where candidate.id=target_message
  for update;

  if not found
    or message.delivery_status<>'PROCESSING'
    or message.lease_token is distinct from token
    or message.locked_by is distinct from left(trim(coalesce(worker_id,'')),120)
    or message.lease_expires_at<now()
    or message.last_provider_attempt_lease_token is distinct from token
  then
    raise exception 'communication_delivery_lease_lost';
  end if;

  uncertain:=normalized_outcome='POSSIBLY_ACCEPTED';
  if uncertain and (
    message.first_provider_attempt_at is null
    or message.first_provider_attempt_at<=now()-interval '23 hours'
    or message.provider_attempt_count>=public.communication_delivery_max_provider_attempts()
  ) then
    next_status:='UNCERTAIN';
    next_attempt:=null;
    terminal_at:=now();
  elsif normalized_outcome='DEFINITE_PERMANENT' then
    next_status:='FAILED';
    next_attempt:=null;
    terminal_at:=now();
  elsif message.provider_attempt_count>=public.communication_delivery_max_provider_attempts() then
    next_status:='FAILED';
    next_attempt:=null;
    terminal_at:=now();
    normalized_code:='MAX_PROVIDER_ATTEMPTS';
  else
    next_status:='QUEUED';
    next_attempt:=now()+public.communication_delivery_retry_delay(
      message.provider_attempt_count
    );
    terminal_at:=null;
  end if;

  update public.communication_messages
  set delivery_status=next_status,
      next_attempt_at=next_attempt,
      locked_at=null,
      lease_expires_at=null,
      locked_by=null,
      lease_token=null,
      delivery_failure_code=normalized_code,
      last_error=normalized_code,
      dead_lettered_at=terminal_at,
      outcome_may_have_been_accepted=uncertain,
      updated_at=now()
  where id=target_message;
  return next_status;
end;
$$;

create or replace function public.requeue_failed_communication_delivery(
  target_message uuid
)
returns public.communication_messages
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare message public.communication_messages;
declare thread public.communication_threads;
declare contact public.contacts;
declare before_state jsonb;
begin
  select candidate.* into message
  from public.communication_messages candidate
  where candidate.id=target_message
    and candidate.workspace_id=public.current_workspace_id()
    and candidate.direction='OUTBOUND'
    and candidate.delivery_status='FAILED'
  for update;
  if not found then
    raise exception 'communication_delivery_not_retryable';
  end if;

  select candidate.* into thread
  from public.communication_threads candidate
  where candidate.id=message.thread_id and candidate.status='OPEN';
  if not found then raise exception 'communication_thread_not_open'; end if;

  select candidate.* into contact
  from public.contacts candidate
  where candidate.id=thread.contact_id
    and candidate.workspace_id=message.workspace_id;
  if not found or nullif(trim(contact.email::text),'') is null then
    raise exception 'communication_recipient_unavailable';
  end if;
  if not public.contact_channel_allowed(
    thread.contact_id,thread.channel,thread.purpose
  ) then
    raise exception 'communication_consent_required';
  end if;

  before_state:=jsonb_build_object(
    'deliveryStatus',message.delivery_status,
    'failureCode',message.delivery_failure_code,
    'providerAttemptCount',message.provider_attempt_count
  );
  update public.communication_messages
  set delivery_status='QUEUED',
      next_attempt_at=now(),
      locked_at=null,
      lease_expires_at=null,
      locked_by=null,
      lease_token=null,
      provider_attempt_count=0,
      first_provider_attempt_at=null,
      last_provider_attempt_at=null,
      last_provider_attempt_lease_token=null,
      delivery_failure_code=null,
      last_error=null,
      dead_lettered_at=null,
      outcome_may_have_been_accepted=false,
      attempt_count=attempt_count+1,
      last_attempt_at=now(),
      updated_at=now()
  where id=message.id
  returning * into message;

  insert into public.audit_events(
    workspace_id,actor_id,entity_type,entity_id,action,
    before_data,after_data,request_id
  ) values(
    message.workspace_id,app_auth.current_user_id(),
    'communication_message',message.id::text,'REQUEUE_DELIVERY',
    before_state,
    jsonb_build_object(
      'deliveryStatus','QUEUED',
      'providerAttemptCount',0
    ),
    txid_current()::text
  );
  return message;
end;
$$;

revoke all on function public.claim_communication_deliveries_leased(
  uuid,integer,text,integer
) from public,crm_app,crm_system,crm_worker;
revoke all on function public.mark_communication_delivery_attempt_started_leased(
  uuid,text,uuid
) from public,crm_app,crm_system,crm_worker;
revoke all on function public.complete_communication_delivery_leased(
  uuid,text,uuid,text
) from public,crm_app,crm_system,crm_worker;
revoke all on function public.fail_communication_delivery_leased(
  uuid,text,uuid,text,text
) from public,crm_app,crm_system,crm_worker;
revoke all on function public.requeue_failed_communication_delivery(uuid)
  from public,crm_app,crm_system,crm_worker;

grant execute on function public.claim_communication_deliveries_leased(
  uuid,integer,text,integer
) to crm_worker;
grant execute on function public.mark_communication_delivery_attempt_started_leased(
  uuid,text,uuid
) to crm_worker;
grant execute on function public.complete_communication_delivery_leased(
  uuid,text,uuid,text
) to crm_worker;
grant execute on function public.fail_communication_delivery_leased(
  uuid,text,uuid,text,text
) to crm_worker;
grant execute on function public.requeue_failed_communication_delivery(uuid)
  to crm_app;

-- Existing synchronous Web functions and their crm_system grants intentionally
-- remain unchanged until the later switch release has been accepted.

notify pgrst,'reload schema';
