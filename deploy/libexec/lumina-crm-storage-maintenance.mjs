#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export const LUMINA_BUILDER_NAME = "lumina-crm-buildkit";
export const LUMINA_COMPOSE_PROJECT = "lumina-crm";
export const LUMINA_MANAGED_LABEL = "com.lumina.crm.managed";
export const LUMINA_REPOSITORY_LABEL = "com.lumina.crm.repository";
export const LUMINA_REPOSITORY_VALUE = "kewtgh/crm";
export const LUMINA_ROOTLESS_DOCKER_DATA_ROOT = "/var/lib/lumina-crm/docker";
export const LUMINA_DOCKER_CONFIG_ROOT = "/var/lib/lumina-crm/docker-config";
export const LUMINA_BUILDX_CONFIG_ROOT = `${LUMINA_DOCKER_CONFIG_ROOT}/buildx`;
export const LUMINA_BUILDKIT_NETWORK_MODE = "host";

const PROGRAM_PATH = "/usr/local/libexec/lumina-crm-storage-maintenance.mjs";
const DOCKER_COMMAND = "/usr/bin/docker";
const DEPLOY_ENV_PATH = "/etc/lumina-crm/deploy.env";
const BUILDKIT_CONFIG_PATH = "/etc/lumina-crm/buildkitd.toml";
const DEPLOY_STATE_ROOT = "/var/lib/lumina-crm/deployments";
const LAST_SUCCESS_PATH = "/var/lib/lumina-crm/deployments/last-success.json";
const CLEANUP_REQUEST_PATH = "/var/lib/lumina-crm/deployments/storage-cleanup-request.json";
const STATE_ROOT = "/var/lib/lumina-crm/storage-maintenance";
const LOG_ROOT = "/var/log/lumina-crm/storage-maintenance";
const LEGACY_DOCKER_CONFIG_ROOT = `${STATE_ROOT}/${["docker", "config"].join("-")}`;
const BUILDER_MARKER_PATH = `${STATE_ROOT}/builder-owner.json`;
const LATEST_REPORT_PATH = `${STATE_ROOT}/latest.json`;
const GIBIBYTE = 1024 ** 3;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const LUMINA_TAG_PATTERN = /(?:^|\/)lumina-crm(?:-ops)?:[0-9a-f]{40}$/;
const DOCKER_PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
const maintenanceRedactions = new Set();

export function parseDockerProxy(value) {
  const proxy = String(value ?? "").trim();
  if (!proxy) return "";
  let parsed;
  try {
    parsed = new URL(proxy);
  } catch {
    throw new Error("LUMINA_DOCKER_PROXY_INVALID");
  }
  if (!["http:", "https:"].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || proxy.includes("?")
    || proxy.includes("#")) {
    throw new Error("LUMINA_DOCKER_PROXY_INVALID");
  }
  return proxy;
}

export function dockerProxyMarkerContract(proxyValue) {
  const proxy = parseDockerProxy(proxyValue);
  return {
    enabled: Boolean(proxy),
    sha256: proxy ? createHash("sha256").update(proxy).digest("hex") : null,
  };
}

