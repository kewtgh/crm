import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertHealthPayload,
  assertDeploymentDiskCapacity,
  assertLoopbackListener,
  assertPathWithin,
  assertProxyFreeEnvironment,
  assertReleasePath,
  assertSystemdRuntime,
  atomicSwitchCurrent,
  classifyPersistedDeployment,
  cleanupFailedRelease,
  collectSecretValues,
  diskSnapshotFromStatfs,
  directRuntimeEnvironment,
  GITHUB_PULL_PROXY_URL,
  githubPullArguments,
  isSystemdServiceInProgress,
  makeDeploymentId,
  makeReleaseId,
  parseEnvironmentText,
  parseDeploymentStoragePolicy,
  planReleasesForCleanup,
  planInterruptedRecovery,
  PRODUCTION_DEPLOY_LOCK_PATH,
  redactSecrets,
  retryHealth,
  rollbackAfterCutover,
  runNonFatalCleanup,
  selectReleasesForCleanup,
  validateDirectoryMetadata,
  validateEnvironmentFileMetadata,
  validateEnvironmentKeyPolicy,
  validateRequiredEnvironment,
  writeExclusiveRequest,
} from "../scripts/lib/production-deploy-core.mjs";
import {
  assertAllowedDockerArguments,
  LUMINA_COMPOSE_PROJECT,
  LUMINA_MANAGED_LABEL,
  LUMINA_REPOSITORY_LABEL,
  LUMINA_REPOSITORY_VALUE,
  selectLuminaImageCandidates,
} from "../deploy/libexec/lumina-crm-storage-maintenance.mjs";

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
      { MIGRATION_DATABASE_URL: "postgresql://crm_migrator:secret@127.0.0.1/crm", NODE_OPTIONS: "--inspect" },
      { label: "deploy.env", allowed: ["MIGRATION_DATABASE_URL"] },
    ),
    /NODE_OPTIONS/,
  );
});

test("blocks deployment unless root, Docker, and release filesystems satisfy byte and percentage gates", () => {
  const policy = parseDeploymentStoragePolicy({
    LUMINA_DOCKER_DATA_ROOT: "/srv/docker",
    LUMINA_DEPLOY_MIN_FREE_PERCENT: "15",
    LUMINA_ROOT_MIN_FREE_GB: "8",
    LUMINA_DOCKER_MIN_FREE_GB: "10",
    LUMINA_RELEASE_MIN_FREE_GB: "8",
    LUMINA_RELEASE_RETENTION: "5",
    LUMINA_FAILED_RELEASE_RETENTION_HOURS: "24",
    LUMINA_BUILDKIT_CACHE_RETENTION_HOURS: "168",
    LUMINA_BUILDKIT_MAX_CACHE_GB: "12",
    LUMINA_BUILDKIT_RESERVED_CACHE_GB: "2",
  });
  assert.equal(policy.dockerDataRoot, path.resolve("/srv/docker"));
  const healthy = diskSnapshotFromStatfs({
    label: "Docker data root",
    path: policy.dockerDataRoot,
    minimumAvailableBytes: 10 * 1024 ** 3,
    minimumFreePercent: 15,
  }, { blocks: 100, bavail: 20, bsize: 1024 ** 3 });
  assert.equal(healthy.freePercent, 20);
  assert.doesNotThrow(() => assertDeploymentDiskCapacity([healthy]));
  assert.throws(
    () => assertDeploymentDiskCapacity([{ ...healthy, availableBytes: 9 * 1024 ** 3 }]),
    /LUMINA_DEPLOY_DISK_GATE_FAILED.*Docker data root.*requires at least/,
  );
  assert.throws(
    () => parseDeploymentStoragePolicy({
      LUMINA_BUILDKIT_MAX_CACHE_GB: "4",
      LUMINA_BUILDKIT_RESERVED_CACHE_GB: "4",
    }),
    /must be lower/,
  );
});

