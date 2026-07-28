-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- v0.9.0: the signed server webhook endpoint inserts with the service role and
-- needs INSERT + SELECT for PostgREST return=representation. DELETE is limited
-- to the same trusted service role for retention jobs and isolated smoke cleanup.
grant insert,select,delete on public.webhook_inbox to crm_system, crm_worker;
revoke insert,update,delete on public.webhook_inbox from crm_system,crm_app;
