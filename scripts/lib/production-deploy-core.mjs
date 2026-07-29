import path from "node:path";
import { parseEnv } from "node:util";
import {
  assertProxyFreeEnvironment,
  assertProxyFreeSystemdEnvironment,
  directRuntimeEnvironment,
} from "./direct-environment.mjs";

export {
  assertProxyFreeEnvironment,
  assertProxyFreeSystemdEnvironment,
  directRuntimeEnvironment,
};

export const PRODUCTION_PUBLIC_URL = "https://crm.ewaya.com";
export const PRODUCTION_LOCAL_URL = "http://127.0.0.1:3200";
export const PRODUCTION_DEPLOY_LOCK_PATH = "/var/lib/lumina-crm/deploy.lock";
export const PRODUCTION_LOCAL_OBJECT_ROOT = "/var/lib/lumina-crm/objects";
export const GITHUB_PULL_PROXY_URL = "http://127.0.0.1:20271";
export const RELEASE_NAME_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/;
export const LEGACY_RELEASE_NAME_PATTERN = /^\d{14}-[0-9a-f]{12}$/;
export const DEPLOYMENT_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{32}$/;
export const REVIEWED_INSTALL_SCRIPTS = Object.freeze({
  "argon2@0.45.1": true,
  "esbuild@0.28.1": true,
  "unrs-resolver@1.12.2": true,
});
export const PRODUCTION_RUNTIME_REQUIRED_KEYS = Object.freeze([
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
]);
export const PRODUCTION_RUNTIME_EXACT_VALUES = Object.freeze({
  APP_URL: PRODUCTION_PUBLIC_URL,
  TURNSTILE_EXPECTED_HOSTNAME: "crm.ewaya.com",
});
export const PRODUCTION_RUNTIME_FORBIDDEN_PATTERNS = Object.freeze([
  /^(?:PATH|HOME|USER|LOGNAME|SHELL|NODE_OPTIONS|NODE_ENV|CI|TMPDIR|TMP|TEMP|XDG_CACHE_HOME|SSH_AUTH_SOCK)$/i,
  /^(?:NPM_CONFIG_.+|LUMINA_HTTPS_PROXY|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|NODE_USE_ENV_PROXY|GIT_PROXY_COMMAND|LD_PRELOAD|LD_LIBRARY_PATH|BASH_ENV|ENV)$/i,
  /^(?:DATABASE_ADMIN_URL|MIGRATION_DATABASE_URL|CRM_(?:APP|SYSTEM|WORKER|MIGRATOR|BACKUP)_DB_PASSWORD|BACKUP_.+|DISK_.+|LUMINA_(?:DOCKER|DEPLOY|ROOT|RELEASE|FAILED|BUILDKIT)_.+|ADMIN_.+)$/i,
]);
export const DEPLOY_ENV_ALLOWED_KEYS = Object.freeze([
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
  "LUMINA_DOCKER_DATA_ROOT",
  "LUMINA_DEPLOY_MIN_FREE_PERCENT",
  "LUMINA_ROOT_MIN_FREE_GB",
  "LUMINA_DOCKER_MIN_FREE_GB",
  "LUMINA_RELEASE_MIN_FREE_GB",
  "LUMINA_RELEASE_RETENTION",
  "LUMINA_FAILED_RELEASE_RETENTION_HOURS",
  "LUMINA_BUILDKIT_CACHE_RETENTION_HOURS",
  "LUMINA_BUILDKIT_MAX_CACHE_GB",
  "LUMINA_BUILDKIT_RESERVED_CACHE_GB",
]);

const REQUIRED_READINESS_CHECKS = ["environment", "auth", "database", "workers", "queues"];
const SECRET_KEY_PATTERN = /(TOKEN|SECRET|PASSWORD|PRIVATE|SERVICE_ROLE|KEY|CREDENTIAL|DSN|CONNECTION_STRING|WEBHOOK_URL)/i;
const GIBIBYTE = 1024 ** 3;

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

