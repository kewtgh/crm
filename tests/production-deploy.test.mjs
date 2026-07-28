import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertHealthPayload,
  assertLoopbackListener,
  assertPathWithin,
  assertReleasePath,
  assertSystemdRuntime,
  atomicSwitchCurrent,
  classifyPersistedDeployment,
  cleanupFailedRelease,
  collectSecretValues,
  isSystemdServiceInProgress,
  makeDeploymentId,
  makeReleaseId,
  parseEnvironmentText,
  planInterruptedRecovery,
  PRODUCTION_DEPLOY_LOCK_PATH,
  redactSecrets,
  retryHealth,
  rollbackAfterCutover,
  selectReleasesForCleanup,
  validateDeployAssetTexts,
  validateDirectoryMetadata,
  validateEnvironmentFileMetadata,
  validateEnvironmentKeyPolicy,
  validateRequiredEnvironment,
  writeExclusiveRequest,
} from "../scripts/lib/production-deploy-core.mjs";

test("creates UTC deployment and release IDs with an explicit commit", () => {
  const date = new Date("2026-07-28T12:34:56.789Z");
  assert.equal(
    makeDeploymentId(date, "12345678-1234-1234-1234-123456789abc"),
    "20260728T123456Z-12345678123412341234123456789abc",
  );
  assert.equal(
    makeReleaseId(date, "abcdef123456abcdef123456abcdef123456abcd"),
    "20260728T123456Z-abcdef123456",
  );
  assert.throws(() => makeReleaseId(date, "main"), /full 40-character SHA/);
});

test("enforces the release path whitelist", () => {
  const root = path.resolve("safe-releases");
  const release = path.join(root, "20260728T123456Z-abcdef123456");
  assert.equal(assertReleasePath(root, release), release);
  assert.throws(() => assertReleasePath(root, path.join(root, "..", "outside")), /stay below/);
  assert.throws(() => assertReleasePath(root, path.join(root, "nested", "release")), /direct child/);
  assert.throws(() => assertPathWithin(root, root), /stay below/);
  assert.equal(validateDirectoryMetadata({
    isDirectory: () => true,
    isSymbolicLink: () => false,
  }, { label: "release root" }), true);
  assert.throws(() => validateDirectoryMetadata({
    isDirectory: () => true,
    isSymbolicLink: () => true,
  }, { label: "release root" }), /not a symlink/);
});

test("validates environment names and secure file modes without echoing values", () => {
  const parsed = parseEnvironmentText("TOKEN=secret-value\nPROJECT=expected\n", "deploy.env");
  validateRequiredEnvironment(parsed, {
    label: "deploy.env",
    required: ["TOKEN", "PROJECT"],
    exact: { PROJECT: "expected" },
  });
  assert.throws(
    () => validateRequiredEnvironment(parsed, { label: "deploy.env", required: ["MISSING"] }),
    /MISSING/,
  );
  assert.doesNotThrow(() => validateEnvironmentFileMetadata({
    mode: 0o100640,
    uid: 0,
    gid: 1000,
    isFile: () => true,
    isSymbolicLink: () => false,
  }, { label: "deploy.env", currentUid: 1000, allowedGroupIds: [1000] }));
  assert.throws(() => validateEnvironmentFileMetadata({
    mode: 0o100644,
    uid: 0,
    gid: 1000,
    isFile: () => true,
    isSymbolicLink: () => false,
  }, { label: "deploy.env", currentUid: 1000, allowedGroupIds: [1000] }), /permissions/);
  assert.throws(
    () => validateEnvironmentKeyPolicy(
      { SUPABASE_ACCESS_TOKEN: "secret", NODE_OPTIONS: "--inspect" },
      { label: "deploy.env", allowed: ["SUPABASE_ACCESS_TOKEN"] },
    ),
    /NODE_OPTIONS/,
  );
});