function boundedInteger(value, { name, minimum, maximum, fallback }) {
  const source = String(value ?? fallback);
  if (!/^\d+$/.test(source)) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function specificAbsolutePath(value, name) {
  const resolved = path.resolve(String(value));
  if (!path.isAbsolute(String(value)) || resolved === path.parse(resolved).root) {
    throw new Error(`${name} must be a specific absolute path`);
  }
  return resolved;
}

export function parseStoragePolicy(environment = {}) {
  const maximumCacheGb = boundedInteger(environment.LUMINA_BUILDKIT_MAX_CACHE_GB, {
    name: "LUMINA_BUILDKIT_MAX_CACHE_GB",
    minimum: 2,
    maximum: 512,
    fallback: 12,
  });
  const reservedCacheGb = boundedInteger(environment.LUMINA_BUILDKIT_RESERVED_CACHE_GB, {
    name: "LUMINA_BUILDKIT_RESERVED_CACHE_GB",
    minimum: 1,
    maximum: 128,
    fallback: 2,
  });
  if (reservedCacheGb >= maximumCacheGb) {
    throw new Error("LUMINA_BUILDKIT_RESERVED_CACHE_GB must be lower than LUMINA_BUILDKIT_MAX_CACHE_GB");
  }
  return {
    dockerProxy: parseDockerProxy(environment.LUMINA_DOCKER_PROXY),
    dockerDataRoot: specificAbsolutePath(
      environment.LUMINA_DOCKER_DATA_ROOT ?? LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
      "LUMINA_DOCKER_DATA_ROOT",
    ),
    minimumFreePercent: boundedInteger(environment.LUMINA_DEPLOY_MIN_FREE_PERCENT, {
      name: "LUMINA_DEPLOY_MIN_FREE_PERCENT",
      minimum: 5,
      maximum: 50,
      fallback: 15,
    }),
    rootMinimumAvailableBytes: boundedInteger(environment.LUMINA_ROOT_MIN_FREE_GB, {
      name: "LUMINA_ROOT_MIN_FREE_GB",
      minimum: 2,
      maximum: 1024,
      fallback: 8,
    }) * GIBIBYTE,
    dockerMinimumAvailableBytes: boundedInteger(environment.LUMINA_DOCKER_MIN_FREE_GB, {
      name: "LUMINA_DOCKER_MIN_FREE_GB",
      minimum: 2,
      maximum: 1024,
      fallback: 10,
    }) * GIBIBYTE,
    releaseMinimumAvailableBytes: boundedInteger(
      environment.LUMINA_STATE_MIN_FREE_GB ?? environment.LUMINA_RELEASE_MIN_FREE_GB,
      {
      name: "LUMINA_STATE_MIN_FREE_GB",
      minimum: 2,
      maximum: 1024,
      fallback: 4,
    }) * GIBIBYTE,
    cacheRetentionHours: boundedInteger(environment.LUMINA_BUILDKIT_CACHE_RETENTION_HOURS, {
      name: "LUMINA_BUILDKIT_CACHE_RETENTION_HOURS",
      minimum: 24,
      maximum: 2160,
      fallback: 168,
    }),
    maximumCacheGb,
    reservedCacheGb,
  };
}

function assertRegularRootFile(file, label) {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) {
    throw new Error(`${label} must be root-owned and not group/world writable`);
  }
  if (realpathSync(file) !== file) throw new Error(`${label} must resolve exactly to ${file}`);
}

function assertRealDirectory(directory, label) {
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error(`${label} must be a real directory at ${directory}`);
  }
}

function missingPath(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

export function ensureCanonicalDockerConfigDirectory({
  canonicalRoot = LUMINA_DOCKER_CONFIG_ROOT,
  legacyRoot = LEGACY_DOCKER_CONFIG_ROOT,
  currentUid = process.getuid?.(),
  operations = {
    lstat: lstatSync,
    mkdir: mkdirSync,
    realpath: realpathSync,
  },
} = {}) {
  if (canonicalRoot !== LUMINA_DOCKER_CONFIG_ROOT
    || legacyRoot !== LEGACY_DOCKER_CONFIG_ROOT
    || !canonicalRoot.startsWith("/")
    || canonicalRoot === STATE_ROOT
    || canonicalRoot.startsWith(`${STATE_ROOT}/`)) {
    throw new Error("LUMINA_DOCKER_CONFIG_PATH_INVALID");
  }
  if (!Number.isInteger(currentUid) || currentUid < 1) {
    throw new Error("LUMINA_DOCKER_CONFIG_OWNER_INVALID");
  }

  try {
    operations.lstat(legacyRoot);
    throw new Error("LEGACY_BUILDX_CONFIG_REQUIRES_REVIEW");
  } catch (error) {
    if (!missingPath(error)) throw error;
  }

  try {
    operations.lstat(canonicalRoot);
  } catch (error) {
    if (!missingPath(error)) throw error;
    operations.mkdir(canonicalRoot, { recursive: true, mode: 0o700 });
  }

  const metadata = operations.lstat(canonicalRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("LUMINA_DOCKER_CONFIG_NOT_REAL_DIRECTORY");
  }
  if (operations.realpath(canonicalRoot) !== canonicalRoot) {
    throw new Error("LUMINA_DOCKER_CONFIG_REALPATH_MISMATCH");
  }
  if (metadata.uid !== currentUid) {
    throw new Error("LUMINA_DOCKER_CONFIG_OWNER_INVALID");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("LUMINA_DOCKER_CONFIG_PERMISSIONS_INVALID");
  }
  return canonicalRoot;
}

function loadPolicy() {
  assertRegularRootFile(DEPLOY_ENV_PATH, "deploy.env");
  const policy = parseStoragePolicy(parseEnv(readFileSync(DEPLOY_ENV_PATH, "utf8")));
  if (policy.dockerProxy) maintenanceRedactions.add(policy.dockerProxy);
  return policy;
}

export function redactMaintenance(value, redactions = maintenanceRedactions) {
  let safe = String(value ?? "");
  for (const secret of redactions) {
    safe = safe.replaceAll(secret, "[REDACTED]");
    try {
      safe = safe.replaceAll(encodeURIComponent(secret), "[REDACTED]");
    } catch {
      // Literal redaction remains authoritative.
    }
  }
  return safe;
}

function diskSnapshot(label, targetPath, minimumAvailableBytes, minimumFreePercent) {
  const status = statfsSync(targetPath);
  const totalBytes = Number(status.blocks) * Number(status.bsize);
  const availableBytes = Number(status.bavail) * Number(status.bsize);
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0
    || !Number.isSafeInteger(availableBytes) || availableBytes < 0) {
    throw new Error(`Could not calculate disk capacity for ${label} (${targetPath})`);
  }
  return {
    label,
    path: targetPath,
    totalBytes,
    availableBytes,
    freePercent: Number((availableBytes / totalBytes * 100).toFixed(2)),
    minimumAvailableBytes,
    minimumFreePercent,
  };
}

