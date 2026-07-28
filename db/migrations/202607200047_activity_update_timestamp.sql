-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- Activity detachment during privacy deletion needs a mutation timestamp.
alter table public.crm_activities
  add column if not exists updated_at timestamptz not null default now();

notify pgrst,'reload schema';