test("redacts secrets, bearer tokens, JWTs, URL credentials, and query credentials", () => {
  const collected = collectSecretValues({
    APP_URL: "https://public.example.test",
    THIRD_PARTY_API_KEY: "generic-key-value",
    EMAIL_DELIVERY_WEBHOOK_URL: "https://delivery.example.test/private-path",
  });
  assert.deepEqual(collected, ["https://delivery.example.test/private-path", "generic-key-value"]);
  const output = redactSecrets(
    "secret-value Bearer token-value eyJabc.def.ghi https://user:password@example.test/?token=query-secret https://delivery.example.test/private-path https%3A%2F%2Fdelivery.example.test%2Fprivate-path",
    ["secret-value", "password", ...collected],
  );
  assert.doesNotMatch(output, /secret-value|token-value|password|query-secret|eyJabc|private-path|generic-key-value/);
  assert.match(output, /\[REDACTED\]/);
});

test("atomically switches current through a temporary symlink", async () => {
  const calls = [];
  const fakeFs = {
    rm: async (...args) => calls.push(["rm", ...args]),
    symlink: async (...args) => calls.push(["symlink", ...args]),
    rename: async (...args) => calls.push(["rename", ...args]),
  };
  await atomicSwitchCurrent({
    fs: fakeFs,
    currentLink: "/opt/lumina-crm/current",
    target: "/opt/lumina-crm/releases/20260728T123456Z-abcdef123456",
    nonce: "test",
  });
  assert.deepEqual(calls.map(([operation]) => operation), ["rm", "symlink", "rename"]);
  assert.equal(calls[1][1], "/opt/lumina-crm/releases/20260728T123456Z-abcdef123456");
  assert.equal(calls[2][2], "/opt/lumina-crm/current");
});

test("cleans a pre-switch failed release but never current", async () => {
  const root = path.resolve("releases");
  const failed = path.join(root, "20260728T123456Z-abcdef123456");
  const removed = [];
  assert.equal(await cleanupFailedRelease({
    releasesRoot: root,
    releasePath: failed,
    currentTarget: path.join(root, "20260727T123456Z-111111111111"),
    removeRelease: async (release) => removed.push(release),
  }), true);
  assert.deepEqual(removed, [failed]);
  await assert.rejects(() => cleanupFailedRelease({
    releasesRoot: root,
    releasePath: failed,
    currentTarget: failed,
    removeRelease: async () => undefined,
  }), /while it is current/);
});

test("rolls back after cutover and verifies the restored release", async () => {
  const calls = [];
  const result = await rollbackAfterCutover({
    switched: true,
    previousRelease: "/releases/previous",
    switchCurrent: async (release) => calls.push(`switch:${release}`),
    restartWeb: async () => calls.push("restart"),
    verifyPrevious: async (release) => calls.push(`verify:${release}`),
  });
  assert.equal(result.restored, true);
  assert.deepEqual(calls, ["switch:/releases/previous", "restart", "verify:/releases/previous"]);
});

test("a pre-switch failure neither changes current nor restarts services", async () => {
  const calls = [];
  const result = await rollbackAfterCutover({
    switched: false,
    previousRelease: "/releases/previous",
    switchCurrent: async () => calls.push("switch"),
    restartWeb: async () => calls.push("restart"),
    verifyPrevious: async () => calls.push("verify"),
  });
  assert.deepEqual(result, { attempted: false, restored: false });
  assert.deepEqual(calls, []);
});

test("fails safely when cutover has no previous release", async () => {
  await assert.rejects(() => rollbackAfterCutover({
    switched: true,
    previousRelease: null,
    switchCurrent: async () => assert.fail("must not switch"),
    restartWeb: async () => assert.fail("must not restart"),
    verifyPrevious: async () => assert.fail("must not verify"),
  }), /No previous release/);
});

test("retries health and requires strict production readiness", async () => {
  let clock = 0;
  let calls = 0;
  const healthy = {
    status: "ok",
    version: "2.8.0",
    checks: { environment: true, auth: true, database: true, workers: true, queues: true },
    metrics: { staleWorkers: 0, missingWorkers: 0, failedJobs: 0, stuckJobs: 0 },
    configuration: { expected: 12, configured: 12, missing: [] },
  };
  const result = await retryHealth({
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new Error("not ready");
      return { ok: true, status: 200, json: async () => healthy };
    },
    url: "http://127.0.0.1:3200/api/health?mode=ready",
    expectedVersion: "2.8.0",
    readiness: true,
    timeoutMs: 5_000,
    intervalMs: 1_000,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
  });
  assert.equal(result.attempts, 3);
  assert.throws(() => assertHealthPayload({
    ...healthy,
    metrics: { ...healthy.metrics, staleWorkers: 1 },
  }, "2.8.0", { readiness: true }), /staleWorkers/);
  assert.throws(() => assertHealthPayload({
    ...healthy,
    configuration: { expected: 12, configured: 11, missing: [] },
  }, "2.8.0", { readiness: true }), /only 11/);
});

