-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

alter table public.organizations add column if not exists organization_type text not null default 'SCHOOL'
check (organization_type in ('SCHOOL','FAMILY','PARTNER','OTHER'));
create index if not exists organizations_workspace_type_idx on public.organizations(workspace_id,organization_type);
