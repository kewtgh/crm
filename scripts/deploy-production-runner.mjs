#!/usr/bin/env node

import { spawn } from "node:child_process";
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
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedSourceRoot = "/opt/lumina-crm/source";
const stateRoot = "/var/lib/lumina-crm/deployments";
const logRoot = "/var/log/lumina-crm/deployments";
const requestPath = path.join(stateRoot, "request.json");
const latestPath = path.join(stateRoot, "latest.json");
const acceptedPath = path.join(stateRoot, "last-success.json");
const composeEnvPath = path.join(stateRoot, "compose.env");
const cleanupRequestPath = path.join(stateRoot, "storage-cleanup-request.json");
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
  "NODE_OPTIONS",
];

if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
  throw new Error("Production deployment runner must run as non-root lumina-crm on Linux");
}
if (sourceRoot !== expectedSourceRoot) throw new Error(`Runner must execute from ${expectedSourceRoot}`);
if (!existsSync(requestPath)) throw new Error("Deployment request is missing");
mkdirSync(stateRoot, { recursive: true, mode: 0o750 });
mkdirSync(logRoot, { recursive: true, mode: 0o750 });

const request = JSON.parse(readFileSync(requestPath, "utf8"));
if (!/^[0-9a-f-]{36}$/i.test(request.requestId ?? "")
  || !["deploy", "rollback"].includes(request.mode)
  || path.resolve(request.sourceRoot ?? "") !== sourceRoot) {
  throw new Error("Deployment request is invalid");
}

const startedAt = new Date();
const deploymentId = `${startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${request.requestId.slice(0, 8)}`;
const logPath = path.join(logRoot, `${deploymentId}.log`);
const statusPath = path.join(stateRoot, `${deploymentId}.json`);
writeFileSync(logPath, "", { flag: "wx", mode: 0o640 });

let secretValues = [];
let switched = false;
let migrationMayHaveChanged = false;
const priorLatest = readJson(latestPath);
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

