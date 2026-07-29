do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pg_stat_statements'
  ) then
    raise exception 'pg_stat_statements must be provisioned by the database bootstrap task';
  end if;
end
$$;

create or replace function public.service_schema_version()
returns text
language sql
stable
security definer
set search_path = pg_catalog, app_meta
as $$
  select max(name)
  from app_meta.schema_migrations
$$;

revoke all on function public.service_schema_version() from public, crm_app;
grant execute on function public.service_schema_version() to crm_system, crm_worker;
