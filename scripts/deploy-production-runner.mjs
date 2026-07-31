#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertRootlessDockerHost,
  assertRootlessDockerInfo,
  LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
} from "./lib/rootless-docker.mjs";
import { updateProductionSource } from "./lib/git-source-update.mjs";
import { assertProductionSecretSources } from "./lib/production-secret-sources.mjs";
import {
  dockerBuildEnvironment,
  dockerBuildProxyArguments,
  parseDockerBuildProxy,
  validateBuildxInspectContract,
} from "./lib/docker-build-proxy.mjs";
import {
  acceptedReleaseMatchesRequest,
  assertReleaseModeAllowed,
  createAcceptedRelease,
  extractSensitiveEnvironmentValues,
  ProductionReleaseWorkflowError,
  redactDeploymentSecrets,
  releaseFailureRollbackPlan,
  runProductionReleaseWorkflow,
} from "./lib/production-deploy-workflow.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedSourceRoot = "/opt/lumina-crm/source";
const stateRoot = "/var/lib/lumina-crm/deployments";
const logRoot = "/var/log/lumina-crm/deployments";
const requestPath = path.join(stateRoot, "request.json");
const latestPath = path.join(stateRoot, "latest.json");
const acceptedPath = path.join(stateRoot, "last-success.json");
const composeEnvPath = path.join(stateRoot, "compose.env");
const cleanupRequestPath = path.join(stateRoot, "storage-cleanup-request.json");
const builderMarkerPath = "/var/lib/lumina-crm/storage-maintenance/builder-owner.json";
const composeFile = path.join(sourceRoot, "compose.production.yml");
const project = "lumina-crm";
const builder = "lumina-crm-buildkit";
const expectedBranch = "main";
const allowedOrigins = new Set([
  "git@github.com:kewtgh/crm.git",
  "https://github.com/kewtgh/crm.git",
]);
const proxyKeys = [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
  "http_proxy", "https_proxy", "all_proxy",
  "LUMINA_GIT_PROXY", "LUMINA_DOCKER_PROXY",
  "NODE_OPTIONS",
  "DOCKER_CONTEXT",
];

if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
  throw new Error("Production deployment runner must run as non-root lumina-crm on Linux");
}
assertRootlessDockerHost();
if (sourceRoot !== expectedSourceRoot) throw new Error(`Runner must execute from ${expectedSourceRoot}`);
if (!existsSync(requestPath)) throw new Error("Deployment request is missing");
mkdirSync(stateRoot, { recursive: true, mode: 0o750 });
mkdirSync(logRoot, { recursive: true, mode: 0o750 });

const request = JSON.parse(readFileSync(requestPath, "utf8"));
if (!/^[0-9a-f-]{36}$/i.test(request.requestId ?? "")
  || !["deploy", "initialize", "rollback"].includes(request.mode)
  || path.resolve(request.sourceRoot ?? "") !== sourceRoot) {
  throw new Error("Deployment request is invalid");
}

const startedAt = new Date();
const deploymentId = `${startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${request.requestId.slice(0, 8)}`;
const logPath = path.join(logRoot, `${deploymentId}.log`);
const statusPath = path.join(stateRoot, `${deploymentId}.json`);
writeFileSync(logPath, "", { flag: "wx", mode: 0o640 });

const configuredGitProxy = process.env.LUMINA_GIT_PROXY?.trim() ?? "";
const configuredDockerProxy = parseDockerBuildProxy(process.env.LUMINA_DOCKER_PROXY);
const secretValues = [
  ...(configuredGitProxy ? [configuredGitProxy] : []),
  ...(configuredDockerProxy ? [configuredDockerProxy] : []),
  ...deploymentSecretValues(),
];
let switched = false;
let migrationMayHaveChanged = false;
const priorLatest = readJson(latestPath);
const acceptedStateExists = existsSync(acceptedPath);
let previousAccepted = readJson(acceptedPath);
let target = null;
let persisted = {
  deploymentId,
  requestId: request.requestId,
  mode: request.mode,
  result: "RUNNING",
  stage: "starting",
  startedAt: startedAt.toISOString(),
  finishedAt: null,
  previousCommit: previousAccepted?.commit ?? null,
  targetCommit: null,
  applicationVersion: null,
  previousImage: previousAccepted?.currentImage ?? null,
  targetImage: null,
  migrationMayHaveChanged: false,
  rollback: null,
  applicationAccepted: false,
  acceptedAt: null,
  cleanup: null,
  logPath,
  error: null,
};

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function atomicWrite(file, content, mode = 0o640) {
  const temporary = `${file}.next-${process.pid}`;
  writeFileSync(temporary, content, { mode });
  renameSync(temporary, file);
}