test("requires port 3200 to listen only on IPv4 loopback", () => {
  assert.equal(assertLoopbackListener("LISTEN 0 511 127.0.0.1:3200 0.0.0.0:*"), true);
  assert.throws(() => assertLoopbackListener("LISTEN 0 511 0.0.0.0:3200 0.0.0.0:*"), /non-loopback/);
  assert.throws(() => assertLoopbackListener("LISTEN 0 511 [::]:3200 [::]:*"), /non-loopback/);
});

test("requires effective systemd hostname, proxy preload, worker result, and timer state", () => {
  const environment = "LUMINA_HTTPS_PROXY=http://127.0.0.1:20271 NODE_OPTIONS=--import=/opt/lumina-crm/runtime-proxy/register-proxy.mjs";
  const input = {
    web: {
      ActiveState: "active",
      SubState: "running",
      UnitFileState: "enabled",
      ExecStart: "/usr/bin/npm run start -- --port 3200 --hostname 127.0.0.1",
      Environment: environment,
    },
    worker: { Environment: environment, Result: "success", ExecMainStatus: "0" },
    timer: { ActiveState: "active", SubState: "waiting", UnitFileState: "enabled" },
  };
  assert.equal(assertSystemdRuntime(input), true);
  assert.throws(() => assertSystemdRuntime({
    ...input,
    web: { ...input.web, ExecStart: "/usr/bin/npm run start -- --port 3200" },
  }), /127\.0\.0\.1/);
  assert.throws(() => assertSystemdRuntime({
    ...input,
    worker: { ...input.worker, Environment: "" },
  }), /ProxyAgent preload|LUMINA_HTTPS_PROXY/);
  assert.throws(() => assertSystemdRuntime({
    ...input,
    timer: { ...input.timer, SubState: "elapsed" },
  }), /waiting/);
});

test("release cleanup protects current, previous, active, and newest retained releases", () => {
  const root = path.resolve("release-retention");
  const names = [
    "20260728T100000Z-aaaaaaaaaaaa",
    "20260728T110000Z-bbbbbbbbbbbb",
    "20260728T120000Z-cccccccccccc",
    "20260728T130000Z-dddddddddddd",
    "20260728T140000Z-eeeeeeeeeeee",
    "20260728T150000Z-ffffffffffff",
  ];
  const entries = names.map((name, index) => ({ path: path.join(root, name), mtimeMs: index }));
  const current = entries[5].path;
  const previous = entries[1].path;
  const active = entries[4].path;
  const removals = selectReleasesForCleanup(entries, {
    releasesRoot: root,
    currentRelease: current,
    previousRelease: previous,
    activeRelease: active,
    retain: 2,
  });
  assert(!removals.includes(current));
  assert(!removals.includes(previous));
  assert(!removals.includes(active));
  assert(removals.includes(entries[0].path));
});