function captureDisk(policy) {
  return [
    diskSnapshot("root filesystem", "/", policy.rootMinimumAvailableBytes, policy.minimumFreePercent),
    diskSnapshot("Docker data root", policy.dockerDataRoot, policy.dockerMinimumAvailableBytes, policy.minimumFreePercent),
    diskSnapshot("Lumina deploy state", DEPLOY_STATE_ROOT, policy.releaseMinimumAvailableBytes, policy.minimumFreePercent),
  ];
}

function assertDiskGate(snapshots) {
  const unhealthy = snapshots.filter((snapshot) => (
    snapshot.availableBytes < snapshot.minimumAvailableBytes
    || snapshot.freePercent < snapshot.minimumFreePercent
  ));
  if (!unhealthy.length) return;
  const error = new Error(`LUMINA_DEPLOY_DISK_GATE_FAILED: ${unhealthy.map((snapshot) => (
    `${snapshot.label} (${snapshot.path}) has ${snapshot.availableBytes} bytes/${snapshot.freePercent}% free; `
    + `requires ${snapshot.minimumAvailableBytes} bytes/${snapshot.minimumFreePercent}%`
  )).join("; ")}`);
  error.disk = snapshots;
  throw error;
}

function isImageId(value) {
  return /^sha256:[0-9a-f]{64}$/.test(String(value));
}

function isContainerId(value) {
  return /^[0-9a-f]{12,64}$/.test(String(value));
}

export function builderCreateArguments(proxyValue) {
  const proxy = parseDockerProxy(proxyValue);
  return [
    "buildx",
    "create",
    "--name", LUMINA_BUILDER_NAME,
    "--driver", "docker-container",
    "--buildkitd-config", BUILDKIT_CONFIG_PATH,
    "--driver-opt", `network=${LUMINA_BUILDKIT_NETWORK_MODE}`,
    ...(proxy ? DOCKER_PROXY_ENV_KEYS.flatMap((key) => [
      "--driver-opt", `env.${key}=${proxy}`,
    ]) : []),
  ];
}

function safeDockerArguments(args) {
  return args.map((argument) => argument.replace(
    /^(env\.(?:HTTP_PROXY|HTTPS_PROXY|http_proxy|https_proxy)=).+$/,
    "$1[REDACTED]",
  )).join(" ");
}

export function assertAllowedDockerArguments(args) {
  if (!Array.isArray(args) || !args.length || args.some((item) => typeof item !== "string" || !item)) {
    throw new Error("Docker arguments are required");
  }
  const [category, action, ...rest] = args;
  const forbidden = (args.includes("prune") && args.some((item) => ["--all", "-a", "--volumes"].includes(item)))
    || args.includes("--volumes")
    || ["system", "volume", "network"].includes(category)
    || (category === "container" && action !== "ls" && action !== "inspect")
    || (category === "image" && !["ls", "inspect", "rm"].includes(action))
    || (action === "prune" && category !== "buildx");
  if (forbidden) throw new Error(`Forbidden Docker command: docker ${safeDockerArguments(args)}`);

  if (category === "info") {
    if (args.length === 3 && action === "--format" && [
      "{{.DockerRootDir}}",
      "{{json .SecurityOptions}}",
      "{{.CgroupDriver}}",
    ].includes(rest[0])) return true;
  } else if (category === "buildx") {
    if (action === "inspect" && rest.length === 1 && rest[0] === LUMINA_BUILDER_NAME) return true;
    if (action === "create") {
      let proxy = "";
      const proxyOption = args.find((argument) => argument.startsWith("env.HTTP_PROXY="));
      if (proxyOption) {
        proxy = proxyOption.slice("env.HTTP_PROXY=".length);
      }
      try {
        if (JSON.stringify(args) === JSON.stringify(builderCreateArguments(proxy))) return true;
      } catch {
        // Invalid proxy-bearing arguments remain outside the allowlist.
      }
    }
    if (action === "--builder" && rest[0] === LUMINA_BUILDER_NAME
      && ["du", "prune"].includes(rest[1])) return true;
  } else if (category === "image") {
    if (action === "ls"
      && rest.includes("--quiet") && rest.includes("--no-trunc")
      && rest.filter((item) => item === "--filter").length === 3
      && rest.includes(`label=${LUMINA_MANAGED_LABEL}=true`)
      && rest.includes(`label=${LUMINA_REPOSITORY_LABEL}=${LUMINA_REPOSITORY_VALUE}`)
      && rest.includes(`label=com.docker.compose.project=${LUMINA_COMPOSE_PROJECT}`)) return true;
    if (action === "inspect" && rest.length > 0 && rest.every(isImageId)) return true;
    if (action === "rm" && rest.length === 1 && isImageId(rest[0])) return true;
  } else if (category === "container") {
    if (action === "ls" && rest.length === 2 && rest.includes("--all") && rest.includes("--quiet")) return true;
    if (action === "inspect" && rest.length > 0 && rest.every(isContainerId)) return true;
  }
  throw new Error(
    `Docker command is outside the Lumina maintenance allowlist: docker ${safeDockerArguments(args)}`,
  );
}

