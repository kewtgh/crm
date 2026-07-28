import path from "node:path";
import { parseEnv } from "node:util";

export const PRODUCTION_PROJECT_REF = "ectxevxmcwzvwsjkwnld";
export const PRODUCTION_PUBLIC_URL = "https://crm.ewaya.com";
export const PRODUCTION_LOCAL_URL = "http://127.0.0.1:3200";
export const PRODUCTION_DEPLOY_LOCK_PATH = "/var/lib/lumina-crm/deploy.lock";
export const RELEASE_NAME_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/;
export const LEGACY_RELEASE_NAME_PATTERN = /^\d{14}-[0-9a-f]{12}$/;
export const DEPLOYMENT_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{32}$/;
export const REVIEWED_INSTALL_SCRIPTS = Object.freeze({
  "esbuild@0.28.1": true,
  "unrs-resolver@1.12.2": true,
  "workerd@1.20260714.1": true,
});

const REQUIRED_READINESS_CHECKS = ["environment", "auth", "database", "workers", "queues"];
const SECRET_KEY_PATTERN = /(TOKEN|SECRET|PASSWORD|PRIVATE|SERVICE_ROLE|KEY|CREDENTIAL|DSN|CONNECTION_STRING|WEBHOOK_URL)/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compactUtc(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("Deployment time is invalid");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function makeDeploymentId(date, requestId) {
  const nonce = String(requestId ?? "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error("Deployment request ID is invalid");
  return `${compactUtc(date)}-${nonce}`;
}

export function makeReleaseId(date, commit) {
  const revision = String(commit ?? "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Target commit must be a full 40-character SHA");
  return `${compactUtc(date)}-${revision.slice(0, 12)}`;
}

export function assertSpecificAbsolutePath(value, label) {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(value) || resolved === path.parse(resolved).root) {
    throw new Error(`${label} must be a specific absolute path`);
  }
  return resolved;
}

export function assertPathWithin(parent, candidate, { directChild = false, label = "Path" } = {}) {
  const root = assertSpecificAbsolutePath(parent, "Parent path");
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay below ${root}`);
  }
  if (directChild && relative.includes(path.sep)) {
    throw new Error(`${label} must be a direct child of ${root}`);
  }
  return target;
}

export function assertReleasePath(releasesRoot, candidate, label = "Release path") {
  const target = assertPathWithin(releasesRoot, candidate, { directChild: true, label });
  if (!RELEASE_NAME_PATTERN.test(path.basename(target)) && !LEGACY_RELEASE_NAME_PATTERN.test(path.basename(target))) {
    throw new Error(`${label} does not match the UTC timestamp and commit release format`);
  }
  return target;
}

export function parseEnvironmentText(text, label) {
  try {
    return parseEnv(String(text));
  } catch {
    throw new Error(`${label} is not a valid environment file`);
  }
}

export function validateEnvironmentFileMetadata(metadata, {
  label,
  currentUid,
  allowedGroupIds = [],
} = {}) {
  if (!metadata?.isFile?.() || metadata?.isSymbolicLink?.()) {
    throw new Error(`${label} must be a regular file, not a symlink`);
  }
  const permissions = Number(metadata.mode) & 0o777;
  if (![0o400, 0o440, 0o600, 0o640].includes(permissions)) {
    throw new Error(`${label} permissions must be 0400, 0440, 0600, or 0640`);
  }
  if (metadata.uid !== 0 && metadata.uid !== currentUid) {
    throw new Error(`${label} must be owned by root or the deployment user`);
  }
  if ((permissions & 0o040) !== 0 && !allowedGroupIds.includes(metadata.gid) && metadata.uid !== currentUid) {
    throw new Error(`${label} group-readable mode requires the deployment user's group`);
  }
  return permissions;
}

export function validateDirectoryMetadata(metadata, { label } = {}) {
  if (!metadata?.isDirectory?.() || metadata?.isSymbolicLink?.()) {
    throw new Error(`${label} must be a real directory, not a symlink`);
  }
  return true;
}

export function validateRequiredEnvironment(environment, {
  label,
  required = [],
  exact = {},
} = {}) {
  const missing = required.filter((key) => !String(environment[key] ?? "").trim());
  if (missing.length) throw new Error(`${label} is missing required variables: ${missing.join(", ")}`);
  const mismatched = Object.entries(exact)
    .filter(([key, expected]) => String(environment[key] ?? "").trim() !== expected)
    .map(([key]) => key);
  if (mismatched.length) throw new Error(`${label} has unexpected values for: ${mismatched.join(", ")}`);
}

