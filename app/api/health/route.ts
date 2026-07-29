import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { apiRoute } from "@/lib/api";
import { DatabaseRequestError, databaseSystemJson } from "@/lib/db/gateway";
import { poolQuery } from "@/lib/db/pools";
import { inspectWebReadinessEnvironment } from "@/lib/runtime-environment";
import {
  buildReadinessDiagnostics,
  type ReadinessProbe,
  type ReadinessSnapshot,
} from "@/lib/readiness-diagnostics";
import { detailedReadinessAllowed } from "@/lib/readiness-request";

export const dynamic = "force-dynamic";

const READINESS_DATABASE_TIMEOUT_MS = 10_000;

const integrationStatus=(environment:ReturnType<typeof inspectWebReadinessEnvironment>)=>({
  email:{enabled:true,configured:null,configurationBoundary:"worker"},
  webhook:{enabled:environment.webhooksEnabled,configured:null,configurationBoundary:"worker"},
  integrationSync:{enabled:environment.integrationsEnabled,configured:null,configurationBoundary:"worker"},
  externalAi:{enabled:false,configured:false},
});

function authProbe(result: PromiseSettledResult<boolean>): ReadinessProbe {
  if (result.status === "fulfilled") {
    return result.value
      ? { ok: true }
      : { ok: false, code: "AUTH_SCHEMA_INCOMPLETE" };
  }
  return {
    ok: false,
    code: "AUTH_STORE_UNAVAILABLE",
  };
}

function databaseProbe(result: PromiseSettledResult<ReadinessSnapshot>): ReadinessProbe {
  if (result.status === "fulfilled") return { ok: true };
  if (result.reason instanceof DatabaseRequestError) {
    return {
      ok: false,
      code: result.reason.status === 504 || result.reason.code === "UPSTREAM_TIMEOUT"
        ? "DATABASE_READINESS_TIMEOUT"
        : "DATABASE_READINESS_RPC_ERROR",
      httpStatus: result.reason.status,
    };
  }
  return {
    ok: false,
    code: "DATABASE_READINESS_UNAVAILABLE",
  };
}

async function get(request: Request) {
  const checkedAt = new Date().toISOString();
  if (new URL(request.url).searchParams.get("mode") !== "ready") {
    return NextResponse.json({ status: "ok", version: APP_VERSION, checkedAt });
  }
  if (!detailedReadinessAllowed(request)) {
    return NextResponse.json({ code: "READINESS_LOCAL_ONLY" }, { status: 404 });
  }
  const workspaceId = process.env.CRM_WORKSPACE_ID;
  const environment = inspectWebReadinessEnvironment();
  const requiredWorkers=environment.enabledWorkers;
  if (!environment.core || !workspaceId) {
    const diagnostics = buildReadinessDiagnostics({
      environmentValid: false,
      auth: { ok: false },
      database: { ok: false },
    });
    return NextResponse.json({
      code: "SERVICE_NOT_CONFIGURED",
      status: "unavailable",
      version: APP_VERSION,
      checkedAt,
      checks: diagnostics.checks,
      components: diagnostics.components,
      failureReasons: diagnostics.failureReasons,
      metrics: diagnostics.metrics,
      configuration: { configured: environment.configured, expected: environment.expected, missing: environment.missing },
      integrations:integrationStatus(environment),
      remediation:[
        {code:"CONFIGURE_RUNTIME",action:"Configure every named missing variable in the Web runtime secret file; never copy local test values.",missing:environment.missing},
        {code:"APPLY_MIGRATIONS",action:"Back up the target database, then apply every project PostgreSQL migration."},
        {code:"SCHEDULE_WORKERS",action:"Enable the protected production schedule for npm run workers:process and confirm every enabled worker heartbeat.",workers:requiredWorkers},
      ],
    }, { status: 503 });
  }

  const [authResult, readinessResult] = await Promise.allSettled([
      poolQuery<{ ready: boolean }>(
        "system",
        `select
          to_regclass('app_auth.accounts') is not null
          and to_regclass('app_auth.sessions') is not null
          and to_regclass('app_auth.password_credentials') is not null
          as ready`,
      ).then((result) => result.rows[0]?.ready === true),
      databaseSystemJson<ReadinessSnapshot>("/db/rpc/service_readiness_snapshot_for_workers", {
        method: "POST",
        body: JSON.stringify({
          target_workspace: workspaceId,
          enabled_workers: requiredWorkers,
        }),
        signal: AbortSignal.timeout(READINESS_DATABASE_TIMEOUT_MS),
      }),
    ]);
    const readiness = readinessResult.status === "fulfilled" ? readinessResult.value : undefined;
    const diagnostics = buildReadinessDiagnostics({
      environmentValid: environment.valid,
      auth: authProbe(authResult),
      database: databaseProbe(readinessResult),
      snapshot: readiness,
    });
    const ready = diagnostics.ready;
    return NextResponse.json(
      {
        ...(ready ? {} : { code: "SERVICE_NOT_READY" }),
        status: ready ? "ok" : "degraded",
        version: APP_VERSION,
        checkedAt,
        checks: diagnostics.checks,
        components: diagnostics.components,
        failureReasons: diagnostics.failureReasons,
        metrics: diagnostics.metrics,
        configuration: { configured: environment.configured, expected: environment.expected, missing: environment.missing },
        integrations:integrationStatus(environment),
        remediation:ready?[]:[
          ...(environment.valid?[]:[{code:"CONFIGURE_RUNTIME",action:"Configure the missing Web runtime variables.",missing:environment.missing}]),
          ...(diagnostics.components.auth.status!=="failed"?[]:[{code:"RESTORE_AUTH",action:"Verify the app_auth schema, database credentials, and session tables.",reason:diagnostics.components.auth.code}]),
          ...(diagnostics.components.database.status!=="failed"?[]:[{code:"VERIFY_DATABASE",action:"Apply pending migrations and verify service_readiness_snapshot with the production workspace.",reason:diagnostics.components.database.code}]),
          ...(diagnostics.components.workers.status!=="failed"?[]:[{code:"RUN_WORKERS",action:"Run npm run workers:process from the protected scheduler until all worker heartbeats are fresh.",workers:requiredWorkers,reason:diagnostics.components.workers.code}]),
          ...(diagnostics.components.queues.status!=="failed"?[]:[{code:"REPAIR_QUEUES",action:"Review failed/dead jobs in Operations, correct the recorded cause, then use the audited retry action.",reason:diagnostics.components.queues.code}]),
        ],
      },
      { status: ready ? 200 : 503 },
    );
}

export const GET = apiRoute(get, "HEALTH_CHECK_FAILED");