function persist(update = {}) {
  persisted = { ...persisted, ...update };
  const text = `${JSON.stringify(persisted, null, 2)}\n`;
  atomicWrite(statusPath, text);
  atomicWrite(latestPath, text);
}

function deploymentSecretValues() {
  const secretsDirectory = process.env.LUMINA_SECRETS_DIR || "/etc/lumina-crm/secrets";
  const values = [];
  for (const name of [
    "production.env",
    "worker.env",
    "database-bootstrap.env",
    "migration.env",
    "bootstrap-admin.env",
    "backup.env",
    "restore.env",
  ]) {
    const secretFile = path.join(secretsDirectory, name);
    if (!existsSync(secretFile)) continue;
    try {
      values.push(...extractSensitiveEnvironmentValues(
        readFileSync(secretFile, "utf8"),
      ));
    } catch {
      throw new Error(`Cannot safely load deployment log redactions from ${name}`);
    }
  }
  const postgresPasswordFile = path.join(secretsDirectory, "postgres-superuser-password.txt");
  if (!existsSync(postgresPasswordFile)) return values;
  try {
    const postgresPassword = readFileSync(postgresPasswordFile, "utf8").trim();
    if (postgresPassword) values.push(postgresPassword);
  } catch {
    throw new Error("Cannot safely load deployment log redactions from postgres-superuser-password.txt");
  }
  return values;
}

function redact(value) {
  return redactDeploymentSecrets(value, secretValues);
}

function log(level, message) {
  const safe = redact(message);
  const line = `${new Date().toISOString()} [${deploymentId}] [${level}] ${safe}\n`;
  appendFileSync(logPath, line);
  (level === "ERROR" ? process.stderr : process.stdout).write(line);
}

function stage(name) {
  persist({ stage: name, migrationMayHaveChanged });
  log("STAGE", name);
}

function directEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides };
  for (const key of proxyKeys) delete environment[key];
  environment.NO_PROXY = "postgres,web,worker,localhost,127.0.0.1,::1";
  environment.no_proxy = environment.NO_PROXY;
  environment.LUMINA_COMPOSE_PROJECT = project;
  return environment;
}

function run(label, command, args, {
  timeoutMs = 600_000,
  environment = directEnvironment(),
  allowFailure = false,
  quiet = false,
  validateStdout,
} = {}) {
  stage(label);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: sourceRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const append = (value, chunk) => `${value}${chunk}`.slice(-4 * 1024 * 1024);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const heartbeat = setInterval(() => log("INFO", `${label} is still running`), 20_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code !== 0 && !allowFailure) {
        reject(new Error(`${label} failed: ${redact(stderr || stdout || signal || code).slice(-1200)}`));
        return;
      }
      try {
        if (code === 0 && validateStdout) validateStdout(result.stdout);
      } catch (error) {
        reject(error);
        return;
      }
      if (!quiet && stdout.trim()) log("OUTPUT", stdout.trim().slice(-20_000));
      if (!quiet && stderr.trim()) log(code === 0 ? "OUTPUT" : "WARN", stderr.trim().slice(-20_000));
      resolve(result);
    });
  });
}

function git(label, args, options) {
  return run(label, "git", args, { timeoutMs: 180_000, ...options });
}

function composeArguments(envFile, args) {
  return [
    "compose",
    "--project-name", project,
    "--env-file", envFile,
    "-f", composeFile,
    ...args,
  ];
}

function compose(label, envFile, args, options) {
  return run(label, "docker", composeArguments(envFile, args), options);
}

function imageReferences(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Commit must be a full SHA");
  const applicationRepository = process.env.LUMINA_IMAGE_REPOSITORY || "lumina-crm";
  const operationsRepository = process.env.LUMINA_OPS_IMAGE_REPOSITORY || "lumina-crm-ops";
  if (!/^[a-z0-9][a-z0-9./_-]*$/.test(applicationRepository)
    || !/^[a-z0-9][a-z0-9./_-]*$/.test(operationsRepository)) {
    throw new Error("Lumina image repository is invalid");
  }
  return {
    commit,
    currentImage: `${applicationRepository}:${commit}`,
    operationsImage: `${operationsRepository}:${commit}`,
  };
}

