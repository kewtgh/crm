-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- The service role bypasses RLS but still needs SQL privileges for the narrowly
-- scoped staff-administration operations performed by the server.
grant select, update on public.workspace_memberships to crm_system, crm_worker;
grant select, insert, update on public.sales_team_members to crm_system, crm_worker;
grant insert on public.audit_events to crm_system, crm_worker;
grant usage, select on sequence public.audit_events_id_seq to crm_system, crm_worker;
