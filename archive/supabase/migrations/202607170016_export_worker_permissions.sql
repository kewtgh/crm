grant select,update on public.generated_jobs to service_role;
grant select on public.contracts,public.organizations,public.products,public.sales_team_members,
  public.performance_targets,public.performance_allocations,public.payments,public.performance_contributions to service_role;
grant insert on public.user_notifications to service_role;
