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

const PROGRAM_PATH = "/usr/local/libexec/lumina-crm-storage-maintenance.mjs";
const DOCKER_COMMAND = "/usr/bin/docker";
const DEPLOY_ENV_PATH = "/etc/lumina-crm/deploy.env";
const BUILDKIT_CONFIG_PATH = "/etc/lumina-crm/buildkitd.toml";
const DEPLOY_ROOT = "/opt/lumina-crm";
const RELEASES_ROOT = `${DEPLOY_ROOT}/releases`;
const CURRENT_LINK = `${DEPLOY_ROOT}/current`;
const LAST_SUCCESS_PATH = "/var/lib/lumina-crm/deployments/last-success.json";
const CLEANUP_REQUEST_PATH = "/var/lib/lumina-crm/deployments/storage-cleanup-request.json";
const STATE_ROOT = "/var/lib/lumina-crm/storage-maintenance";
const LOG_ROOT = "/var/log/lumina-crm/storage-maintenance";
const DOCKER_CONFIG_ROOT = `${STATE_ROOT}/docker-config`;
const BUILDER_MARKER_PATH = `${STATE_ROOT}/builder-owner.json`;
const LATEST_REPORT_PATH = `${STATE_ROOT}/latest.json`;
const GIBIBYTE = 1024 ** 3;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const LUMINA_TAG_PATTERN = /(?:^|\/)lumina-crm(?::|\/)/;

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
    dockerDataRoot: specificAbsolutePath(
      environment.LUMINA_DOCKER_DATA_ROOT ?? "/var/lib/docker",
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
    releaseMinimumAvailableBytes: boundedInteger(environment.LUMINA_RELEASE_MIN_FREE_GB, {
      name: "LUMINA_RELEASE_MIN_FREE_GB",
      minimum: 2,
      maximum: 1024,
      fallback: 8,
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

function loadPolicy() {
  assertRegularRootFile(DEPLOY_ENV_PATH, "deploy.env");
  return parseStoragePolicy(parseEnv(readFileSync(DEPLOY_ENV_PATH, "utf8")));
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
    diskSnapshot("Lumina releases", RELEASES_ROOT, policy.releaseMinimumAvailableBytes, policy.minimumFreePercent),
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
  if (forbidden) throw new Error(`Forbidden Docker command: docker ${args.join(" ")}`);

  if (category === "info") {
    if (args.length === 3 && action === "--format" && rest[0] === "{{.DockerRootDir}}") return true;
  } else if (category === "buildx") {
    if (action === "inspect" && rest.length === 1 && rest[0] === LUMINA_BUILDER_NAME) return true;
    if (action === "create"
      && rest.includes("--name") && rest[rest.indexOf("--name") + 1] === LUMINA_BUILDER_NAME
      && rest.includes("--driver") && rest[rest.indexOf("--driver") + 1] === "docker-container"
      && rest.includes("--buildkitd-config") && rest[rest.indexOf("--buildkitd-config") + 1] === BUILDKIT_CONFIG_PATH) {
      return true;
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
  throw new Error(`Docker command is outside the Lumina maintenance allowlist: docker ${args.join(" ")}`);
}

function dockerEnvironment() {
  return {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: STATE_ROOT,
    DOCKER_CONFIG: DOCKER_CONFIG_ROOT,
    BUILDX_CONFIG: `${DOCKER_CONFIG_ROOT}/buildx`,
    LANG: "C.UTF-8",
  };
}

function runDocker(args, { allowFailure = false, timeoutMs = 120_000 } = {}) {
  assertAllowedDockerArguments(args);
  const result = spawnSync(DOCKER_COMMAND, args, {
    encoding: "utf8",
    env: dockerEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (result.error) {
    if (allowFailure) return { ok: false, status: null, stdout: "", stderr: result.error.message };
    throw result.error;
  }
  const output = {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
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

function validateBuilderInspect(output) {
  if (!new RegExp(`^Name:\\s+${LUMINA_BUILDER_NAME}$`, "m").test(output)
    || !/^Driver:\s+docker-container$/m.test(output)) {
    throw new Error(`Builder ${LUMINA_BUILDER_NAME} is not the expected docker-container builder`);
  }
}

function ensureBuilder(policy) {
  const fingerprint = configFingerprint(policy);
  const marker = existsSync(BUILDER_MARKER_PATH) ? readJson(BUILDER_MARKER_PATH) : null;
  if (marker && (marker.owner !== LUMINA_REPOSITORY_VALUE
    || marker.builder !== LUMINA_BUILDER_NAME
    || marker.configSha256 !== fingerprint)) {
    throw new Error("Lumina BuildKit ownership marker does not match the reviewed builder/configuration");
  }
  const inspected = runDocker(["buildx", "inspect", LUMINA_BUILDER_NAME], { allowFailure: true });
  if (inspected.ok) {
    if (!marker) throw new Error(`Refusing to adopt unmarked existing builder ${LUMINA_BUILDER_NAME}`);
    validateBuilderInspect(inspected.stdout);
    return { created: false, builder: LUMINA_BUILDER_NAME, configSha256: fingerprint };
  }
  runDocker([
    "buildx",
    "create",
    "--name", LUMINA_BUILDER_NAME,
    "--driver", "docker-container",
    "--buildkitd-config", BUILDKIT_CONFIG_PATH,
  ]);
  const created = runDocker(["buildx", "inspect", LUMINA_BUILDER_NAME]);
  validateBuilderInspect(created.stdout);
  writeAtomicJson(BUILDER_MARKER_PATH, {
    owner: LUMINA_REPOSITORY_VALUE,
    builder: LUMINA_BUILDER_NAME,
    driver: "docker-container",
    configSha256: fingerprint,
    createdAt: new Date().toISOString(),
  }, 0o600);
  return { created: true, builder: LUMINA_BUILDER_NAME, configSha256: fingerprint };
}

function validateCleanupRequest() {
  const request = readJson(CLEANUP_REQUEST_PATH);
  const lastSuccess = readJson(LAST_SUCCESS_PATH);
  if (request.applicationAccepted !== true || request.deploymentId !== lastSuccess.deploymentId) {
    throw new Error("Storage cleanup request does not match the accepted deployment");
  }
  const release = path.resolve(String(request.releasePath ?? ""));
  if (!release.startsWith(`${RELEASES_ROOT}/`) || realpathSync(CURRENT_LINK) !== release
    || path.resolve(lastSuccess.currentRelease) !== release) {
    throw new Error("Storage cleanup request is not for the current accepted Lumina release");
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

function cleanupDocker(policy) {
  const marker = existsSync(BUILDER_MARKER_PATH) ? readJson(BUILDER_MARKER_PATH) : null;
  const fingerprint = configFingerprint(policy);
  if (!marker || marker.owner !== LUMINA_REPOSITORY_VALUE
    || marker.builder !== LUMINA_BUILDER_NAME || marker.configSha256 !== fingerprint) {
    throw new Error("Lumina BuildKit ownership marker is missing or invalid; refusing cleanup");
  }
  validateBuilderInspect(runDocker(["buildx", "inspect", LUMINA_BUILDER_NAME]).stdout);

  const images = listLuminaImages();
  const candidates = selectLuminaImageCandidates(images, {
    inUseIds: inUseImageIds(),
    minimumAgeMs: policy.cacheRetentionHours * 60 * 60 * 1_000,
    retain: 2,
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
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("Lumina storage maintenance must run as root on Linux");
  }
  if (realpathSync(process.argv[1]) !== PROGRAM_PATH) {
    throw new Error(`Lumina storage maintenance must run from root-owned ${PROGRAM_PATH}`);
  }
  assertRegularRootFile(PROGRAM_PATH, "Lumina storage maintenance program");
  assertRealDirectory(RELEASES_ROOT, "Lumina release root");
  mkdirSync(STATE_ROOT, { recursive: true, mode: 0o750 });
  mkdirSync(LOG_ROOT, { recursive: true, mode: 0o750 });
  mkdirSync(DOCKER_CONFIG_ROOT, { recursive: true, mode: 0o700 });
  assertRealDirectory(STATE_ROOT, "Lumina storage state directory");
  assertRealDirectory(LOG_ROOT, "Lumina storage log directory");
  assertRealDirectory(DOCKER_CONFIG_ROOT, "Lumina Docker configuration directory");

  const policy = loadPolicy();
  dockerRoot(policy);
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
    const cleanup = cleanupDocker(policy);
    const diskAfter = captureDisk(policy);
    return {
      status: cleanup.failures.length ? "PARTIAL" : "SUCCEEDED",
      mode,
      deploymentId: request.deploymentId,
      acceptedRelease: request.releasePath,
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
      error: error instanceof Error ? error.message : String(error),
      ...(error?.maintenanceContext ?? {}),
      disk: error?.disk ?? null,
    });
    process.exitCode = 1;
  }
}

const isEntrypoint = process.argv[1]
  && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isEntrypoint) await main();