export function validateEnvironmentKeyPolicy(environment, {
  label,
  allowed,
  forbidden = [],
} = {}) {
  const keys = Object.keys(environment ?? {});
  const allowedKeys = allowed ? new Set(allowed) : null;
  const disallowed = keys.filter((key) => (
    (allowedKeys && !allowedKeys.has(key))
    || forbidden.some((pattern) => pattern.test(key))
  ));
  if (disallowed.length) {
    throw new Error(`${label} contains disallowed variables: ${disallowed.sort().join(", ")}`);
  }
  return true;
}

export function collectSecretValues(...environments) {
  return [...new Set(environments.flatMap((environment) => Object.entries(environment ?? {})
    .filter(([key, value]) => SECRET_KEY_PATTERN.test(key) && String(value).length >= 4)
    .map(([, value]) => String(value))))]
    .sort((left, right) => right.length - left.length);
}

export function redactSecrets(value, secretValues = []) {
  let output = String(value ?? "");
  for (const secret of secretValues) {
    output = output.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) output = output.replace(new RegExp(escapeRegExp(encoded), "g"), "[REDACTED]");
  }
  return output
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/(https?:\/\/[^:/\s]+:)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[REDACTED]");
}

export async function atomicSwitchCurrent({
  fs,
  currentLink,
  target,
  nonce = process.pid,
}) {
  const temporary = `${currentLink}.next-${nonce}`;
  await fs.rm(temporary, { force: true });
  await fs.symlink(target, temporary, "dir");
  await fs.rename(temporary, currentLink);
  return target;
}

export async function cleanupFailedRelease({
  releasesRoot,
  releasePath,
  currentTarget,
  removeRelease,
}) {
  if (!releasePath) return false;
  const safeRelease = assertReleasePath(releasesRoot, releasePath, "Failed release");
  if (currentTarget && path.resolve(currentTarget) === safeRelease) {
    throw new Error("Refusing to remove a failed release while it is current");
  }
  await removeRelease(safeRelease);
  return true;
}

export async function rollbackAfterCutover({
  switched,
  previousRelease,
  switchCurrent,
  restartWeb,
  verifyPrevious,
}) {
  if (!switched) return { attempted: false, restored: false };
  if (!previousRelease) throw new Error("No previous release is available; current was not changed");
  await switchCurrent(previousRelease);
  await restartWeb();
  await verifyPrevious(previousRelease);
  return { attempted: true, restored: true, release: previousRelease };
}

export function assertHealthPayload(payload, expectedVersion, { readiness = false } = {}) {
  if (!payload || payload.status !== "ok") throw new Error(`Health status is ${String(payload?.status ?? "missing")}`);
  if (payload.version !== expectedVersion) {
    throw new Error(`Health version ${String(payload.version ?? "missing")} does not match ${expectedVersion}`);
  }
  if (!readiness) return true;
  const failedChecks = REQUIRED_READINESS_CHECKS.filter((key) => payload.checks?.[key] !== true);
  if (failedChecks.length) throw new Error(`Readiness checks failed: ${failedChecks.join(", ")}`);
  const unhealthyMetrics = ["staleWorkers", "missingWorkers", "failedJobs", "stuckJobs"]
    .filter((key) => Number(payload.metrics?.[key] ?? 0) !== 0);
  if (unhealthyMetrics.length) throw new Error(`Readiness metrics are non-zero: ${unhealthyMetrics.join(", ")}`);
  const missing = Array.isArray(payload.configuration?.missing) ? payload.configuration.missing : [];
  if (missing.length) throw new Error(`Expected configuration is missing: ${missing.join(", ")}`);
  const expected = payload.configuration?.expected;
  const configured = payload.configuration?.configured;
  if (Number.isFinite(expected) && Number.isFinite(configured)) {
    if (Number(configured) !== Number(expected)) {
      throw new Error(`Expected configuration count is ${expected}, but only ${configured} is configured`);
    }
  } else if (Array.isArray(expected) && Array.isArray(configured)) {
    const configuredKeys = new Set(configured);
    const absent = expected.filter((key) => !configuredKeys.has(key));
    if (absent.length) throw new Error(`Expected configuration is not configured: ${absent.join(", ")}`);
  } else {
    throw new Error("Readiness configuration counts are missing");
  }
  return true;
}

export async function retryHealth({
  fetchImpl,
  url,
  expectedVersion,
  readiness = false,
  timeoutMs,
  requestTimeoutMs = 5_000,
  intervalMs = 1_000,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onFailure = () => {},
}) {
  const deadline = now() + timeoutMs;
  let lastError = "no response";
  let attempts = 0;
  while (now() < deadline) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - now()))),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      assertHealthPayload(payload, expectedVersion, { readiness });
      return { attempts, payload };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      onFailure({ attempt: attempts, error: lastError });
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(intervalMs, remaining));
  }
  throw new Error(`Health check failed after ${attempts} attempt(s): ${lastError}`);
}