function publicHostname() {
  const hostname = process.env.LUMINA_PUBLIC_HOSTNAME?.trim().toLowerCase();
  if (!hostname) throw new Error("LUMINA_PUBLIC_HOSTNAME is required");
  if (hostname.length > 253
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)
    || /(?:^|\.)example\.(?:com|net|org)$|(?:^|\.)invalid$/.test(hostname)) {
    throw new Error("LUMINA_PUBLIC_HOSTNAME must be the configured production DNS hostname");
  }
  return hostname;
}

function composeEnvironment(release) {
  const lines = {
    LUMINA_COMPOSE_PROJECT: project,
    LUMINA_IMAGE: release.currentImage,
    LUMINA_OPS_IMAGE: release.operationsImage,
    LUMINA_PUBLIC_HOSTNAME: publicHostname(),
    LUMINA_WEB_BIND: "127.0.0.1:3200",
    LUMINA_SECRETS_DIR: process.env.LUMINA_SECRETS_DIR || "/etc/lumina-crm/secrets",
    LUMINA_POSTGRES_VOLUME: process.env.LUMINA_POSTGRES_VOLUME || "lumina-crm-postgres-data",
    LUMINA_OBJECTS_VOLUME: process.env.LUMINA_OBJECTS_VOLUME || "lumina-crm-objects",
    LUMINA_BACKUPS_VOLUME: process.env.LUMINA_BACKUPS_VOLUME || "lumina-crm-backups",
    LUMINA_BACKEND_NETWORK: process.env.LUMINA_BACKEND_NETWORK || "lumina-crm-backend",
    LUMINA_EDGE_NETWORK: process.env.LUMINA_EDGE_NETWORK || "lumina-crm-edge",
  };
  return `${Object.entries(lines).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

async function waitForContainerHealth(envFile, service, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = (await compose(`locate ${service}`, envFile, ["ps", "--quiet", service], {
      timeoutMs: 15_000,
      quiet: true,
    })).stdout.trim();
    if (id) {
      const health = await run(`inspect ${service} health`, "docker", [
        "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", id,
      ], { timeoutMs: 15_000, quiet: true });
      if (health.stdout.trim() === "healthy") return;
      if (health.stdout.trim() === "unhealthy") {
        log("WARN", `${service} is unhealthy; waiting for its bounded recovery window`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${service} did not become healthy`);
}

async function fetchHealth(label, url, { readiness = false, headers } = {}) {
  stage(label);
  const response = await fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok || body?.status !== "ok" || (readiness && body?.ready === false)) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  if (readiness && !Object.values(body?.checks ?? {}).every(Boolean)) {
    throw new Error(`${label} did not pass every readiness component`);
  }
  if (body?.version && target?.version && body.version !== target.version) {
    throw new Error(`${label} returned version ${body.version}, expected ${target.version}`);
  }
}

async function acceptRuntime(envFile, { publicChecks = true } = {}) {
  await waitForContainerHealth(envFile, "postgres", 120_000);
  await waitForContainerHealth(envFile, "web", 120_000);
  await waitForContainerHealth(envFile, "worker", 240_000);
  await fetchHealth(
    "loopback readiness",
    "http://127.0.0.1:3200/api/health?mode=ready",
    { readiness: true },
  );
  if (!publicChecks) return;
  await fetchHealth(
    "Cloudflare Tunnel public liveness",
    `https://${publicHostname()}/api/health`,
  );
}

async function prepareBuilderAndCapacity() {
  await run(
    "host and Docker capacity plus isolated builder verification",
    "sudo",
    ["-n", "/usr/bin/systemctl", "start", "lumina-crm-storage-prepare.service"],
    { timeoutMs: 300_000 },
  );
  await run(
    "verify isolated Lumina builder",
    "docker",
    ["buildx", "inspect", builder],
    {
      timeoutMs: 30_000,
      quiet: true,
      validateStdout: (output) => validateBuildxInspectContract(output, {
        builderName: builder,
        dockerProxy: configuredDockerProxy,
      }),
    },
  );
  const marker = readJson(builderMarkerPath);
  const proxySha256 = configuredDockerProxy
    ? createHash("sha256").update(configuredDockerProxy).digest("hex")
    : null;
  if (marker?.builderNetworkMode !== "host") {
    throw new Error("LUMINA_BUILDKIT_NETWORK_CONFIGURATION_MISMATCH");
  }
  if ((marker?.dockerProxyEnabled ?? false) !== Boolean(configuredDockerProxy)
    || (marker?.dockerProxySha256 ?? null) !== proxySha256) {
    throw new Error("LUMINA_BUILDKIT_PROXY_CONFIGURATION_MISMATCH");
  }
  const securityOptions = await run("verify rootless Docker security mode", "docker", [
    "info", "--format", "{{json .SecurityOptions}}",
  ], { timeoutMs: 30_000, quiet: true });
  const cgroupDriver = await run("verify rootless Docker cgroup driver", "docker", [
    "info", "--format", "{{.CgroupDriver}}",
  ], { timeoutMs: 30_000, quiet: true });
  const dockerRoot = await run("verify rootless Docker data root", "docker", [
    "info", "--format", "{{.DockerRootDir}}",
  ], { timeoutMs: 30_000, quiet: true });
  assertRootlessDockerInfo({
    securityOptions: securityOptions.stdout,
    cgroupDriver: cgroupDriver.stdout,
    dockerRoot: dockerRoot.stdout,
    expectedDockerRoot: LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
  });
}

