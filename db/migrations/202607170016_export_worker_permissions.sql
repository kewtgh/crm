-- Generated from the preserved pre-exit migration history.
-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.
set search_path = public, extensions;

grant select,update on public.generated_jobs to crm_system, crm_worker;
grant select on public.contracts,public.organizations,public.products,public.sales_team_members,
  public.performance_targets,public.performance_allocations,public.payments,public.performance_contributions to crm_system, crm_worker;
grant insert on public.user_notifications to crm_system, crm_worker;