test("keeps every non-Git deployment stage free of proxy environment", () => {
  const direct = directRuntimeEnvironment({
    PATH: "/usr/bin",
    HOME: "/var/lib/lumina-crm",
    HTTP_PROXY: "http://127.0.0.1:20271",
    https_proxy: "http://127.0.0.1:10808",
    FTP_PROXY: "http://127.0.0.1:20271",
    GLOBAL_AGENT_HTTP_PROXY: "http://proxy.invalid",
    NO_PROXY: "127.0.0.1",
    LUMINA_HTTPS_PROXY: "http://proxy.invalid",
    NODE_OPTIONS: "--import=/opt/lumina-crm/runtime-proxy/register-proxy.mjs",
    NODE_ENV: "production",
  });
  assert.deepEqual(direct, {
    PATH: "/usr/bin",
    HOME: "/var/lib/lumina-crm",
    NODE_ENV: "production",
  });
  assert.equal(assertProxyFreeEnvironment(direct, "test stage"), true);
  assert.throws(
    () => assertProxyFreeEnvironment({ HTTPS_PROXY: "http://127.0.0.1:20271" }, "test stage"),
    /HTTPS_PROXY/,
  );
  assert.throws(
    () => assertProxyFreeEnvironment({ THIRD_PARTY_PROXY: "http://proxy.invalid" }, "test stage"),
    /THIRD_PARTY_PROXY/,
  );
  assert.throws(
    () => assertProxyFreeEnvironment({ NODE_OPTIONS: "--import=register-proxy.mjs" }, "test stage"),
    /NODE_OPTIONS/,
  );
});

test("uses the loopback proxy only as temporary configuration on GitHub pull", () => {
  const args = githubPullArguments();
  assert.deepEqual(args.slice(-4), ["pull", "--ff-only", "origin", "main"]);
  assert.equal(args[0], "-c");
  assert.match(args[1], /^core\.sshCommand=\/usr\/bin\/ssh /);
  assert.match(args[1], /\/usr\/bin\/nc -X connect -x 127\.0\.0\.1:20271/);
  assert.equal(GITHUB_PULL_PROXY_URL, "http://127.0.0.1:20271");
  assert.throws(
    () => githubPullArguments({ proxyUrl: "http://proxy.example:8080" }),
    /loopback/,
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
  let failureClock = 0;
  await assert.rejects(
    () => retryHealth({
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          failureReasons: [
            { component: "auth", code: "AUTH_HEALTH_TIMEOUT" },
            { component: "database", code: "DATABASE_READINESS_RPC_ERROR" },
          ],
        }),
      }),
      url: "http://127.0.0.1:3200/api/health?mode=ready",
      expectedVersion: "2.8.0",
      readiness: true,
      timeoutMs: 1,
      now: () => failureClock,
      sleep: async (milliseconds) => { failureClock += milliseconds; },
    }),
    /auth:AUTH_HEALTH_TIMEOUT.*database:DATABASE_READINESS_RPC_ERROR/,
  );
});

test("requires port 3200 to listen only on IPv4 loopback", () => {
  assert.equal(assertLoopbackListener("LISTEN 0 511 127.0.0.1:3200 0.0.0.0:*"), true);
  assert.throws(() => assertLoopbackListener("LISTEN 0 511 0.0.0.0:3200 0.0.0.0:*"), /non-loopback/);
  assert.throws(() => assertLoopbackListener("LISTEN 0 511 [::]:3200 [::]:*"), /non-loopback/);
});

test("requires effective systemd hostname, direct runtime, worker result, and timer state", () => {
  const environment = "NODE_ENV=production";
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
    worker: { ...input.worker, Environment: "HTTPS_PROXY=http://127.0.0.1:20271" },
  }), /must not contain proxy/);
  assert.throws(() => assertSystemdRuntime({
    ...input,
    web: { ...input.web, Environment: "THIRD_PARTY_PROXY=http://proxy.invalid" },
  }), /must not contain proxy/);
  assert.throws(() => assertSystemdRuntime({
    ...input,
    timer: { ...input.timer, SubState: "elapsed" },
  }), /waiting/);
});