export function dockerEnvironment(environment = process.env) {
  if ((Object.hasOwn(environment, "DOCKER_CONFIG")
      && environment.DOCKER_CONFIG !== LUMINA_DOCKER_CONFIG_ROOT)
    || (Object.hasOwn(environment, "BUILDX_CONFIG")
      && environment.BUILDX_CONFIG !== LUMINA_BUILDX_CONFIG_ROOT)) {
    throw new Error("LUMINA_DOCKER_CONFIG_ENVIRONMENT_MISMATCH");
  }
  if (!/^unix:\/\/\/run\/user\/[1-9]\d*\/docker\.sock$/.test(String(environment.DOCKER_HOST ?? ""))) {
    throw new Error("LUMINA_ROOTLESS_DOCKER_HOST_REQUIRED");
  }
  return {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    DOCKER_CONFIG: LUMINA_DOCKER_CONFIG_ROOT,
    BUILDX_CONFIG: LUMINA_BUILDX_CONFIG_ROOT,
    DOCKER_HOST: environment.DOCKER_HOST,
    LANG: "C.UTF-8",
  };
}

function runDocker(args, {
  allowFailure = false,
  timeoutMs = 120_000,
  validateStdout,
} = {}) {
  assertAllowedDockerArguments(args);
  const result = spawnSync(DOCKER_COMMAND, args, {
    encoding: "utf8",
    env: dockerEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (result.error) {
    const message = redactMaintenance(result.error.message);
    if (allowFailure) return { ok: false, status: null, stdout: "", stderr: message };
    throw new Error(message);
  }
  if (result.status === 0 && validateStdout) validateStdout(String(result.stdout ?? ""));
  const output = {
    ok: result.status === 0,
    status: result.status,
    stdout: redactMaintenance(String(result.stdout ?? "").trim()),
    stderr: redactMaintenance(String(result.stderr ?? "").trim()),
  };
  if (!output.ok && !allowFailure) {
    throw new Error(`Docker command failed (${args.slice(0, 3).join(" ")}): ${(output.stderr || output.stdout).slice(-1_000)}`);
  }
  return output;
}

function dockerRoot(policy) {
  const reported = path.resolve(runDocker(["info", "--format", "{{.DockerRootDir}}"]).stdout);
  if (reported !== policy.dockerDataRoot) {
    throw new Error(`Docker reports data root ${reported}, but deploy.env requires ${policy.dockerDataRoot}`);
  }
  return reported;
}

function assertRootlessDocker(policy) {
  const uid = process.getuid();
  const expectedHost = `unix:///run/user/${uid}/docker.sock`;
  if (process.env.DOCKER_HOST?.trim() !== expectedHost) {
    throw new Error(`LUMINA_ROOTLESS_DOCKER_HOST_REQUIRED:${expectedHost}`);
  }
  const securityOptions = JSON.parse(
    runDocker(["info", "--format", "{{json .SecurityOptions}}"]).stdout,
  );
  if (!Array.isArray(securityOptions)
    || !securityOptions.some((value) => String(value).toLowerCase().includes("rootless"))) {
    throw new Error("LUMINA_ROOTLESS_DOCKER_REQUIRED");
  }
  const cgroupDriver = runDocker(["info", "--format", "{{.CgroupDriver}}"]).stdout;
  if (cgroupDriver !== "systemd") {
    throw new Error("LUMINA_ROOTLESS_CGROUP_V2_SYSTEMD_REQUIRED");
  }
  return dockerRoot(policy);
}

function configFingerprint(policy) {
  assertRegularRootFile(BUILDKIT_CONFIG_PATH, "Lumina BuildKit configuration");
  const content = readFileSync(BUILDKIT_CONFIG_PATH, "utf8");
  const required = [
    `reservedSpace = "${policy.reservedCacheGb}GB"`,
    `maxUsedSpace = "${policy.maximumCacheGb}GB"`,
    `minFreeSpace = "${Math.ceil(policy.dockerMinimumAvailableBytes / GIBIBYTE)}GB"`,
    `keepDuration = "${policy.cacheRetentionHours}h"`,
  ];
  const missing = required.filter((entry) => !content.includes(entry));
  if (missing.length) {
    throw new Error(`Lumina BuildKit configuration does not match deploy.env policy: ${missing.join(", ")}`);
  }
  return createHash("sha256").update(content).digest("hex");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeAtomicJson(file, value, mode = 0o640) {
  const temporary = `${file}.next-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporary, file);
}

function parseBuilderDriverOptions(output) {
  const lines = [...String(output).matchAll(/^Driver Options:\s*(.+)$/gm)];
  if (lines.length !== 1) return null;
  const options = new Map();
  const value = lines[0][1].trim();
  const tokenPattern = /(?:^|\s)([^\s=]+)="([^"]*)"/g;
  let consumed = "";
  for (const match of value.matchAll(tokenPattern)) {
    options.set(match[1], match[2]);
    consumed += match[0];
  }
  if (consumed.trim() !== value) return null;
  return options;
}

export function validateBuilderInspect(output, dockerProxy) {
  if (!new RegExp(`^Name:\\s+${LUMINA_BUILDER_NAME}$`, "m").test(output)
    || !/^Driver:\s+docker-container$/m.test(output)) {
    throw new Error(`Builder ${LUMINA_BUILDER_NAME} is not the expected docker-container builder`);
  }
  const options = parseBuilderDriverOptions(output);
  if (options?.get("network") !== LUMINA_BUILDKIT_NETWORK_MODE) {
    throw new Error("LUMINA_BUILDKIT_NETWORK_CONFIGURATION_MISMATCH");
  }
  const expectedProxy = parseDockerProxy(dockerProxy);
  const expectedKeys = new Set([
    "network",
    ...(expectedProxy ? DOCKER_PROXY_ENV_KEYS.map((key) => `env.${key}`) : []),
  ]);
  if (options.size !== expectedKeys.size
    || [...options.keys()].some((key) => !expectedKeys.has(key))
    || DOCKER_PROXY_ENV_KEYS.some((key) => (
      expectedProxy
        ? options.get(`env.${key}`) !== expectedProxy
        : options.has(`env.${key}`)
    ))) {
    throw new Error("LUMINA_BUILDKIT_PROXY_CONFIGURATION_MISMATCH");
  }
  return true;
}

export function validateBuilderMarker(marker, { fingerprint, dockerProxy }) {
  if (!marker
    || marker.owner !== LUMINA_REPOSITORY_VALUE
    || marker.builder !== LUMINA_BUILDER_NAME
    || marker.configSha256 !== fingerprint) {
    throw new Error("Lumina BuildKit ownership marker does not match the reviewed builder/configuration");
  }
  if (marker.builderNetworkMode !== LUMINA_BUILDKIT_NETWORK_MODE) {
    throw new Error("LUMINA_BUILDKIT_NETWORK_CONFIGURATION_MISMATCH");
  }
  const expectedProxy = dockerProxyMarkerContract(dockerProxy);
  const recordedProxy = {
    enabled: marker.dockerProxyEnabled ?? false,
    sha256: marker.dockerProxySha256 ?? null,
  };
  if (recordedProxy.enabled !== expectedProxy.enabled
    || recordedProxy.sha256 !== expectedProxy.sha256) {
    throw new Error("LUMINA_BUILDKIT_PROXY_CONFIGURATION_MISMATCH");
  }
  return true;
}

function ensureBuilder(policy) {
  const fingerprint = configFingerprint(policy);
  const marker = existsSync(BUILDER_MARKER_PATH) ? readJson(BUILDER_MARKER_PATH) : null;
  if (marker) validateBuilderMarker(marker, { fingerprint, dockerProxy: policy.dockerProxy });
  const inspected = runDocker(["buildx", "inspect", LUMINA_BUILDER_NAME], {
    allowFailure: true,
    validateStdout: (output) => validateBuilderInspect(output, policy.dockerProxy),
  });
  if (inspected.ok) {
    if (!marker) throw new Error(`Refusing to adopt unmarked existing builder ${LUMINA_BUILDER_NAME}`);
    return {
      created: false,
      builder: LUMINA_BUILDER_NAME,
      configSha256: fingerprint,
      dockerProxyEnabled: Boolean(policy.dockerProxy),
      builderNetworkMode: LUMINA_BUILDKIT_NETWORK_MODE,
    };
  }
  runDocker(builderCreateArguments(policy.dockerProxy));
  runDocker(["buildx", "inspect", LUMINA_BUILDER_NAME], {
    validateStdout: (output) => validateBuilderInspect(output, policy.dockerProxy),
  });
  writeAtomicJson(BUILDER_MARKER_PATH, {
    owner: LUMINA_REPOSITORY_VALUE,
    builder: LUMINA_BUILDER_NAME,
    driver: "docker-container",
    builderNetworkMode: LUMINA_BUILDKIT_NETWORK_MODE,
    configSha256: fingerprint,
    dockerProxyEnabled: dockerProxyMarkerContract(policy.dockerProxy).enabled,
    dockerProxySha256: dockerProxyMarkerContract(policy.dockerProxy).sha256,
    createdAt: new Date().toISOString(),
  }, 0o600);
  return {
    created: true,
    builder: LUMINA_BUILDER_NAME,
    configSha256: fingerprint,
    dockerProxyEnabled: Boolean(policy.dockerProxy),
    builderNetworkMode: LUMINA_BUILDKIT_NETWORK_MODE,
  };
}

function validateCleanupRequest() {
  const request = readJson(CLEANUP_REQUEST_PATH);
  const lastSuccess = readJson(LAST_SUCCESS_PATH);
  if (request.applicationAccepted !== true || request.deploymentId !== lastSuccess.deploymentId) {
    throw new Error("Storage cleanup request does not match the accepted deployment");
  }
  if (request.currentImage !== lastSuccess.currentImage
    || !LUMINA_TAG_PATTERN.test(String(request.currentImage ?? ""))) {
    throw new Error("Storage cleanup request is not for the current accepted Lumina image");
  }
  if (!Array.isArray(request.protectedImageTags)
    || request.protectedImageTags.some((tag) => (
      typeof tag !== "string" || !LUMINA_TAG_PATTERN.test(tag)
    ))) {
    throw new Error("Storage cleanup protected image tags are invalid");
  }
  const ageMs = Date.now() - Date.parse(String(request.acceptedAt ?? ""));
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 60 * 60 * 1_000) {
    throw new Error("Storage cleanup request is expired");
  }
  return request;
}

function inspectJson(category, ids) {
  if (!ids.length) return [];
  const result = runDocker([category, "inspect", ...ids]);
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed)) throw new Error(`Docker ${category} inspect did not return an array`);
  return parsed;
}

function listLuminaImages() {
  const ids = runDocker([
    "image", "ls", "--quiet", "--no-trunc",
    "--filter", `label=${LUMINA_MANAGED_LABEL}=true`,
    "--filter", `label=${LUMINA_REPOSITORY_LABEL}=${LUMINA_REPOSITORY_VALUE}`,
    "--filter", `label=com.docker.compose.project=${LUMINA_COMPOSE_PROJECT}`,
  ]).stdout.split(/\s+/).filter(Boolean);
  if (!ids.every(isImageId)) throw new Error("Docker returned an invalid Lumina image ID");
  return inspectJson("image", [...new Set(ids)]);
}

function inUseImageIds() {
  const ids = runDocker(["container", "ls", "--all", "--quiet"]).stdout.split(/\s+/).filter(Boolean);
  if (!ids.length) return new Set();
  if (!ids.every(isContainerId)) throw new Error("Docker returned an invalid container ID");
  return new Set(inspectJson("container", ids).map((container) => container.Image).filter(isImageId));
}

function exactLuminaImage(image) {
  const labels = image?.Config?.Labels ?? {};
  const tags = Array.isArray(image?.RepoTags) ? image.RepoTags : [];
  return isImageId(image?.Id)
    && labels[LUMINA_MANAGED_LABEL] === "true"
    && labels[LUMINA_REPOSITORY_LABEL] === LUMINA_REPOSITORY_VALUE
    && labels["com.docker.compose.project"] === LUMINA_COMPOSE_PROJECT
    && tags.some((tag) => LUMINA_TAG_PATTERN.test(tag));
}

export function selectLuminaImageCandidates(images, {
  inUseIds = new Set(),
  protectedTags = new Set(),
  nowMs = Date.now(),
  minimumAgeMs = 7 * 24 * 60 * 60 * 1_000,
  retain = 2,
} = {}) {
  if (!Number.isInteger(retain) || retain < 2) throw new Error("Lumina image retention must be at least 2");
  const exact = images.filter(exactLuminaImage)
    .map((image) => ({ ...image, createdMs: Date.parse(String(image.Created ?? "")) }))
    .filter((image) => Number.isFinite(image.createdMs))
    .sort((left, right) => right.createdMs - left.createdMs || left.Id.localeCompare(right.Id));
  const newest = new Set(exact.slice(0, retain).map((image) => image.Id));
  return exact.filter((image) => (
    !newest.has(image.Id)
    && !inUseIds.has(image.Id)
    && !(image.RepoTags ?? []).some((tag) => protectedTags.has(tag))
    && nowMs - image.createdMs >= minimumAgeMs
  ));
}

function buildkitUsage() {
  const result = runDocker(["buildx", "--builder", LUMINA_BUILDER_NAME, "du"], { allowFailure: true });
  return {
    ok: result.ok,
    output: (result.stdout || result.stderr).slice(0, MAX_OUTPUT_BYTES),
  };
}

function cleanupDocker(policy, request) {
  const marker = existsSync(BUILDER_MARKER_PATH) ? readJson(BUILDER_MARKER_PATH) : null;
  const fingerprint = configFingerprint(policy);
  validateBuilderMarker(marker, { fingerprint, dockerProxy: policy.dockerProxy });
  runDocker(["buildx", "inspect", LUMINA_BUILDER_NAME], {
    validateStdout: (output) => validateBuilderInspect(output, policy.dockerProxy),
  });

  const images = listLuminaImages();
  const inUseIds = inUseImageIds();
  const protectedTags = new Set(request.protectedImageTags);
  const candidates = selectLuminaImageCandidates(images, {
    inUseIds,
    protectedTags,
    minimumAgeMs: policy.cacheRetentionHours * 60 * 60 * 1_000,
    retain: 2,
  });
  const candidateIds = new Set(candidates.map((image) => image.Id));
  const imageDecisions = images.map((image) => {
    const reasons = [];
    if (!exactLuminaImage(image)) reasons.push("labels-or-repository-tag-not-exact");
    if (inUseIds.has(image.Id)) reasons.push("used-by-container");
    if ((image.RepoTags ?? []).some((tag) => protectedTags.has(tag))) {
      reasons.push("current-rollback-or-recent-success");
    }
    if (!candidateIds.has(image.Id) && !reasons.length) reasons.push("retention-or-minimum-age");
    return {
      id: image.Id,
      repositoryTags: image.RepoTags ?? [],
      decision: candidateIds.has(image.Id) ? "DELETE_CANDIDATE" : "REJECTED",
      reasons,
    };
  });
  const deletedImages = [];
  const failures = [];
  for (const image of candidates) {
    const result = runDocker(["image", "rm", image.Id], { allowFailure: true });
    if (result.ok) {
      deletedImages.push({
        id: image.Id,
        repositoryTags: image.RepoTags ?? [],
        sizeBytes: Number(image.Size ?? 0),
        output: result.stdout.slice(0, 20_000),
      });
    } else {
      failures.push({
        object: image.Id,
        operation: "image-rm",
        error: (result.stderr || result.stdout).slice(-1_000),
      });
    }
  }

  const cacheBefore = buildkitUsage();
  const prune = runDocker([
    "buildx", "--builder", LUMINA_BUILDER_NAME, "prune",
    "--filter", `until=${policy.cacheRetentionHours}h`,
    "--max-used-space", `${policy.maximumCacheGb}GB`,
    "--reserved-space", `${policy.reservedCacheGb}GB`,
    "--min-free-space", `${Math.ceil(policy.dockerMinimumAvailableBytes / GIBIBYTE)}GB`,
    "--force",
    "--verbose",
  ], { allowFailure: true, timeoutMs: 300_000 });
  if (!prune.ok) {
    failures.push({
      object: LUMINA_BUILDER_NAME,
      operation: "buildx-prune",
      error: (prune.stderr || prune.stdout).slice(-1_000),
    });
  }
  return {
    imageCandidates: candidates.map((image) => ({
      id: image.Id,
      repositoryTags: image.RepoTags ?? [],
      sizeBytes: Number(image.Size ?? 0),
    })),
    imageDecisions,
    deletedImages,
    estimatedImageBytes: deletedImages.reduce((total, image) => total + image.sizeBytes, 0),
    cacheBefore,
    cachePrune: {
      ok: prune.ok,
      output: (prune.stdout || prune.stderr).slice(0, MAX_OUTPUT_BYTES),
    },
    cacheAfter: buildkitUsage(),
    failures,
  };
}

function diskDelta(before, after) {
  return after.map((snapshot) => {
    const prior = before.find((item) => item.label === snapshot.label && item.path === snapshot.path);
    return {
      ...snapshot,
      availableBytesBefore: prior?.availableBytes ?? null,
      availableBytesDelta: prior ? snapshot.availableBytes - prior.availableBytes : null,
    };
  });
}

function reportPaths(startedAt) {
  const stamp = startedAt.replaceAll(":", "").replaceAll("-", "").replace(/\.\d{3}Z$/, "Z");
  return {
    state: `${STATE_ROOT}/${stamp}-${process.pid}.json`,
    log: `${LOG_ROOT}/${stamp}-${process.pid}.jsonl`,
  };
}

function persistReport(report) {
  const paths = reportPaths(report.startedAt);
  const completed = { ...report, reportPath: paths.state, logPath: paths.log };
  writeAtomicJson(paths.state, completed);
  writeAtomicJson(LATEST_REPORT_PATH, completed);
  appendFileSync(paths.log, `${JSON.stringify(completed)}\n`, { mode: 0o640 });
  process.stdout.write(`${JSON.stringify(completed)}\n`);
  return completed;
}

async function perform(mode) {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
    throw new Error("Lumina storage maintenance must run as non-root lumina-crm on Linux");
  }
  if (realpathSync(process.argv[1]) !== PROGRAM_PATH) {
    throw new Error(`Lumina storage maintenance must run from root-owned ${PROGRAM_PATH}`);
  }
  assertRegularRootFile(PROGRAM_PATH, "Lumina storage maintenance program");
  assertRealDirectory(DEPLOY_STATE_ROOT, "Lumina deploy state root");
  mkdirSync(STATE_ROOT, { recursive: true, mode: 0o750 });
  mkdirSync(LOG_ROOT, { recursive: true, mode: 0o750 });
  assertRealDirectory(STATE_ROOT, "Lumina storage state directory");
  assertRealDirectory(LOG_ROOT, "Lumina storage log directory");
  ensureCanonicalDockerConfigDirectory();

  const policy = loadPolicy();
  assertRootlessDocker(policy);
  const diskBefore = captureDisk(policy);
  try {
    if (mode === "prepare") {
      assertDiskGate(diskBefore);
      const builder = ensureBuilder(policy);
      return {
        status: "SUCCEEDED",
        mode,
        diskBefore,
        builder,
        policy: {
          dockerDataRoot: policy.dockerDataRoot,
          minimumFreePercent: policy.minimumFreePercent,
          cacheRetentionHours: policy.cacheRetentionHours,
          maximumCacheGb: policy.maximumCacheGb,
          reservedCacheGb: policy.reservedCacheGb,
        },
      };
    }
    if (mode !== "cleanup") throw new Error(`Unsupported storage maintenance mode: ${mode}`);
    const request = validateCleanupRequest();
    const cleanup = cleanupDocker(policy, request);
    const diskAfter = captureDisk(policy);
    return {
      status: cleanup.failures.length ? "PARTIAL" : "SUCCEEDED",
      mode,
      deploymentId: request.deploymentId,
      acceptedImage: request.currentImage,
      diskBefore,
      diskAfter: diskDelta(diskBefore, diskAfter),
      cleanup,
    };
  } catch (error) {
    let diskAfter = null;
    try {
      diskAfter = diskDelta(diskBefore, captureDisk(policy));
    } catch {
      // The original failure remains authoritative when a follow-up measurement is unavailable.
    }
    error.maintenanceContext = { diskBefore, diskAfter };
    throw error;
  }
}

async function main() {
  const [mode] = process.argv.slice(2);
  const startedAt = new Date().toISOString();
  try {
    const result = await perform(mode);
    persistReport({
      event: "lumina-storage-maintenance",
      startedAt,
      finishedAt: new Date().toISOString(),
      ...result,
    });
    if (result.status === "PARTIAL") process.exitCode = 1;
  } catch (error) {
    persistReport({
      event: "lumina-storage-maintenance",
      status: "FAILED",
      mode: mode ?? null,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: redactMaintenance(error instanceof Error ? error.message : String(error)),
      ...(error?.maintenanceContext ?? {}),
      disk: error?.disk ?? null,
    });
    process.exitCode = 1;
  }
}

const isEntrypoint = process.argv[1]
  && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isEntrypoint) await main();
