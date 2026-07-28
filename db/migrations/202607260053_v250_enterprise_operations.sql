-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- v2.5.0: staged enterprise directory lifecycle and connector validation evidence.

create table if not exists public.enterprise_directory_users (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  auth_user_id uuid unique references app_auth.accounts(id) on delete set null,
  external_id text not null,
  user_name citext not null,
  display_name_zh text not null default '',
  display_name_en text not null,
  role text not null default 'SALES_SUPPORT'
    check(role in ('SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT')),
  team text not null default 'Enterprise directory',
  active boolean not null default true,
  version bigint not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deprovisioned_at timestamptz,
  unique(workspace_id, external_id),
  unique(workspace_id, user_name)
);
create index if not exists enterprise_directory_claim_idx
  on public.enterprise_directory_users(workspace_id,lower(user_name::text),active);
alter table public.enterprise_directory_users enable row level security;
create policy "administrators read enterprise directory"
  on public.enterprise_directory_users for select to crm_app
  using(public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));
grant select on public.enterprise_directory_users to crm_app;
grant select,insert,update on public.enterprise_directory_users to crm_system, crm_worker;
revoke delete on public.enterprise_directory_users from crm_system, crm_worker;
revoke insert,update,delete on public.enterprise_directory_users from crm_app;

create table if not exists public.connector_validation_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check(provider in ('MICROSOFT_365','GOOGLE_CALENDAR','EMAIL','E_SIGNATURE','ACCOUNTING','PAYMENT')),
  status text not null check(status in ('SUCCEEDED','FAILED')),
  response_digest text check(response_digest is null or response_digest ~ '^[a-f0-9]{64}$'),
  capabilities jsonb not null default '[]'::jsonb check(jsonb_typeof(capabilities)='array'),
  error_code text,
  duration_ms integer not null check(duration_ms >= 0 and duration_ms <= 60000),
  validated_by uuid references app_auth.accounts(id) on delete set null,
  validated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check((status='SUCCEEDED' and response_digest is not null and error_code is null)
    or (status='FAILED' and error_code is not null))
);
create index if not exists connector_validation_latest_idx
  on public.connector_validation_receipts(workspace_id,provider,validated_at desc);
alter table public.connector_validation_receipts enable row level security;
create policy "administrators read connector validation receipts"
  on public.connector_validation_receipts for select to crm_app
  using(public.is_workspace_member(workspace_id)
    and public.current_crm_role() in ('SUPER_ADMIN','ADMIN'));
grant select on public.connector_validation_receipts to crm_app;
grant select,insert on public.connector_validation_receipts to crm_system, crm_worker;
revoke insert,update,delete on public.connector_validation_receipts from crm_app;

-- SSO identities may arrive without application metadata. Profile creation must
-- therefore derive a collision-safe username instead of rejecting the Auth row.
create or replace function public.handle_new_lumina_crm_user()
returns trigger
language plpgsql
security definer
set search_path=public,app_auth,extensions
as $$
declare
  candidate text:=regexp_replace(lower(coalesce(
    nullif(new.raw_user_meta_data->>'username',''),
    split_part(coalesce(new.email,''),'@',1),
    'user'
  )), '[^a-z0-9._-]', '', 'g');
begin
  if candidate !~ '^[a-z]' then candidate:='u-'||candidate; end if;
  if length(candidate)<3 then candidate:='user-'||left(new.id::text,6); end if;
  candidate:=left(candidate,24);
  if exists(select 1 from public.user_profiles where username=candidate::citext) then
    candidate:=left(candidate,25)||'-'||left(new.id::text,6);
  end if;
  insert into public.user_profiles(user_id,username,display_name_zh,display_name_en)
  values(
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data->>'chinese_name',''),
    coalesce(nullif(new.raw_user_meta_data->>'english_name',''),nullif(new.raw_user_meta_data->>'full_name',''),split_part(coalesce(new.email,'CRM User'),'@',1))
  ) on conflict(user_id) do nothing;
  return new;
end;
$$;