function databaseUsername(value, label) {
  try {
    const parsed = new URL(String(value));
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.username) throw new Error();
    return decodeURIComponent(parsed.username);
  } catch {
    throw new Error(`${label} must be a complete PostgreSQL URL`);
  }
}

export function validateProductionRuntimeEnvironment(environment, { label = "production.env" } = {}) {
  validateEnvironmentKeyPolicy(environment, {
    label,
    forbidden: PRODUCTION_RUNTIME_FORBIDDEN_PATTERNS,
  });
  validateRequiredEnvironment(environment, {
    label,
    required: PRODUCTION_RUNTIME_REQUIRED_KEYS,
    exact: PRODUCTION_RUNTIME_EXACT_VALUES,
  });

  const databaseRoles = {
    DATABASE_URL: "crm_app",
    SYSTEM_DATABASE_URL: "crm_system",
    WORKER_DATABASE_URL: "crm_worker",
  };
  const mismatchedRoles = Object.entries(databaseRoles)
    .filter(([key, role]) => databaseUsername(environment[key], `${label} ${key}`) !== role)
    .map(([key]) => key);
  if (mismatchedRoles.length) {
    throw new Error(`${label} must use the dedicated v3 runtime database roles for: ${mismatchedRoles.join(", ")}`);
  }

  const provider = String(environment.OBJECT_STORAGE_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "local") {
    validateRequiredEnvironment(environment, {
      label,
      required: ["OBJECT_STORAGE_LOCAL_ROOT"],
      exact: { OBJECT_STORAGE_LOCAL_ROOT: PRODUCTION_LOCAL_OBJECT_ROOT },
    });
  } else if (provider === "s3") {
    validateRequiredEnvironment(environment, {
      label,
      required: [
        "S3_ENDPOINT",
        "S3_REGION",
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ],
    });
    let endpoint;
    try { endpoint = new URL(environment.S3_ENDPOINT); } catch { throw new Error(`${label} S3_ENDPOINT must be a valid HTTPS URL`); }
    if (endpoint.protocol !== "https:") throw new Error(`${label} S3_ENDPOINT must be a valid HTTPS URL`);
  } else {
    throw new Error(`${label} OBJECT_STORAGE_PROVIDER must be local or s3`);
  }
  return true;
}

export function validateMigrationEnvironment(environment, { label = "deploy.env" } = {}) {
  validateRequiredEnvironment(environment, {
    label,
    required: ["MIGRATION_DATABASE_URL"],
  });
  if (databaseUsername(environment.MIGRATION_DATABASE_URL, `${label} MIGRATION_DATABASE_URL`) !== "crm_migrator") {
    throw new Error(`${label} MIGRATION_DATABASE_URL must use the dedicated crm_migrator role`);
  }
  if (environment.BACKUP_DATABASE_URL
    && databaseUsername(environment.BACKUP_DATABASE_URL, `${label} BACKUP_DATABASE_URL`) !== "crm_backup") {
    throw new Error(`${label} BACKUP_DATABASE_URL must use the dedicated crm_backup role`);
  }
  return true;
}