async function updateSource() {
  return updateProductionSource({
    git,
    baseEnvironment: directEnvironment(),
    configuredProxy: configuredGitProxy,
    expectedBranch,
    allowedOrigins,
    onConfiguredProxy: () => log("INFO", "Git fetch is using the configured Git proxy"),
  });
}

async function buildImages(release) {
  const buildEnvironment = dockerBuildEnvironment(directEnvironment(), configuredDockerProxy);
  const common = [
    "--builder", builder,
    "--file", "Dockerfile",
    "--build-arg", `LUMINA_VCS_REF=${release.commit}`,
    ...dockerBuildProxyArguments(configuredDockerProxy),
    "--provenance=true",
  ];
  try {
    await run("containerized type, lint and contract verification", "docker", [
      "buildx", "build", ...common,
      "--target", "verification",
      "--output", "type=cacheonly",
      ".",
    ], { timeoutMs: 900_000, environment: buildEnvironment });
    await run("build immutable application image", "docker", [
      "buildx", "build", ...common,
      "--target", "application",
      "--tag", release.currentImage,
      "--load",
      ".",
    ], { timeoutMs: 900_000, environment: buildEnvironment });
    await run("build immutable operations image", "docker", [
      "buildx", "build", ...common,
      "--target", "operations",
      "--tag", release.operationsImage,
      "--load",
      ".",
    ], { timeoutMs: 900_000, environment: buildEnvironment });
  } finally {
    try {
      const cleanup = await run(
        "bounded post-build BuildKit cache cleanup",
        "sudo",
        ["-n", "/usr/bin/systemctl", "start", "lumina-crm-build-cache-cleanup.service"],
        { timeoutMs: 360_000, allowFailure: true },
      );
      if (cleanup.code !== 0) {
        log("WARN", "BuildKit cache cleanup requires operator review");
      }
    } catch {
      log("WARN", "BuildKit cache cleanup could not be started; operator review is required");
    }
  }
}

async function startPostgres(candidateEnv) {
  await compose("start or verify PostgreSQL", candidateEnv, ["up", "-d", "postgres"], { timeoutMs: 180_000 });
  await waitForContainerHealth(candidateEnv, "postgres", 120_000);
}

async function preflightSecretSources() {
  stage("verify production secret source metadata");
  const result = assertProductionSecretSources();
  log("INFO", `Verified metadata for ${result.checkedFiles.length} production secret source files`);
}

async function bootstrapDatabase(candidateEnv) {
  await compose("bootstrap PostgreSQL roles and extensions", candidateEnv, [
    "--profile", "ops", "run", "--rm", "--no-deps", "db-bootstrap",
  ]);
}

async function verifyMigrations(candidateEnv) {
  await compose("verify migration manifest", candidateEnv, [
    "--profile", "ops", "run", "--rm", "--no-deps", "migration-verify",
  ]);
}

async function applyMigrations(candidateEnv) {
  await compose("apply locked forward migration", candidateEnv, [
    "--profile", "ops", "run", "--rm", "--no-deps", "migrate",
  ]);
}

async function bootstrapAdmin(candidateEnv) {
  await compose("bootstrap first CRM administrator", candidateEnv, [
    "--profile", "ops", "run", "--rm", "--no-deps", "bootstrap-admin",
  ]);
}

async function switchApplication(candidateEnv) {
  atomicWrite(composeEnvPath, readFileSync(candidateEnv, "utf8"));
  await compose("switch Web image before enabling the new Worker image", composeEnvPath, [
    "up", "-d", "--no-deps", "web",
  ], { timeoutMs: 300_000 });
  switched = true;
  await waitForContainerHealth(composeEnvPath, "web", 120_000);
  await compose("switch Worker image after Web ownership transfer", composeEnvPath, [
    "up", "-d", "--no-deps", "worker",
  ], { timeoutMs: 300_000 });
}