test("release cleanup protects rollback set and recent successes while expiring old failed residue", () => {
  const root = path.resolve("release-retention");
  const names = [
    "20260728T100000Z-aaaaaaaaaaaa",
    "20260728T110000Z-bbbbbbbbbbbb",
    "20260728T120000Z-cccccccccccc",
    "20260728T130000Z-dddddddddddd",
    "20260728T140000Z-eeeeeeeeeeee",
    "20260728T150000Z-ffffffffffff",
  ];
  const entries = names.map((name, index) => ({
    path: path.join(root, name),
    mtimeMs: index * 1_000,
    successful: true,
  }));
  const failedOld = {
    path: path.join(root, "20260728T160000Z-121212121212"),
    mtimeMs: 1_000,
    successful: false,
  };
  const failedRecent = {
    path: path.join(root, "20260728T170000Z-131313131313"),
    mtimeMs: 99_000,
    successful: false,
  };
  const current = entries[5].path;
  const previous = entries[1].path;
  const active = entries[4].path;
  const plan = planReleasesForCleanup([...entries, failedOld, failedRecent], {
    releasesRoot: root,
    currentRelease: current,
    previousRelease: previous,
    activeRelease: active,
    retain: 2,
    failedRetentionMs: 10_000,
    nowMs: 100_000,
  });
  const removals = plan.map((entry) => entry.path);
  assert(!removals.includes(current));
  assert(!removals.includes(previous));
  assert(!removals.includes(active));
  assert(removals.includes(entries[0].path));
  assert.deepEqual(plan.find((entry) => entry.path === failedOld.path), {
    path: failedOld.path,
    reason: "failed-residue",
  });
  assert(!removals.includes(failedRecent.path));
  assert.deepEqual(selectReleasesForCleanup(entries, {
    releasesRoot: root,
    currentRelease: current,
    previousRelease: previous,
    activeRelease: active,
    retain: 2,
  }), planReleasesForCleanup(entries, {
    releasesRoot: root,
    currentRelease: current,
    previousRelease: previous,
    activeRelease: active,
    retain: 2,
  }).map((entry) => entry.path));
});

test("Docker cleanup candidates require every Lumina identity and protect active/recent images", () => {
  const imageId = (character) => `sha256:${character.repeat(64)}`;
  const luminaLabels = {
    [LUMINA_MANAGED_LABEL]: "true",
    [LUMINA_REPOSITORY_LABEL]: LUMINA_REPOSITORY_VALUE,
    "com.docker.compose.project": LUMINA_COMPOSE_PROJECT,
  };
  const image = (id, created, overrides = {}) => ({
    Id: imageId(id),
    Created: created,
    Size: 100,
    RepoTags: [`ghcr.io/kewtgh/lumina-crm:${id.repeat(40)}`],
    Config: { Labels: luminaLabels },
    ...overrides,
  });
  const newest = image("a", "2026-07-30T00:00:00.000Z");
  const rollback = image("b", "2026-07-29T00:00:00.000Z");
  const activeOld = image("c", "2026-07-01T00:00:00.000Z");
  const removable = image("d", "2026-06-01T00:00:00.000Z");
  const protectedRollback = image("9", "2026-05-15T00:00:00.000Z");
  const hunter = image("e", "2026-05-01T00:00:00.000Z", {
    RepoTags: ["hunterai/service:old"],
    Config: {
      Labels: {
        ...luminaLabels,
        [LUMINA_REPOSITORY_LABEL]: "hunterai/service",
        "com.docker.compose.project": "hunterai",
      },
    },
  });
  const temporalWithPartialSpoof = image("f", "2026-05-01T00:00:00.000Z", {
    RepoTags: ["temporal/server:old"],
    Config: { Labels: { [LUMINA_MANAGED_LABEL]: "true" } },
  });
  const candidates = selectLuminaImageCandidates([
    newest,
    rollback,
    activeOld,
    removable,
    protectedRollback,
    hunter,
    temporalWithPartialSpoof,
  ], {
    inUseIds: new Set([activeOld.Id]),
    protectedTags: new Set(protectedRollback.RepoTags),
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    minimumAgeMs: 7 * 24 * 60 * 60 * 1_000,
    retain: 2,
  });
  assert.deepEqual(candidates.map((entry) => entry.Id), [removable.Id]);
});

test("Docker maintenance allowlist rejects host-global and non-Lumina destructive commands", () => {
  assert.equal(assertAllowedDockerArguments(["info", "--format", "{{.DockerRootDir}}"]), true);
  assert.equal(assertAllowedDockerArguments(["container", "ls", "--all", "--quiet"]), true);
  for (const args of [
    ["system", "prune", "-a"],
    ["system", "prune", "--volumes"],
    ["image", "prune", "-a"],
    ["volume", "prune"],
    ["network", "prune"],
    ["container", "rm", "abcdef123456"],
    ["buildx", "--builder", "lumina-crm-buildkit", "prune", "--all"],
    ["image", "ls", "--quiet"],
  ]) {
    assert.throws(() => assertAllowedDockerArguments(args), /Forbidden Docker command|outside the Lumina/);
  }
});

