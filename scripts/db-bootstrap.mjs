import pg from "pg";

const { Client, escapeIdentifier, escapeLiteral } = pg;
const connectionString = process.env.DATABASE_ADMIN_URL?.trim();
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required");

const production = process.env.NODE_ENV === "production";
const roles = [
  ["crm_app", process.env.CRM_APP_DB_PASSWORD],
  ["crm_system", process.env.CRM_SYSTEM_DB_PASSWORD],
  ["crm_worker", process.env.CRM_WORKER_DB_PASSWORD],
  ["crm_migrator", process.env.CRM_MIGRATOR_DB_PASSWORD],
  ["crm_backup", process.env.CRM_BACKUP_DB_PASSWORD],
];
for (const [role, password] of roles) {
  if (!password || (production && password.length < 32)) {
    throw new Error(`${role.toUpperCase()}_DB_PASSWORD must be configured${production ? " with at least 32 characters" : ""}`);
  }
}

const ssl = /^(1|true|yes|on)$/i.test(process.env.DATABASE_SSL ?? "")
  ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
  : undefined;
const client = new Client({
  connectionString,
  ssl,
  connectionTimeoutMillis: 10_000,
  application_name: "lumina-crm-bootstrap",
});

await client.connect();
try {
  const database = (await client.query("select current_database() as name")).rows[0].name;
  await client.query("create schema if not exists extensions");
  await client.query("create extension if not exists pgcrypto with schema extensions");
  await client.query("create extension if not exists citext with schema extensions");
  await client.query("create extension if not exists pg_stat_statements with schema extensions");
  for (const [role, password] of roles) {
    const exists = (await client.query("select 1 from pg_roles where rolname = $1", [role])).rowCount;
    if (!exists) {
      await client.query(
        `create role ${escapeIdentifier(role)} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password ${escapeLiteral(password)}`,
      );
    } else {
      await client.query(`alter role ${escapeIdentifier(role)} password ${escapeLiteral(password)}`);
    }
    const bypassRls = role === "crm_backup" ? "bypassrls" : "nobypassrls";
    await client.query(
      `alter role ${escapeIdentifier(role)}
       nosuperuser nocreatedb nocreaterole noinherit noreplication ${bypassRls}`,
    );
    await client.query(`grant connect on database ${escapeIdentifier(database)} to ${escapeIdentifier(role)}`);
  }
  await client.query(`grant create on database ${escapeIdentifier(database)} to crm_migrator`);
  await client.query("grant all on schema public to crm_migrator");
  await client.query("grant usage on schema extensions to crm_migrator");
  await client.query("grant pg_read_all_data to crm_backup");
  await client.query("revoke create on schema public from public");
  process.stdout.write(`[db:bootstrap] roles prepared for ${database}.\n`);
} finally {
  await client.end();
}
