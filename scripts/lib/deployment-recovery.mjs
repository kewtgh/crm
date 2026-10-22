// Recovery requires affirmative evidence. Historical/partially written records fail closed.
export function assertEarlyRequestRecoverable({ request, latest, mode, serviceActive = false }) {
  if (serviceActive || !request || !/^[0-9a-f-]{36}$/i.test(request.requestId ?? "")
    || typeof request.sourceRoot !== "string" || !request.sourceRoot
    || !["deploy", "initialize", "rollback", "recover"].includes(request.mode) || request.mode !== mode
    || latest?.requestId !== request.requestId || latest?.mode !== mode
    || !["BOOTSTRAP_FAILED", "BOOTSTRAP_RUNNING"].includes(latest.result) || latest.recoverySafe !== true
    || latest.applicationResult !== "NOT_STARTED" || latest.controllerStarted !== false
    || latest.migrationState !== "NOT_STARTED" || latest.migrationMayHaveChanged !== false
    || latest.webSwitch !== "NOT_STARTED" || latest.workerSwitch !== "NOT_STARTED"
    || latest.applicationAccepted !== false || latest.finalizationComplete !== false
    || latest.requestArchived !== false || !Array.isArray(latest.attempts)
    || !latest.attempts.length || latest.attempts.some(attempt => attempt.controllerStarted !== false)) {
    throw new Error("REQUEST_RECONCILIATION_REQUIRED: execution evidence does not permit replay");
  }
  return request;
}

export function assertPendingAcceptance({ request, latest }) {
  if (latest?.result !== "PUBLIC_EDGE_RECOVERY_REQUIRED" || latest.requestId !== request?.requestId
    || latest.mode !== request?.mode || latest.internalReleaseHealth !== "HEALTHY"
    || latest.applicationAccepted !== false || latest.finalizationComplete !== false
    || latest.requestArchived !== false || latest.migrationState !== "COMPLETED"
    || !/^[0-9a-f]{40}$/.test(latest.targetCommit ?? "")) {
    throw new Error("PUBLIC_ACCEPTANCE_RESUME_UNSAFE");
  }
  return latest;
}

export function deploymentFailureDisposition({ migrationMayHaveChanged, migrationState,
  internalReleaseHealth, publicEdgeFailure, rollback, applicationAccepted }) {
  if (applicationAccepted) return "FINALIZATION_RECONCILIATION_REQUIRED";
  if (publicEdgeFailure && internalReleaseHealth === "HEALTHY" && migrationState === "COMPLETED"
    && rollback?.status !== "REQUIRED") return "PUBLIC_EDGE_RECOVERY_REQUIRED";
  if (migrationMayHaveChanged && (migrationState !== "COMPLETED" || rollback?.status !== "REQUIRED")) {
    return "APPLICATION_RECOVERY_REQUIRED";
  }
  return "ROLLBACK_OR_FINALIZE";
}

export async function resumeCandidateAcceptance({ request, latest, operations }) {
  assertPendingAcceptance({ request, latest });
  const target = await operations.validateIdentity(latest);
  const releaseHealth = await operations.acceptRuntime(target);
  // The only allowed operations are identity/health validation and acceptance persistence.
  return operations.finalize(target, releaseHealth);
}
