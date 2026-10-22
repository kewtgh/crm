import path from "node:path";
import { assertEarlyRequestRecoverable } from "./deployment-recovery.mjs";

export const PRODUCTION_DEPLOY_LOCK_PATH = "/var/lib/lumina-crm/deploy.lock";
export const FINALIZED_DEPLOYMENT_RESULTS = Object.freeze([
  "SUCCESS", "RECOVERED", "FAILED", "FAILED_ROLLED_BACK",
  "FAILED_ROLLBACK_REQUIRED", "ROLLBACK_OK", "ROLLBACK_FAILED",
]);

export function assertSpecificAbsolutePath(value, label) {
  const resolved = path.resolve(String(value));
  if (!path.isAbsolute(String(value)) || resolved === path.parse(resolved).root) {
    throw new Error(`${label} must be a specific absolute path`);
  }
  return resolved;
}

export function assertPathWithin(
  parent,
  candidate,
  { directChild = false, label = "Path" } = {},
) {
  const root = assertSpecificAbsolutePath(parent, "Parent path");
  const target = path.resolve(String(candidate));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay below ${root}`);
  }
  if (directChild && relative.includes(path.sep)) {
    throw new Error(`${label} must be a direct child of ${root}`);
  }
  return target;
}

export function validateDirectoryMetadata(metadata, { label = "Directory" } = {}) {
  if (!metadata?.isDirectory?.() || metadata?.isSymbolicLink?.()) {
    throw new Error(`${label} must be a real directory, not a symlink`);
  }
  return true;
}

export async function writeExclusiveRequest(fs, requestPath, request) {
  try {
    await fs.writeFile(
      requestPath,
      `${JSON.stringify(request)}\n`,
      { flag: "wx", mode: 0o640 },
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("A production deployment request is already pending or running");
    }
    throw error;
  }
}

export function classifyPersistedDeployment({ serviceActive, request, latest }) {
  if (serviceActive) {
    return { state: "RUNNING", deploymentId: latest?.deploymentId ?? null };
  }
  if (latest?.result
    && FINALIZED_DEPLOYMENT_RESULTS.includes(latest.result)
    && latest.finalizationComplete === true
    && !request) {
    return { state: latest.result, deploymentId: latest.deploymentId ?? null };
  }
  if (latest?.result === "CONTROL_PLANE_FINALIZATION_FAILED") {
    return { state: latest.result, deploymentId: latest.deploymentId ?? null };
  }
  if (["BOOTSTRAP_FAILED", "PUBLIC_EDGE_RECOVERY_REQUIRED", "APPLICATION_RECOVERY_REQUIRED"].includes(latest?.result)) {
    return { state: latest.result, requestId: request?.requestId ?? null };
  }
  if (request) {
    try {
      assertEarlyRequestRecoverable({ request, latest, mode: request.mode, serviceActive });
      return { state: "PENDING_RECOVERABLE", requestId: request.requestId };
    } catch { return { state: "PENDING_RECONCILIATION_REQUIRED", requestId: request.requestId }; }
  }
  if (latest?.result) {
    return { state: latest.result, deploymentId: latest.deploymentId ?? null };
  }
  return { state: "IDLE", deploymentId: null };
}

export function validatePendingRequestForRecovery(options) {
  return assertEarlyRequestRecoverable(options);
}

export function isSystemdServiceInProgress(activeState) {
  return ["activating", "active", "reloading", "deactivating"]
    .includes(String(activeState ?? "").trim());
}
