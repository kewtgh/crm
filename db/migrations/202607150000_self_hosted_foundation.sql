create schema if not exists extensions;
create schema if not exists app_auth;
create schema if not exists app_meta;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

set search_path = public, extensions;

create table if not exists app_auth.accounts (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  username citext unique,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'SUSPENDED', 'DISABLED')),
  email_confirmed_at timestamptz,
  password_version integer not null default 1 check (password_version > 0),
  must_change_password boolean not null default false,
  last_sign_in_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_auth.totp_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_auth.accounts(id) on delete cascade,
  friendly_name text not null default 'Lumina CRM',
  secret_ciphertext bytea not null,
  secret_iv bytea not null,
  secret_tag bytea not null,
  status text not null default 'UNVERIFIED'
    check (status in ('UNVERIFIED', 'VERIFIED', 'REVOKED')),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  last_used_step bigint,
  revoked_at timestamptz
);

create or replace function app_auth.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

create or replace function app_auth.current_workspace_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.workspace_id', true), '')::uuid;
$$;

create or replace function app_auth.current_db_role()
returns text
language sql
stable
as $$
  select case
    when current_user in ('crm_system', 'crm_worker')
      or current_setting('app.system', true) = 'true'
      then 'service_role'
    when current_user = 'crm_app' then 'authenticated'
    else current_user
  end;
$$;

create or replace function app_auth.current_claims()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'aal', coalesce(nullif(current_setting('app.aal', true), ''), 'aal1'),
    'app_metadata', jsonb_build_object(
      'role', coalesce(nullif(current_setting('app.role', true), ''), '')
    )
  );
$$;

grant usage on schema app_auth, extensions to crm_app, crm_system, crm_worker;
grant execute on function
  app_auth.current_user_id(),
  app_auth.current_workspace_id(),
  app_auth.current_db_role(),
  app_auth.current_claims()
to crm_app, crm_system, crm_worker;