function boundedInteger(value, {
  label,
  minimum,
  maximum,
  fallback,
}) {
  const source = String(value ?? fallback);
  if (!/^\d+$/.test(source)) throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function parseDeploymentStoragePolicy(environment = {}) {
  const dockerDataRoot = assertSpecificAbsolutePath(
    String(environment.LUMINA_DOCKER_DATA_ROOT ?? "/var/lib/docker"),
    "LUMINA_DOCKER_DATA_ROOT",
  );
  const policy = {
    dockerDataRoot,
    minimumFreePercent: boundedInteger(environment.LUMINA_DEPLOY_MIN_FREE_PERCENT, {
      label: "LUMINA_DEPLOY_MIN_FREE_PERCENT",
      minimum: 5,
      maximum: 50,
      fallback: 15,
    }),
    rootMinimumAvailableBytes: boundedInteger(environment.LUMINA_ROOT_MIN_FREE_GB, {
      label: "LUMINA_ROOT_MIN_FREE_GB",
      minimum: 2,
      maximum: 1024,
      fallback: 8,
    }) * GIBIBYTE,
    dockerMinimumAvailableBytes: boundedInteger(environment.LUMINA_DOCKER_MIN_FREE_GB, {
      label: "LUMINA_DOCKER_MIN_FREE_GB",
      minimum: 2,
      maximum: 1024,
      fallback: 10,
    }) * GIBIBYTE,
    releaseMinimumAvailableBytes: boundedInteger(environment.LUMINA_RELEASE_MIN_FREE_GB, {
      label: "LUMINA_RELEASE_MIN_FREE_GB",
      minimum: 2,
      maximum: 1024,
      fallback: 8,
    }) * GIBIBYTE,
    releaseRetention: boundedInteger(environment.LUMINA_RELEASE_RETENTION, {
      label: "LUMINA_RELEASE_RETENTION",
      minimum: 3,
      maximum: 20,
      fallback: 5,
    }),
    failedReleaseRetentionHours: boundedInteger(environment.LUMINA_FAILED_RELEASE_RETENTION_HOURS, {
      label: "LUMINA_FAILED_RELEASE_RETENTION_HOURS",
      minimum: 1,
      maximum: 720,
      fallback: 24,
    }),
    buildkitCacheRetentionHours: boundedInteger(environment.LUMINA_BUILDKIT_CACHE_RETENTION_HOURS, {
      label: "LUMINA_BUILDKIT_CACHE_RETENTION_HOURS",
      minimum: 24,
      maximum: 2160,
      fallback: 168,
    }),
    buildkitMaxCacheGb: boundedInteger(environment.LUMINA_BUILDKIT_MAX_CACHE_GB, {
      label: "LUMINA_BUILDKIT_MAX_CACHE_GB",
      minimum: 2,
      maximum: 512,
      fallback: 12,
    }),
    buildkitReservedCacheGb: boundedInteger(environment.LUMINA_BUILDKIT_RESERVED_CACHE_GB, {
      label: "LUMINA_BUILDKIT_RESERVED_CACHE_GB",
      minimum: 1,
      maximum: 128,
      fallback: 2,
    }),
  };
  if (policy.buildkitReservedCacheGb >= policy.buildkitMaxCacheGb) {
    throw new Error("LUMINA_BUILDKIT_RESERVED_CACHE_GB must be lower than LUMINA_BUILDKIT_MAX_CACHE_GB");
  }
  return Object.freeze(policy);
}

export function diskSnapshotFromStatfs(check, status) {
  const totalBytes = Number(status?.blocks) * Number(status?.bsize);
  const availableBytes = Number(status?.bavail) * Number(status?.bsize);
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0
    || !Number.isSafeInteger(availableBytes) || availableBytes < 0) {
    throw new Error(`Could not calculate disk capacity for ${check.label} (${check.path})`);
  }
  return {
    label: String(check.label),
    path: path.resolve(check.path),
    totalBytes,
    availableBytes,
    freePercent: Number((availableBytes / totalBytes * 100).toFixed(2)),
    minimumAvailableBytes: Number(check.minimumAvailableBytes),
    minimumFreePercent: Number(check.minimumFreePercent),
  };
}

export function assertDeploymentDiskCapacity(snapshots) {
  if (!Array.isArray(snapshots) || !snapshots.length) throw new Error("Deployment disk checks are required");
  const unhealthy = snapshots.filter((snapshot) => (
    snapshot.availableBytes < snapshot.minimumAvailableBytes
    || snapshot.freePercent < snapshot.minimumFreePercent
  ));
  if (unhealthy.length) {
    const details = unhealthy.map((snapshot) => (
      `${snapshot.label} (${snapshot.path}) has ${snapshot.availableBytes} bytes/${snapshot.freePercent}% free; `
      + `requires at least ${snapshot.minimumAvailableBytes} bytes/${snapshot.minimumFreePercent}%`
    ));
    throw new Error(`LUMINA_DEPLOY_DISK_GATE_FAILED: ${details.join("; ")}`);
  }
  return snapshots;
}

