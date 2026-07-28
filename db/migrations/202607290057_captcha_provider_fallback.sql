-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- Lumina CRM v2.9.0: durable, action-bound lifecycle for the self-hosted
-- ALTCHA fallback.  The browser never receives service-role credentials and
-- every transition is an atomic, service-role-only database operation.

create table public.captcha_challenges (
  id uuid primary key,
  provider text not null default 'altcha'
    check (provider = 'altcha'),
  action text not null
    check (action in ('staff_login','password_recovery')),
  source_hash text not null
    check (source_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  attestation_id uuid unique,
  attestation_expires_at timestamptz,
  consumed_at timestamptz,
  check (expires_at > issued_at),
  check (
    (verified_at is null and attestation_id is null and attestation_expires_at is null)
    or
    (verified_at is not null and attestation_id is not null and attestation_expires_at is not null)
  ),
  check (consumed_at is null or verified_at is not null)
);

create index captcha_challenges_source_issued_idx
  on public.captcha_challenges(source_hash,issued_at desc);
create index captcha_challenges_expiry_idx
  on public.captcha_challenges(expires_at);

alter table public.captcha_challenges enable row level security;
revoke all on table public.captcha_challenges
  from public,crm_system,crm_app, crm_system, crm_worker;

create function public.service_issue_captcha_challenge(
  challenge_identifier uuid,
  challenge_action text,
  challenge_source_hash text,
  challenge_expires_at timestamptz
)
returns boolean
language plpgsql volatile security definer set search_path=public,app_auth,extensions
as $$
begin
  if app_auth.current_db_role()<>'service_role'
    or challenge_identifier is null
    or challenge_action not in ('staff_login','password_recovery')
    or challenge_source_hash !~ '^[a-f0-9]{64}$'
    or challenge_expires_at <= now()
    or challenge_expires_at > now()+interval '5 minutes'
  then
    raise exception 'captcha_challenge_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(challenge_source_hash,0));
  if (
    select count(*) >= 30
    from public.captcha_challenges
    where source_hash=challenge_source_hash
      and issued_at > now()-interval '5 minutes'
  ) then
    return false;
  end if;

  insert into public.captcha_challenges(id,action,source_hash,expires_at)
  values (
    challenge_identifier,
    challenge_action,
    challenge_source_hash,
    challenge_expires_at
  );
  return true;
end;
$$;

create function public.service_verify_captcha_challenge(
  challenge_identifier uuid,
  challenge_action text,
  challenge_source_hash text,
  target_attestation_id uuid,
  target_attestation_expires_at timestamptz
)
returns boolean
language plpgsql volatile security definer set search_path=public,app_auth,extensions
as $$
declare
  changed integer;
begin
  if app_auth.current_db_role()<>'service_role'
    or challenge_identifier is null
    or challenge_action not in ('staff_login','password_recovery')
    or challenge_source_hash !~ '^[a-f0-9]{64}$'
    or target_attestation_id is null
    or target_attestation_expires_at <= now()
    or target_attestation_expires_at > now()+interval '5 minutes'
  then
    raise exception 'captcha_verification_invalid';
  end if;

  update public.captcha_challenges
  set verified_at=now(),
      attestation_id=target_attestation_id,
      attestation_expires_at=target_attestation_expires_at
  where id=challenge_identifier
    and action=challenge_action
    and source_hash=challenge_source_hash
    and verified_at is null
    and consumed_at is null
    and expires_at > now();
  get diagnostics changed = row_count;
  return changed=1;
end;
$$;

create function public.service_consume_captcha_attestation(
  challenge_identifier uuid,
  challenge_action text,
  challenge_source_hash text,
  target_attestation_id uuid
)
returns boolean
language plpgsql volatile security definer set search_path=public,app_auth,extensions
as $$
declare
  changed integer;
begin
  if app_auth.current_db_role()<>'service_role'
    or challenge_identifier is null
    or challenge_action not in ('staff_login','password_recovery')
    or challenge_source_hash !~ '^[a-f0-9]{64}$'
    or target_attestation_id is null
  then
    raise exception 'captcha_attestation_invalid';
  end if;

  update public.captcha_challenges
  set consumed_at=now()
  where id=challenge_identifier
    and action=challenge_action
    and source_hash=challenge_source_hash
    and attestation_id=target_attestation_id
    and verified_at is not null
    and consumed_at is null
    and attestation_expires_at > now();
  get diagnostics changed = row_count;
  return changed=1;
end;
$$;

revoke all on function public.service_issue_captcha_challenge(uuid,text,text,timestamptz)
  from public,crm_system,crm_app;
revoke all on function public.service_verify_captcha_challenge(uuid,text,text,uuid,timestamptz)
  from public,crm_system,crm_app;
revoke all on function public.service_consume_captcha_attestation(uuid,text,text,uuid)
  from public,crm_system,crm_app;
grant execute on function public.service_issue_captcha_challenge(uuid,text,text,timestamptz)
  to crm_system, crm_worker;
grant execute on function public.service_verify_captcha_challenge(uuid,text,text,uuid,timestamptz)
  to crm_system, crm_worker;
grant execute on function public.service_consume_captcha_attestation(uuid,text,text,uuid)
  to crm_system, crm_worker;

notify pgrst,'reload schema';
