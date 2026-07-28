-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- Object bucket provisioning moved to the application ObjectStore.
alter table public.generated_jobs add column if not exists error_message text;