test("post-success cleanup failure is non-fatal", async () => {
  const failures = [];
  const result = await runNonFatalCleanup(
    async () => { throw new Error("simulated cleanup failure"); },
    async (error) => failures.push(error.message),
  );
  assert.deepEqual(result, { ok: false, error: "simulated cleanup failure" });
  assert.deepEqual(failures, ["simulated cleanup failure"]);
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
  assert.deepEqual(
    planInterruptedRecovery({
      requestId,
      prior: { ...prior, applicationAccepted: true },
      currentRelease: prior.releasePath,
    }),
    {
      action: "FINALIZE_ACCEPTED",
      acceptedRelease: prior.releasePath,
      migrationMayHaveChanged: true,
    },
  );
});

test("production Compose assets keep project, role, network, volume, proxy and cleanup boundaries", async () => {
  const [
    compose,
    dockerfile,
    serviceUnit,
    sudoers,
    productionEnvironment,
    workerEnvironment,
    migrationEnvironment,
    backupEnvironment,
    deploymentEnvironment,
    runner,
    storagePrepareUnit,
    storageCleanupUnit,
    storageMaintenance,
    buildkitConfiguration,
    volumeProvisioning,
    caddy,
    cloudflareWorker,
    containerEntrypoint,
    databaseBootstrap,
    databaseMigrate,
    backup,
    restore,
    packageJson,
  ] = await Promise.all([
    readFile(new URL("../compose.production.yml", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/lumina-crm-deploy.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/sudoers/lumina-crm-deploy", import.meta.url), "utf8"),
    readFile(new URL("../deploy/production.env.example", import.meta.url), "utf8"),
    readFile(new URL("../deploy/worker.env.example", import.meta.url), "utf8"),
    readFile(new URL("../deploy/migration.env.example", import.meta.url), "utf8"),
    readFile(new URL("../deploy/backup.env.example", import.meta.url), "utf8"),
    readFile(new URL("../deploy/deploy.env.example", import.meta.url), "utf8"),
    readFile(new URL("../scripts/deploy-production-runner.mjs", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/lumina-crm-storage-prepare.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/lumina-crm-storage-cleanup.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/libexec/lumina-crm-storage-maintenance.mjs", import.meta.url), "utf8"),
    readFile(new URL("../deploy/buildkitd.toml", import.meta.url), "utf8"),
    readFile(new URL("../deploy/scripts/provision-volumes.sh", import.meta.url), "utf8"),
    readFile(new URL("../deploy/caddy/Caddyfile", import.meta.url), "utf8"),
    readFile(new URL("../deploy/cloudflare-worker/src/index.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/container-entrypoint.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/db-bootstrap.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/db-migrate.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/db-backup.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/db-restore-test.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.match(compose, /^name: \$\{LUMINA_COMPOSE_PROJECT:-lumina-crm\}$/m);
  assert.match(compose, /image: postgres:18\.4-bookworm/);
  assert.match(compose, /"\$\{LUMINA_WEB_BIND:-127\.0\.0\.1:3200\}:3200"/);
  assert.match(compose, /backend:\s*\n\s+name:.*\n\s+internal: true/);
  assert.doesNotMatch(compose.match(/postgres:[\s\S]+?\n  web:/)?.[0] ?? "", /\n\s+ports:/);
  for (const service of ["postgres", "web", "worker"]) {
    const section = compose.match(new RegExp(`\\n  ${service}:[\\s\\S]+?(?=\\n  [a-z-]+:|\\nnetworks:)`))?.[0] ?? "";
    assert.match(section, /restart: unless-stopped/, `${service} restart policy`);
  }
  assert.match(compose, /postgres_data:\s*\n\s+external: true/);
  assert.match(compose, /LUMINA_ENV_FILES: \/run\/secrets\/web_runtime_env/);
  assert.match(compose, /LUMINA_ENV_FILES: \/run\/secrets\/worker_runtime_env/);
  assert.match(dockerfile, /FROM \$\{NODE_IMAGE\} AS application/);
  assert.match(dockerfile, /USER 10001:10001/);
  for (const label of [
    'com.lumina.crm.managed="true"',
    'com.lumina.crm.repository="kewtgh/crm"',
    'com.docker.compose.project="lumina-crm"',
  ]) assert.match(dockerfile, new RegExp(label.replaceAll(".", "\\.")));

  assert.doesNotMatch(productionEnvironment, /WORKER_DATABASE_URL|MIGRATION_DATABASE_URL|BACKUP_DATABASE_URL|DATABASE_ADMIN_URL|ADMIN_PASSWORD/);
  assert.doesNotMatch(workerEnvironment, /^DATABASE_URL=|SYSTEM_DATABASE_URL|MIGRATION_DATABASE_URL|BACKUP_DATABASE_URL|DATABASE_ADMIN_URL/m);
  assert.match(migrationEnvironment, /MIGRATION_DATABASE_URL=postgresql:\/\/crm_migrator:.*@postgres:5432\/lumina_crm/);
  assert.match(backupEnvironment, /BACKUP_DATABASE_URL=postgresql:\/\/crm_backup:.*@postgres:5432\/lumina_crm/);
  assert.doesNotMatch(deploymentEnvironment, /PASSWORD|TOKEN|DATABASE_URL/);
  assert.match(containerEntrypoint, /_CREDENTIAL_BOUNDARY_VIOLATION/);
  assert.match(containerEntrypoint, /\], "WEB"\)/);
  assert.match(containerEntrypoint, /\], "BACKUP"\)/);
  assert.match(databaseBootstrap, /create extension if not exists pgcrypto with schema extensions/i);
  assert.match(databaseBootstrap, /create extension if not exists citext with schema extensions/i);
  assert.match(databaseBootstrap, /create extension if not exists pg_stat_statements with schema extensions/i);
  assert.match(databaseBootstrap, /grant usage on schema extensions to crm_migrator/i);
  assert.match(databaseMigrate, /set local search_path = public, extensions/i);

  assert.equal(PRODUCTION_DEPLOY_LOCK_PATH, "/var/lib/lumina-crm/deploy.lock");
  assert.match(serviceUnit, /flock --nonblock --exclusive/);
  assert.match(serviceUnit, /UnsetEnvironment=HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY/);
  assert.match(storagePrepareUnit, /\/usr\/local\/libexec\/lumina-crm-storage-maintenance\.mjs prepare/);
  assert.match(storageCleanupUnit, /\/usr\/local\/libexec\/lumina-crm-storage-maintenance\.mjs cleanup/);
  assert.doesNotMatch(storageMaintenance, /docker (?:system|image|volume|network) prune/i);
  assert.match(buildkitConfiguration, /keepDuration = "168h"/);
  assert.match(volumeProvisioning, /postgres:18\.4-bookworm/);
  assert.match(volumeProvisioning, /--network none/);
  assert.match(volumeProvisioning, /--cap-add CHOWN/);
  assert.match(volumeProvisioning, /10001:10001 \/data/);
  assert.doesNotMatch(volumeProvisioning, /mount[^\\n]*postgres_volume/);
  for (const contract of [
    /build immutable application image/,
    /verify migration manifest/,
    /apply locked forward migration/,
    /switch Web and Worker images/,
    /loopback readiness/,
    /Cloudflare Worker public liveness/,
  ]) assert.match(runner, contract);
  assert.match(runner, /await buildImages\(target\);[\s\S]+await migrate\(candidateEnv\);[\s\S]+await switchApplication\(candidateEnv\);[\s\S]+await acceptRuntime\(composeEnvPath\)/);
  assert.match(runner, /Application rolled back; database remains on the forward schema/);
  assert.match(storageMaintenance, /current-rollback-or-recent-success/);
  assert.match(storageMaintenance, /imageDecisions/);
  assert.doesNotMatch(`${serviceUnit}\n${sudoers}\n${runner}\n${compose}`, /hunterai|temporal|v2raya/i);

  assert.match(caddy, /X-Lumina-Origin-Auth/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3200/);
  assert.match(caddy, /header_up -X-Forwarded-For/);
  assert.match(cloudflareWorker, /headers\.delete\(INTERNAL_AUTH_HEADER\)|untrustedForwardingHeaders/);
  assert.match(cloudflareWorker, /cacheEverything: false/);
  assert.match(backup, /--format=custom/);
  assert.match(backup, /encryptBackup/);
  assert.match(backup, /BACKUP_LOCAL_OBJECTS/);
  assert.match(backup, /await upload\(objectKey[\s\S]+await notify\("SUCCEEDED"/);
  assert.match(restore, /lumina_restore_/);
  assert.match(restore, /--exit-on-error/);
  assert.match(restore, /drop database if exists/);

  const executableAssets = `${runner}\n${storageMaintenance}\n${compose}\n${serviceUnit}\n${sudoers}`;
  assert.doesNotMatch(executableAssets, /docker\s+system\s+prune|docker\s+image\s+prune\s+-a|docker\s+volume\s+prune|compose\s+down\s+-v/i);
  assert.equal(packageJson.version, "3.7.0");
});
