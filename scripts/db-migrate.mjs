import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const migrationsDirectory = path.resolve(import.meta.dirname, "..", "db", "migrations");
const connectionString = process.env.MIGRATION_DATABASE_URL?.trim();

if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required");

const ssl = /^(1|true|yes|on)$/i.test(process.env.DATABASE_SSL ?? "")
  ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
  : undefined;
const client = new Client({
  connectionString,
  ssl,
  connectionTimeoutMillis: 10_000,
  application_name: "lumina-crm-migrator",
});

const checksum = (sql) => createHash("sha256").update(sql).digest("hex");

await client.connect();
try {
  await client.query("select pg_advisory_lock(hashtext($1))", ["lumina-crm-schema-migrations"]);
  await client.query(`
    create schema if not exists app_meta;
    create table if not exists app_meta.schema_migrations (
      name text primary key,
      checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz not null default now(),
      execution_ms integer not null check (execution_ms >= 0)
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{12,}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (!files.length) throw new Error("No database migrations were found");

  const appliedResult = await client.query(
    "select name, checksum from app_meta.schema_migrations order by name",
  );
  const applied = new Map(appliedResult.rows.map((row) => [row.name, row.checksum]));
  let executed = 0;

  for (const name of files) {
    const sql = await readFile(path.join(migrationsDirectory, name), "utf8");
    const digest = checksum(sql);
    const prior = applied.get(name);
    if (prior) {
      if (prior !== digest) throw new Error(`Migration checksum mismatch: ${name}`);
      continue;
    }
    const startedAt = performance.now();
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      await client.query("set local search_path = public, extensions");
      await client.query(sql);
      const executionMs = Math.max(0, Math.round(performance.now() - startedAt));
      await client.query(
        "insert into app_meta.schema_migrations(name, checksum, execution_ms) values($1, $2, $3)",
        [name, digest, executionMs],
      );
      await client.query("commit");
      executed += 1;
      process.stdout.write(`[db:migrate] applied ${name} (${executionMs} ms)\n`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }

  process.stdout.write(`[db:migrate] ${executed} applied, ${files.length - executed} already current.\n`);
} finally {
  await client.query("select pg_advisory_unlock(hashtext($1))", ["lumina-crm-schema-migrations"])
    .catch(() => undefined);
  await client.end();
}
