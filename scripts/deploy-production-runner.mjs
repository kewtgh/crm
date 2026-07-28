#!/usr/bin/env node

import { spawn } from "node:child_process";
import { get as httpGet } from "node:http";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertLoopbackListener,
  assertProxyFreeEnvironment,
  assertReviewedInstallScriptPolicy,
  assertReleasePath,
  assertSpecificAbsolutePath,
  assertSystemdRuntime,
  atomicSwitchCurrent,
  cleanupFailedRelease,
  collectSecretValues,
  directRuntimeEnvironment,
  githubPullArguments,
  makeDeploymentId,
  makeReleaseId,
  parseEnvironmentText,
  parseSystemdProperties,
  planInterruptedRecovery,
  PRODUCTION_LOCAL_URL,
  PRODUCTION_PUBLIC_URL,
  redactSecrets,
  retryHealth,
  rollbackAfterCutover,
  selectReleasesForCleanup,
  validateEnvironmentFileMetadata,
  validateEnvironmentKeyPolicy,
  validateDirectoryMetadata,
  validateRequiredEnvironment,
} from "./lib/production-deploy-core.mjs";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployRoot = assertSpecificAbsolutePath("/opt/lumina-crm", "Deployment root");
const sourceRoot = path.join(deployRoot, "source");
const releasesRoot = path.join(deployRoot, "releases");
const currentLink = path.join(deployRoot, "current");
const stateRoot = path.resolve("/var/lib/lumina-crm/deployments");
const logRoot = path.resolve("/var/log/lumina-crm/deployments");
const productionEnvPath = "/etc/lumina-crm/production.env";
const deployEnvPath = "/etc/lumina-crm/deploy.env";
const requestPath = path.join(stateRoot, "request.json");
const latestPath = path.join(stateRoot, "latest.json");
const lastSuccessPath = path.join(stateRoot, "last-success.json");
const npmCommand = "/usr/bin/npm";
const webService = "lumina-crm.service";
const workerService = "lumina-crm-workers.service";
const workerTimer = "lumina-crm-workers.timer";
const expectedRepository = "git@github.com:kewtgh/crm.git";
const expectedBranch = "main";
const releaseRetention = 5;

const limits = {
  total: 3_600_000,
  git: 180_000,
  install: 600_000,
  check: 600_000,
  build: 600_000,
  migration: 600_000,
  systemd: 120_000,
  liveness: 90_000,
  readiness: 180_000,
  publicHealth: 180_000,
};

const request = readRequest();
const priorInterruptedStatus = readPriorStatus();
const deploymentStarted = new Date();
const deploymentId = makeDeploymentId(deploymentStarted, request.requestId);
const statusPath = path.join(stateRoot, `${deploymentId}.json`);
const logPath = path.join(logRoot, `${deploymentId}.log`);
const deadline = Date.now() + limits.total;
let activeChild;
let interruptedSignal;
let secretValues = [];
let releaseDir;
let previousRelease;
let previousCommit;
let previousVersion;
let targetCommit;
let applicationVersion;
let switched = false;
let migrationApplied = false;
let migrationMayHaveChanged = false;
let createdRelease = false;

assertRealDirectory(stateRoot, "Deployment state directory");
assertRealDirectory(logRoot, "Deployment log directory");
mkdirSync("/var/lib/lumina-crm/npm-cache", { recursive: true, mode: 0o750 });
mkdirSync("/var/lib/lumina-crm/cache", { recursive: true, mode: 0o750 });
assertRealDirectory("/var/lib/lumina-crm/npm-cache", "npm cache directory");
assertRealDirectory("/var/lib/lumina-crm/cache", "XDG cache directory");
writeFileSync(logPath, "", { flag: "wx", mode: 0o640 });

let persisted = {
  deploymentId,
  requestId: request.requestId,
  mode: request.mode,
  result: "RUNNING",
  stage: "starting",
  startedAt: deploymentStarted.toISOString(),
  finishedAt: null,
  durationMs: null,
  previousCommit: null,
  targetCommit: null,
  applicationVersion: null,
  releasePath: null,
  previousRelease: null,
  logPath,
  migrationApplied: false,
  migrationMayHaveChanged: false,
  rollback: null,
  error: null,
};

function readRequest() {
  if (process.platform !== "linux") throw new Error("The production deployment runner supports only Linux");
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    throw new Error("The production deployment runner must not run as root");
  }
  if (scriptRoot !== sourceRoot) throw new Error(`Deployment runner must execute from ${sourceRoot}`);
  const parsed = JSON.parse(readFileSync(requestPath, "utf8"));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(parsed.requestId ?? ""))) {
    throw new Error("Deployment request ID is invalid");
  }
  if (!["deploy", "rollback"].includes(parsed.mode)) throw new Error("Deployment request mode is invalid");
  if (path.resolve(parsed.sourceRoot ?? "") !== sourceRoot) throw new Error("Deployment request source path is invalid");
  return parsed;
}

function readPriorStatus() {
  try {
    return JSON.parse(readFileSync(latestPath, "utf8"));
  } catch {
    return null;
  }
}

