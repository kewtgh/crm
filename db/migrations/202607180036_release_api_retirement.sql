-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

-- v1.0.0: retire quote writers that predate product/bundle and currency locks.
-- Drafts created through these overloads cannot satisfy the v1.0 submit rules.

revoke all on function public.create_quote(
  text,uuid,uuid,uuid,text,numeric,numeric,date,text,text
) from public,crm_system,crm_app;

revoke all on function public.add_quote_version(
  uuid,numeric,numeric,text,text,text
) from public,crm_system,crm_app;
