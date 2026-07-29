import pg from "pg";
import { readdir } from "node:fs/promises";

const connectionString = process.env.SYSTEM_DATABASE_URL?.trim();
if (!connectionString) throw new Error("SYSTEM_DATABASE_URL_NOT_CONFIGURED");
const client = new pg.Client({
  connectionString,
  application_name: "lumina-database-validation",
});
const expectedMigrationCount = (await readdir(new URL("../db/migrations/", import.meta.url)))
  .filter((name) => name.endsWith(".sql")).length;

await client.connect();
try {
  const migrations = await client.query(
    "select count(*)::int as count from app_meta.schema_migrations",
  );
  const tables = await client.query(
      `select n.nspname as schema_name, count(*)::int as table_count,
              coalesce(sum(greatest(c.reltuples,0)),0)::bigint as estimated_rows
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where c.relkind='r' and n.nspname in ('public','app_auth')
       group by n.nspname order by n.nspname`,
  );
  const invalidConstraints = await client.query(
      `select n.nspname as schema_name, c.relname as table_name, con.conname
       from pg_constraint con
       join pg_class c on c.oid=con.conrelid
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('public','app_auth')
         and con.contype in ('f','c') and not con.convalidated`,
  );
  const invalidIndexes = await client.query(
      `select n.nspname as schema_name, c.relname as index_name
       from pg_index i join pg_class c on c.oid=i.indexrelid
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('public','app_auth') and not i.indisvalid`,
  );
  const duplicates = await client.query(
      `select
        (select count(*) from (
          select email from app_auth.accounts group by email having count(*)>1
        ) duplicate_email) as duplicate_emails,
        (select count(*) from (
          select username from app_auth.accounts group by username having count(*)>1
        ) duplicate_username) as duplicate_usernames`,
  );
  const orphans = await client.query(
      `select
        (select count(*) from public.user_profiles p
         left join app_auth.accounts a on a.id=p.user_id where a.id is null) as profiles,
        (select count(*) from public.workspace_memberships m
         left join app_auth.accounts a on a.id=m.user_id where a.id is null) as memberships,
        (select count(*) from app_auth.password_credentials c
         left join app_auth.accounts a on a.id=c.user_id where a.id is null) as credentials,
        (select count(*) from app_auth.sessions s
         left join app_auth.accounts a on a.id=s.user_id where a.id is null) as sessions`,
  );
  const roles = await client.query(
      `select rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
       from pg_roles
       where rolname=any($1)
      order by rolname`,
      [["crm_app", "crm_backup", "crm_migrator", "crm_system", "crm_worker"]],
  );

  const expectedRoles = new Set([
    "crm_app",
    "crm_backup",
    "crm_migrator",
    "crm_system",
    "crm_worker",
  ]);
  for (const role of roles.rows) {
    expectedRoles.delete(role.rolname);
    if (
      role.rolsuper
      || role.rolcreaterole
      || role.rolcreatedb
      || role.rolreplication
      || (role.rolname === "crm_backup" ? !role.rolbypassrls : role.rolbypassrls)
    ) {
      throw new Error(`DATABASE_ROLE_OVERPRIVILEGED:${role.rolname}`);
    }
  }
  if (expectedRoles.size) {
    throw new Error(`DATABASE_ROLES_MISSING:${[...expectedRoles].join(",")}`);
  }
  if (Number(migrations.rows[0]?.count) !== expectedMigrationCount) {
    throw new Error(`MIGRATION_COUNT_MISMATCH:${migrations.rows[0]?.count}`);
  }
  if (invalidConstraints.rowCount) {
    throw new Error(
      `UNVALIDATED_CONSTRAINTS:${invalidConstraints.rows
        .map((constraint) => `${constraint.schema_name}.${constraint.table_name}.${constraint.conname}`)
        .join(",")}`,
    );
  }
  if (invalidIndexes.rowCount) {
    throw new Error(`INVALID_INDEXES:${invalidIndexes.rowCount}`);
  }
  const duplicateCounts = duplicates.rows[0];
  if (Object.values(duplicateCounts).some((value) => Number(value) !== 0)) {
    throw new Error(`DUPLICATE_IDENTITIES:${JSON.stringify(duplicateCounts)}`);
  }
  const orphanCounts = orphans.rows[0];
  if (Object.values(orphanCounts).some((value) => Number(value) !== 0)) {
    throw new Error(`ORPHAN_IDENTITIES:${JSON.stringify(orphanCounts)}`);
  }

  process.stdout.write(`${JSON.stringify({
    migrations: migrations.rows[0].count,
    tables: tables.rows,
    invalidConstraints: 0,
    invalidIndexes: 0,
    duplicateIdentities: duplicateCounts,
    orphanIdentities: orphanCounts,
    leastPrivilegeRoles: roles.rows.map((role) => role.rolname),
  }, null, 2)}\n`);
} finally {
  await client.end();
}
