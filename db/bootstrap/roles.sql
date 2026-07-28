\set ON_ERROR_STOP on

do $bootstrap$
begin
  if not exists (select 1 from pg_roles where rolname = 'crm_app') then
    create role crm_app login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'crm_system') then
    create role crm_system login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'crm_worker') then
    create role crm_worker login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'crm_migrator') then
    create role crm_migrator login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'crm_backup') then
    create role crm_backup login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$bootstrap$;

alter role crm_app nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role crm_system nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role crm_worker nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role crm_migrator nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role crm_backup nosuperuser nocreatedb nocreaterole noinherit noreplication bypassrls;

revoke create on schema public from public;
grant usage on schema public to crm_app, crm_system, crm_worker;
grant pg_read_all_data to crm_backup;