function atomicJson(file, value) {
  const temporary = `${file}.next-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
  renameSync(temporary, file);
}

function persist(update = {}) {
  persisted = { ...persisted, ...update };
  atomicJson(statusPath, persisted);
  atomicJson(latestPath, persisted);
}

function log(level, message) {
  const safe = redactSecrets(message, secretValues);
  const lines = safe.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    const entry = `${new Date().toISOString()} [${deploymentId}] [${level}] ${line}\n`;
    appendFileSync(logPath, entry, { encoding: "utf8" });
    (level === "ERROR" ? process.stderr : process.stdout).write(entry);
  }
}

function setStage(stage) {
  persist({
    stage,
    previousCommit: previousCommit ?? null,
    targetCommit: targetCommit ?? null,
    applicationVersion: applicationVersion ?? null,
    releasePath: releaseDir ?? null,
    previousRelease: previousRelease ?? null,
    migrationApplied,
    migrationMayHaveChanged,
  });
  log("STAGE", stage);
}

function remainingMs() {
  return deadline - Date.now();
}

function elapsedMs() {
  return Date.now() - deploymentStarted.getTime();
}

function ensureNotInterrupted() {
  if (interruptedSignal) throw new Error(`Deployment runner interrupted by ${interruptedSignal}`);
  if (remainingMs() <= 0) throw new Error("Total deployment deadline expired");
}

function terminate(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  const force = setTimeout(() => {
    if (child.exitCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  }, 5_000);
  force.unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interruptedSignal = signal;
    log("ERROR", `Runner received ${signal}; terminating the active stage and entering failure recovery`);
    terminate(activeChild);
  });
}

function limitedAppend(current, chunk, limit = 12 * 1024 * 1024) {
  const next = current + chunk;
  return next.length > limit ? `${next.slice(0, limit)}\n[output truncated]\n` : next;
}

function run(label, command, args, {
  cwd = sourceRoot,
  timeoutMs = limits.check,
  env = safeBaseEnvironment(),
  allowExitCodes = [0],
  sensitiveOutput = false,
} = {}) {
  ensureNotInterrupted();
  const budget = Math.min(timeoutMs, remainingMs());
  if (budget <= 0) return Promise.reject(new Error(`No deployment time remains for ${label}`));
  setStage(label);
  return new Promise((resolve, reject) => {
    const commandStartedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { stdout = limitedAppend(stdout, chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr = limitedAppend(stderr, chunk.toString()); });
    const heartbeat = setInterval(() => log("INFO", `${label} is still running`), 15_000);
    const timer = setTimeout(() => {
      timedOut = true;
      log("ERROR", `${label} exceeded its ${Math.ceil(budget / 1000)}s limit`);
      terminate(child);
    }, budget);
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      clearTimeout(timer);
      if (activeChild === child) activeChild = undefined;
      if (!sensitiveOutput && stdout.trim()) log("OUTPUT", stdout.trim());
      if (!sensitiveOutput && stderr.trim()) log(error ? "ERROR" : "OUTPUT", stderr.trim());
      log(error ? "ERROR" : "INFO", `${label} ${error ? "failed" : "completed"} in ${Date.now() - commandStartedAt}ms`);
      if (error) reject(error);
      else resolve(result);
    };
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (interruptedSignal) return finish(new Error(`${label} interrupted by ${interruptedSignal}`));
      if (timedOut) return finish(new Error(`${label} exceeded its ${Math.ceil(budget / 1000)}s limit`));
      if (!allowExitCodes.includes(code)) {
        const detail = sensitiveOutput
          ? String(signal || `exit ${code}`)
          : redactSecrets(stderr.trim() || stdout.trim() || signal || `exit ${code}`, secretValues).slice(-1_000);
        return finish(new Error(`${label} failed: ${detail}`));
      }
      finish(undefined, { code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function runNpm(label, args, options = {}) {
  return run(label, npmCommand, args, options);
}

function safeBaseEnvironment() {
  const allowed = [
    "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP",
    "XDG_CACHE_HOME", "NPM_CONFIG_CACHE", "SSH_AUTH_SOCK",
  ];
  const environment = {};
  for (const key of allowed) if (process.env[key] !== undefined) environment[key] = process.env[key];
  return directRuntimeEnvironment({
    ...environment,
    NPM_CONFIG_CACHE: "/var/lib/lumina-crm/npm-cache",
    XDG_CACHE_HOME: "/var/lib/lumina-crm/cache",
    DO_NOT_TRACK: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    WRANGLER_WRITE_LOGS: "false",
  });
}

function loadEnvironmentFile(file, label) {
  const metadata = lstatSync(file);
  validateEnvironmentFileMetadata(metadata, {
    label,
    currentUid: process.getuid(),
    allowedGroupIds: [process.getgid(), ...(process.getgroups?.() ?? [])],
  });
  return parseEnvironmentText(readFileSync(file, "utf8"), label);
}

function loadEnvironments() {
  assertProxyFreeEnvironment(process.env, "Deployment runner systemd environment");
  const production = loadEnvironmentFile(productionEnvPath, "production.env");
  const deploy = loadEnvironmentFile(deployEnvPath, "deploy.env");
  validateEnvironmentKeyPolicy(production, {
    label: "production.env",
    forbidden: [
      /^(?:PATH|HOME|USER|LOGNAME|SHELL|NODE_OPTIONS|NODE_ENV|CI|TMPDIR|TMP|TEMP|XDG_CACHE_HOME|SSH_AUTH_SOCK)$/i,
      /^(?:NPM_CONFIG_.+|LUMINA_HTTPS_PROXY|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|NODE_USE_ENV_PROXY|GIT_PROXY_COMMAND|LD_PRELOAD|LD_LIBRARY_PATH|BASH_ENV|ENV)$/i,
      /^(?:DATABASE_ADMIN_URL|MIGRATION_DATABASE_URL|CRM_(?:APP|SYSTEM|WORKER|MIGRATOR|BACKUP)_DB_PASSWORD|BACKUP_.+|DISK_.+)$/i,
    ],
  });
  validateEnvironmentKeyPolicy(deploy, {
    label: "deploy.env",
    allowed: [
      "DATABASE_ADMIN_URL",
      "MIGRATION_DATABASE_URL",
      "CRM_APP_DB_PASSWORD",
      "CRM_SYSTEM_DB_PASSWORD",
      "CRM_WORKER_DB_PASSWORD",
      "CRM_MIGRATOR_DB_PASSWORD",
      "CRM_BACKUP_DB_PASSWORD",
      "BACKUP_DATABASE_URL",
      "BACKUP_LOCAL_ROOT",
      "BACKUP_ENCRYPTION_KEY",
      "BACKUP_RETENTION_DAYS",
      "BACKUP_S3_ENDPOINT",
      "BACKUP_S3_REGION",
      "BACKUP_S3_BUCKET",
      "BACKUP_S3_ACCESS_KEY_ID",
      "BACKUP_S3_SECRET_ACCESS_KEY",
      "BACKUP_NOTIFICATION_WEBHOOK_URL",
      "BACKUP_NOTIFICATION_WEBHOOK_TOKEN",
      "DISK_MONITOR_PATHS",
      "DISK_FREE_PERCENT_THRESHOLD",
      "DISK_NOTIFICATION_WEBHOOK_URL",
      "DISK_NOTIFICATION_WEBHOOK_TOKEN",
    ],
  });
  validateRequiredEnvironment(production, {
    label: "production.env",
    required: [
      "APP_URL",
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "TURNSTILE_EXPECTED_HOSTNAME",
      "ALTCHA_HMAC_SECRET",
      "DATABASE_URL",
      "SYSTEM_DATABASE_URL",
      "WORKER_DATABASE_URL",
      "CRM_WORKSPACE_ID",
      "LOGIN_THROTTLE_HASH_SECRET",
      "TRUSTED_DEVICE_HASH_SECRET",
      "TOTP_ENCRYPTION_KEY",
      "OBJECT_STORAGE_PROVIDER",
      "OBJECT_STORAGE_SIGNING_SECRET",
      "EMAIL_DELIVERY_WEBHOOK_URL",
      "EMAIL_DELIVERY_WEBHOOK_TOKEN",
    ],
    exact: {
      APP_URL: PRODUCTION_PUBLIC_URL,
      TURNSTILE_EXPECTED_HOSTNAME: "crm.ewaya.com",
    },
  });
  validateRequiredEnvironment(deploy, {
    label: "deploy.env",
    required: ["MIGRATION_DATABASE_URL"],
  });
  secretValues = collectSecretValues(production, deploy);
  log("INFO", "Validated production.env and deploy.env names, ownership, permissions, and required keys; values are redacted");
  return { production, deploy };
}

function installEnvironment() {
  return { ...safeBaseEnvironment(), CI: "true", NODE_ENV: "development" };
}

function buildEnvironment(production) {
  return { ...safeBaseEnvironment(), ...production, CI: "true", NODE_ENV: "production" };
}

function migrationEnvironment(deploy) {
  return { ...safeBaseEnvironment(), ...deploy, CI: "true" };
}

async function currentReleaseMetadata(release) {
  const safeRelease = assertReleasePath(releasesRoot, release, "Current release");
  const packageJson = JSON.parse(readFileSync(path.join(safeRelease, "package.json"), "utf8"));
  const manifestPath = path.join(safeRelease, ".lumina-release.json");
  let commit = null;
  if (existsSync(manifestPath)) commit = JSON.parse(readFileSync(manifestPath, "utf8")).commit;
  if (!/^[0-9a-f]{40}$/.test(String(commit ?? ""))) {
    commit = (await run("resolve current release commit", "git", ["-C", safeRelease, "rev-parse", "HEAD"], {
      timeoutMs: limits.git,
    })).stdout;
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Could not resolve commit for ${safeRelease}`);
  return { release: safeRelease, commit, version: String(packageJson.version) };
}

