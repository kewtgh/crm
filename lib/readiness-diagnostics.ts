export type ReadinessSnapshot = {
  ready?: boolean;
  database?: boolean;
  staleWorkers?: number;
  failedJobs?: number;
  stuckJobs?: number;
  missingWorkers?: number;
  oldestPendingAt?: string | null;
  checkedAt?: string;
};

export type ReadinessProbe = {
  ok: boolean;
  code?: string;
  httpStatus?: number;
};

type ComponentName = "environment" | "auth" | "database" | "workers" | "queues";
type ComponentDiagnostic = {
  status: "ok" | "failed" | "blocked";
  code?: string;
  httpStatus?: number;
  details?: Record<string, number | string>;
};

const count = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

export function buildReadinessDiagnostics({
  environmentValid,
  auth,
  database,
  snapshot,
}: {
  environmentValid: boolean;
  auth: ReadinessProbe;
  database: ReadinessProbe;
  snapshot?: ReadinessSnapshot;
}) {
  const metrics = {
    staleWorkers: count(snapshot?.staleWorkers),
    missingWorkers: count(snapshot?.missingWorkers),
    failedJobs: count(snapshot?.failedJobs),
    stuckJobs: count(snapshot?.stuckJobs),
    oldestPendingAt: snapshot?.oldestPendingAt ?? null,
  };
  const components = {} as Record<ComponentName, ComponentDiagnostic>;
  components.environment = environmentValid
    ? { status: "ok" }
    : { status: "failed", code: "RUNTIME_CONFIGURATION_INVALID" };

  if (!environmentValid) {
    for (const component of ["auth", "database", "workers", "queues"] as const) {
      components[component] = {
        status: "blocked",
        code: "RUNTIME_CONFIGURATION_BLOCKED",
      };
    }
  } else {
    components.auth = auth.ok
      ? { status: "ok" }
      : {
          status: "failed",
          code: auth.code ?? "AUTH_HEALTH_UNAVAILABLE",
          ...(auth.httpStatus ? { httpStatus: auth.httpStatus } : {}),
        };
    const databaseOk = database.ok && snapshot?.database === true;
    components.database = databaseOk
      ? { status: "ok" }
      : {
          status: "failed",
          code: database.code ?? (database.ok ? "DATABASE_NOT_READY" : "DATABASE_READINESS_UNAVAILABLE"),
          ...(database.httpStatus ? { httpStatus: database.httpStatus } : {}),
        };

    if (!databaseOk) {
      components.workers = { status: "blocked", code: "WORKER_CHECK_BLOCKED_BY_DATABASE" };
      components.queues = { status: "blocked", code: "QUEUE_CHECK_BLOCKED_BY_DATABASE" };
    } else {
      const workersOk = metrics.missingWorkers === 0 && metrics.staleWorkers === 0;
      const workerCode = metrics.missingWorkers && metrics.staleWorkers
        ? "WORKERS_MISSING_AND_STALE"
        : metrics.missingWorkers
          ? "WORKERS_MISSING"
          : "WORKERS_STALE";
      components.workers = workersOk
        ? { status: "ok" }
        : {
            status: "failed",
            code: workerCode,
            details: {
              missingWorkers: metrics.missingWorkers,
              staleWorkers: metrics.staleWorkers,
            },
          };

      const queuesOk = metrics.failedJobs === 0 && metrics.stuckJobs === 0;
      const queueCode = metrics.failedJobs && metrics.stuckJobs
        ? "QUEUES_FAILED_AND_STUCK"
        : metrics.failedJobs
          ? "QUEUES_FAILED"
          : "QUEUES_STUCK";
      components.queues = queuesOk
        ? { status: "ok" }
        : {
            status: "failed",
            code: queueCode,
            details: {
              failedJobs: metrics.failedJobs,
              stuckJobs: metrics.stuckJobs,
            },
          };
    }
  }

  const checks = Object.fromEntries(
    (Object.keys(components) as ComponentName[]).map((component) => [
      component,
      components[component].status === "ok",
    ]),
  ) as Record<ComponentName, boolean>;
  const failureReasons = (Object.entries(components) as [ComponentName, ComponentDiagnostic][])
    .filter(([, diagnostic]) => diagnostic.status !== "ok")
    .map(([component, diagnostic]) => ({ component, ...diagnostic }));
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    components,
    failureReasons,
    metrics,
  };
}
