export const PREEXISTING_QUEUE_DEGRADATION = "PREEXISTING_QUEUE_DEGRADATION";

const releaseCheckNames = Object.freeze([
  "environment",
  "auth",
  "database",
  "workers",
]);
const releaseMetricNames = Object.freeze([
  "failedJobs",
  "stuckJobs",
  "missingWorkers",
  "staleWorkers",
]);

function nonnegativeInteger(value, name) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`RELEASE_HEALTH_${name.toUpperCase()}_INVALID`);
  }
  return count;
}

export function sanitizeReleaseHealthSnapshot(readiness) {
  if (!readiness || typeof readiness !== "object" || Array.isArray(readiness)) {
    throw new Error("RELEASE_HEALTH_RESPONSE_INVALID");
  }
  const checks = Object.fromEntries(releaseCheckNames.map((name) => [
    name,
    readiness.checks?.[name] === true,
  ]));
  const metrics = Object.fromEntries(releaseMetricNames.map((name) => [
    name,
    nonnegativeInteger(readiness.metrics?.[name], name),
  ]));
  return { checks, metrics };
}

export function evaluateProductionReleaseHealth({
  baseline,
  final,
  allowMissingBaseline = false,
}) {
  const finalSnapshot = sanitizeReleaseHealthSnapshot(final);
  for (const name of releaseCheckNames) {
    if (!finalSnapshot.checks[name]) {
      throw new Error(`RELEASE_HEALTH_${name.toUpperCase()}_FAILED`);
    }
  }
  if (finalSnapshot.metrics.missingWorkers !== 0) {
    throw new Error("RELEASE_HEALTH_MISSING_WORKERS");
  }
  if (finalSnapshot.metrics.staleWorkers !== 0) {
    throw new Error("RELEASE_HEALTH_STALE_WORKERS");
  }
  if (finalSnapshot.metrics.stuckJobs !== 0) {
    throw new Error("RELEASE_HEALTH_STUCK_JOBS");
  }

  const baselineSnapshot = baseline === null && allowMissingBaseline
    ? finalSnapshot
    : sanitizeReleaseHealthSnapshot(baseline);
  if (finalSnapshot.metrics.failedJobs > baselineSnapshot.metrics.failedJobs) {
    throw new Error("RELEASE_HEALTH_FAILED_JOBS_INCREASED");
  }

  const degraded = finalSnapshot.metrics.failedJobs > 0;
  return sanitizeReleaseHealthEvidence({
    status: degraded ? "ACCEPTED_WITH_PREEXISTING_DEGRADATION" : "HEALTHY",
    baselineFailedJobs: baselineSnapshot.metrics.failedJobs,
    finalFailedJobs: finalSnapshot.metrics.failedJobs,
    stuckJobs: finalSnapshot.metrics.stuckJobs,
    warnings: degraded ? [PREEXISTING_QUEUE_DEGRADATION] : [],
  });
}

export function sanitizeReleaseHealthEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RELEASE_HEALTH_EVIDENCE_INVALID");
  }
  const status = value.status;
  const baselineFailedJobs = nonnegativeInteger(value.baselineFailedJobs, "baselineFailedJobs");
  const finalFailedJobs = nonnegativeInteger(value.finalFailedJobs, "finalFailedJobs");
  const stuckJobs = nonnegativeInteger(value.stuckJobs, "stuckJobs");
  const warnings = value.warnings;
  const degraded = status === "ACCEPTED_WITH_PREEXISTING_DEGRADATION";
  if (!degraded && status !== "HEALTHY") throw new Error("RELEASE_HEALTH_STATUS_INVALID");
  if (stuckJobs !== 0 || finalFailedJobs > baselineFailedJobs) {
    throw new Error("RELEASE_HEALTH_EVIDENCE_INVALID");
  }
  if (!Array.isArray(warnings)
    || (degraded && (finalFailedJobs === 0
      || warnings.length !== 1
      || warnings[0] !== PREEXISTING_QUEUE_DEGRADATION))
    || (!degraded && (finalFailedJobs !== 0 || warnings.length !== 0))) {
    throw new Error("RELEASE_HEALTH_WARNINGS_INVALID");
  }
  return { status,baselineFailedJobs,finalFailedJobs,stuckJobs,warnings:[...warnings] };
}