function resolveCurrentRelease() {
  if (!existsSync(currentLink)) throw new Error(`Current release symlink is missing: ${currentLink}`);
  const metadata = lstatSync(currentLink);
  if (!metadata.isSymbolicLink()) throw new Error(`${currentLink} must be a symbolic link`);
  return assertReleasePath(releasesRoot, realpathSync(currentLink), "Current release");
}

function assertRealDirectory(directory, label) {
  validateDirectoryMetadata(lstatSync(directory), { label });
  if (realpathSync(directory) !== path.resolve(directory)) {
    throw new Error(`${label} must resolve exactly to ${directory}`);
  }
}

async function verifySystemd({ requireWorkerSuccess = true } = {}) {
  const properties = "ActiveState,SubState,UnitFileState,ExecStart,Environment,Result,ExecMainStatus";
  const webResult = await run(
    "inspect effective web unit",
    "systemctl",
    ["show", webService, `--property=${properties}`, "--no-pager"],
    { timeoutMs: limits.systemd, sensitiveOutput: true },
  );
  const workerResult = await run(
    "inspect effective worker unit",
    "systemctl",
    ["show", workerService, `--property=${properties}`, "--no-pager"],
    { timeoutMs: limits.systemd, sensitiveOutput: true },
  );
  const timerResult = await run(
    "inspect effective worker timer",
    "systemctl",
    ["show", workerTimer, `--property=${properties}`, "--no-pager"],
    { timeoutMs: limits.systemd, sensitiveOutput: true },
  );
  const sockets = await run("inspect port 3200 listeners", "ss", ["-H", "-ltn"], { timeoutMs: limits.systemd });
  const worker = parseSystemdProperties(workerResult.stdout);
  assertSystemdRuntime({
    web: parseSystemdProperties(webResult.stdout),
    worker: requireWorkerSuccess ? worker : { ...worker, Result: "success", ExecMainStatus: "0" },
    timer: parseSystemdProperties(timerResult.stdout),
  });
  assertLoopbackListener(sockets.stdout, 3200);
}

