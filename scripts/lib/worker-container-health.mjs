function nonnegativeInteger(value, code) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(code);
  return count;
}

export function assertWorkerContainerHealth({
  schemaCurrent,
  snapshot,
}) {
  if (schemaCurrent !== true) throw new Error("WORKER_SCHEMA_NOT_CURRENT");
  if (snapshot?.database !== true) throw new Error("WORKER_DATABASE_NOT_READY");

  const missingWorkers = nonnegativeInteger(
    snapshot?.missingWorkers,
    "WORKER_HEALTH_MISSINGWORKERS_INVALID",
  );
  const staleWorkers = nonnegativeInteger(
    snapshot?.staleWorkers,
    "WORKER_HEALTH_STALEWORKERS_INVALID",
  );
  nonnegativeInteger(snapshot?.failedJobs, "WORKER_HEALTH_FAILEDJOBS_INVALID");
  nonnegativeInteger(snapshot?.stuckJobs, "WORKER_HEALTH_STUCKJOBS_INVALID");

  if (missingWorkers !== 0) throw new Error("WORKER_HEALTH_MISSINGWORKERS");
  if (staleWorkers !== 0) throw new Error("WORKER_HEALTH_STALEWORKERS");
  return true;
}
