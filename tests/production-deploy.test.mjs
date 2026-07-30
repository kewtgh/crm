import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertPathWithin,
  classifyPersistedDeployment,
  isSystemdServiceInProgress,
  PRODUCTION_DEPLOY_LOCK_PATH,
  validatePendingRequestForRecovery,
  validateDirectoryMetadata,
  writeExclusiveRequest,
} from "../scripts/lib/production-deploy-core.mjs";
import {
  assertRootlessDockerHost,
  assertRootlessDockerInfo,
  expectedRootlessDockerHost,
  LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
} from "../scripts/lib/rootless-docker.mjs";
import { updateProductionSource } from "../scripts/lib/git-source-update.mjs";
import {
  acceptedReleaseMatchesRequest,
  assertReleaseModeAllowed,
  createAcceptedRelease,
  extractSensitiveEnvironmentValues,
  ProductionReleaseWorkflowError,
  redactDeploymentSecrets,
  releaseFailureRollbackPlan,
  runProductionReleaseWorkflow,
} from "../scripts/lib/production-deploy-workflow.mjs";
import {
  backupRetentionPolicy,
  matchingEncryptedObjectsPath,
} from "../scripts/lib/backup-policy.mjs";
import {
  assertAllowedDockerArguments,
  builderCreateArguments,
  dockerEnvironment,
  dockerProxyMarkerContract,
  ensureCanonicalDockerConfigDirectory,
  LUMINA_BUILDX_CONFIG_ROOT,
  LUMINA_DOCKER_CONFIG_ROOT,
  parseDockerProxy,
  redactMaintenance,
  selectLuminaImageCandidates,
  validateBuilderMarker,
} from "../deploy/libexec/lumina-crm-storage-maintenance.mjs";
import {
  DOCKER_BUILD_PROXY_KEYS,
  dockerBuildEnvironment,
  dockerBuildProxyArguments,
  parseDockerBuildProxy,
} from "../scripts/lib/docker-build-proxy.mjs";

const repositoryFile = (value) => new URL(`../${value}`, import.meta.url);
const source = (value) => readFile(repositoryFile(value), "utf8");

function sourceGitDouble({ fetchError } = {}) {
  const calls = [];
  const commit = "a".repeat(40);
  const git = async (label, args, options = {}) => {
    calls.push({
      label,
      args: [...args],
      options: {
        ...options,
        environment: options.environment ? { ...options.environment } : undefined,
      },
    });
    if (args[0] === "branch") return { stdout: "main" };
    if (args[0] === "remote") return { stdout: "git@github.com:kewtgh/crm.git" };
    if (args[0] === "status") return { stdout: "" };
    if (args[0] === "fetch") {
      if (fetchError) throw fetchError;
      return { stdout: "" };
    }
    if (args[0] === "merge") return { stdout: "Already up to date." };
    if (args[0] === "rev-parse") return { stdout: commit };
    throw new Error(`Unexpected Git invocation: ${args.join(" ")}`);
  };
  return { calls, commit, git };
}

function releaseWorkflowDouble({ failAt } = {}) {
  const calls = [];
  const target = {
    commit: "a".repeat(40),
    version: "3.8.2",
    currentImage: `lumina-crm:${"a".repeat(40)}`,
    operationsImage: `lumina-crm-ops:${"a".repeat(40)}`,
  };
  const operation = (name, result) => async () => {
    calls.push(name);
    if (failAt === name) throw new Error(`failed at ${name}`);
    return result;
  };
  return {
    calls,
    target,
    operations: {
      prepare: operation("prepare"),
      updateSource: operation("fetch", target.commit),
      resolveTarget: operation("resolve-target", target),
      buildImages: operation("build"),
      writeCandidateEnvironment: operation("candidate-env", "candidate.env"),
      startPostgres: operation("postgres"),
      bootstrapDatabase: operation("db-bootstrap"),
      verifyMigrations: operation("migration-verify"),
      markMigrationMayHaveChanged: operation("migration-may-have-changed"),
      migrate: operation("migrate"),
      bootstrapAdmin: operation("bootstrap-admin"),
      switchApplication: operation("switch"),
      acceptRuntime: operation("acceptance"),
    },
  };
}