async function rollbackApplication(reason) {
  if (!previousAccepted?.currentImage || !previousAccepted?.operationsImage) {
    return { status: "UNAVAILABLE", reason: "No accepted application image exists" };
  }
  const previous = {
    currentImage: previousAccepted.currentImage,
    operationsImage: previousAccepted.operationsImage,
  };
  atomicWrite(composeEnvPath, composeEnvironment(previous));
  await compose("stop asynchronous Worker before restoring the previous Web image", composeEnvPath, [
    "stop", "worker",
  ], { timeoutMs: 120_000 });
  await compose("restore previous Web image", composeEnvPath, [
    "up", "-d", "--no-deps", "web",
  ], { timeoutMs: 300_000 });
  await waitForContainerHealth(composeEnvPath, "web", 120_000);
  await compose("restore previous Worker image after Web rollback", composeEnvPath, [
    "up", "-d", "--no-deps", "worker",
  ], { timeoutMs: 300_000 });
  target = { ...previous, version: previousAccepted.version };
  await acceptRuntime(composeEnvPath, { publicChecks: false });
  log("WARN", "Application rolled back; database remains on the forward schema.");
  return {
    status: "SUCCEEDED",
    reason,
    restoredImage: previous.currentImage,
    database: "FORWARD_SCHEMA_RETAINED",
  };
}

async function requestCleanup(accepted) {
  atomicWrite(cleanupRequestPath, `${JSON.stringify({
    deploymentId,
    applicationAccepted: true,
    acceptedAt: accepted.acceptedAt,
    currentImage: accepted.currentImage,
    rollbackImage: accepted.rollbackImage,
    protectedImageTags: [
      accepted.currentImage,
      accepted.operationsImage,
      accepted.rollbackImage,
      accepted.rollbackOperationsImage,
      ...(accepted.recentImages ?? []),
    ].filter(Boolean),
  }, null, 2)}\n`);
  const result = await run(
    "post-acceptance Lumina-only cleanup",
    "sudo",
    ["-n", "/usr/bin/systemctl", "start", "lumina-crm-storage-cleanup.service"],
    { timeoutMs: 360_000, allowFailure: true },
  );
  return result.code === 0
    ? { status: "SUCCEEDED" }
    : { status: "WARNING", message: "Healthy release retained; cleanup requires operator review" };
}

async function finish(result, update = {}) {
  const finishedAt = new Date();
  persist({
    ...update,
    result,
    stage: "finished",
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  });
  rmSync(requestPath, { force: true });
}