export function parseSystemdProperties(text) {
  const result = {};
  for (const line of String(text).split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

export function assertSystemdRuntime({
  web,
  worker,
  timer,
  proxyUrl = "http://127.0.0.1:20271",
  proxyPreload = "/opt/lumina-crm/runtime-proxy/register-proxy.mjs",
}) {
  if (web.ActiveState !== "active" || web.SubState !== "running" || web.UnitFileState !== "enabled") {
    throw new Error("Lumina web service must be active, running, and enabled");
  }
  if (!web.ExecStart?.includes("--port 3200") || !web.ExecStart?.includes("--hostname 127.0.0.1")) {
    throw new Error("Lumina web ExecStart must bind port 3200 to 127.0.0.1");
  }
  for (const [label, unit] of [["web", web], ["worker", worker]]) {
    const environment = unit.Environment ?? "";
    if (!environment.includes(`LUMINA_HTTPS_PROXY=${proxyUrl}`)) {
      throw new Error(`Lumina ${label} unit is missing LUMINA_HTTPS_PROXY`);
    }
    if (!environment.includes(`NODE_OPTIONS=--import=${proxyPreload}`)) {
      throw new Error(`Lumina ${label} unit is missing the ProxyAgent preload`);
    }
  }
  if (worker.Result !== "success" || Number(worker.ExecMainStatus) !== 0) {
    throw new Error("Lumina worker cycle did not complete successfully");
  }
  if (timer.ActiveState !== "active" || timer.SubState !== "waiting" || timer.UnitFileState !== "enabled") {
    throw new Error("Lumina worker timer must be active, waiting, and enabled");
  }
  return true;
}

export function assertLoopbackListener(output, port = 3200) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const relevant = lines.filter((line) => line.includes(`:${port}`));
  if (!relevant.length) throw new Error(`No listener was found on port ${port}`);
  const unsafe = relevant.filter((line) => (
    line.includes(`0.0.0.0:${port}`)
    || line.includes(`[::]:${port}`)
    || line.includes(`*:${port}`)
  ));
  if (unsafe.length) throw new Error(`Port ${port} is listening on a non-loopback address`);
  if (!relevant.some((line) => line.includes(`127.0.0.1:${port}`))) {
    throw new Error(`Port ${port} is not listening on 127.0.0.1`);
  }
  return true;
}

export function selectReleasesForCleanup(entries, {
  releasesRoot,
  currentRelease,
  previousRelease,
  activeRelease,
  retain = 5,
}) {
  if (!Number.isInteger(retain) || retain < 2) throw new Error("Release retention must be at least 2");
  const protectedPaths = new Set([currentRelease, previousRelease, activeRelease]
    .filter(Boolean)
    .map((item) => path.resolve(item)));
  const valid = entries
    .map((entry) => ({ ...entry, path: assertReleasePath(releasesRoot, entry.path) }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path));
  const newest = new Set(valid.slice(0, retain).map((entry) => entry.path));
  return valid
    .filter((entry) => !protectedPaths.has(entry.path) && !newest.has(entry.path))
    .map((entry) => entry.path);
}

export async function writeExclusiveRequest(fs, requestPath, request) {
  try {
    await fs.writeFile(requestPath, `${JSON.stringify(request)}\n`, { flag: "wx", mode: 0o640 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("A production deployment request is already pending or running");
    throw error;
  }
}

export function classifyPersistedDeployment({ serviceActive, request, latest }) {
  if (serviceActive) return { state: "RUNNING", deploymentId: latest?.deploymentId ?? null };
  if (latest?.result && ["SUCCESS", "FAILED", "ROLLBACK_OK", "ROLLBACK_FAILED"].includes(latest.result)
    && (!request || request.requestId === latest.requestId)) {
    return { state: latest.result, deploymentId: latest.deploymentId ?? null };
  }
  if (request) return { state: "PENDING_RECOVERABLE", requestId: request.requestId };
  if (latest?.result) return { state: latest.result, deploymentId: latest.deploymentId ?? null };
  return { state: "IDLE", deploymentId: null };
}

export function isSystemdServiceInProgress(activeState) {
  return ["activating", "active", "reloading", "deactivating"].includes(String(activeState ?? "").trim());
}

export function planInterruptedRecovery({ requestId, prior, currentRelease }) {
  if (!prior || prior.requestId !== requestId || prior.result !== "RUNNING") {
    return { action: "NONE" };
  }
  if (!prior.releasePath) return { action: "RESUME_PRE_CUTOVER" };
  const migrationMayHaveChanged = prior.migrationMayHaveChanged === true || prior.migrationApplied === true;
  if (path.resolve(currentRelease ?? "") === path.resolve(prior.releasePath)) {
    if (!prior.previousRelease) {
      throw new Error("Interrupted cutover has no recorded previous release");
    }
    return {
      action: "ROLLBACK_THEN_RESUME",
      failedRelease: prior.releasePath,
      previousRelease: prior.previousRelease,
      migrationMayHaveChanged,
    };
  }
  return {
    action: "CLEANUP_THEN_RESUME",
    failedRelease: prior.releasePath,
    migrationMayHaveChanged,
  };
}

export function assertReviewedInstallScriptPolicy(packageJson) {
  const policy = packageJson?.allowScripts;
  const expectedEntries = Object.entries(REVIEWED_INSTALL_SCRIPTS);
  if (!policy || Object.keys(policy).length !== expectedEntries.length
    || !expectedEntries.every(([name, allowed]) => policy[name] === allowed)) {
    throw new Error("package.json must contain the reviewed, version-pinned npm install-script allowlist");
  }
  return true;
}

export function validateDeployAssetTexts({ serviceUnit, sudoers, webUnit, runner, packageJson }) {
  const failures = [];
  const lockCommand = `/usr/bin/flock --nonblock --exclusive --conflict-exit-code=73 ${PRODUCTION_DEPLOY_LOCK_PATH}`;
  if (!serviceUnit.includes(lockCommand)) failures.push("deploy service must lock inside its systemd StateDirectory");
  if (serviceUnit.includes("/var/lock/") || /^ReadWritePaths=.*\.lock(?:\s|$)/m.test(serviceUnit)) {
    failures.push("deploy service must not require an individual volatile lock file to exist before namespace setup");
  }
  if (!serviceUnit.includes("--conflict-exit-code=73")) failures.push("deploy service must expose a distinct lock conflict exit code");
  if (!serviceUnit.includes("User=lumina-crm") || !serviceUnit.includes("Group=lumina-crm")) failures.push("deploy service must run as lumina-crm");
  if (!serviceUnit.includes("LUMINA_HTTPS_PROXY=http://127.0.0.1:20271")) failures.push("deploy runner proxy is missing");
  if (!serviceUnit.includes("NODE_OPTIONS=--import=/opt/lumina-crm/runtime-proxy/register-proxy.mjs")) failures.push("deploy runner preload is missing");
  if (!serviceUnit.includes("StateDirectory=lumina-crm") || !serviceUnit.includes("LogsDirectory=lumina-crm")) {
    failures.push("deploy service persistent state or log directory is missing");
  }
  if (!/^ReadWritePaths=.*\/var\/lib\/lumina-crm(?:\s|$)/m.test(serviceUnit)) {
    failures.push("deploy service StateDirectory must be writable inside its filesystem namespace");
  }
  if (!serviceUnit.includes("ProtectHome=read-only")
    || !serviceUnit.includes("NPM_CONFIG_CACHE=/var/lib/lumina-crm/npm-cache")
    || !serviceUnit.includes("XDG_CACHE_HOME=/var/lib/lumina-crm/cache")) {
    failures.push("deploy service must use read-only SSH home access and dedicated writable caches");
  }
  if (!runner.includes("sensitiveOutput: true")) failures.push("effective systemd environment output must be withheld from deployment logs");
  if (!runner.includes("directLocalFetch")) failures.push("localhost health checks must bypass the production proxy");
  if (!runner.includes("process.versions.node")) failures.push("deploy runner must enforce Node.js 24.x");
  if (!webUnit.includes("--hostname 127.0.0.1")) failures.push("web unit must bind to 127.0.0.1");
  for (const forbidden of ["cloudflared", "hunterai", "docker", "v2raya", "reboot", "poweroff"]) {
    if (sudoers.toLowerCase().includes(forbidden)) failures.push(`sudoers must not mention ${forbidden}`);
    if (runner.toLowerCase().includes(forbidden)) failures.push(`deploy runner must not mention ${forbidden}`);
  }
  if (runner.includes('"db", "reset"')) failures.push("deploy runner must not reset the database");
  if (sudoers.includes("*")) failures.push("sudoers must not contain wildcard commands");
  try { assertReviewedInstallScriptPolicy(packageJson); } catch (error) { failures.push(error.message); }
  if (!sudoers.includes("lumina-crm-deploy.service")
    || !sudoers.includes("lumina-crm.service")
    || !sudoers.includes("lumina-crm-workers.service")
    || !sudoers.includes("lumina-crm-workers.timer")) {
    failures.push("sudoers is missing a required Lumina unit");
  }
  if (!packageJson.scripts?.["deploy:production"]
    || !packageJson.scripts?.["deploy:production:detach"]
    || !packageJson.scripts?.["deploy:production:status"]
    || !packageJson.scripts?.["deploy:production:logs"]
    || !packageJson.scripts?.["deploy:production:rollback"]
    || !packageJson.scripts?.["deploy:production:dry-run"]) {
    failures.push("package.json is missing a stable production deployment command");
  }
  if (failures.length) throw new Error(`Production deployment assets are invalid: ${failures.join("; ")}`);
  return true;
}
