-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- Privileged users may hold an AAL1 session while completing MFA, but that
-- session must not receive CRM data privileges through RLS or RPC helpers.
create or replace function public.current_crm_role()
returns text
language sql
stable
security definer
set search_path=public,app_auth,extensions
as $$
  select coalesce((
    select upper(role)
    from public.workspace_memberships
    where user_id = app_auth.current_user_id()
      and status = 'ACTIVE'
      and (upper(role) not in ('SUPER_ADMIN','ADMIN') or coalesce(app_auth.current_claims()->>'aal','aal1') = 'aal2')
    order by created_at
    limit 1
  ), '');
$$;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path=public,app_auth,extensions
as $$
  select exists(
    select 1 from public.workspace_memberships m
    where m.workspace_id = target_workspace
      and m.user_id = app_auth.current_user_id()
      and m.status = 'ACTIVE'
      and (upper(m.role) not in ('SUPER_ADMIN','ADMIN') or coalesce(app_auth.current_claims()->>'aal','aal1') = 'aal2')
  );
$$;

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path=public,app_auth,extensions
as $$
  select workspace_id
  from public.workspace_memberships
  where user_id = app_auth.current_user_id()
    and status = 'ACTIVE'
    and (upper(role) not in ('SUPER_ADMIN','ADMIN') or coalesce(app_auth.current_claims()->>'aal','aal1') = 'aal2')
  order by created_at
  limit 1;
$$;