try {
  publicHostname();
  persist();
  log("INFO", `Accepted persistent request mode=${request.mode}`);
  if (request.mode === "rollback") {
    if (!previousAccepted?.rollbackImage || !previousAccepted?.rollbackOperationsImage) {
      throw new Error("No explicit rollback image is recorded");
    }
    target = {
      currentImage: previousAccepted.rollbackImage,
      operationsImage: previousAccepted.rollbackOperationsImage,
      version: previousAccepted.rollbackVersion,
    };
    const rollbackEnv = path.join(stateRoot, `${deploymentId}.candidate.env`);
    atomicWrite(rollbackEnv, composeEnvironment(target));
    const old = previousAccepted;
    await switchApplication(rollbackEnv);
    await acceptRuntime(composeEnvPath);
    const acceptedAt = new Date().toISOString();
    const accepted = {
      deploymentId,
      requestId: request.requestId,
      mode: request.mode,
      commit: old.rollbackCommit,
      version: old.rollbackVersion,
      currentImage: old.rollbackImage,
      operationsImage: old.rollbackOperationsImage,
      rollbackCommit: old.commit,
      rollbackVersion: old.version,
      rollbackImage: old.currentImage,
      rollbackOperationsImage: old.operationsImage,
      recentImages: [...new Set([
        old.rollbackImage,
        old.rollbackOperationsImage,
        ...(old.recentImages ?? []),
      ])].slice(0, 10),
      acceptedAt,
      database: "FORWARD_SCHEMA_RETAINED",
    };
    atomicWrite(acceptedPath, `${JSON.stringify(accepted, null, 2)}\n`);
    await finish("ROLLBACK_OK", {
      applicationAccepted: true,
      acceptedAt,
      rollback: { status: "SUCCEEDED", database: "FORWARD_SCHEMA_RETAINED" },
      targetImage: target.currentImage,
    });
    log("WARN", "Application rolled back; database remains on the forward schema.");
  } else {
    const interrupted = priorLatest;
    if (acceptedReleaseMatchesRequest({
      request,
      priorLatest: interrupted,
      acceptedRelease: previousAccepted,
    })) {
      const cleanup = await requestCleanup(previousAccepted);
      if (request.mode === "initialize") {
        log(
          "WARN",
          "Initialization succeeded; delete or clear ADMIN_PASSWORD in "
          + "bootstrap-admin.env. The runner did not modify the root-owned secret file.",
        );
      }
      await finish("SUCCESS", {
        targetCommit: interrupted?.targetCommit ?? previousAccepted.commit,
        applicationVersion: interrupted?.applicationVersion ?? previousAccepted.version,
        targetImage: interrupted?.targetImage ?? previousAccepted.currentImage,
        migrationMayHaveChanged: interrupted?.migrationMayHaveChanged ?? true,
        applicationAccepted: true,
        acceptedAt: previousAccepted.acceptedAt,
        cleanup,
      });
    } else {
      assertReleaseModeAllowed({
        mode: request.mode,
        acceptedStateExists,
        acceptedRelease: previousAccepted,
      });
      const workflow = await runProductionReleaseWorkflow({
        mode: request.mode,
        operations: {
          prepare: prepareBuilderAndCapacity,
          updateSource,
          resolveTarget: async (commit) => {
            const packageJson = JSON.parse(readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
            target = { ...imageReferences(commit), version: String(packageJson.version) };
            persist({
              targetCommit: commit,
              applicationVersion: target.version,
              targetImage: target.currentImage,
            });
            return target;
          },
          buildImages,
          writeCandidateEnvironment: async (release) => {
            const candidateEnv = path.join(stateRoot, `${deploymentId}.candidate.env`);
            atomicWrite(candidateEnv, composeEnvironment(release));
            return candidateEnv;
          },
          preflightSecretSources,
          startPostgres,
          bootstrapDatabase,
          verifyMigrations,
          markMigrationMayHaveChanged: async () => {
            migrationMayHaveChanged = true;
            persist({ migrationMayHaveChanged });
          },
          migrate: applyMigrations,
          bootstrapAdmin,
          switchApplication,
          acceptRuntime: async () => acceptRuntime(composeEnvPath),
        },
      });
      migrationMayHaveChanged = workflow.migrationMayHaveChanged;
      switched = workflow.switched;
      const { candidateEnvironment: candidateEnv, commit } = workflow;

      const acceptedAt = new Date().toISOString();
      const accepted = createAcceptedRelease({
        deploymentId,
        request,
        target: { ...target, commit },
        previousAccepted,
        acceptedAt,
      });
      atomicWrite(acceptedPath, `${JSON.stringify(accepted, null, 2)}\n`);
      persist({ applicationAccepted: true, acceptedAt });
      const cleanup = await requestCleanup(accepted);
      log("INFO", `Accepted immutable application image ${target.currentImage}`);
      if (request.mode === "initialize") {
        log(
          "WARN",
          "Initialization succeeded; delete or clear ADMIN_PASSWORD in "
          + "bootstrap-admin.env. The runner did not modify the root-owned secret file.",
        );
      }
      await finish("SUCCESS", { applicationAccepted: true, acceptedAt, cleanup });
      rmSync(candidateEnv, { force: true });
    }
  }
} catch (error) {
  if (error instanceof ProductionReleaseWorkflowError) {
    migrationMayHaveChanged = error.migrationMayHaveChanged;
    switched = error.switched;
  }
  log("ERROR", error instanceof Error ? error.message : String(error));
  let rollback = releaseFailureRollbackPlan({ switched, previousAccepted });
  if (rollback?.status === "REQUIRED") {
    try {
      rollback = await rollbackApplication("POST_SWITCH_ACCEPTANCE_FAILED");
    } catch (rollbackError) {
      rollback = {
        status: "FAILED",
        error: redact(rollbackError instanceof Error ? rollbackError.message : String(rollbackError)),
      };
    }
  }
  await finish(
    request.mode === "rollback" ? "ROLLBACK_FAILED" : "FAILED",
    {
      migrationMayHaveChanged,
      rollback,
      error: redact(error instanceof Error ? error.message : String(error)),
    },
  );
  process.exitCode = 1;
}