function redact(value) {
  let safe = String(value);
  for (const secret of secretValues.filter((item) => item && item.length >= 8)) {
    safe = safe.replaceAll(secret, "[REDACTED]");
    try {
      safe = safe.replaceAll(encodeURIComponent(secret), "[REDACTED]");
    } catch {
      // The literal replacement remains in effect.
    }
  }
  return safe;
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

function composeEnvironment(release) {
  const lines = {
    LUMINA_COMPOSE_PROJECT: project,
    LUMINA_IMAGE: release.currentImage,
    LUMINA_OPS_IMAGE: release.operationsImage,
    LUMINA_PUBLIC_HOSTNAME: process.env.LUMINA_PUBLIC_HOSTNAME || "crm.ewaya.com",
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
    "Cloudflare Worker public liveness",
    process.env.LUMINA_PUBLIC_HEALTH_URL || "https://crm.ewaya.com/api/health",
  );
  const originEnvironmentPath = process.env.LUMINA_ORIGIN_ENV_FILE;
  if (!originEnvironmentPath) throw new Error("LUMINA_ORIGIN_ENV_FILE is required");
  const originEnvironment = parseEnv(readFileSync(originEnvironmentPath, "utf8"));
  const originSecret = originEnvironment.LUMINA_ORIGIN_AUTH_SECRET?.trim();
  if (!originSecret) throw new Error("LUMINA_ORIGIN_AUTH_SECRET is missing");
  secretValues.push(originSecret);
  await fetchHealth(
    "authenticated origin liveness",
    process.env.LUMINA_ORIGIN_HEALTH_URL,
    { headers: { "x-lumina-origin-auth": originSecret } },
  );
}

async function prepareBuilderAndCapacity() {
  await run(
    "host and Docker capacity plus isolated builder verification",
    "sudo",
    ["-n", "/usr/bin/systemctl", "start", "lumina-crm-storage-prepare.service"],
    { timeoutMs: 300_000 },
  );
  const inspected = await run(
    "verify isolated Lumina builder",
    "docker",
    ["buildx", "inspect", builder],
    { timeoutMs: 30_000, quiet: true },
  );
  if (!/^Driver:\s+docker-container$/m.test(inspected.stdout)) {
    throw new Error(`${builder} is not a docker-container builder`);
  }
}

async function updateSource() {
  const branch = (await git("verify deployment branch", ["branch", "--show-current"], { quiet: true })).stdout;
  if (branch !== expectedBranch) throw new Error(`Expected branch ${expectedBranch}, found ${branch}`);
  const origin = (await git("verify deployment origin", ["remote", "get-url", "origin"], { quiet: true })).stdout;
  if (!allowedOrigins.has(origin)) throw new Error("Git origin does not exactly match kewtgh/crm");
  if ((await git("verify clean source", ["status", "--porcelain"], { quiet: true })).stdout) {
    throw new Error("Deployment source worktree is not clean");
  }
  const direct = await git("fetch origin main", ["fetch", "--prune", "origin", expectedBranch], {
    allowFailure: true,
    quiet: true,
  });
  if (direct.code !== 0) {
    const fallbackProxy = process.env.LUMINA_GIT_FALLBACK_PROXY?.trim();
    if (!fallbackProxy) throw new Error("Direct git fetch failed and no one-shot fallback is configured");
    secretValues.push(fallbackProxy);
    const fallbackEnvironment = directEnvironment();
    fallbackEnvironment.HTTPS_PROXY = fallbackProxy;
    fallbackEnvironment.HTTP_PROXY = fallbackProxy;
    await git("one-shot proxied fetch origin main", ["fetch", "--prune", "origin", expectedBranch], {
      environment: fallbackEnvironment,
      quiet: true,
    });
  }
  await git("fast-forward source", ["merge", "--ff-only", `origin/${expectedBranch}`], { quiet: true });
  const commit = (await git("resolve exact target commit", ["rev-parse", "HEAD"], { quiet: true })).stdout;
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Git did not return a full commit");
  if ((await git("verify final clean source", ["status", "--porcelain"], { quiet: true })).stdout) {
    throw new Error("Deployment source changed during fetch");
  }
  return commit;
}

async function buildImages(release) {
  const common = [
    "--builder", builder,
    "--file", "Dockerfile",
    "--build-arg", `LUMINA_VCS_REF=${release.commit}`,
    "--provenance=true",
  ];
  await run("containerized type, lint and contract verification", "docker", [
    "buildx", "build", ...common,
    "--target", "verification",
    "--output", "type=cacheonly",
    ".",
  ], { timeoutMs: 900_000 });
  await run("build immutable application image", "docker", [
    "buildx", "build", ...common,
    "--target", "application",
    "--tag", release.currentImage,
    "--load",
    ".",
  ], { timeoutMs: 900_000 });
  await run("build immutable operations image", "docker", [
    "buildx", "build", ...common,
    "--target", "operations",
    "--tag", release.operationsImage,
    "--load",
    ".",
  ], { timeoutMs: 900_000 });
}

async function migrate(candidateEnv) {
  await compose("start or verify PostgreSQL", candidateEnv, ["up", "-d", "postgres"], { timeoutMs: 180_000 });
  await waitForContainerHealth(candidateEnv, "postgres", 120_000);
  await compose("verify migration manifest", candidateEnv, [
    "--profile", "ops", "run", "--rm", "--no-deps", "migration-verify",
  ]);
  migrationMayHaveChanged = true;
  await compose("apply locked forward migration", candidateEnv, [
    "--profile", "ops", "run", "--rm", "--no-deps", "migrate",
  ]);
}

async function switchApplication(candidateEnv) {
  atomicWrite(composeEnvPath, readFileSync(candidateEnv, "utf8"));
  await compose("switch Web and Worker images", composeEnvPath, [
    "up", "-d", "--no-deps", "web", "worker",
  ], { timeoutMs: 300_000 });
  switched = true;
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
  await compose("restore previous application images", composeEnvPath, [
    "up", "-d", "--no-deps", "web", "worker",
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
  persist();
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
    if (interrupted?.requestId === request.requestId
      && interrupted.applicationAccepted === true
      && previousAccepted?.currentImage === interrupted.targetImage) {
      const cleanup = await requestCleanup(previousAccepted);
      await finish("SUCCESS", { ...interrupted, cleanup });
    } else {
      await prepareBuilderAndCapacity();
      const commit = await updateSource();
      const packageJson = JSON.parse(readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
      target = { ...imageReferences(commit), version: String(packageJson.version) };
      persist({
        targetCommit: commit,
        applicationVersion: target.version,
        targetImage: target.currentImage,
      });
      await buildImages(target);
      const candidateEnv = path.join(stateRoot, `${deploymentId}.candidate.env`);
      atomicWrite(candidateEnv, composeEnvironment(target));
      await migrate(candidateEnv);
      await switchApplication(candidateEnv);
      await acceptRuntime(composeEnvPath);

      const acceptedAt = new Date().toISOString();
      const accepted = {
        deploymentId,
        commit,
        version: target.version,
        currentImage: target.currentImage,
        operationsImage: target.operationsImage,
        rollbackCommit: previousAccepted?.commit ?? null,
        rollbackVersion: previousAccepted?.version ?? null,
        rollbackImage: previousAccepted?.currentImage ?? null,
        rollbackOperationsImage: previousAccepted?.operationsImage ?? null,
        recentImages: [...new Set([
          target.currentImage,
          target.operationsImage,
          ...(previousAccepted?.recentImages ?? []),
        ])].slice(0, 10),
        acceptedAt,
        database: "FORWARD_ONLY",
      };
      atomicWrite(acceptedPath, `${JSON.stringify(accepted, null, 2)}\n`);
      persist({ applicationAccepted: true, acceptedAt });
      const cleanup = await requestCleanup(accepted);
      await finish("SUCCESS", { applicationAccepted: true, acceptedAt, cleanup });
      rmSync(candidateEnv, { force: true });
      log("INFO", `Accepted immutable application image ${target.currentImage}`);
    }
  }
} catch (error) {
  log("ERROR", error instanceof Error ? error.message : String(error));
  let rollback = null;
  if (switched) {
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
