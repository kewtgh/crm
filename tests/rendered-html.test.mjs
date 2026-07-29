import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);

test("rejects encoded, backslash, and protocol-relative authentication return targets", async () => {
  const { safeRelativeReturnTo } = await import("../lib/return-to.ts");
  assert.equal(safeRelativeReturnTo("/schools?page=2"), "/schools?page=2");
  assert.equal(safeRelativeReturnTo("//evil.example"), "/dashboard");
  assert.equal(safeRelativeReturnTo("/\\evil.example"), "/dashboard");
  assert.equal(safeRelativeReturnTo("/%5cevil.example"), "/dashboard");
  assert.equal(safeRelativeReturnTo("/%255cevil.example"), "/dashboard");
});

test("reports incomplete PostgreSQL runtime configuration without throwing", async () => {
  const { inspectCoreRuntimeEnvironment, inspectWorkerRuntimeEnvironment } =
    await import("../lib/runtime-environment.ts");
  const core = inspectCoreRuntimeEnvironment({});
  assert.equal(core.valid, false);
  for (const key of ["APP_URL", "DATABASE_URL", "SYSTEM_DATABASE_URL", "TOTP_ENCRYPTION_KEY"]) {
    assert.ok(core.missing.includes(key), `${key} must be required`);
  }
  const worker = inspectWorkerRuntimeEnvironment({});
  assert.equal(worker.valid, false);
  assert.ok(worker.missing.includes("WORKER_DATABASE_URL"));
});

test("distinguishes authentication, database, Worker, and queue readiness causes", async () => {
  const { buildReadinessDiagnostics } = await import("../lib/readiness-diagnostics.ts");
  const healthySnapshot = {
    database: true,
    missingWorkers: 0,
    staleWorkers: 0,
    failedJobs: 0,
    stuckJobs: 0,
  };
  const authFailure = buildReadinessDiagnostics({
    environmentValid: true,
    auth: { ok: false, code: "AUTH_HEALTH_TIMEOUT" },
    database: { ok: true },
    snapshot: healthySnapshot,
  });
  assert.equal(authFailure.components.auth.code, "AUTH_HEALTH_TIMEOUT");
  assert.equal(authFailure.components.database.status, "ok");
  assert.equal(authFailure.components.workers.status, "ok");
  const databaseFailure = buildReadinessDiagnostics({
    environmentValid: true,
    auth: { ok: true },
    database: { ok: false, code: "DATABASE_CONNECTION_FAILED" },
    snapshot: healthySnapshot,
  });
  assert.equal(databaseFailure.components.database.code, "DATABASE_CONNECTION_FAILED");
  assert.equal(databaseFailure.components.workers.status, "blocked");
  assert.equal(databaseFailure.components.queues.status, "blocked");
});

