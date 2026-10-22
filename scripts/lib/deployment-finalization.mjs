export const CONTROL_PLANE_FINALIZATION_FAILED = "CONTROL_PLANE_FINALIZATION_FAILED";

export class ControlPlaneFinalizationError extends Error {
  constructor(state, cause) {
    super(CONTROL_PLANE_FINALIZATION_FAILED, { cause });
    this.name = "ControlPlaneFinalizationError";
    this.state = state;
  }
}

const serialized = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function terminalReconciliationEvidence({ state, accepted, requestArchivePath }) {
  if (["finalizing", "finished", "control-plane-finalization-failed"].includes(state?.stage)) return state;
  if (!state || state.finalReleaseAcceptance !== "VERIFIED" || state.internalReleaseHealth !== "HEALTHY"
    || accepted?.requestId !== state.requestId || accepted.mode !== state.mode
    || accepted.commit !== state.targetCommit || accepted.currentImage !== state.targetImage
    || accepted.version !== state.applicationVersion) throw new Error("FINALIZATION_RECONCILIATION_UNSAFE");
  return { ...state, result: CONTROL_PLANE_FINALIZATION_FAILED, applicationResult: "SUCCESS",
    applicationAccepted: true, stage: "control-plane-finalization-failed", requestArchivePath };
}

export function terminalRequestIsArchived({ latest, requestExists, archivedRequest }) {
  return latest?.finalizationComplete === true
    && latest.requestArchived === true
    && requestExists === false
    && archivedRequest?.requestId === latest.requestId
    && archivedRequest?.mode === latest.mode;
}

// Reconcile filesystem finalization only. Never invoke application operations here.
export function reconcileTerminalDeployment({ state, latest, requestPath, requestArchivePath,
  statusPath, latestPath, readJson, exists, rename, atomicWrite }) {
  const results = new Set(["SUCCESS", "RECOVERED", "FAILED", "FAILED_ROLLED_BACK",
    "FAILED_ROLLBACK_REQUIRED", "ROLLBACK_OK", "ROLLBACK_FAILED"]);
  const result = state?.result === CONTROL_PLANE_FINALIZATION_FAILED ? state.applicationResult : state?.result;
  if (!results.has(result) || !["finalizing", "finished", "control-plane-finalization-failed"].includes(state?.stage)
    || state.deploymentId !== latest?.deploymentId || state.requestId !== latest?.requestId
    || state.requestArchivePath !== requestArchivePath) throw new Error("FINALIZATION_RECONCILIATION_UNSAFE");
  const request = readJson(requestPath);
  const archived = readJson(requestArchivePath);
  if ((request && archived) || (!request && !archived)
    || (request ?? archived).requestId !== state.requestId || (request ?? archived).mode !== state.mode
    || (exists(requestPath) && !request) || (exists(requestArchivePath) && !archived)) {
    throw new Error("FINALIZATION_IDENTITY_CONFLICT");
  }
  // Repeatable after a crash at any subsequent write; rename is performed at most once.
  if (request) rename(requestPath, requestArchivePath);
  const finalized = { ...state, result, stage: "finished", finalizationComplete: true, requestArchived: true };
  atomicWrite(statusPath, serialized(finalized));
  atomicWrite(latestPath, serialized(finalized));
  return finalized;
}

export function finalizeTerminalDeployment({
  currentState,
  result,
  update = {},
  startedAt,
  finishedAt = new Date(),
  requestPath,
  requestArchivePath,
  statusPath,
  latestPath,
  exists,
  rename,
  atomicWrite,
}) {
  const terminalState = {
    ...currentState,
    ...update,
    result,
    applicationResult: result,
    stage: "finalizing",
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    finalizationComplete: false,
    requestArchived: false,
    requestArchivePath,
  };
  try {
    atomicWrite(statusPath, serialized(terminalState));
    if (!exists(requestPath)) throw new Error("TERMINAL_REQUEST_MISSING");
    if (exists(requestArchivePath)) throw new Error("TERMINAL_REQUEST_ARCHIVE_EXISTS");
    rename(requestPath, requestArchivePath);
    const finalized = {
      ...terminalState,
      stage: "finished",
      finalizationComplete: true,
      requestArchived: true,
    };
    atomicWrite(statusPath, serialized(finalized));
    atomicWrite(latestPath, serialized(finalized));
    return finalized;
  } catch (cause) {
    const requestArchived = !exists(requestPath) && exists(requestArchivePath);
    const failure = {
      ...terminalState,
      result: CONTROL_PLANE_FINALIZATION_FAILED,
      applicationResult: result,
      stage: "control-plane-finalization-failed",
      finalizationComplete: false,
      requestArchived,
      error: CONTROL_PLANE_FINALIZATION_FAILED,
    };
    try { atomicWrite(statusPath, serialized(failure)); } catch { /* Preserve the original finalization failure. */ }
    try { atomicWrite(latestPath, serialized(failure)); } catch { /* The runner still exits non-zero. */ }
    throw new ControlPlaneFinalizationError(failure, cause);
  }
}