async function sudoSystemctl(label, args) {
  await run(label, "sudo", ["-n", "/usr/bin/systemctl", ...args], { timeoutMs: limits.systemd });
}

async function verifyHealth(version, { includePublic = true } = {}) {
  const onFailure = ({ attempt, error }) => log("ERROR", `Health attempt ${attempt} failed: ${error}`);
  const localHealth = await retryHealth({
    fetchImpl: directLocalFetch,
    url: `${PRODUCTION_LOCAL_URL}/api/health`,
    expectedVersion: version,
    timeoutMs: limits.liveness,
    sleep: interruptedSleep,
    onFailure,
  });
  log("INFO", `Local liveness passed after ${localHealth.attempts} attempt(s)`);
  const readiness = await retryHealth({
    fetchImpl: directLocalFetch,
    url: `${PRODUCTION_LOCAL_URL}/api/health?mode=ready`,
    expectedVersion: version,
    readiness: true,
    timeoutMs: limits.readiness,
    requestTimeoutMs: 15_000,
    sleep: interruptedSleep,
    onFailure,
  });
  log("INFO", `Local readiness passed after ${readiness.attempts} attempt(s)`);
  if (includePublic) {
    const publicHealth = await retryHealth({
      fetchImpl: fetch,
      url: `${PRODUCTION_PUBLIC_URL}/api/health`,
      expectedVersion: version,
      timeoutMs: limits.publicHealth,
      sleep: interruptedSleep,
      onFailure,
    });
    log("INFO", `Public liveness passed after ${publicHealth.attempts} attempt(s)`);
  }
}

function directLocalFetch(url, { headers, signal } = {}) {
  const target = new URL(url);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.port !== "3200") {
    return Promise.reject(new Error("Direct local health requests are restricted to http://127.0.0.1:3200"));
  }
  return new Promise((resolve, reject) => {
    const request = httpGet(target, { headers, signal }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
          status: Number(response.statusCode ?? 0),
          json: async () => JSON.parse(body),
        });
      });
    });
    request.once("error", reject);
  });
}

async function waitForWorkerIdle() {
  const idleDeadline = Date.now() + limits.systemd;
  while (Date.now() < idleDeadline) {
    const result = await run(
      "wait for current Lumina worker cycle",
      "systemctl",
      ["show", workerService, "--property=ActiveState", "--value", "--no-pager"],
      { timeoutMs: Math.min(10_000, Math.max(1, idleDeadline - Date.now())) },
    );
    if (["inactive", "failed"].includes(result.stdout)) return;
    await interruptedSleep(1_000);
  }
  throw new Error("Existing Lumina worker cycle did not become idle before the systemd deadline");
}

async function interruptedSleep(milliseconds) {
  ensureNotInterrupted();
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  ensureNotInterrupted();
}

async function activateRelease(version) {
  await sudoSystemctl("restart Lumina web", ["restart", webService]);
  await sudoSystemctl("enable and start Lumina worker timer", ["enable", "--now", workerTimer]);
  await waitForWorkerIdle();
  await sudoSystemctl("run one Lumina worker cycle", ["start", workerService]);
  await verifySystemd();
  await verifyHealth(version);
}

