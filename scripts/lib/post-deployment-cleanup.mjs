import {
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  statfsSync,
} from "node:fs";
import path from "node:path";

export const LUMINA_MANAGED_LABEL = "com.lumina.crm.managed";
export const LUMINA_REPOSITORY_LABEL = "com.lumina.crm.repository";
export const LUMINA_REPOSITORY_VALUE = "kewtgh/crm";
export const LUMINA_BUILDER = "lumina-crm-buildkit";

const FULL_SHA = /^[0-9a-f]{40}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const CONTAINER_ID = /^[0-9a-f]{12,64}$/;
const FINAL_RESULTS = new Set([
  "SUCCESS", "RECOVERED", "FAILED", "FAILED_ROLLED_BACK",
  "FAILED_ROLLBACK_REQUIRED", "ROLLBACK_OK", "ROLLBACK_FAILED",
]);
const DAY_MS = 24 * 60 * 60 * 1_000;
const GIBIBYTE = 1024 ** 3;

function boundedInteger(value, { fallback, minimum, maximum, name }) {
  const source = String(value ?? fallback);
  if (!/^\d+$/.test(source)) throw new Error(`${name}_INVALID`);
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name}_INVALID`);
  }
  return parsed;
}

function storageSize(value, fallback, name) {
  const source = String(value ?? fallback).toUpperCase();
  if (!/^[1-9]\d*(?:MB|GB|TB)$/.test(source)) throw new Error(`${name}_INVALID`);
  return source;
}

function storageSizeBytes(value) {
  const match = /^(\d+)(MB|GB|TB)$/.exec(value);
  const factors = { MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return Number(match[1]) * factors[match[2]];
}

function cacheAge(value, fallback) {
  const source = String(value ?? fallback).toLowerCase();
  const match = /^([1-9]\d*)h$/.exec(source);
  if (!match || Number(match[1]) < 24 || Number(match[1]) > 2160) {
    throw new Error("LUMINA_BUILDKIT_CACHE_MAX_AGE_INVALID");
  }
  return source;
}

export function parsePostDeploymentCleanupPolicy(environment = {}) {
  const policy = {
    buildkitMaxUsedSpace: storageSize(
      environment.LUMINA_BUILDKIT_MAX_USED_SPACE
        ?? (environment.LUMINA_BUILDKIT_MAX_CACHE_GB
          ? `${environment.LUMINA_BUILDKIT_MAX_CACHE_GB}GB`
          : undefined),
      "12GB",
      "LUMINA_BUILDKIT_MAX_USED_SPACE",
    ),
    buildkitReservedSpace: storageSize(
      environment.LUMINA_BUILDKIT_RESERVED_SPACE
        ?? (environment.LUMINA_BUILDKIT_RESERVED_CACHE_GB
          ? `${environment.LUMINA_BUILDKIT_RESERVED_CACHE_GB}GB`
          : undefined),
      "2GB",
      "LUMINA_BUILDKIT_RESERVED_SPACE",
    ),
    buildkitCacheMaxAge: cacheAge(
      environment.LUMINA_BUILDKIT_CACHE_MAX_AGE
        ?? (environment.LUMINA_BUILDKIT_CACHE_RETENTION_HOURS
          ? `${environment.LUMINA_BUILDKIT_CACHE_RETENTION_HOURS}h`
          : undefined),
      "168h",
    ),
    imageReleasesToKeep: boundedInteger(environment.LUMINA_IMAGE_RELEASES_TO_KEEP, {
      name: "LUMINA_IMAGE_RELEASES_TO_KEEP",
      minimum: 3,
      maximum: 10,
      fallback: 3,
    }),
    historyRetentionDays: boundedInteger(environment.LUMINA_DEPLOYMENT_HISTORY_RETENTION_DAYS, {
      name: "LUMINA_DEPLOYMENT_HISTORY_RETENTION_DAYS",
      minimum: 1,
      maximum: 3650,
      fallback: 30,
    }),
    historyMinimumKeep: boundedInteger(environment.LUMINA_DEPLOYMENT_HISTORY_MIN_KEEP, {
      name: "LUMINA_DEPLOYMENT_HISTORY_MIN_KEEP",
      minimum: 20,
      maximum: 1000,
      fallback: 20,
    }),
    minimumFreeBytes: boundedInteger(environment.LUMINA_STORAGE_CLEANUP_MIN_FREE_GB, {
      name: "LUMINA_STORAGE_CLEANUP_MIN_FREE_GB",
      minimum: 1,
      maximum: 1024,
      fallback: 10,
    }) * GIBIBYTE,
  };
  if (storageSizeBytes(policy.buildkitReservedSpace)
    >= storageSizeBytes(policy.buildkitMaxUsedSpace)) {
    throw new Error("LUMINA_BUILDKIT_STORAGE_LIMITS_INVALID");
  }
  return policy;
}

export function buildkitCleanupArguments(policy) {
  return [
    "buildx", "--builder", LUMINA_BUILDER, "prune",
    "--filter", `until=${policy.buildkitCacheMaxAge}`,
    "--max-used-space", policy.buildkitMaxUsedSpace,
    "--reserved-space", policy.buildkitReservedSpace,
    "--force",
  ];
}

function normalizedImage(image) {
  const labels = image?.Config?.Labels ?? {};
  const commit = labels["org.opencontainers.image.revision"];
  const declaredKind = labels["com.lumina.crm.image-kind"];
  const kind = declaredKind === "operations"
    ? "operations"
    : declaredKind === undefined || declaredKind === "application"
      ? "application"
      : null;
  const createdMs = Date.parse(String(image?.Created ?? ""));
  if (!IMAGE_ID.test(image?.Id ?? "")
    || labels[LUMINA_MANAGED_LABEL] !== "true"
    || labels[LUMINA_REPOSITORY_LABEL] !== LUMINA_REPOSITORY_VALUE
    || !FULL_SHA.test(commit ?? "")
    || !kind
    || !Number.isFinite(createdMs)) return null;
  return {
    id: image.Id,
    commit,
    kind,
    createdMs,
    sizeBytes: Math.max(0, Number(image.Size) || 0),
    tags: Array.isArray(image.RepoTags) ? image.RepoTags.filter((tag) => typeof tag === "string") : [],
  };
}

export function selectLuminaImageDeletionCandidates(images, {
  protectedReferences = new Set(),
  inUseImageIds = new Set(),
  releasesToKeep = 3,
} = {}) {
  if (!Number.isInteger(releasesToKeep) || releasesToKeep < 3 || releasesToKeep > 10) {
    throw new Error("LUMINA_IMAGE_RELEASES_TO_KEEP_INVALID");
  }
  const normalized = images.map(normalizedImage).filter(Boolean);
  const releases = new Map();
  for (const image of normalized) {
    const release = releases.get(image.commit) ?? {
      commit: image.commit,
      images: [],
      application: false,
      operations: false,
      createdMs: 0,
    };
    release.images.push(image);
    release[image.kind] = true;
    release.createdMs = Math.max(release.createdMs, image.createdMs);
    releases.set(image.commit, release);
  }
  const complete = [...releases.values()]
    .filter((release) => release.application && release.operations)
    .sort((left, right) => right.createdMs - left.createdMs || left.commit.localeCompare(right.commit));
  const retainedCommits = new Set(complete.slice(0, releasesToKeep).map((release) => release.commit));
  const candidates = [];
  for (const release of complete) {
    const protectedRelease = retainedCommits.has(release.commit)
      || release.images.some((image) => (
        inUseImageIds.has(image.id)
        || protectedReferences.has(image.id)
        || image.tags.some((tag) => protectedReferences.has(tag))
      ));
    if (!protectedRelease) candidates.push(...release.images);
  }
  return candidates.sort((left, right) => left.commit.localeCompare(right.commit)
    || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}

function historyCategory(name, location) {
  if (location === "state" && /^\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/.test(name)) return "records";
  if (location === "state" && /^request-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/.test(name)) return "requests";
  if (location === "log" && /^\d{8}T\d{6}Z-[0-9a-f]{8}\.log$/.test(name)) return "logs";
  return null;
}

function historyDeploymentId(name) {
  return name.replace(/^request-/, "").replace(/\.(?:json|log)$/, "");
}

export function selectHistoryCleanupCandidates(entries, {
  nowMs = Date.now(),
  retentionDays = 30,
  minimumKeep = 20,
  protectedDeploymentIds = new Set(),
  currentDeploymentId = null,
  terminalDeploymentIds = new Set(),
} = {}) {
  const candidates = [];
  for (const category of ["records", "requests", "logs"]) {
    const matching = entries
      .filter((entry) => historyCategory(entry.name, entry.location) === category
        && entry.isFile === true && entry.isSymbolicLink !== true)
      .sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    for (const entry of matching.slice(minimumKeep)) {
      const deploymentId = historyDeploymentId(entry.name);
      if (nowMs - entry.mtimeMs > retentionDays * DAY_MS
        && deploymentId !== currentDeploymentId
        && !protectedDeploymentIds.has(deploymentId)) candidates.push(entry);
    }
  }
  for (const entry of entries) {
    const match = /^(.*)\.(candidate|recovery|rollback)\.env$/.exec(entry.name);
    if (!match || entry.location !== "state" || entry.isFile !== true || entry.isSymbolicLink === true) continue;
    const deploymentId = match[1];
    if (deploymentId !== currentDeploymentId
      && terminalDeploymentIds.has(deploymentId)
      && nowMs - entry.mtimeMs > DAY_MS) candidates.push(entry);
  }
  return candidates;
}

export function nonNegativeReclaimedBytes(values) {
  return Math.max(0, values.reduce((total, value) => {
    const numeric = Number(value);
    return total + (Number.isFinite(numeric) && numeric > 0 ? numeric : 0);
  }, 0));
}

export function filesystemSnapshot(directory, statfs = statfsSync) {
  const snapshot = statfs(directory, { bigint: true });
  const total = snapshot.bsize * snapshot.blocks;
  const available = snapshot.bsize * snapshot.bavail;
  const totalBytes = Number(total);
  const availableBytes = Number(available);
  return {
    totalBytes,
    availableBytes,
    usedPercentage: total > 0n ? Number(((total - available) * 10_000n) / total) / 100 : 0,
  };
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function protectedImageReferences(accepted, target) {
  return new Set([
    accepted?.currentImage,
    accepted?.operationsImage,
    accepted?.rollbackImage,
    accepted?.rollbackOperationsImage,
    target?.currentImage,
    target?.operationsImage,
    ...(accepted?.recentImages ?? []),
  ].filter(Boolean));
}

function historyEntries(root, location) {
  return readdirSync(root, { withFileTypes: true }).map((entry) => {
    const file = path.join(root, entry.name);
    const metadata = lstatSync(file);
    return {
      name: entry.name,
      path: file,
      location,
      isFile: metadata.isFile(),
      isSymbolicLink: metadata.isSymbolicLink(),
      mtimeMs: metadata.mtimeMs,
      sizeBytes: Math.max(0, metadata.size),
    };
  });
}

async function cleanupImages({ runDocker, accepted, target, releasesToKeep }) {
  const listed = await runDocker([
    "image", "ls", "--quiet", "--no-trunc",
    "--filter", `label=${LUMINA_MANAGED_LABEL}=true`,
    "--filter", `label=${LUMINA_REPOSITORY_LABEL}=${LUMINA_REPOSITORY_VALUE}`,
  ]);
  if (listed.code !== 0) throw new Error("IMAGE_LIST_FAILED");
  const ids = [...new Set(listed.stdout.split(/\s+/).filter(Boolean))];
  if (ids.some((id) => !IMAGE_ID.test(id))) throw new Error("IMAGE_LIST_INVALID");
  if (!ids.length) return { reclaimedBytes: 0, warnings: [] };
  const inspected = await runDocker(["image", "inspect", ...ids]);
  if (inspected.code !== 0) throw new Error("IMAGE_INSPECT_FAILED");
  let images;
  try { images = JSON.parse(inspected.stdout); } catch { throw new Error("IMAGE_INSPECT_INVALID"); }
  if (!Array.isArray(images) || images.length !== ids.length) throw new Error("IMAGE_INSPECT_INVALID");

  const containers = await runDocker(["container", "ls", "--quiet", "--no-trunc"]);
  if (containers.code !== 0) throw new Error("CONTAINER_LIST_FAILED");
  const containerIds = containers.stdout.split(/\s+/).filter(Boolean);
  if (containerIds.some((id) => !CONTAINER_ID.test(id))) {
    throw new Error("CONTAINER_LIST_INVALID");
  }
  let inUseImageIds = new Set();
  if (containerIds.length) {
    const containerInspect = await runDocker(["container", "inspect", ...containerIds]);
    if (containerInspect.code !== 0) throw new Error("CONTAINER_INSPECT_FAILED");
    let parsed;
    try { parsed = JSON.parse(containerInspect.stdout); } catch { throw new Error("CONTAINER_INSPECT_INVALID"); }
    if (!Array.isArray(parsed)) throw new Error("CONTAINER_INSPECT_INVALID");
    inUseImageIds = new Set(parsed.map((container) => container.Image).filter((id) => IMAGE_ID.test(id)));
  }
  const candidates = selectLuminaImageDeletionCandidates(images, {
    protectedReferences: protectedImageReferences(accepted, target),
    inUseImageIds,
    releasesToKeep,
  });
  const deletedSizes = [];
  const warnings = [];
  for (const image of candidates) {
    const removed = await runDocker(["image", "rm", image.id]);
    if (removed.code === 0) deletedSizes.push(image.sizeBytes);
    else warnings.push("IMAGE_CLEANUP_FAILED");
  }
  return { reclaimedBytes: nonNegativeReclaimedBytes(deletedSizes), warnings };
}

function cleanupHistory({ stateRoot, logRoot, currentDeploymentId, policy, nowMs }) {
  const latest = readJson(path.join(stateRoot, "latest.json"));
  const accepted = readJson(path.join(stateRoot, "last-success.json"));
  const protectedDeploymentIds = new Set([
    currentDeploymentId,
    latest?.deploymentId,
    accepted?.deploymentId,
    accepted?.rollbackDeploymentId,
  ].filter(Boolean));
  const entries = [
    ...historyEntries(stateRoot, "state"),
    ...historyEntries(logRoot, "log"),
  ];
  const terminalDeploymentIds = new Set(entries
    .filter((entry) => historyCategory(entry.name, entry.location) === "records")
    .filter((entry) => {
      const state = readJson(entry.path);
      return FINAL_RESULTS.has(state?.result) || state?.finalizationComplete === true;
    })
    .map((entry) => historyDeploymentId(entry.name)));
  const candidates = selectHistoryCleanupCandidates(entries, {
    nowMs,
    retentionDays: policy.historyRetentionDays,
    minimumKeep: policy.historyMinimumKeep,
    protectedDeploymentIds,
    currentDeploymentId,
    terminalDeploymentIds,
  });
  const sizes = [];
  for (const candidate of candidates) {
    rmSync(candidate.path);
    sizes.push(candidate.sizeBytes);
  }
  return nonNegativeReclaimedBytes(sizes);
}

export async function performPostDeploymentCleanup({
  accepted,
  target,
  currentDeploymentId,
  stateRoot,
  logRoot,
  environment = process.env,
  runDocker,
  nowMs = Date.now(),
  snapshot = filesystemSnapshot,
}) {
  let before = { totalBytes: null, availableBytes: null, usedPercentage: null };
  try { before = snapshot(stateRoot); } catch { /* Cleanup remains non-fatal. */ }
  const warnings = new Set();
  let policy;
  try {
    policy = parsePostDeploymentCleanupPolicy(environment);
  } catch {
    return {
      status: "FAILED_NON_FATAL",
      buildkitBytesReclaimed: 0,
      imageBytesReclaimed: 0,
      historyBytesReclaimed: 0,
      freeBytesBefore: before.availableBytes,
      freeBytesAfter: before.availableBytes,
      warnings: ["CLEANUP_CONFIGURATION_INVALID"],
    };
  }

  let buildkitBytesReclaimed = 0;
  let imageBytesReclaimed = 0;
  let historyBytesReclaimed = 0;
  try {
    const result = await runDocker(buildkitCleanupArguments(policy));
    if (result.code !== 0) warnings.add("BUILDKIT_CLEANUP_FAILED");
  } catch { warnings.add("BUILDKIT_CLEANUP_FAILED"); }
  try {
    const result = await cleanupImages({
      runDocker, accepted, target, releasesToKeep: policy.imageReleasesToKeep,
    });
    imageBytesReclaimed = result.reclaimedBytes;
    for (const warning of result.warnings) warnings.add(warning);
  } catch { warnings.add("IMAGE_CLEANUP_FAILED"); }
  try {
    historyBytesReclaimed = cleanupHistory({
      stateRoot, logRoot, currentDeploymentId, policy, nowMs,
    });
  } catch { warnings.add("HISTORY_CLEANUP_FAILED"); }

  let after = before;
  try { after = snapshot(stateRoot); } catch { /* Preserve the available before evidence. */ }
  if (Number.isFinite(after.availableBytes) && after.availableBytes < policy.minimumFreeBytes) {
    warnings.add("STORAGE_PRESSURE_REMAINS");
  }
  const warningList = [...warnings].sort();
  const failedSections = [
    "BUILDKIT_CLEANUP_FAILED", "IMAGE_CLEANUP_FAILED", "HISTORY_CLEANUP_FAILED",
  ].filter((code) => warnings.has(code)).length;
  return {
    status: failedSections === 3 ? "FAILED_NON_FATAL" : warningList.length ? "PARTIAL" : "COMPLETED",
    buildkitBytesReclaimed,
    imageBytesReclaimed: nonNegativeReclaimedBytes([imageBytesReclaimed]),
    historyBytesReclaimed: nonNegativeReclaimedBytes([historyBytesReclaimed]),
    freeBytesBefore: before.availableBytes,
    freeBytesAfter: after.availableBytes,
    filesystemTotalBytes: after.totalBytes,
    filesystemUsedPercentage: after.usedPercentage,
    warnings: warningList,
  };
}