test("keeps controller paths and request state inside exact deployment roots", async () => {
  const root = path.resolve("deployment-state");
  assert.equal(
    assertPathWithin(root, path.join(root, "latest.log"), {
      directChild: true,
      label: "Deployment log",
    }),
    path.join(root, "latest.log"),
  );
  assert.throws(
    () => assertPathWithin(root, path.join(root, "..", "outside")),
    /stay below/,
  );
  assert.throws(
    () => assertPathWithin(root, path.join(root, "nested", "log"), { directChild: true }),
    /direct child/,
  );
  assert.equal(validateDirectoryMetadata({
    isDirectory: () => true,
    isSymbolicLink: () => false,
  }), true);
  assert.throws(() => validateDirectoryMetadata({
    isDirectory: () => true,
    isSymbolicLink: () => true,
  }), /not a symlink/);

  const directory = await mkdtemp(path.join(os.tmpdir(), "lumina-deploy-test-"));
  const requestPath = path.join(directory, "request.json");
  const request = { requestId: "12345678-1234-1234-1234-123456789abc", mode: "deploy" };
  try {
    await writeExclusiveRequest({ writeFile }, requestPath, request);
    await assert.rejects(
      () => writeExclusiveRequest({ writeFile }, requestPath, request),
      /already pending or running/,
    );
    assert.deepEqual(
      classifyPersistedDeployment({
        serviceActive: false,
        request,
        latest: { requestId: request.requestId, deploymentId: "finished", result: "FAILED" },
      }),
      { state: "FAILED", deploymentId: "finished" },
    );
    assert.deepEqual(
      classifyPersistedDeployment({ serviceActive: false, request, latest: null }),
      { state: "PENDING_RECOVERABLE", requestId: request.requestId },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("classifies every active systemd oneshot state and fixed deployment lock", () => {
  assert.equal(PRODUCTION_DEPLOY_LOCK_PATH, "/var/lib/lumina-crm/deploy.lock");
  for (const state of ["activating", "active", "reloading", "deactivating"]) {
    assert.equal(isSystemdServiceInProgress(state), true);
  }
  for (const state of ["inactive", "failed", "dead", ""]) {
    assert.equal(isSystemdServiceInProgress(state), false);
  }
});

test("initialize follows the explicit first-install order", async () => {
  const { calls, operations } = releaseWorkflowDouble();
  const result = await runProductionReleaseWorkflow({ mode: "initialize", operations });
  assert.deepEqual(calls, [
    "prepare",
    "fetch",
    "resolve-target",
    "build",
    "candidate-env",
    "postgres",
    "db-bootstrap",
    "migration-verify",
    "migration-may-have-changed",
    "migrate",
    "bootstrap-admin",
    "switch",
    "acceptance",
  ]);
  assert.equal(result.migrationMayHaveChanged, true);
  assert.equal(result.switched, true);
});

test("exposes initialize through package scripts, controller help, and the runbook", async () => {
  const [packageText, controller, runbook] = await Promise.all([
    source("package.json"),
    source("scripts/deploy-production.mjs"),
    source("docs/DEPLOYMENT.md"),
  ]);
  const packageJson = JSON.parse(packageText);
  assert.equal(
    packageJson.scripts["deploy:production:initialize"],
    "node scripts/deploy-production.mjs initialize",
  );
  assert.equal(
    packageJson.scripts["deploy:production:initialize:detach"],
    "node scripts/deploy-production.mjs initialize --detach",
  );
  assert.match(controller, /npm run deploy:production:initialize/);
  assert.match(controller, /await start\("initialize"/);
  assert.match(runbook, /Initialization is explicit and is never inferred/);
});

test("initialize never reaches migration before db-bootstrap succeeds", async () => {
  const { calls, operations } = releaseWorkflowDouble({ failAt: "db-bootstrap" });
  await assert.rejects(
    () => runProductionReleaseWorkflow({ mode: "initialize", operations }),
    ProductionReleaseWorkflowError,
  );
  assert.equal(calls.includes("migrate"), false);
  assert.ok(calls.indexOf("postgres") < calls.indexOf("db-bootstrap"));
});

test("first initialize acceptance records explicit mode and null rollback images", () => {
  const request = {
    requestId: "12345678-1234-1234-1234-123456789abc",
    mode: "initialize",
  };
  const { target } = releaseWorkflowDouble();
  const accepted = createAcceptedRelease({
    deploymentId: "initialize-release",
    request,
    target,
    previousAccepted: null,
    acceptedAt: "2026-07-30T12:00:00.000Z",
  });
  assert.equal(accepted.mode, "initialize");
  assert.equal(accepted.requestId, request.requestId);
  assert.equal(accepted.rollbackCommit, null);
  assert.equal(accepted.rollbackVersion, null);
  assert.equal(accepted.rollbackImage, null);
  assert.equal(accepted.rollbackOperationsImage, null);
});

test("release mode gates fail closed before build or database work", () => {
  const work = [];
  assert.throws(
    () => assertReleaseModeAllowed({
      mode: "initialize",
      acceptedStateExists: true,
      acceptedRelease: { currentImage: "lumina-crm:accepted" },
    }),
    /last-success\.json already exists/,
  );
  assert.throws(
    () => assertReleaseModeAllowed({
      mode: "deploy",
      acceptedStateExists: false,
      acceptedRelease: null,
    }),
    /npm run deploy:production:initialize/,
  );
  assert.deepEqual(work, []);
});

test("ordinary deploy migrates but never runs either initialization bootstrap", async () => {
  const { calls, operations } = releaseWorkflowDouble();
  await runProductionReleaseWorkflow({ mode: "deploy", operations });
  assert.equal(calls.includes("db-bootstrap"), false);
  assert.equal(calls.includes("bootstrap-admin"), false);
  assert.ok(calls.indexOf("migration-verify") < calls.indexOf("migrate"));
  assert.ok(calls.indexOf("migrate") < calls.indexOf("switch"));
});

test("initialize failures retain forward-only migration and rollback semantics", async (t) => {
  const cases = [
    {
      name: "before db-bootstrap",
      failAt: "postgres",
      migrationMayHaveChanged: false,
      switched: false,
      rollback: null,
    },
    {
      name: "after db-bootstrap and before migrate",
      failAt: "migration-verify",
      migrationMayHaveChanged: false,
      switched: false,
      rollback: null,
    },
    {
      name: "after migrate and before switch",
      failAt: "bootstrap-admin",
      migrationMayHaveChanged: true,
      switched: false,
      rollback: null,
    },
    {
      name: "after switch",
      failAt: "acceptance",
      migrationMayHaveChanged: true,
      switched: true,
      rollback: {
        status: "UNAVAILABLE",
        reason: "No accepted application image exists",
      },
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { operations } = releaseWorkflowDouble({ failAt: scenario.failAt });
      await assert.rejects(
        () => runProductionReleaseWorkflow({ mode: "initialize", operations }),
        (error) => {
          assert.equal(error.migrationMayHaveChanged, scenario.migrationMayHaveChanged);
          assert.equal(error.switched, scenario.switched);
          assert.deepEqual(
            releaseFailureRollbackPlan({
              switched: error.switched,
              previousAccepted: null,
            }),
            scenario.rollback,
          );
          return true;
        },
      );
    });
  }
  assert.deepEqual(
    releaseFailureRollbackPlan({
      switched: true,
      previousAccepted: {
        currentImage: "lumina-crm:previous",
        operationsImage: "lumina-crm-ops:previous",
      },
    }),
    { status: "REQUIRED" },
  );
});

test("an interrupted initialize recovers the same request and safely repeats its steps", async () => {
  const request = {
    requestId: "12345678-1234-1234-1234-123456789abc",
    mode: "initialize",
    requestedAt: "2026-07-30T11:00:00.000Z",
  };
  assert.strictEqual(
    validatePendingRequestForRecovery({
      request,
      mode: "initialize",
      nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    }),
    request,
  );
  const first = releaseWorkflowDouble();
  const second = releaseWorkflowDouble();
  await runProductionReleaseWorkflow({ mode: "initialize", operations: first.operations });
  await runProductionReleaseWorkflow({ mode: "initialize", operations: second.operations });
  assert.deepEqual(second.calls, first.calls);

  const acceptedRelease = createAcceptedRelease({
    deploymentId: "accepted-before-interruption",
    request,
    target: first.target,
    previousAccepted: null,
    acceptedAt: "2026-07-30T12:00:00.000Z",
  });
  assert.equal(acceptedReleaseMatchesRequest({
    request,
    priorLatest: {
      requestId: request.requestId,
      targetImage: first.target.currentImage,
      applicationAccepted: false,
    },
    acceptedRelease,
  }), true);
});

test("deployment logs and JSON state redact every configured secret boundary", () => {
  const environment = `
ADMIN_PASSWORD=temporary-admin-password
DATABASE_ADMIN_URL=postgresql://postgres:superuser-password@postgres:5432/lumina_crm
CRM_APP_DB_PASSWORD=application-role-password
CRM_SYSTEM_DB_PASSWORD=system-role-password
CRM_WORKER_DB_PASSWORD=worker-role-password
CRM_MIGRATOR_DB_PASSWORD=migrator-role-password
CRM_BACKUP_DB_PASSWORD=backup-role-password
TURNSTILE_SECRET_KEY=turnstile-secret-value
EMAIL_DELIVERY_WEBHOOK_TOKEN=mail-delivery-token
BACKUP_ENCRYPTION_KEY=backup-encryption-key
`;
  const secrets = extractSensitiveEnvironmentValues(environment);
  const rawError = `command failed: ${secrets.join(" ")}`;
  const safeError = redactDeploymentSecrets(rawError, secrets);
  const acceptedState = createAcceptedRelease({
    deploymentId: "safe-state",
    request: {
      requestId: "12345678-1234-1234-1234-123456789abc",
      mode: "initialize",
    },
    target: releaseWorkflowDouble().target,
    previousAccepted: null,
    acceptedAt: "2026-07-30T12:00:00.000Z",
  });
  const stateJson = JSON.stringify({
    ...acceptedState,
    error: safeError,
    migrationMayHaveChanged: true,
  });
  for (const secret of secrets) {
    assert.equal(safeError.includes(secret), false);
    assert.equal(stateJson.includes(secret), false);
  }
  assert.match(safeError, /\[REDACTED\]/);
});

test("requires the deployment user's exact rootless socket and enforced cgroup limits", () => {
  const uid = 1001;
  const dockerHost = expectedRootlessDockerHost(uid);
  assert.equal(dockerHost, "unix:///run/user/1001/docker.sock");
  assert.equal(assertRootlessDockerHost({ DOCKER_HOST: dockerHost }, uid), dockerHost);
  assert.throws(
    () => assertRootlessDockerHost({ DOCKER_HOST: "unix:///var/run/docker.sock" }, uid),
    /ROOTLESS_DOCKER_HOST_REQUIRED/,
  );
  assert.deepEqual(
    assertRootlessDockerInfo({
      securityOptions: JSON.stringify(["name=seccomp", "name=rootless", "name=cgroupns"]),
      cgroupDriver: "systemd",
      dockerRoot: LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
    }),
    {
      rootless: true,
      cgroupDriver: "systemd",
      dockerRoot: LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
    },
  );
  assert.throws(() => assertRootlessDockerInfo({
    securityOptions: "[]",
    cgroupDriver: "systemd",
    dockerRoot: LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
  }), /ROOTLESS_DOCKER_REQUIRED/);
  assert.throws(() => assertRootlessDockerInfo({
    securityOptions: '["name=rootless"]',
    cgroupDriver: "none",
    dockerRoot: LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
  }), /CGROUP_V2_SYSTEMD_REQUIRED/);
});

test("configured Git proxy is used by the first and only fetch before fast-forward", async () => {
  const configuredProxy = "http://proxy-user:proxy-password@127.0.0.1:20271";
  const messages = [];
  const { calls, commit, git } = sourceGitDouble();
  const result = await updateProductionSource({
    git,
    baseEnvironment: {
      SAFE_MARKER: "preserved",
      LUMINA_GIT_PROXY: configuredProxy,
      HTTP_PROXY: "http://inherited.invalid:1",
      HTTPS_PROXY: "http://inherited.invalid:2",
      ALL_PROXY: "socks5://inherited.invalid:3",
      http_proxy: "http://lowercase.invalid:4",
      https_proxy: "http://lowercase.invalid:5",
      all_proxy: "socks5://lowercase.invalid:6",
    },
    configuredProxy,
    allowedOrigins: new Set(["git@github.com:kewtgh/crm.git"]),
    onConfiguredProxy: () => messages.push("Git fetch is using the configured Git proxy"),
  });

  assert.equal(result, commit);
  const fetches = calls.filter(({ args }) => args[0] === "fetch");
  assert.equal(fetches.length, 1);
  assert.match(fetches[0].label, /configured Git proxy/);
  assert.doesNotMatch(fetches[0].label, /direct/i);
  assert.equal(fetches[0].options.environment.HTTP_PROXY, configuredProxy);
  assert.equal(fetches[0].options.environment.HTTPS_PROXY, configuredProxy);
  assert.equal(fetches[0].options.environment.SAFE_MARKER, "preserved");
  for (const key of [
    "LUMINA_GIT_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ]) {
    assert.equal(Object.hasOwn(fetches[0].options.environment, key), false);
  }
  assert.deepEqual(
    calls.find(({ args }) => args[0] === "merge")?.args,
    ["merge", "--ff-only", "origin/main"],
  );
  assert.equal(messages.join("\n").includes(configuredProxy), false);
});

test("unconfigured Git proxy performs one direct fetch without retry", async () => {
  let proxyAnnouncements = 0;
  const { calls, git } = sourceGitDouble();
  await updateProductionSource({
    git,
    baseEnvironment: {
      HTTP_PROXY: "http://inherited.invalid:1",
      HTTPS_PROXY: "http://inherited.invalid:2",
    },
    configuredProxy: "  ",
    allowedOrigins: new Set(["git@github.com:kewtgh/crm.git"]),
    onConfiguredProxy: () => { proxyAnnouncements += 1; },
  });

  const fetches = calls.filter(({ args }) => args[0] === "fetch");
  assert.equal(fetches.length, 1);
  assert.match(fetches[0].label, /directly/);
  assert.equal(proxyAnnouncements, 0);
  assert.equal(Object.hasOwn(fetches[0].options.environment, "HTTP_PROXY"), false);
  assert.equal(Object.hasOwn(fetches[0].options.environment, "HTTPS_PROXY"), false);
});

test("failed Git fetch is redacted and stops before worktree or deployment changes", async () => {
  const configuredProxy = "http://proxy-user:proxy-password@127.0.0.1:20271";
  const messages = [];
  const { calls, git } = sourceGitDouble({
    fetchError: new Error(`unable to reach ${configuredProxy}`),
  });
  await assert.rejects(
    () => updateProductionSource({
      git,
      baseEnvironment: { LUMINA_GIT_PROXY: configuredProxy },
      configuredProxy,
      allowedOrigins: new Set(["git@github.com:kewtgh/crm.git"]),
      onConfiguredProxy: () => messages.push("Git fetch is using the configured Git proxy"),
    }),
    (error) => {
      assert.match(error.message, /configured Git proxy failed; source update stopped/);
      assert.equal(error.message.includes(configuredProxy), false);
      return true;
    },
  );

  assert.deepEqual(calls.map(({ args }) => args[0]), [
    "branch",
    "remote",
    "status",
    "fetch",
  ]);
  assert.equal(calls.some(({ args }) => args.includes("config")), false);
  assert.equal(messages.join("\n").includes(configuredProxy), false);
});

test("Git proxy production contract is canonical, redacted, and container-isolated", async () => {
  const [
    runner,
    sourceUpdate,
    deploymentController,
    deployEnvironment,
    deploymentDocumentation,
    compose,
    dockerfile,
    productionEnvironment,
    workerEnvironment,
    migrationEnvironment,
    backupEnvironment,
    workflow,
  ] = await Promise.all([
    source("scripts/deploy-production-runner.mjs"),
    source("scripts/lib/git-source-update.mjs"),
    source("scripts/deploy-production.mjs"),
    source("deploy/deploy.env.example"),
    source("docs/DEPLOYMENT.md"),
    source("compose.production.yml"),
    source("Dockerfile"),
    source("deploy/production.env.example"),
    source("deploy/worker.env.example"),
    source("deploy/migration.env.example"),
    source("deploy/backup.env.example"),
    source("scripts/lib/production-deploy-workflow.mjs"),
  ]);

  const productionContract = [
    runner,
    sourceUpdate,
    deploymentController,
    deployEnvironment,
    deploymentDocumentation,
  ].join("\n");
  assert.doesNotMatch(productionContract, /LUMINA_GIT_FALLBACK_PROXY/);
  assert.match(deployEnvironment, /^LUMINA_GIT_PROXY=http:\/\/127\.0\.0\.1:20271$/m);
  assert.match(runner, /configuredGitProxy \? \[configuredGitProxy\] : \[\]/);
  assert.match(runner, /"LUMINA_GIT_PROXY"/);
  assert.match(
    workflow,
    /await operations\.updateSource\(\);[\s\S]+await operations\.buildImages\(target\);/,
  );

  for (const containerInput of [
    compose,
    dockerfile,
    productionEnvironment,
    workerEnvironment,
    migrationEnvironment,
    backupEnvironment,
  ]) {
    assert.doesNotMatch(containerInput, /LUMINA_GIT_PROXY/);
  }
});

test("validates explicit remote and local backup retention and pairs object archives", () => {
  assert.deepEqual(backupRetentionPolicy({}), {
    remoteRetentionDays: 30,
    localRetentionHours: 48,
  });
  assert.deepEqual(backupRetentionPolicy({
    BACKUP_RETENTION_DAYS: "90",
    BACKUP_LOCAL_RETENTION_HOURS: "72",
  }), {
    remoteRetentionDays: 90,
    localRetentionHours: 72,
  });
  assert.throws(
    () => backupRetentionPolicy({ BACKUP_RETENTION_DAYS: "not-a-number" }),
    /BACKUP_RETENTION_DAYS/,
  );
  assert.throws(
    () => backupRetentionPolicy({ BACKUP_LOCAL_RETENTION_HOURS: "8" }),
    /BACKUP_LOCAL_RETENTION_HOURS/,
  );
  assert.equal(
    matchingEncryptedObjectsPath(path.resolve("/backups/lumina-crm-20260730T120000Z.dump.enc")),
    path.resolve("/backups/lumina-crm-20260730T120000Z.objects.tar.enc"),
  );
  assert.throws(
    () => matchingEncryptedObjectsPath("/backups/other.dump.enc"),
    /BACKUP_NAME_INVALID/,
  );
});

test("selects only old, unused, unprotected, exactly labeled Lumina images", () => {
  const image = (id, tag, created, labels = {}) => ({
    Id: `sha256:${id.repeat(64).slice(0, 64)}`,
    RepoTags: [tag],
    Created: created,
    Size: 100,
    Config: {
      Labels: {
        "com.lumina.crm.managed": "true",
        "com.lumina.crm.repository": "kewtgh/crm",
        "com.docker.compose.project": "lumina-crm",
        ...labels,
      },
    },
  });
  const sha = (character) => character.repeat(40);
  const protectedImage = image("a", `lumina-crm:${sha("a")}`, "2026-07-20T00:00:00Z");
  const newest = image("b", `lumina-crm:${sha("b")}`, "2026-07-29T00:00:00Z");
  const secondNewest = image("c", `lumina-crm-ops:${sha("c")}`, "2026-07-28T00:00:00Z");
  const removable = image("d", `lumina-crm:${sha("d")}`, "2026-07-01T00:00:00Z");
  const foreign = image("e", `lumina-crm:${sha("e")}`, "2026-07-01T00:00:00Z", {
    "com.lumina.crm.repository": "foreign/project",
  });
  const selected = selectLuminaImageCandidates(
    [protectedImage, newest, secondNewest, removable, foreign],
    {
      protectedTags: new Set(protectedImage.RepoTags),
      nowMs: Date.parse("2026-07-30T12:00:00Z"),
      minimumAgeMs: 7 * 24 * 60 * 60 * 1000,
      retain: 2,
    },
  );
  assert.deepEqual(selected.map((entry) => entry.Id), [removable.Id]);
});

test("Docker maintenance allowlist rejects host-global destructive commands", () => {
  assert.equal(assertAllowedDockerArguments(["info", "--format", "{{.DockerRootDir}}"]), true);
  assert.equal(assertAllowedDockerArguments(["info", "--format", "{{json .SecurityOptions}}"]), true);
  for (const args of [
    ["system", "prune", "-a"],
    ["image", "prune", "-a"],
    ["volume", "prune"],
    ["network", "prune"],
    ["container", "rm", "abcdef123456"],
    ["buildx", "--builder", "lumina-crm-buildkit", "prune", "--all"],
  ]) {
    assert.throws(
      () => assertAllowedDockerArguments(args),
      /Forbidden Docker command|outside the Lumina/,
    );
  }
});

test("verification build context includes only the deployment contract from docs", async () => {
  const dockerIgnore = (await source(".dockerignore"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(dockerIgnore.includes("docs"), false);
  assert.equal(dockerIgnore.includes("docs/*"), true);
  assert.equal(dockerIgnore.includes("!docs/DEPLOYMENT.md"), true);
  assert.deepEqual(
    dockerIgnore.filter((line) => line.startsWith("!docs/")),
    ["!docs/DEPLOYMENT.md"],
  );
});

test("optional Docker proxy accepts only credential-free HTTP(S) URLs", () => {
  for (const parse of [parseDockerProxy, parseDockerBuildProxy]) {
    assert.equal(parse(undefined), "");
    assert.equal(parse("  "), "");
    assert.equal(parse("http://proxy.example.invalid:8080"), "http://proxy.example.invalid:8080");
    assert.equal(parse("https://proxy.example.invalid/build"), "https://proxy.example.invalid/build");
    for (const value of [
      "socks5://proxy.example.invalid:1080",
      "http://user@proxy.example.invalid",
      "http://user:password@proxy.example.invalid",
      "http://proxy.example.invalid?mode=build",
      "http://proxy.example.invalid#build",
      "proxy.example.invalid:8080",
    ]) assert.throws(() => parse(value), /LUMINA_DOCKER_PROXY_INVALID/);
  }
});

test("BuildKit builder proxy options are exact, allowlisted, and marker-safe", () => {
  const proxy = "http://proxy.example.invalid:8080";
  const direct = builderCreateArguments("");
  assert.equal(assertAllowedDockerArguments(direct), true);
  assert.equal(direct.includes("--driver-opt"), false);

  const proxied = builderCreateArguments(proxy);
  assert.equal(assertAllowedDockerArguments(proxied), true);
  assert.deepEqual(proxied.slice(8), DOCKER_BUILD_PROXY_KEYS.flatMap((key) => [
    "--driver-opt", `env.${key}=${proxy}`,
  ]));
  assert.throws(() => assertAllowedDockerArguments([
    ...proxied,
    "--driver-opt", "network=host",
  ]), (error) => {
    assert.match(error.message, /outside the Lumina maintenance allowlist/);
    assert.doesNotMatch(error.message, /proxy\.example\.invalid|8080/);
    assert.match(error.message, /env\.HTTP_PROXY=\[REDACTED\]/);
    return true;
  });

  const fingerprint = "a".repeat(64);
  const proxyContract = dockerProxyMarkerContract(proxy);
  const marker = {
    owner: "kewtgh/crm",
    builder: "lumina-crm-buildkit",
    configSha256: fingerprint,
    dockerProxyEnabled: proxyContract.enabled,
    dockerProxySha256: proxyContract.sha256,
  };
  assert.equal(JSON.stringify(marker).includes(proxy), false);
  assert.equal(validateBuilderMarker(marker, { fingerprint, dockerProxy: proxy }), true);
  assert.throws(
    () => validateBuilderMarker(marker, { fingerprint, dockerProxy: "" }),
    /LUMINA_BUILDKIT_PROXY_CONFIGURATION_MISMATCH/,
  );
  assert.equal(validateBuilderMarker({
    owner: "kewtgh/crm",
    builder: "lumina-crm-buildkit",
    configSha256: fingerprint,
  }, { fingerprint, dockerProxy: "" }), true);
});

test("only buildx builds receive the optional Docker proxy and value-free predefined args", async () => {
  const proxy = "http://proxy.example.invalid:8080";
  const inherited = {
    DOCKER_HOST: "unix:///run/user/1001/docker.sock",
    HTTP_PROXY: "http://inherited.example.invalid:9000",
    ALL_PROXY: "socks5://inherited.example.invalid:1080",
    LUMINA_DOCKER_PROXY: proxy,
    LUMINA_COMPOSE_PROJECT: "lumina-crm",
  };
  const direct = dockerBuildEnvironment(inherited, "");
  for (const key of [...DOCKER_BUILD_PROXY_KEYS, "ALL_PROXY", "all_proxy", "LUMINA_DOCKER_PROXY"]) {
    assert.equal(Object.hasOwn(direct, key), false);
  }
  const build = dockerBuildEnvironment(inherited, proxy);
  for (const key of DOCKER_BUILD_PROXY_KEYS) assert.equal(build[key], proxy);
  assert.equal(Object.hasOwn(build, "ALL_PROXY"), false);
  assert.equal(Object.hasOwn(build, "LUMINA_DOCKER_PROXY"), false);
  assert.deepEqual(dockerBuildProxyArguments(""), []);
  assert.deepEqual(dockerBuildProxyArguments(proxy), DOCKER_BUILD_PROXY_KEYS.flatMap((key) => [
    "--build-arg", key,
  ]));
  assert.equal(dockerBuildProxyArguments(proxy).some((argument) => argument.includes(proxy)), false);

  const [runner, gitSource, compose] = await Promise.all([
    source("scripts/deploy-production-runner.mjs"),
    source("scripts/lib/git-source-update.mjs"),
    source("compose.production.yml"),
  ]);
  assert.equal((runner.match(/"buildx", "build"/g) ?? []).length, 3);
  assert.equal((runner.match(/environment: buildEnvironment/g) ?? []).length, 3);
  assert.match(runner, /\.\.\.dockerBuildProxyArguments\(configuredDockerProxy\)/);
  assert.match(runner, /"LUMINA_GIT_PROXY", "LUMINA_DOCKER_PROXY"/);
  assert.match(gitSource, /environment\.HTTP_PROXY = proxy/);
  assert.doesNotMatch(gitSource, /LUMINA_DOCKER_PROXY/);
  assert.match(compose, /^\s+HTTP_PROXY: ""$/m);
  assert.match(compose, /^\s+HTTPS_PROXY: ""$/m);
  assert.match(compose, /^\s+http_proxy: ""$/m);
  assert.match(compose, /^\s+https_proxy: ""$/m);
  assert.doesNotMatch(compose, /LUMINA_DOCKER_PROXY/);
});

test("Docker proxy values are redacted from runner and maintenance error/state payloads", () => {
  const proxy = "http://proxy.example.invalid:8080/build";
  const encoded = encodeURIComponent(proxy);
  const runnerPayload = redactDeploymentSecrets(
    JSON.stringify({ error: `failed via ${proxy} and ${encoded}` }),
    [proxy],
  );
  const maintenancePayload = redactMaintenance(
    JSON.stringify({ error: `failed via ${proxy} and ${encoded}` }),
    new Set([proxy]),
  );
  for (const payload of [runnerPayload, maintenancePayload]) {
    assert.doesNotMatch(payload, /proxy\.example\.invalid|8080|%3A%2F%2F/);
    assert.match(payload, /\[REDACTED\]/);
  }
});

test("storage maintenance and all production units share one canonical Buildx namespace", async () => {
  assert.equal(LUMINA_DOCKER_CONFIG_ROOT, "/var/lib/lumina-crm/docker-config");
  assert.equal(LUMINA_BUILDX_CONFIG_ROOT, "/var/lib/lumina-crm/docker-config/buildx");

  const [deployUnit, prepareUnit, cleanupUnit, maintenance, runner] = await Promise.all([
    source("deploy/systemd/lumina-crm-deploy.service"),
    source("deploy/systemd/lumina-crm-storage-prepare.service"),
    source("deploy/systemd/lumina-crm-storage-cleanup.service"),
    source("deploy/libexec/lumina-crm-storage-maintenance.mjs"),
    source("scripts/deploy-production-runner.mjs"),
  ]);
  for (const unit of [deployUnit, prepareUnit, cleanupUnit]) {
    assert.match(unit, new RegExp(`^Environment=DOCKER_CONFIG=${LUMINA_DOCKER_CONFIG_ROOT}$`, "m"));
    assert.match(unit, new RegExp(`^Environment=BUILDX_CONFIG=${LUMINA_BUILDX_CONFIG_ROOT}$`, "m"));
    assert.match(unit, /UnsetEnvironment=.*DOCKER_CONTEXT/);
  }
  assert.doesNotMatch(maintenance, /const DOCKER_CONFIG_ROOT\s*=\s*`\$\{STATE_ROOT\}\/docker-config`/);
  assert.doesNotMatch(maintenance, /\/var\/lib\/lumina-crm\/storage-maintenance\/docker-config/);
  assert.match(
    maintenance,
    /"buildx", "inspect", LUMINA_BUILDER_NAME[\s\S]+?builderCreateArguments\(policy\.dockerProxy\)[\s\S]+?"buildx", "inspect", LUMINA_BUILDER_NAME/,
  );
  assert.match(
    runner,
    /start", "lumina-crm-storage-prepare\.service"[\s\S]+?"buildx", "inspect", builder/,
  );

  const environment = dockerEnvironment({
    DOCKER_HOST: "unix:///run/user/1001/docker.sock",
    HTTP_PROXY: "http://proxy.example.invalid",
    HOME: "/tmp/untrusted-home",
    DOCKER_CONTEXT: "desktop-linux",
  });
  assert.deepEqual(environment, {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    DOCKER_CONFIG: LUMINA_DOCKER_CONFIG_ROOT,
    BUILDX_CONFIG: LUMINA_BUILDX_CONFIG_ROOT,
    DOCKER_HOST: "unix:///run/user/1001/docker.sock",
    LANG: "C.UTF-8",
  });
  const simulatedCalls = [
    { phase: "prepare-create", args: ["buildx", "create", "--name", "lumina-crm-buildkit"] },
    { phase: "prepare-post-create", args: ["buildx", "inspect", "lumina-crm-buildkit"] },
    { phase: "deploy-inspect", args: ["buildx", "inspect", "lumina-crm-buildkit"] },
  ].map((call) => ({ ...call, environment: dockerEnvironment({
    DOCKER_HOST: "unix:///run/user/1001/docker.sock",
  }) }));
  assert.equal(simulatedCalls.every((call) => (
    call.environment.DOCKER_CONFIG === LUMINA_DOCKER_CONFIG_ROOT
    && call.environment.BUILDX_CONFIG === LUMINA_BUILDX_CONFIG_ROOT
  )), true);
  assert.doesNotMatch(JSON.stringify(environment), /proxy|DOCKER_CONTEXT|\/run\/docker\.sock|\.docker/i);
  assert.throws(
    () => dockerEnvironment({
      DOCKER_HOST: "unix:///run/user/1001/docker.sock",
      DOCKER_CONFIG: "/tmp/other",
    }),
    /LUMINA_DOCKER_CONFIG_ENVIRONMENT_MISMATCH/,
  );
  assert.throws(
    () => dockerEnvironment({
      DOCKER_HOST: "unix:///run/user/1001/docker.sock",
      BUILDX_CONFIG: "",
    }),
    /LUMINA_DOCKER_CONFIG_ENVIRONMENT_MISMATCH/,
  );
  assert.throws(
    () => dockerEnvironment({ DOCKER_HOST: "unix:///run/docker.sock" }),
    /LUMINA_ROOTLESS_DOCKER_HOST_REQUIRED/,
  );
});

function dockerConfigDirectoryDouble({
  canonicalExists = true,
  legacyExists = false,
  metadata = {},
  resolved = LUMINA_DOCKER_CONFIG_ROOT,
} = {}) {
  let created = false;
  const calls = [];
  const directoryMetadata = {
    uid: 1001,
    mode: 0o40700,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    ...metadata,
  };
  const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
  return {
    calls,
    operations: {
      lstat(target) {
        calls.push(["lstat", target]);
        if (target.includes("storage-maintenance")) {
          if (!legacyExists) throw missing();
          return { ...directoryMetadata };
        }
        if (!canonicalExists && !created) throw missing();
        return directoryMetadata;
      },
      mkdir(target, options) {
        calls.push(["mkdir", target, options]);
        created = true;
      },
      realpath(target) {
        calls.push(["realpath", target]);
        return resolved;
      },
    },
  };
}

test("canonical Docker configuration directory is created once and then fully revalidated", () => {
  const mock = dockerConfigDirectoryDouble({ canonicalExists: false });
  assert.equal(ensureCanonicalDockerConfigDirectory({
    currentUid: 1001,
    operations: mock.operations,
  }), LUMINA_DOCKER_CONFIG_ROOT);
  assert.deepEqual(mock.calls.filter(([operation]) => operation === "mkdir"), [[
    "mkdir",
    LUMINA_DOCKER_CONFIG_ROOT,
    { recursive: true, mode: 0o700 },
  ]]);
  assert.equal(
    mock.calls.filter(([operation, target]) => (
      operation === "lstat" && target === LUMINA_DOCKER_CONFIG_ROOT
    )).length,
    2,
  );
  assert.equal(mock.calls.some(([operation]) => ["rm", "copy", "rename"].includes(operation)), false);
});

test("an existing valid canonical Docker configuration directory is preserved", () => {
  const mock = dockerConfigDirectoryDouble();
  assert.equal(ensureCanonicalDockerConfigDirectory({
    currentUid: 1001,
    operations: mock.operations,
  }), LUMINA_DOCKER_CONFIG_ROOT);
  assert.equal(mock.calls.some(([operation]) => ["mkdir", "rm", "copy", "rename"].includes(operation)), false);
});

test("canonical Docker configuration directory rejects unsafe metadata without replacement", () => {
  for (const [options, expected] of [
    [{ metadata: { isSymbolicLink: () => true } }, /NOT_REAL_DIRECTORY/],
    [{ metadata: { isDirectory: () => false } }, /NOT_REAL_DIRECTORY/],
    [{ metadata: { uid: 1002 } }, /OWNER_INVALID/],
    [{ metadata: { mode: 0o40750 } }, /PERMISSIONS_INVALID/],
    [{ metadata: { mode: 0o40701 } }, /PERMISSIONS_INVALID/],
    [{ resolved: `${LUMINA_DOCKER_CONFIG_ROOT}-redirected` }, /REALPATH_MISMATCH/],
  ]) {
    const mock = dockerConfigDirectoryDouble(options);
    assert.throws(() => ensureCanonicalDockerConfigDirectory({
      currentUid: 1001,
      operations: mock.operations,
    }), expected);
    assert.equal(mock.calls.some(([operation]) => ["mkdir", "rm", "copy", "rename"].includes(operation)), false);
  }
});

test("legacy Buildx configuration path always fails closed without migration or deletion", () => {
  const mock = dockerConfigDirectoryDouble({ legacyExists: true });
  assert.throws(() => ensureCanonicalDockerConfigDirectory({
    currentUid: 1001,
    operations: mock.operations,
  }), /LEGACY_BUILDX_CONFIG_REQUIRES_REVIEW/);
  assert.equal(mock.calls.some(([operation]) => ["mkdir", "rm", "copy", "rename"].includes(operation)), false);
});

test("production units and provisioning never connect Lumina to rootful Docker", async () => {
  const [
    deployEnvironment,
    applicationUnit,
    deployUnit,
    backupUnit,
    restoreUnit,
    storagePrepareUnit,
    storageCleanupUnit,
    diskUnit,
    storageMaintenance,
    provisioning,
    runner,
    daemonConfiguration,
  ] = await Promise.all([
    source("deploy/deploy.env.example"),
    source("deploy/systemd/lumina-crm.service"),
    source("deploy/systemd/lumina-crm-deploy.service"),
    source("deploy/systemd/lumina-crm-backup.service"),
    source("deploy/systemd/lumina-crm-restore-test.service"),
    source("deploy/systemd/lumina-crm-storage-prepare.service"),
    source("deploy/systemd/lumina-crm-storage-cleanup.service"),
    source("deploy/systemd/lumina-crm-disk-monitor.service"),
    source("deploy/libexec/lumina-crm-storage-maintenance.mjs"),
    source("deploy/scripts/provision-volumes.sh"),
    source("scripts/deploy-production-runner.mjs"),
    source("deploy/rootless-docker/daemon.json"),
  ]);
  assert.match(deployEnvironment, /DOCKER_HOST=unix:\/\/\/run\/user\/1001\/docker\.sock/);
  assert.match(deployEnvironment, /LUMINA_DOCKER_DATA_ROOT=\/var\/lib\/lumina-crm\/docker/);
  for (const unit of [
    applicationUnit,
    deployUnit,
    backupUnit,
    restoreUnit,
    storagePrepareUnit,
    storageCleanupUnit,
  ]) {
    assert.doesNotMatch(unit, /Requires=docker\.service|After=docker\.service|\/run\/docker\.sock/);
    assert.doesNotMatch(unit, /ProtectHome=true/);
    assert.match(unit, /ProtectHome=read-only/);
    assert.match(unit, /EnvironmentFile=\/etc\/lumina-crm\/deploy\.env/);
  }
  for (const unit of [storagePrepareUnit, storageCleanupUnit]) {
    assert.match(unit, /User=lumina-crm/);
    assert.doesNotMatch(unit, /User=root/);
  }
  assert.match(storageMaintenance, /LUMINA_ROOTLESS_DOCKER_REQUIRED/);
  assert.match(storageMaintenance, /LUMINA_ROOTLESS_CGROUP_V2_SYSTEMD_REQUIRED/);
  assert.match(provisioning, /Refusing to provision Lumina volumes through a rootful Docker daemon/);
  assert.match(runner, /assertRootlessDockerInfo/);
  assert.match(daemonConfiguration, /"data-root": "\/var\/lib\/lumina-crm\/docker"/);
  assert.match(diskUnit, /WorkingDirectory=\/opt\/lumina-crm\/source/);
  assert.doesNotMatch(diskUnit, /\/opt\/lumina-crm\/current/);
});

test("Compose, credentials, immutable images, and forward-only rollback remain bounded", async () => {
  const [
    compose,
    dockerfile,
    productionEnvironment,
    workerEnvironment,
    migrationEnvironment,
    backupEnvironment,
    runner,
    workflow,
    caddy,
    tunnel,
  ] = await Promise.all([
    source("compose.production.yml"),
    source("Dockerfile"),
    source("deploy/production.env.example"),
    source("deploy/worker.env.example"),
    source("deploy/migration.env.example"),
    source("deploy/backup.env.example"),
    source("scripts/deploy-production-runner.mjs"),
    source("scripts/lib/production-deploy-workflow.mjs"),
    source("deploy/caddy/Caddyfile"),
    source("deploy/cloudflare-tunnel/config.yml.example"),
  ]);
  assert.match(compose, /^name: \$\{LUMINA_COMPOSE_PROJECT:-lumina-crm\}$/m);
  assert.match(compose, /image: postgres:18\.4-bookworm/);
  assert.match(compose, /internal: true/);
  assert.doesNotMatch(
    compose.match(/postgres:[\s\S]+?\n  web:/)?.[0] ?? "",
    /\n\s+ports:/,
  );
  assert.match(dockerfile, /USER 10001:10001/);
  const applicationStage = dockerfile.match(
    /FROM \$\{NODE_IMAGE\} AS application[\s\S]+?(?=\nFROM \$\{POSTGRES_IMAGE\} AS operations)/,
  )?.[0] ?? "";
  assert.doesNotMatch(applicationStage, /deploy-production|browser-qa|smoke-|release-gate/);
  assert.match(applicationStage, /scripts\/container-entrypoint\.mjs/);
  assert.match(applicationStage, /scripts\/lib\/worker-database\.mjs/);
  assert.doesNotMatch(
    productionEnvironment,
    /WORKER_DATABASE_URL|MIGRATION_DATABASE_URL|BACKUP_DATABASE_URL|DATABASE_ADMIN_URL/,
  );
  assert.doesNotMatch(
    workerEnvironment,
    /^DATABASE_URL=|SYSTEM_DATABASE_URL|MIGRATION_DATABASE_URL|BACKUP_DATABASE_URL/m,
  );
  assert.match(migrationEnvironment, /crm_migrator:.*@postgres:5432\/lumina_crm/);
  assert.match(backupEnvironment, /crm_backup:.*@postgres:5432\/lumina_crm/);
  assert.match(
    workflow,
    /await operations\.buildImages\(target\);[\s\S]+await operations\.migrate\(candidateEnvironment\);[\s\S]+await operations\.switchApplication\(candidateEnvironment\)/,
  );
  assert.match(runner, /database remains on the forward schema/);
  assert.match(caddy, /^http:\/\/127\.0\.0\.1:3211 \{/m);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3200/);
  assert.doesNotMatch(caddy, /Origin-Auth|ORIGIN_AUTH_SECRET/);
  assert.match(tunnel, /service: http:\/\/127\.0\.0\.1:3211/);
  assert.match(tunnel, /service: http_status:404/);
});

test("restore verification includes matching encrypted local objects without extracting them", async () => {
  const [backup, restore, backupEnvironment, restoreEnvironment] = await Promise.all([
    source("scripts/db-backup.mjs"),
    source("scripts/db-restore-test.mjs"),
    source("deploy/backup.env.example"),
    source("deploy/restore.env.example"),
  ]);
  assert.match(backup, /retention\.localRetentionHours/);
  assert.match(backup, /remoteRetentionDays/);
  assert.match(restore, /matchingEncryptedObjectsPath/);
  assert.match(restore, /RESTORE_MATCHING_OBJECT_BACKUP_NOT_FOUND/);
  assert.match(restore, /"--list"/);
  assert.doesNotMatch(restore, /"--extract"|-x[fv]?/);
  assert.match(backupEnvironment, /BACKUP_LOCAL_RETENTION_HOURS=48/);
  assert.match(restoreEnvironment, /RESTORE_REQUIRE_LOCAL_OBJECTS=true/);
});
