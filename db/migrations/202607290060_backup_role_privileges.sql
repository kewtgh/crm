grant usage on schema public, app_auth, app_meta, extensions to crm_backup;
grant select on all tables in schema public, app_auth, app_meta to crm_backup;
grant select on all sequences in schema public, app_auth, app_meta to crm_backup;

alter default privileges for role crm_migrator in schema public
  grant select on tables to crm_backup;
alter default privileges for role crm_migrator in schema public
  grant select on sequences to crm_backup;
alter default privileges for role crm_migrator in schema app_auth
  grant select on tables to crm_backup;
alter default privileges for role crm_migrator in schema app_auth
  grant select on sequences to crm_backup;
alter default privileges for role crm_migrator in schema app_meta
  grant select on tables to crm_backup;
alter default privileges for role crm_migrator in schema app_meta
  grant select on sequences to crm_backup;
