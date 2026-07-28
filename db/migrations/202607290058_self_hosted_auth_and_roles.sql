drop trigger if exists on_auth_user_created_profile on app_auth.accounts;
drop trigger if exists on_auth_user_created_crm_membership on app_auth.accounts;
drop function if exists public.handle_new_lumina_crm_user();
drop function if exists public.handle_new_crm_membership();

update app_auth.accounts account
set username = profile.username
from public.user_profiles profile
where profile.user_id = account.id
  and account.username is null;

alter table app_auth.accounts
  drop column if exists raw_user_meta_data,
  drop column if exists raw_app_meta_data;

create table if not exists app_auth.password_credentials (
  user_id uuid primary key references app_auth.accounts(id) on delete cascade,
  password_hash text not null check (password_hash like '$argon2id$%'),
  parameters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_auth.accounts(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  csrf_hash text not null check (csrf_hash ~ '^[a-f0-9]{64}$'),
  aal text not null default 'aal1' check (aal in ('aal1', 'aal2')),
  password_version integer not null,
  user_agent_hash text,
  source_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  check (idle_expires_at <= absolute_expires_at)
);
create index if not exists auth_sessions_user_active_idx
  on app_auth.sessions(user_id, absolute_expires_at desc)
  where revoked_at is null;

create table if not exists app_auth.email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_auth.accounts(id) on delete cascade,
  purpose text not null
    check (purpose in ('EMAIL_VERIFICATION', 'DEVICE_VERIFICATION', 'PASSWORD_RESET')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);
create index if not exists auth_email_tokens_active_idx
  on app_auth.email_tokens(user_id, purpose, expires_at)
  where consumed_at is null;

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
create unique index if not exists auth_totp_one_active_uidx
  on app_auth.totp_factors(user_id)
  where status in ('UNVERIFIED', 'VERIFIED');

create table if not exists app_auth.login_events (
  id bigint generated always as identity primary key,
  user_id uuid references app_auth.accounts(id) on delete set null,
  session_id uuid references app_auth.sessions(id) on delete set null,
  outcome text not null,
  reason text,
  source_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);
create index if not exists auth_login_events_user_time_idx
  on app_auth.login_events(user_id, created_at desc);

grant usage on schema app_auth to crm_system;
grant select, insert, update, delete on
  app_auth.accounts,
  app_auth.password_credentials,
  app_auth.sessions,
  app_auth.email_tokens,
  app_auth.totp_factors,
  app_auth.login_events
to crm_system;
grant usage, select on sequence app_auth.login_events_id_seq to crm_system;

grant select on app_auth.accounts, app_auth.sessions to crm_app;
grant update (last_seen_at, idle_expires_at) on app_auth.sessions to crm_app;
grant select (id, email, status) on app_auth.accounts to crm_worker;

do $policies$
declare
  target record;
  policy_name text;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
  loop
    policy_name := 'crm_internal_' || substr(md5(target.table_name), 1, 16);
    execute format('drop policy if exists %I on %I.%I',
      policy_name, target.schema_name, target.table_name);
    execute format(
      'create policy %I on %I.%I for all to crm_system, crm_worker using (true) with check (true)',
      policy_name, target.schema_name, target.table_name
    );
  end loop;
end
$policies$;

grant usage on schema public to crm_app, crm_system, crm_worker;
grant select, insert, update, delete on all tables in schema public to crm_system;
grant usage, select on all sequences in schema public to crm_system;
grant usage on schema app_meta to crm_system;
grant select on app_meta.schema_migrations to crm_system;
