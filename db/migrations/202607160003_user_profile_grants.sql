-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

grant select on table public.user_profiles to crm_app;
grant update (display_name_zh, display_name_en) on table public.user_profiles to crm_app;
grant select, insert, update, delete on table public.user_profiles to crm_system, crm_worker;
