import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { readDatabaseSchema, schemaEvidence, applicationRollbackDecision } from "../scripts/lib/deployment-schema.mjs";

// Explicit opt-in only: a disposable local database, never application DATABASE_URL.
const connectionString = process.env.DEPLOYMENT_TEST_DATABASE_URL;
test("PostgreSQL schema evidence and forward-only rollback guard", { skip: !connectionString && "DEPLOYMENT_TEST_DATABASE_URL not provided" }, async () => {
  const url = new URL(connectionString);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/test_lumina_deployment_[a-f0-9]{10,}$/);
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 });
  await client.connect();
  let created = false;
  try {
    const existing = await client.query("select count(*)::int as count from pg_tables where schemaname not in ('pg_catalog','information_schema')");
    assert.equal(existing.rows[0].count, 0, "database must be empty and disposable");
    await client.query("create schema app_meta"); created = true;
    await client.query("create table app_meta.schema_migrations (name text primary key, checksum text not null)");
    const first = { name: "001_example.sql", checksum: "0".repeat(64) };
    await client.query("insert into app_meta.schema_migrations values ($1,$2)", [first.name, first.checksum]);
    const before = await readDatabaseSchema(client);
    assert.deepEqual(before, schemaEvidence([first]));
    await client.query("insert into app_meta.schema_migrations values ('002_example.sql',$1)", ["1".repeat(64)]);
    const after = await readDatabaseSchema(client);
    assert.equal(applicationRollbackDecision({ migrationState: "COMPLETED", database: after, previousImageSchema: before }).status, "UNSAFE");
    assert.equal((await client.query("select count(*)::int as count from app_meta.schema_migrations")).rows[0].count, 2);
  } finally {
    if (created) {
      await client.query("drop table if exists app_meta.schema_migrations");
      await client.query("drop schema app_meta");
    }
    await client.end();
  }
});
