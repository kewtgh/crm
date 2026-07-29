-- Allow the low-privilege Worker to establish a workspace-local business timezone.
set search_path = public, app_auth, extensions;

grant select (id, business_timezone) on public.workspaces to crm_worker;
grant execute on function public.current_business_date() to crm_worker;
