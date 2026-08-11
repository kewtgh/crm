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
  for (const key of ["APP_URL", "DATABASE_URL", "SYSTEM_DATABASE_URL", "TOTP_ENCRYPTION_KEY", "INVITATION_CREDENTIAL_ENCRYPTION_KEY"]) {
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
  const queueFailure = buildReadinessDiagnostics({
    environmentValid: true,
    auth: { ok: true },
    database: { ok: true },
    snapshot: { ...healthySnapshot, failedJobs: 1 },
  });
  assert.equal(queueFailure.ready, false);
  assert.equal(queueFailure.checks.queues, false);
  assert.equal(queueFailure.components.queues.code, "QUEUES_FAILED");
  assert.equal(queueFailure.metrics.failedJobs, 1);
});

test("owns an ordered, checksum-managed standard PostgreSQL migration history", async () => {
  const migrationNames = (await readdir(repositoryFile("db/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(migrationNames.length >= 79);
  assert.equal(migrationNames[0], "202607150000_self_hosted_foundation.sql");
  for (const requiredMigration of [
    "202608020073_staff_invitation_system_rls.sql",
    "202608100074_persistent_session_retention.sql",
    "202608110075_structured_profiles_teams_and_terminal_approvals.sql",
    "202608110076_product_contact_and_multi_team_profiles.sql",
    "202608110077_crm_system_team_membership_permissions.sql",
    "202608110078_product_lifecycle_and_contact_operating_profile.sql",
    "202608110079_all_staff_team_membership.sql",
  ]) {
    assert.ok(migrationNames.includes(requiredMigration), `${requiredMigration} must remain in migration history`);
  }
  const [migrator, verifier, containerMigration, turnstileMigration, businessTimezoneMigration, workerPermissionMigration, businessDateMigration, communicationMigration, backupMigration, profileRlsMigration] = await Promise.all([
    readFile(repositoryFile("scripts/db-migrate.mjs"), "utf8"),
    readFile(repositoryFile("scripts/db-verify-migrations.mjs"), "utf8"),
    readFile(repositoryFile("db/migrations/202607300069_container_runtime_boundary.sql"), "utf8"),
    readFile(repositoryFile("db/migrations/202607300068_workspace_turnstile_policy.sql"), "utf8"),
    readFile(repositoryFile("db/migrations/202607300065_workspace_business_timezone.sql"), "utf8"),
    readFile(repositoryFile("db/migrations/202607300066_worker_business_timezone_permissions.sql"), "utf8"),
    readFile(repositoryFile("db/migrations/202607300067_business_date_text_contract.sql"), "utf8"),
    readFile(repositoryFile("db/migrations/202607290064_v330_communication_scalability.sql"), "utf8"),
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
  assert.match(containerMigration, /service_schema_version/);
  assert.match(containerMigration, /pg_stat_statements/);
  assert.match(turnstileMigration, /turnstile_enabled/);
  assert.match(turnstileMigration, /WORKSPACE_TURNSTILE_POLICY_CHANGED/);
  assert.match(businessTimezoneMigration, /set_workspace_business_timezone/);
  assert.match(workerPermissionMigration, /to crm_worker/);
  assert.match(businessDateMigration, /YYYY-MM-DD/);
  assert.match(communicationMigration, /communication_threads_creation_request_uidx/);
  assert.match(communicationMigration, /communication_inbox_page/);
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

test("deploys standard database migrations with a lock and isolated Compose credentials", async () => {
  const [runner, migrator, releaseGate, deployEnvironment, migrationEnvironment] = await Promise.all([
    readFile(repositoryFile("scripts/deploy-production-runner.mjs"), "utf8"),
    readFile(repositoryFile("scripts/db-migrate.mjs"), "utf8"),
    readFile(repositoryFile("scripts/release-gate.mjs"), "utf8"),
    readFile(repositoryFile("deploy/deploy.env.example"), "utf8"),
    readFile(repositoryFile("deploy/migration.env.example"), "utf8"),
  ]);
  assert.match(runner, /verify migration manifest/);
  assert.match(runner, /apply locked forward migration/);
  assert.match(migrator, /pg_advisory_lock/);
  assert.match(migrator, /checksum/);
  assert.match(migrationEnvironment, /MIGRATION_DATABASE_URL=.*crm_migrator/);
  assert.match(releaseGate, /db:smoke/);
  assert.doesNotMatch(deployEnvironment, /DATABASE_ADMIN_URL|BACKUP_DATABASE_URL/);
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

test("keeps cold admin submenu navigation on a same-tab document boundary", async () => {
  const [shell, browserQa] = await Promise.all([
    readFile(repositoryFile("components/app-shell.tsx"), "utf8"),
    readFile(repositoryFile("scripts/browser-qa-chromium-1228.cjs"), "utf8"),
  ]);
  assert.match(shell, /labelKey:\s*"nav\.admin"[^\n]+documentChildNavigation:\s*true/);
  assert.match(shell, /item\.documentChildNavigation\?<a[^>]+data-navigation="document"/);
  assert.match(browserQa, /__LUMINA_QA_DOCUMENT_MARKER__/);
  assert.match(browserQa, /context\.pages\(\)\.length!==1/);
});

test("restores the sidebar position across document navigation", async () => {
  const shell = await readFile(repositoryFile("components/app-shell.tsx"), "utf8");
  assert.match(shell, /SIDEBAR_SCROLL_STORAGE_KEY = "lumina\.sidebar\.scroll-top"/);
  assert.match(shell, /sessionStorage\.getItem\(SIDEBAR_SCROLL_STORAGE_KEY\)/);
  assert.match(shell, /sidebarNavigation\.scrollTop = storedPosition/);
  assert.match(shell, /sessionStorage\.setItem\(SIDEBAR_SCROLL_STORAGE_KEY, String\(sidebarNavigation\.scrollTop\)\)/);
  assert.match(shell, /addEventListener\("pagehide", persistScrollPosition\)/);
  assert.match(shell, /<nav ref=\{sidebarNavRef\} className="sidebar-nav">/);
});