test("owns an ordered, checksum-managed standard PostgreSQL migration history", async () => {
  const migrationNames = (await readdir(repositoryFile("db/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(migrationNames.length >= 68);
  assert.equal(migrationNames[0], "202607150000_self_hosted_foundation.sql");
  assert.equal(migrationNames.at(-1), "202607290063_v320_delivery_integrity.sql");
  const [migrator, verifier, finalMigration, backupMigration, profileRlsMigration] = await Promise.all([
    readFile(repositoryFile("scripts/db-migrate.mjs"), "utf8"),
    readFile(repositoryFile("scripts/db-verify-migrations.mjs"), "utf8"),
    readFile(repositoryFile(`db/migrations/${migrationNames.at(-1)}`), "utf8"),
    readFile(repositoryFile("db/migrations/202607290060_backup_role_privileges.sql"), "utf8"),
    readFile(repositoryFile("db/migrations/202607290062_v310_profile_rls_repair.sql"), "utf8"),
  ]);
  assert.match(migrator, /pg_advisory_lock/);
  assert.match(migrator, /checksum/);
  assert.match(verifier, /forbidden platform SQL/);
  const authMigration = await readFile(
    repositoryFile("db/migrations/202607290058_self_hosted_auth_and_roles.sql"),
    "utf8",
  );
  assert.match(authMigration, /app_auth\.password_credentials/);
  assert.match(authMigration, /app_auth\.sessions/);
  assert.match(authMigration, /app_auth\.totp_factors/);
  assert.match(finalMigration, /appointments_creation_request_uidx/);
  assert.match(profileRlsMigration, /users and administrators read profiles/);
  assert.match(backupMigration, /crm_backup/);
});

test("uses Argon2id, opaque server sessions, encrypted TOTP, and replay protection", async () => {
  const [password, sessionStore, totp, emailTokens] = await Promise.all([
    readFile(repositoryFile("lib/auth/password.ts"), "utf8"),
    readFile(repositoryFile("lib/auth/session-store.ts"), "utf8"),
    readFile(repositoryFile("lib/auth/totp.ts"), "utf8"),
    readFile(repositoryFile("lib/auth/email-tokens.ts"), "utf8"),
  ]);
  assert.match(password, /argon2id/);
  assert.match(sessionStore, /token_hash/);
  assert.match(sessionStore, /idle_expires_at/);
  assert.match(totp, /aes-256-gcm/);
  assert.match(totp, /last_used_step/);
  assert.match(emailTokens, /hashOpaqueValue/);
});

test("routes application and privileged database access through separate pools", async () => {
  const [pools, context, gateway] = await Promise.all([
    readFile(repositoryFile("lib/db/pools.ts"), "utf8"),
    readFile(repositoryFile("lib/db/context.ts"), "utf8"),
    readFile(repositoryFile("lib/db/gateway.ts"), "utf8"),
  ]);
  assert.match(pools, /DATABASE_URL/);
  assert.match(pools, /SYSTEM_DATABASE_URL/);
  assert.match(context, /app\.user_id/);
  assert.match(context, /app\.workspace_id/);
  assert.match(gateway, /withDatabaseContext/);
});

test("keeps object bytes outside release directories behind a storage abstraction", async () => {
  const [objectStore, storageRoute, workerStore] = await Promise.all([
    readFile(repositoryFile("lib/storage/object-store.ts"), "utf8"),
    readFile(repositoryFile("app/api/storage/object/route.ts"), "utf8"),
    readFile(repositoryFile("scripts/lib/worker-object-store.mjs"), "utf8"),
  ]);
  assert.match(objectStore, /OBJECT_STORAGE_PROVIDER/);
  assert.match(objectStore, /OBJECT_STORAGE_LOCAL_ROOT/);
  assert.match(objectStore, /S3Client/);
  assert.match(objectStore, /INVALID_OBJECT_KEY/);
  assert.match(storageRoute, /objectStore\(\)\.get/);
  assert.match(workerStore, /workerObjectStore/);
});

test("runs Workers through the low-privilege PostgreSQL role and heartbeat contract", async () => {
  const [workerDatabase, workerCycle, heartbeat] = await Promise.all([
    readFile(repositoryFile("scripts/lib/worker-database.mjs"), "utf8"),
    readFile(repositoryFile("scripts/process-worker-cycle.mjs"), "utf8"),
    readFile(repositoryFile("scripts/worker-heartbeat.mjs"), "utf8"),
  ]);
  assert.match(workerDatabase, /WORKER_DATABASE_URL/);
  assert.match(workerDatabase, /pg/);
  assert.match(workerCycle, /createWorkerHeartbeat/);
  assert.match(heartbeat, /record_worker_heartbeat/);
});

test("deploys standard database migrations with a lock and without runtime proxy inheritance", async () => {
  const [runner, core, releaseGate, deployEnvironment] = await Promise.all([
    readFile(repositoryFile("scripts/deploy-production-runner.mjs"), "utf8"),
    readFile(repositoryFile("scripts/lib/production-deploy-core.mjs"), "utf8"),
    readFile(repositoryFile("scripts/release-gate.mjs"), "utf8"),
    readFile(repositoryFile("deploy/deploy.env.example"), "utf8"),
  ]);
  assert.match(runner, /db:migrations:verify/);
  assert.match(runner, /db:migrate/);
  assert.match(runner, /validateMigrationEnvironment/);
  assert.match(core, /MIGRATION_DATABASE_URL/);
  assert.match(core, /crm_migrator/);
  assert.match(core, /directRuntimeEnvironment/);
  assert.match(releaseGate, /db:smoke/);
  assert.match(deployEnvironment, /DATABASE_ADMIN_URL/);
  assert.match(deployEnvironment, /BACKUP_DATABASE_URL/);
});

test("provides encrypted off-host backup and destructive restore-test isolation", async () => {
  const [backup, restore, crypto, timer] = await Promise.all([
    readFile(repositoryFile("scripts/db-backup.mjs"), "utf8"),
    readFile(repositoryFile("scripts/db-restore-test.mjs"), "utf8"),
    readFile(repositoryFile("scripts/lib/backup-crypto.mjs"), "utf8"),
    readFile(repositoryFile("deploy/systemd/lumina-crm-backup.timer"), "utf8"),
  ]);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /S3Client/);
  assert.match(restore, /lumina_restore_/);
  assert.match(restore, /drop database if exists/);
  assert.match(crypto, /aes-256-gcm/);
  assert.match(timer, /OnCalendar/);
});

test("keeps the retired platform source only as a read-only migration archive", async () => {
  await access(repositoryFile("archive/supabase/migrations"));
  await assert.rejects(access(repositoryFile("supabase")));
  for (const path of [
    "lib/supabase-server.ts",
    "lib/login-identity.ts",
    "scripts/lib/qa-auth.mjs",
  ]) {
    await assert.rejects(access(repositoryFile(path)));
  }
});
