-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- Staff-only identity boundary. CRM customer contacts are never authentication users.
revoke all on function public.username_available(text) from crm_system;
grant execute on function public.username_available(text) to crm_app;

comment on table public.user_profiles is
  'Profiles for invited operating-company staff accounts only; never customer, parent, or student identities.';
