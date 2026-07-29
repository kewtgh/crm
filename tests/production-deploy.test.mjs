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
  validateDirectoryMetadata,
  writeExclusiveRequest,
} from "../scripts/lib/production-deploy-core.mjs";
import {
  assertRootlessDockerHost,
  assertRootlessDockerInfo,
  expectedRootlessDockerHost,
  LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
} from "../scripts/lib/rootless-docker.mjs";
import {
  backupRetentionPolicy,
  matchingEncryptedObjectsPath,
} from "../scripts/lib/backup-policy.mjs";
import {
  assertAllowedDockerArguments,
  selectLuminaImageCandidates,
} from "../deploy/libexec/lumina-crm-storage-maintenance.mjs";

const repositoryFile = (value) => new URL(`../${value}`, import.meta.url);
const source = (value) => readFile(repositoryFile(value), "utf8");

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
    caddy,
    cloudflareWorker,
  ] = await Promise.all([
    source("compose.production.yml"),
    source("Dockerfile"),
    source("deploy/production.env.example"),
    source("deploy/worker.env.example"),
    source("deploy/migration.env.example"),
    source("deploy/backup.env.example"),
    source("scripts/deploy-production-runner.mjs"),
    source("deploy/caddy/Caddyfile"),
    source("deploy/cloudflare-worker/src/index.mjs"),
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
  assert.match(runner, /await buildImages\(target\);[\s\S]+await migrate\(candidateEnv\);[\s\S]+await switchApplication\(candidateEnv\)/);
  assert.match(runner, /database remains on the forward schema/);
  assert.match(caddy, /X-Lumina-Origin-Auth/);
  assert.match(cloudflareWorker, /cacheEverything: false/);
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