export function githubPullArguments({
  proxyUrl = GITHUB_PULL_PROXY_URL,
  remote = "origin",
  branch = "main",
} = {}) {
  const parsed = new URL(proxyUrl);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port) {
    throw new Error("The one-shot GitHub proxy must be an explicit IPv4 loopback HTTP URL");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(remote) || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error("Git pull remote or branch is invalid");
  }
  const sshCommand = `/usr/bin/ssh -o ProxyCommand='/usr/bin/nc -X connect -x ${parsed.hostname}:${parsed.port} %h %p'`;
  return ["-c", `core.sshCommand=${sshCommand}`, "pull", "--ff-only", remote, branch];
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
      if (!response.ok) {
        const reasons = Array.isArray(payload.failureReasons)
          ? payload.failureReasons.flatMap((reason) => {
              const component = String(reason?.component ?? "");
              const code = String(reason?.code ?? "");
              return /^[a-z]+$/.test(component) && /^[A-Z][A-Z0-9_]{2,80}$/.test(code)
                ? [`${component}:${code}`]
                : [];
            })
          : [];
        throw new Error(`HTTP ${response.status}${reasons.length ? ` (${reasons.join(", ")})` : ""}`);
      }
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
}) {
  if (web.ActiveState !== "active" || web.SubState !== "running" || web.UnitFileState !== "enabled") {
    throw new Error("Lumina web service must be active, running, and enabled");
  }
  if (!web.ExecStart?.includes("--port 3200") || !web.ExecStart?.includes("--hostname 127.0.0.1")) {
    throw new Error("Lumina web ExecStart must bind port 3200 to 127.0.0.1");
  }
  for (const [label, unit] of [["web", web], ["worker", worker]]) {
    assertProxyFreeSystemdEnvironment(unit.Environment, `Lumina ${label} unit`);
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

export function planReleasesForCleanup(entries, {
  releasesRoot,
  currentRelease,
  previousRelease,
  activeRelease,
  retain = 5,
  failedRetentionMs = 24 * 60 * 60 * 1_000,
  nowMs = Date.now(),
}) {
  if (!Number.isInteger(retain) || retain < 2) throw new Error("Release retention must be at least 2");
  if (!Number.isFinite(failedRetentionMs) || failedRetentionMs < 0) {
    throw new Error("Failed release retention must be non-negative");
  }
  const protectedPaths = new Set([currentRelease, previousRelease, activeRelease]
    .filter(Boolean)
    .map((item) => path.resolve(item)));
  const valid = entries
    .map((entry) => ({ ...entry, path: assertReleasePath(releasesRoot, entry.path) }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path));
  const newestSuccessful = new Set(valid
    .filter((entry) => entry.successful !== false)
    .slice(0, retain)
    .map((entry) => entry.path));
  return valid
    .filter((entry) => !protectedPaths.has(entry.path))
    .flatMap((entry) => {
      if (entry.successful !== false) {
        return newestSuccessful.has(entry.path) ? [] : [{ path: entry.path, reason: "old-success" }];
      }
      return nowMs - entry.mtimeMs >= failedRetentionMs
        ? [{ path: entry.path, reason: "failed-residue" }]
        : [];
    });
}

export function selectReleasesForCleanup(entries, options) {
  return planReleasesForCleanup(entries, options).map((entry) => entry.path);
}

export async function runNonFatalCleanup(cleanup, onFailure = () => {}) {
  try {
    return { ok: true, value: await cleanup() };
  } catch (error) {
    await onFailure(error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
  if (prior.applicationAccepted === true
    && path.resolve(currentRelease ?? "") === path.resolve(prior.releasePath)) {
    return {
      action: "FINALIZE_ACCEPTED",
      acceptedRelease: prior.releasePath,
      migrationMayHaveChanged,
    };
  }
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

export function validateDeployAssetTexts({
  serviceUnit,
  sudoers,
  webUnit,
  workerUnit,
  productionEnvironment,
  deploymentEnvironment,
  runner,
  storagePrepareUnit,
  storageCleanupUnit,
  storageMaintenance,
  buildkitConfiguration,
  packageJson,
}) {
  const failures = [];
  const lockCommand = `/usr/bin/flock --nonblock --exclusive --conflict-exit-code=73 ${PRODUCTION_DEPLOY_LOCK_PATH}`;
  if (!serviceUnit.includes(lockCommand)) failures.push("deploy service must lock inside its systemd StateDirectory");
  if (serviceUnit.includes("/var/lock/") || /^ReadWritePaths=.*\.lock(?:\s|$)/m.test(serviceUnit)) {
    failures.push("deploy service must not require an individual volatile lock file to exist before namespace setup");
  }
  if (!serviceUnit.includes("--conflict-exit-code=73")) failures.push("deploy service must expose a distinct lock conflict exit code");
  if (!serviceUnit.includes("User=lumina-crm") || !serviceUnit.includes("Group=lumina-crm")) failures.push("deploy service must run as lumina-crm");
  try { assertProxyFreeSystemdEnvironment(serviceUnit, "deploy service"); } catch (error) { failures.push(error.message); }
  if (!serviceUnit.includes("UnsetEnvironment=HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY")) {
    failures.push("deploy service must explicitly clear inherited proxy environment");
  }
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
  if (!runner.includes("directLocalFetch")) failures.push("localhost health checks must stay on the direct loopback transport");
  if (!runner.includes("githubPullArguments")) failures.push("GitHub pull must use the reviewed one-shot proxy arguments");
  if (runner.includes('"fetch", "--prune"') || runner.includes('"merge", "--ff-only"')) {
    failures.push("GitHub update must not use a separate fetch/merge sequence");
  }
  if (!runner.includes("directRuntimeEnvironment")) failures.push("deploy child stages must strip proxy environment");
  if (!runner.includes("process.versions.node")) failures.push("deploy runner must enforce Node.js 24.x");
  if (!runner.includes("applicationAccepted: true")
    || !runner.includes("postSuccessCleanup(releaseDir)")
    || !runner.includes("prepareDeploymentStorage()")) {
    failures.push("deploy runner must gate storage and persist health acceptance before non-fatal cleanup");
  }
  if (!runner.includes("mkdirSync(PRODUCTION_LOCAL_OBJECT_ROOT")
    || !runner.includes('assertRealDirectory(PRODUCTION_LOCAL_OBJECT_ROOT, "Persistent object storage sandbox directory")')) {
    failures.push("deploy runner must create and verify the persistent object storage sandbox directory");
  }
  if (!webUnit.includes("--hostname 127.0.0.1")) failures.push("web unit must bind to 127.0.0.1");
  if (!/^ReadWritePaths=.*\/var\/lib\/lumina-crm\/objects(?:\s|$)/m.test(webUnit ?? "")) {
    failures.push("web unit must allow writes to the persistent local object root");
  }
  if (!/^ReadWritePaths=.*\/var\/lib\/lumina-crm\/objects(?:\s|$)/m.test(workerUnit ?? "")) {
    failures.push("worker unit must allow writes to the persistent local object root");
  }
  try {
    validateProductionRuntimeEnvironment(
      parseEnvironmentText(productionEnvironment, "production.env.example"),
      { label: "production.env.example" },
    );
  } catch (error) {
    failures.push(error.message);
  }
  try {
    const example = parseEnvironmentText(deploymentEnvironment, "deploy.env.example");
    validateEnvironmentKeyPolicy(example, {
      label: "deploy.env.example",
      allowed: DEPLOY_ENV_ALLOWED_KEYS,
    });
    validateMigrationEnvironment(example, { label: "deploy.env.example" });
    parseDeploymentStoragePolicy(example);
  } catch (error) {
    failures.push(error.message);
  }
  for (const forbidden of ["cloudflared", "hunterai", "v2raya", "reboot", "poweroff"]) {
    if (sudoers.toLowerCase().includes(forbidden)) failures.push(`sudoers must not mention ${forbidden}`);
    if (runner.toLowerCase().includes(forbidden)) failures.push(`deploy runner must not mention ${forbidden}`);
  }
  if (/\/usr\/bin\/docker|docker\.sock|["']docker["']/.test(runner.toLowerCase())) {
    failures.push("deploy runner must not execute Docker or access its socket directly");
  }
  if (/\/usr\/bin\/docker|docker\.sock|["']docker["']/.test(sudoers.toLowerCase())) {
    failures.push("sudoers must not grant Docker CLI or socket access");
  }
  if (runner.includes('"db", "reset"')) failures.push("deploy runner must not reset the database");
  if (sudoers.includes("*")) failures.push("sudoers must not contain wildcard commands");
  try { assertReviewedInstallScriptPolicy(packageJson); } catch (error) { failures.push(error.message); }
  if (!sudoers.includes("lumina-crm-deploy.service")
    || !sudoers.includes("lumina-crm-storage-prepare.service")
    || !sudoers.includes("lumina-crm-storage-cleanup.service")
    || !sudoers.includes("lumina-crm.service")
    || !sudoers.includes("lumina-crm-workers.service")
    || !sudoers.includes("lumina-crm-workers.timer")) {
    failures.push("sudoers is missing a required Lumina unit");
  }
  for (const [label, unit, mode] of [
    ["storage prepare unit", storagePrepareUnit, "prepare"],
    ["storage cleanup unit", storageCleanupUnit, "cleanup"],
  ]) {
    if (!unit?.includes("User=root")
      || !unit.includes("Group=lumina-crm")
      || !unit.includes(`ExecStart=/usr/bin/node /usr/local/libexec/lumina-crm-storage-maintenance.mjs ${mode}`)
      || !unit.includes("ProtectSystem=strict")
      || !unit.includes("RestrictAddressFamilies=AF_UNIX")
      || !unit.includes("ReadWritePaths=/run/docker.sock")
      || unit.includes("/opt/lumina-crm/source/scripts/")) {
      failures.push(`${label} must use the fixed root-owned maintenance entrypoint and constrained Docker socket sandbox`);
    }
  }
  if (!storageMaintenance?.includes('LUMINA_BUILDER_NAME = "lumina-crm-buildkit"')
    || !storageMaintenance.includes('LUMINA_COMPOSE_PROJECT = "lumina-crm"')
    || !storageMaintenance.includes("assertAllowedDockerArguments")
    || !storageMaintenance.includes("selectLuminaImageCandidates")
    || !storageMaintenance.includes("LUMINA_DEPLOY_DISK_GATE_FAILED")) {
    failures.push("storage maintenance must enforce Lumina builder, image identity, command allowlist, and disk gate");
  }
  for (const forbidden of [
    "docker system prune",
    "docker image prune",
    "docker volume prune",
    "docker network prune",
    "docker system prune --volumes",
  ]) {
    if (storageMaintenance?.toLowerCase().includes(forbidden)) {
      failures.push(`storage maintenance must not contain ${forbidden}`);
    }
  }
  if (!buildkitConfiguration?.includes('maxUsedSpace = "12GB"')
    || !buildkitConfiguration.includes('keepDuration = "168h"')
    || !buildkitConfiguration.includes('minFreeSpace = "10GB"')) {
    failures.push("Lumina BuildKit configuration must cap cache, age it, and preserve host free space");
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