test("exclusive request file rejects concurrent deploys and remains recoverable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lumina-deploy-test-"));
  const requestPath = path.join(directory, "request.json");
  const request = { requestId: "12345678-1234-1234-1234-123456789abc", mode: "deploy" };
  try {
    await writeExclusiveRequest({ writeFile }, requestPath, request);
    await assert.rejects(() => writeExclusiveRequest({ writeFile }, requestPath, request), /already pending or running/);
    const persisted = JSON.parse(await readFile(requestPath, "utf8"));
    assert.equal(persisted.requestId, request.requestId);
    assert.deepEqual(
      classifyPersistedDeployment({ serviceActive: true, request: persisted, latest: { deploymentId: "active-id" } }),
      { state: "RUNNING", deploymentId: "active-id" },
    );
    assert.deepEqual(
      classifyPersistedDeployment({ serviceActive: false, request: persisted, latest: null }),
      { state: "PENDING_RECOVERABLE", requestId: request.requestId },
    );
    assert.deepEqual(
      classifyPersistedDeployment({
        serviceActive: false,
        request: persisted,
        latest: { requestId: "87654321-4321-4321-4321-cba987654321", result: "SUCCESS" },
      }),
      { state: "PENDING_RECOVERABLE", requestId: request.requestId },
    );
    assert.deepEqual(
      classifyPersistedDeployment({
        serviceActive: false,
        request: persisted,
        latest: { requestId: request.requestId, deploymentId: "finished-id", result: "FAILED" },
      }),
      { state: "FAILED", deploymentId: "finished-id" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("treats every in-progress systemd oneshot state as running", () => {
  for (const state of ["activating", "active", "reloading", "deactivating"]) {
    assert.equal(isSystemdServiceInProgress(state), true, `${state} must remain in progress`);
  }
  for (const state of ["inactive", "failed", "dead", ""]) {
    assert.equal(isSystemdServiceInProgress(state), false, `${state || "empty"} must be terminal`);
  }
});

test("plans safe recovery after a runner interruption before or after cutover", () => {
  const requestId = "12345678-1234-1234-1234-123456789abc";
  const prior = {
    requestId,
    result: "RUNNING",
    releasePath: "/opt/lumina-crm/releases/20260728T123456Z-abcdef123456",
    previousRelease: "/opt/lumina-crm/releases/20260728T113456Z-111111111111",
    migrationApplied: true,
  };
  assert.deepEqual(
    planInterruptedRecovery({ requestId, prior, currentRelease: prior.previousRelease }),
    { action: "CLEANUP_THEN_RESUME", failedRelease: prior.releasePath, migrationMayHaveChanged: true },
  );
  assert.deepEqual(
    planInterruptedRecovery({ requestId, prior, currentRelease: prior.releasePath }),
    {
      action: "ROLLBACK_THEN_RESUME",
      failedRelease: prior.releasePath,
      previousRelease: prior.previousRelease,
      migrationMayHaveChanged: true,
    },
  );
  assert.throws(
    () => planInterruptedRecovery({
      requestId,
      prior: { ...prior, previousRelease: null },
      currentRelease: prior.releasePath,
    }),
    /no recorded previous release/,
  );
});

test("repository dry-run assets keep the lock, least privilege, and loopback binding", async () => {
  const [serviceUnit, sudoers, webUnit, runner, packageJson] = await Promise.all([
    readFile(new URL("../deploy/systemd/lumina-crm-deploy.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/sudoers/lumina-crm-deploy", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/lumina-crm.service", import.meta.url), "utf8"),
    readFile(new URL("../scripts/deploy-production-runner.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(validateDeployAssetTexts({ serviceUnit, sudoers, webUnit, runner, packageJson }), true);
  assert.equal(PRODUCTION_DEPLOY_LOCK_PATH, "/var/lib/lumina-crm/deploy.lock");
  assert.doesNotMatch(serviceUnit, /\/var\/lock\/|ReadWritePaths=.*\.lock/);
  const rebootFragileUnit = serviceUnit
    .replaceAll(PRODUCTION_DEPLOY_LOCK_PATH, "/var/lock/lumina-crm-deploy.lock")
    .replace(
      "ReadWritePaths=/opt/lumina-crm /var/lib/lumina-crm /var/log/lumina-crm",
      "ReadWritePaths=/opt/lumina-crm /var/lib/lumina-crm /var/log/lumina-crm /var/lock/lumina-crm-deploy.lock",
    );
  assert.throws(
    () => validateDeployAssetTexts({ serviceUnit: rebootFragileUnit, sudoers, webUnit, runner, packageJson }),
    /StateDirectory|volatile lock file/,
  );
  assert.throws(
    () => validateDeployAssetTexts({ serviceUnit, sudoers, webUnit, runner, packageJson: { ...packageJson, allowScripts: {} } }),
    /install-script allowlist/,
  );
  assert.doesNotMatch(`${serviceUnit}\n${sudoers}\n${runner}`, /cloudflared|hunterai|docker|v2raya/i);
});
