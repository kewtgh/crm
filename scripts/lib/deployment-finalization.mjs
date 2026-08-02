export const CONTROL_PLANE_FINALIZATION_FAILED = "CONTROL_PLANE_FINALIZATION_FAILED";

export class ControlPlaneFinalizationError extends Error {
  constructor(state, cause) {
    super(CONTROL_PLANE_FINALIZATION_FAILED, { cause });
    this.name = "ControlPlaneFinalizationError";
    this.state = state;
  }
}

const serialized = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function terminalRequestIsArchived({ latest, requestExists, archivedRequest }) {
  return latest?.finalizationComplete === true
    && latest.requestArchived === true
    && requestExists === false
    && archivedRequest?.requestId === latest.requestId
    && archivedRequest?.mode === latest.mode;
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