function validateReleaseArtifacts(release, expectedCommit) {
  for (const relative of ["dist/client", "dist/server", "package.json", "package-lock.json"]) {
    if (!existsSync(path.join(release, relative))) throw new Error(`Release artifact is missing: ${relative}`);
  }
  const packageJson = JSON.parse(readFileSync(path.join(release, "package.json"), "utf8"));
  const sourceVersion = readFileSync(path.join(release, "lib", "version.ts"), "utf8").match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  if (!sourceVersion || sourceVersion !== packageJson.version) {
    throw new Error("package.json version and APP_VERSION do not match");
  }
  if (packageJson.packageManager !== "npm@12.0.1" || !String(packageJson.engines?.npm ?? "").includes("12")) {
    throw new Error("Release does not retain the pinned npm 12 runtime policy");
  }
  assertReviewedInstallScriptPolicy(packageJson);
  const manifest = {
    deploymentId,
    commit: expectedCommit,
    version: packageJson.version,
    builtAt: new Date().toISOString(),
    migrationHead: path.basename(readdirSync(path.join(release, "db", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .at(-1) ?? ""),
  };
  const manifestPath = path.join(release, ".lumina-release.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o444 });
  chmodSync(manifestPath, 0o444);
  return { version: String(packageJson.version), manifest };
}

async function removeWorktree(release) {
  await run("remove release worktree", "git", ["worktree", "remove", "--force", release], {
    cwd: sourceRoot,
    timeoutMs: limits.git,
  });
}

async function pruneOldReleases(activeRelease) {
  let removals;
  try {
    const entries = readdirSync(releasesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const release = path.join(releasesRoot, entry.name);
        return { path: release, mtimeMs: statSync(release).mtimeMs };
      });
    const lastSuccess = existsSync(lastSuccessPath) ? JSON.parse(readFileSync(lastSuccessPath, "utf8")) : {};
    removals = selectReleasesForCleanup(entries, {
      releasesRoot,
      currentRelease: realpathSync(currentLink),
      previousRelease: lastSuccess.previousRelease,
      activeRelease,
      retain: releaseRetention,
    });
  } catch (error) {
    log("ERROR", `Release cleanup skipped without deleting anything: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const release of removals) {
    try {
      await removeWorktree(release);
      log("INFO", `Removed unused old Lumina release ${release}`);
    } catch (error) {
      log("ERROR", `Could not remove unused old release ${release}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function preflight() {
  setStage("production preflight");
  validateDeploymentFilesystem();
  const current = await currentReleaseMetadata(resolveCurrentRelease());
  previousRelease = current.release;
  previousCommit = current.commit;
  previousVersion = current.version;
  persist({ previousRelease, previousCommit });
  await verifySystemd({ requireWorkerSuccess: false });
  await verifyHealth(previousVersion);
}

function validateDeploymentFilesystem({ createReleaseRoot = false } = {}) {
  if (sourceRoot !== scriptRoot) throw new Error(`Source root must be ${sourceRoot}`);
  if (!/^24\./.test(process.versions.node)) {
    throw new Error(`Production Node.js must be 24.x, found ${process.versions.node}`);
  }
  if (!existsSync(path.join(sourceRoot, ".git"))) throw new Error(`Source checkout is not a Git repository: ${sourceRoot}`);
  if (!existsSync(npmCommand)) throw new Error(`${npmCommand} is missing`);
  if (!existsSync("/usr/bin/nc")) throw new Error("/usr/bin/nc is required for the one-shot GitHub pull proxy");
  for (const [directory, label] of [
    [deployRoot, "Deployment root"],
    [sourceRoot, "Source checkout"],
    [stateRoot, "Deployment state directory"],
    [logRoot, "Deployment log directory"],
    ["/var/lib/lumina-crm/npm-cache", "npm cache directory"],
    ["/var/lib/lumina-crm/cache", "XDG cache directory"],
  ]) assertRealDirectory(directory, label);
  if (createReleaseRoot) mkdirSync(releasesRoot, { recursive: true, mode: 0o750 });
  assertRealDirectory(releasesRoot, "Release root");
}

async function recoverInterruptedRun() {
  const current = existsSync(currentLink) ? realpathSync(currentLink) : null;
  const recovery = planInterruptedRecovery({
    requestId: request.requestId,
    prior: priorInterruptedStatus,
    currentRelease: current,
  });
  if (recovery.action === "NONE") return;
  log("ERROR", `Recovering interrupted request ${request.requestId} with action ${recovery.action}`);
  if (recovery.migrationMayHaveChanged) {
    log("ERROR", "The interrupted run may already have applied forward database migrations; database data will not be rolled back");
  }
  if (recovery.action === "ROLLBACK_THEN_RESUME") {
    const previous = assertReleasePath(releasesRoot, recovery.previousRelease, "Interrupted previous release");
    if (!existsSync(previous)) throw new Error(`Interrupted previous release is missing: ${previous}`);
    await atomicSwitchCurrent({ fs, currentLink, target: previous, nonce: `${deploymentId}-interrupted` });
    await sudoSystemctl("restart web after interrupted runner", ["restart", webService]);
    await verifyRestoredRelease(previous);
    log("INFO", "LUMINA_PRODUCTION_ROLLBACK_OK");
  }
  if (recovery.failedRelease && existsSync(recovery.failedRelease)
    && (!existsSync(currentLink) || realpathSync(currentLink) !== path.resolve(recovery.failedRelease))) {
    await cleanupFailedRelease({
      releasesRoot,
      releasePath: recovery.failedRelease,
      currentTarget: existsSync(currentLink) ? realpathSync(currentLink) : null,
      removeRelease: removeWorktree,
    });
    log("INFO", `Removed interrupted release ${recovery.failedRelease}`);
  }
}

async function deploy(production, deployEnvironment) {
  const status = await run("verify clean source checkout", "git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
    timeoutMs: limits.git,
  });
  if (status.stdout) throw new Error("Source checkout has uncommitted or untracked files");
  const branch = await run("verify source branch", "git", ["branch", "--show-current"], { timeoutMs: limits.git });
  if (branch.stdout !== expectedBranch) throw new Error(`Expected branch ${expectedBranch}, found ${branch.stdout || "detached HEAD"}`);
  const remote = await run("verify source remote", "git", ["remote", "get-url", "origin"], { timeoutMs: limits.git });
  if (remote.stdout !== expectedRepository) throw new Error(`origin must be ${expectedRepository}`);

  await run("fast-forward pull remote main", "git", githubPullArguments({
    remote: "origin",
    branch: expectedBranch,
  }), { timeoutMs: limits.git, env: safeBaseEnvironment() });
  targetCommit = (await run("resolve pulled target commit", "git", ["rev-parse", "HEAD"], {
    timeoutMs: limits.git,
  })).stdout;
  if (!/^[0-9a-f]{40}$/.test(targetCommit)) throw new Error("Remote main did not resolve to a full commit SHA");
  const remoteCommit = (await run("verify remote tracking target", "git", ["rev-parse", `refs/remotes/origin/${expectedBranch}^{commit}`], {
    timeoutMs: limits.git,
  })).stdout;
  if (remoteCommit !== targetCommit) throw new Error("Pulled HEAD does not match origin/main");
  const sourceHead = (await run("verify source target commit", "git", ["rev-parse", "HEAD"], { timeoutMs: limits.git })).stdout;
  if (sourceHead !== targetCommit) throw new Error("Source checkout does not match the pulled target commit");
  const pulledStatus = await run("verify clean source after pull", "git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
    timeoutMs: limits.git,
  });
  if (pulledStatus.stdout) throw new Error("Source checkout became dirty during Git pull");

  const releaseId = makeReleaseId(new Date(), targetCommit);
  releaseDir = assertReleasePath(releasesRoot, path.join(releasesRoot, releaseId), "New release");
  if (existsSync(releaseDir)) throw new Error(`Release path already exists: ${releaseDir}`);
  persist({ targetCommit, releasePath: releaseDir });
  createdRelease = true;
  await run("create detached immutable release worktree", "git", ["worktree", "add", "--detach", releaseDir, targetCommit], {
    timeoutMs: limits.git,
  });

  for (const forbidden of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (existsSync(path.join(releaseDir, forbidden))) throw new Error(`Release contains forbidden environment file: ${forbidden}`);
  }
  const npmVersion = await runNpm("verify npm 12", ["--version"], {
    cwd: releaseDir,
    timeoutMs: limits.git,
    env: installEnvironment(),
  });
  if (!/^12\./.test(npmVersion.stdout)) throw new Error(`Production npm must be 12.x, found ${npmVersion.stdout || "unknown"}`);
  await runNpm("install locked dependencies with allowlisted lifecycle scripts", [
    "ci",
    "--include=dev",
    "--include=optional",
    "--strict-allow-scripts",
    "--no-audit",
    "--no-fund",
  ], { cwd: releaseDir, timeoutMs: limits.install, env: installEnvironment() });
  const qualityEnvironment = buildEnvironment(production);
  await runNpm("typecheck", ["run", "typecheck:raw"], { cwd: releaseDir, timeoutMs: limits.check, env: qualityEnvironment });
  await runNpm("lint", ["run", "lint:raw"], { cwd: releaseDir, timeoutMs: limits.check, env: qualityEnvironment });
  await run("application source contracts", process.execPath, ["--test", "--test-isolation=none", "tests/rendered-html.test.mjs"], {
    cwd: releaseDir,
    timeoutMs: limits.check,
    env: qualityEnvironment,
  });
  await run("production deployment unit tests", process.execPath, ["--test", "--test-isolation=none", "tests/production-deploy.test.mjs"], {
    cwd: releaseDir,
    timeoutMs: limits.check,
    env: qualityEnvironment,
  });
  await runNpm("dependency security audit", ["audit", "--audit-level=moderate"], {
    cwd: releaseDir,
    timeoutMs: limits.check,
    env: installEnvironment(),
  });
  await runNpm("production build", ["run", "build:raw"], {
    cwd: releaseDir,
    timeoutMs: limits.build,
    env: qualityEnvironment,
  });
  await run("verify build did not change tracked source", "git", ["-C", releaseDir, "diff", "--exit-code"], {
    timeoutMs: limits.git,
  });

  const databaseEnvironment = migrationEnvironment(deployEnvironment);
  await runNpm("verify standard PostgreSQL migration manifest", [
    "run", "db:migrations:verify",
  ], { cwd: releaseDir, timeoutMs: limits.migration, env: databaseEnvironment });
  migrationMayHaveChanged = true;
  persist({ migrationMayHaveChanged });
  log("INFO", "Forward migration execution is starting; failures from this point are reported as possibly database-changing");
  await runNpm("apply forward-only production migrations", [
    "run", "db:migrate",
  ], { cwd: releaseDir, timeoutMs: limits.migration, env: databaseEnvironment });
  migrationApplied = true;
  persist({ migrationApplied });
  log("INFO", "Checksum-verified PostgreSQL migrations completed under the project advisory lock");

  const artifacts = validateReleaseArtifacts(releaseDir, targetCommit);
  applicationVersion = artifacts.version;
  persist({ applicationVersion });

  setStage("atomic release cutover");
  await atomicSwitchCurrent({ fs, currentLink, target: releaseDir, nonce: deploymentId });
  switched = true;
  await activateRelease(applicationVersion);

  const success = {
    deploymentId,
    currentRelease: releaseDir,
    previousRelease,
    currentCommit: targetCommit,
    previousCommit,
    currentVersion: applicationVersion,
    previousVersion,
    succeededAt: new Date().toISOString(),
    migrationApplied,
    migrationMayHaveChanged,
  };
  atomicJson(lastSuccessPath, success);
  await pruneOldReleases(releaseDir);
  persist({
    result: "SUCCESS",
    stage: "complete",
    finishedAt: new Date().toISOString(),
    durationMs: elapsedMs(),
    previousCommit,
    targetCommit,
    applicationVersion,
    releasePath: releaseDir,
    previousRelease,
    migrationApplied,
    migrationMayHaveChanged,
  });
  switched = false;
  log("INFO", `deployment ID: ${deploymentId}`);
  log("INFO", `previous commit: ${previousCommit}`);
  log("INFO", `target commit: ${targetCommit}`);
  log("INFO", `application version: ${applicationVersion}`);
  log("INFO", `release path: ${releaseDir}`);
  log("INFO", `deployment duration ms: ${elapsedMs()}`);
  log("INFO", "deployment result: SUCCESS");
  log("INFO", "LUMINA_PRODUCTION_DEPLOY_OK");
}

async function manualRollback() {
  if (!existsSync(lastSuccessPath)) throw new Error("No recorded previous release is available for manual rollback");
  const recorded = JSON.parse(readFileSync(lastSuccessPath, "utf8"));
  const current = await currentReleaseMetadata(resolveCurrentRelease());
  const target = assertReleasePath(releasesRoot, recorded.previousRelease, "Recorded previous release");
  if (target === current.release) throw new Error("Recorded previous release is already current");
  const targetMetadata = await currentReleaseMetadata(target);
  previousRelease = current.release;
  previousCommit = current.commit;
  previousVersion = current.version;
  releaseDir = target;
  targetCommit = targetMetadata.commit;
  applicationVersion = targetMetadata.version;
  persist({ previousRelease, previousCommit, releasePath: releaseDir, targetCommit, applicationVersion });

  setStage("manual application rollback");
  await atomicSwitchCurrent({ fs, currentLink, target, nonce: deploymentId });
  switched = true;
  await activateRelease(applicationVersion);
  atomicJson(lastSuccessPath, {
    deploymentId,
    currentRelease: target,
    previousRelease: current.release,
    currentCommit: targetCommit,
    previousCommit,
    currentVersion: applicationVersion,
    previousVersion,
    succeededAt: new Date().toISOString(),
    migrationApplied: false,
    migrationMayHaveChanged: false,
    note: "Application files rolled back; database migrations were not reverted.",
  });
  persist({
    result: "ROLLBACK_OK",
    stage: "complete",
    finishedAt: new Date().toISOString(),
    durationMs: elapsedMs(),
    rollback: { restored: true, databaseReverted: false },
  });
  switched = false;
  log("INFO", `deployment ID: ${deploymentId}`);
  log("INFO", `previous commit: ${previousCommit}`);
  log("INFO", `target commit: ${targetCommit}`);
  log("INFO", `application version: ${applicationVersion}`);
  log("INFO", `release path: ${releaseDir}`);
  log("INFO", "deployment result: ROLLBACK_OK");
  log("INFO", `Application rollback restored ${target}; database migrations were not reverted`);
  log("INFO", `rollback duration ms: ${elapsedMs()}`);
  log("INFO", "LUMINA_PRODUCTION_ROLLBACK_OK");
}

async function verifyRestoredRelease(release) {
  const metadata = await currentReleaseMetadata(release);
  await sudoSystemctl("keep restored worker timer enabled", ["enable", "--now", workerTimer]);
  await waitForWorkerIdle();
  await sudoSystemctl("verify restored worker cycle", ["start", workerService]);
  await verifySystemd();
  await verifyHealth(metadata.version);
}

async function archiveRequest() {
  try {
    const requestsRoot = path.join(stateRoot, "requests");
    mkdirSync(requestsRoot, { recursive: true, mode: 0o750 });
    if (existsSync(requestPath)) renameSync(requestPath, path.join(requestsRoot, `${deploymentId}.json`));
  } catch (error) {
    log("ERROR", `Could not archive deployment request: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  log("INFO", `Persistent systemd runner accepted request ${request.requestId} in mode ${request.mode}`);
  persist();
  let environments;
  try {
    setStage("environment validation");
    environments = loadEnvironments();
    setStage("deployment filesystem validation");
    validateDeploymentFilesystem({ createReleaseRoot: true });
    await recoverInterruptedRun();
    await preflight();
    if (request.mode === "deploy") await deploy(environments.production, environments.deploy);
    else await manualRollback();
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error), secretValues);
    log("ERROR", message);
    let rollbackResult = { attempted: false, restored: false };
    try {
      rollbackResult = await rollbackAfterCutover({
        switched,
        previousRelease,
        switchCurrent: (target) => atomicSwitchCurrent({ fs, currentLink, target, nonce: `${deploymentId}-rollback` }),
        restartWeb: () => sudoSystemctl("restart restored Lumina web", ["restart", webService]),
        verifyPrevious: verifyRestoredRelease,
      });
      if (rollbackResult.restored) {
        switched = false;
        log("INFO", `Restored previous application release ${previousRelease}; database migrations were not reverted`);
        log("INFO", "LUMINA_PRODUCTION_ROLLBACK_OK");
      }
    } catch (rollbackError) {
      const rollbackMessage = redactSecrets(
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        secretValues,
      );
      log("ERROR", `Automatic application rollback failed: ${rollbackMessage}`);
      log("ERROR", "LUMINA_PRODUCTION_ROLLBACK_FAILED");
      persist({
        result: "ROLLBACK_FAILED",
        stage: "failed",
        finishedAt: new Date().toISOString(),
        durationMs: elapsedMs(),
        error: message,
        rollback: { attempted: true, restored: false, databaseReverted: false, error: rollbackMessage },
      });
      log("ERROR", `deployment ID: ${deploymentId}`);
      log("ERROR", `previous commit: ${previousCommit ?? "unknown"}`);
      log("ERROR", `target commit: ${targetCommit ?? "unknown"}`);
      log("ERROR", `application version: ${applicationVersion ?? "unknown"}`);
      log("ERROR", `release path: ${releaseDir ?? "not created"}`);
      log("ERROR", "deployment result: ROLLBACK_FAILED");
      process.exitCode = 1;
      return;
    }

    if (request.mode === "deploy" && createdRelease && existsSync(releaseDir)
      && (!existsSync(currentLink) || realpathSync(currentLink) !== releaseDir)) {
      try {
        await cleanupFailedRelease({
          releasesRoot,
          releasePath: releaseDir,
          currentTarget: existsSync(currentLink) ? realpathSync(currentLink) : null,
          removeRelease: removeWorktree,
        });
        log("INFO", `Removed failed release ${releaseDir}`);
      } catch (cleanupError) {
        log("ERROR", `Failed release cleanup requires attention: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    } else if (request.mode === "deploy" && createdRelease && releaseDir && !existsSync(releaseDir)) {
      try {
        await run("prune missing failed worktree metadata", "git", ["worktree", "prune", "--expire", "now"], {
          cwd: sourceRoot,
          timeoutMs: limits.git,
        });
      } catch (cleanupError) {
        log("ERROR", `Failed worktree metadata cleanup requires attention: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }

    const result = request.mode === "rollback" ? "ROLLBACK_FAILED" : "FAILED";
    persist({
      result,
      stage: "failed",
      finishedAt: new Date().toISOString(),
      durationMs: elapsedMs(),
      error: message,
      rollback: {
        attempted: rollbackResult.attempted,
        restored: rollbackResult.restored,
        databaseReverted: false,
      },
      migrationApplied,
      migrationMayHaveChanged,
    });
    log("ERROR", migrationMayHaveChanged
      ? "A forward database migration may have been applied; application files were handled separately and database data was not rolled back"
      : "No database rollback was attempted");
    log("ERROR", `deployment ID: ${deploymentId}`);
    log("ERROR", `previous commit: ${previousCommit ?? "unknown"}`);
    log("ERROR", `target commit: ${targetCommit ?? "unknown"}`);
    log("ERROR", `application version: ${applicationVersion ?? "unknown"}`);
    log("ERROR", `release path: ${releaseDir ?? "not created"}`);
    log("ERROR", `deployment result: ${result}`);
    log("ERROR", request.mode === "rollback" ? "LUMINA_PRODUCTION_ROLLBACK_FAILED" : "LUMINA_PRODUCTION_DEPLOY_FAILED");
    process.exitCode = 1;
  } finally {
    await archiveRequest();
  }
}

await main();
