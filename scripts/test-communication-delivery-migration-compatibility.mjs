import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.MIGRATION_DATABASE_URL?.trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL_REQUIRED");

const directory = path.resolve(import.meta.dirname, "..", "db", "migrations");
const parent = "202607300069_container_runtime_boundary.sql";
const migration = "202607310070_async_communication_delivery_expand.sql";
const files = (await readdir(directory))
  .filter((name) => /^\d{12,}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
assert.equal(files.at(-2), parent);
assert.equal(files.at(-1), migration);

const client = new Client({ connectionString });
await client.connect();
try {
  await client.query(`
    create schema if not exists app_meta;
    create table if not exists app_meta.schema_migrations (
      name text primary key,
      checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz not null default now(),
      execution_ms integer not null check (execution_ms >= 0)
    )
  `);
  for (const name of files.filter((candidate) => candidate <= parent)) {
    await client.query("begin");
    try {
      await client.query(await readFile(path.join(directory, name), "utf8"));
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`PARENT_MIGRATION_FAILED:${name}`, { cause: error });
    }
  }

  const workspaceId = "00000000-0000-4000-8000-000000000001";
  const actorId = "97100000-0000-4000-8000-000000000070";
  const contactId = "97100000-0000-4000-8000-000000000071";
  const threadId = "97100000-0000-4000-8000-000000000072";
  await client.query(
    `insert into app_auth.accounts(id,email,username,status)
     values($1,'existing@example.test','phase1.existing','ACTIVE')`,
    [actorId],
  );
  await client.query(
    `insert into public.contacts(
       id,workspace_id,name_zh,name_en,email,created_by
     ) values($1,$2,'既有联系人','Existing Contact','existing@example.test',$3)`,
    [contactId, workspaceId, actorId],
  );
  await client.query(
    `insert into public.communication_threads(
       id,workspace_id,contact_id,subject,channel,purpose,status,
       assigned_to,created_by
     ) values($1,$2,$3,'Existing communication','EMAIL','SERVICE','OPEN',$4,$4)`,
    [threadId, workspaceId, contactId, actorId],
  );

  const fixtures = [
    ["97100000-0000-4000-8000-000000000101", "OUTBOUND", "QUEUED", null, null, 3],
    ["97100000-0000-4000-8000-000000000102", "OUTBOUND", "FAILED", null, "legacy free-form failure", 4],
    ["97100000-0000-4000-8000-000000000103", "OUTBOUND", "SENT", "legacy-provider-id", null, 2],
    ["97100000-0000-4000-8000-000000000104", "INBOUND", "RECEIVED", null, null, 1],
    ["97100000-0000-4000-8000-000000000105", "OUTBOUND", "DELIVERED", "legacy-delivered-id", null, 2],
  ];
  for (const [id, direction, status, providerId, lastError, attempts] of fixtures) {
    await client.query(
      `insert into public.communication_messages(
         id,workspace_id,thread_id,direction,body,delivery_status,
         provider_message_id,last_error,sent_by,idempotency_key,
         attempt_count,last_attempt_at,delivered_at
       ) values(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),
         case when $6 in ('SENT','DELIVERED') then now() end
       )`,
      [
        id,
        workspaceId,
        threadId,
        direction,
        `Existing ${status}`,
        status,
        providerId,
        lastError,
        actorId,
        `existing:${id}`,
        attempts,
      ],
    );
  }
  const before = (await client.query(
    `select id,direction,body,delivery_status,provider_message_id,last_error,
       attempt_count,last_attempt_at,delivered_at
     from public.communication_messages
     where id::text like '97100000-%'
     order by id`,
  )).rows;

  await client.query("begin");
  try {
    await client.query(await readFile(path.join(directory, migration), "utf8"));
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  const after = (await client.query(
    `select id,direction,body,delivery_status,provider_message_id,last_error,
       attempt_count,last_attempt_at,delivered_at,next_attempt_at,
       locked_at,lease_expires_at,locked_by,lease_token,
       provider_attempt_count,first_provider_attempt_at,last_provider_attempt_at,
       last_provider_attempt_lease_token,dead_lettered_at,
       outcome_may_have_been_accepted,delivery_failure_code
     from public.communication_messages
     where id::text like '97100000-%'
     order by id`,
  )).rows;
  assert.equal(after.length, fixtures.length);
  for (let index = 0; index < after.length; index += 1) {
    const current = after[index];
    const prior = before[index];
    for (const key of [
      "id",
      "direction",
      "body",
      "delivery_status",
      "provider_message_id",
      "last_error",
      "attempt_count",
      "last_attempt_at",
      "delivered_at",
    ]) {
      assert.deepEqual(current[key], prior[key], `${key} changed for ${prior.id}`);
    }
    assert.equal(current.next_attempt_at, null);
    assert.equal(current.locked_at, null);
    assert.equal(current.lease_expires_at, null);
    assert.equal(current.locked_by, null);
    assert.equal(current.lease_token, null);
    assert.equal(current.provider_attempt_count, 0);
    assert.equal(current.first_provider_attempt_at, null);
    assert.equal(current.last_provider_attempt_at, null);
    assert.equal(current.last_provider_attempt_lease_token, null);
    assert.equal(current.dead_lettered_at, null);
    assert.equal(current.outcome_may_have_been_accepted, false);
    assert.equal(current.delivery_failure_code, null);
  }

  const constraints = await client.query(
    `select conname,convalidated
     from pg_constraint
     where conrelid='public.communication_messages'::regclass
       and conname like 'communication_messages_%_check'
     order by conname`,
  );
  const expandConstraints = constraints.rows.filter(({ conname }) =>
    [
      "delivery_direction",
      "delivery_lease",
      "provider_attempt",
      "sent_receipt",
      "uncertain",
      "dead_letter",
      "provider_timestamps",
      "delivery_failure_code",
    ].some((name) => conname.includes(name)));
  assert.equal(expandConstraints.length, 8);
  assert.ok(expandConstraints.every(({ convalidated }) => convalidated === false));

  process.stdout.write(
    "[communication-delivery-migration-compatibility] PASS parent=069 "
      + "historical=QUEUED,FAILED,SENT,RECEIVED,DELIVERED unchanged.\n",
  );
} finally {
  await client.end();
}
