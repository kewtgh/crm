-- Keep date-only values stable across PostgreSQL and JSON serialization boundaries.
set search_path = public, app_auth, extensions;

drop function public.current_business_date();

create function public.current_business_date()
returns text
language sql
stable
set search_path = public, app_auth
as $$
  select to_char(current_date, 'YYYY-MM-DD');
$$;

revoke all on function public.current_business_date() from public;
grant execute on function public.current_business_date() to crm_app, crm_worker;
