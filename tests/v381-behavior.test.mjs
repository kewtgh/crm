import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);
const migrationName = "202607310070_async_communication_delivery_expand.sql";

test("adds the next canonical expand-only communication delivery migration", async () => {
  const files = (await readdir(repositoryFile("db/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationIndex = files.indexOf(migrationName);
  assert.equal(files[migrationIndex - 1], "202607300069_container_runtime_boundary.sql");
  assert.ok(migrationIndex >= 0);

  const migration = await readFile(repositoryFile(`db/migrations/${migrationName}`), "utf8");
  for (const column of [
    "next_attempt_at",
    "locked_at",
    "lease_expires_at",
    "locked_by",
    "lease_token",
    "updated_at",
    "provider_attempt_count",
    "first_provider_attempt_at",
    "last_provider_attempt_at",
    "last_provider_attempt_lease_token",
    "dead_lettered_at",
    "outcome_may_have_been_accepted",
    "delivery_failure_code",
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}\\b`));
  }
  assert.match(migration, /'PROCESSING'/);
  assert.match(migration, /'UNCERTAIN'/);
  assert.match(migration, /communication_messages_delivery_lease_check/);
  assert.match(migration, /lease_expires_at>locked_at/);
  assert.match(migration, /provider_attempt_count>=0/);
  assert.match(migration, /communication_messages_sent_receipt_check/);
  assert.match(migration, /provider_message_id!~E'\[\\\\r\\\\n\]'/);
  assert.match(migration, /communication_messages_uncertain_check/);
  assert.match(migration, /communication_messages_delivery_direction_check/);
  assert.match(migration, /communication_messages_delivery_failure_code_check/);
});

test("defines due, expired-lease and terminal operational indexes without requeueing history", async () => {
  const migration = await readFile(repositoryFile(`db/migrations/${migrationName}`), "utf8");
  assert.match(migration, /communication_messages_delivery_due_idx[\s\S]+next_attempt_at,created_at,id/);
  assert.match(migration, /communication_messages_delivery_expired_lease_idx[\s\S]+lease_expires_at,id/);
  assert.match(migration, /communication_messages_delivery_terminal_idx[\s\S]+delivery_status in \('FAILED','UNCERTAIN'\)/);

  const preFunctionSql = migration.slice(
    0,
    migration.indexOf("create or replace function public.claim_communication_deliveries_leased"),
  );
  assert.doesNotMatch(preFunctionSql, /update public\.communication_messages/i);
  assert.doesNotMatch(preFunctionSql, /set\s+delivery_status/i);
  assert.doesNotMatch(preFunctionSql, /set\s+next_attempt_at/i);
});

test("uses fenced worker-only RPCs and preserves database rollback compatibility functions", async () => {
  const migration = await readFile(repositoryFile(`db/migrations/${migrationName}`), "utf8");
  for (const signature of [
    "claim_communication_deliveries_leased",
    "mark_communication_delivery_attempt_started_leased",
    "complete_communication_delivery_leased",
    "fail_communication_delivery_leased",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${signature}`));
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${signature}[\\s\\S]+to crm_worker`),
    );
  }
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /lease_token=gen_random_uuid\(\)/);
  assert.match(migration, /communication_delivery_lease_lost/);
  assert.match(migration, /last_provider_attempt_lease_token=token/);
  assert.match(migration, /if message\.delivery_status='SENT'[\s\S]+return;/);
  assert.match(migration, /to crm_app;/);
  assert.doesNotMatch(
    migration,
    /grant\s+(?:insert|update|delete|all)[\s\S]{0,100}communication_messages[\s\S]{0,100}crm_worker/i,
  );

  assert.match(migration, /Existing synchronous Web functions[\s\S]+remain unchanged/);
});

test("centralizes bounded attempts and backoff while separating legacy attempt_count", async () => {
  const migration = await readFile(repositoryFile(`db/migrations/${migrationName}`), "utf8");
  assert.match(migration, /communication_delivery_max_provider_attempts\(\)[\s\S]+select 8/);
  assert.match(migration, /communication_delivery_retry_delay\(provider_attempts integer\)/);
  assert.match(migration, /least\(360,power\(2,greatest/);
  assert.match(migration, /provider_attempt_count=provider_attempt_count\+1/);
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf("mark_communication_delivery_attempt_started_leased"),
      migration.indexOf("complete_communication_delivery_leased"),
    ),
    /\battempt_count\s*=\s*attempt_count\+1/,
  );
});

test("governs recovery, stable failure codes and ordinary retry of FAILED only", async () => {
  const migration = await readFile(repositoryFile(`db/migrations/${migrationName}`), "utf8");
  assert.match(migration, /LEASE_EXPIRED_BEFORE_PROVIDER_ATTEMPT/);
  assert.match(migration, /LEASE_EXPIRED_AFTER_PROVIDER_ATTEMPT/);
  assert.match(migration, /IDEMPOTENCY_WINDOW_EXPIRED/);
  assert.match(migration, /interval '23 hours'/);
  assert.match(migration, /'DEFINITE_RETRYABLE','DEFINITE_PERMANENT','POSSIBLY_ACCEPTED'/);
  assert.match(migration, /PROVIDER_REJECTED/);
  assert.match(migration, /PROVIDER_UNAVAILABLE/);
  assert.match(migration, /PROVIDER_INVALID_RESPONSE/);
  assert.match(migration, /RECIPIENT_EMAIL_UNAVAILABLE/);
  assert.match(migration, /CONSENT_REVOKED/);
  assert.match(migration, /DELIVERY_CONFIGURATION_UNAVAILABLE/);
  assert.match(migration, /candidate\.delivery_status='FAILED'/);
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf("create or replace function public.requeue_failed_communication_delivery"),
    ),
    /candidate\.delivery_status\s+in\s*\([^)]*UNCERTAIN/,
  );
  assert.match(migration, /contact_channel_allowed/);
  assert.match(migration, /communication_delivery_contact_allowed/);
  assert.match(migration, /target_workspace,thread\.contact_id,thread\.channel,thread\.purpose/);
  assert.match(migration, /'REQUEUE_DELIVERY'/);
});
