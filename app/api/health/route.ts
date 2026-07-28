import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { apiRoute } from "@/lib/api";
import { SupabaseRequestError, supabaseAdminJson } from "@/lib/supabase-server";
import { inspectWorkerRuntimeEnvironment } from "@/lib/runtime-environment";
import { fetchWithTimeout, isTimeoutError } from "@/lib/fetch-timeout";
import {
  buildReadinessDiagnostics,
  type ReadinessProbe,
  type ReadinessSnapshot,
} from "@/lib/readiness-diagnostics";

export const dynamic = "force-dynamic";

const READINESS_SUPABASE_TIMEOUT_MS = 10_000;

const integrationStatus=(environment:ReturnType<typeof inspectWorkerRuntimeEnvironment>)=>({
  email:{enabled:true,configured:environment.delivery},
  webhook:{enabled:environment.webhooksEnabled,configured:environment.webhooks},
  integrationSync:{enabled:environment.integrationsEnabled,configured:environment.integrations},
  externalAi:{enabled:false,configured:false},
});

function authProbe(result: PromiseSettledResult<Response>): ReadinessProbe {
  if (result.status === "fulfilled") {
    return result.value.ok
      ? { ok: true }
      : { ok: false, code: "AUTH_HEALTH_HTTP_ERROR", httpStatus: result.value.status };
  }
  return {
    ok: false,
    code: isTimeoutError(result.reason) ? "AUTH_HEALTH_TIMEOUT" : "AUTH_HEALTH_UNAVAILABLE",
  };
}

function databaseProbe(result: PromiseSettledResult<ReadinessSnapshot>): ReadinessProbe {
  if (result.status === "fulfilled") return { ok: true };
  if (result.reason instanceof SupabaseRequestError) {
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
    code: isTimeoutError(result.reason) ? "DATABASE_READINESS_TIMEOUT" : "DATABASE_READINESS_UNAVAILABLE",
  };
}

async function get(request: Request) {
  const checkedAt = new Date().toISOString();
  if (new URL(request.url).searchParams.get("mode") !== "ready") {
    return NextResponse.json({ status: "ok", version: APP_VERSION, checkedAt });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.CRM_WORKSPACE_ID;
  const environment = inspectWorkerRuntimeEnvironment();
  const requiredWorkers=environment.enabledWorkers;
  if (!environment.core || !url || !key || !serviceKey || !workspaceId) {
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
        {code:"CONFIGURE_RUNTIME",action:"Configure every named missing variable in the private Sites/runtime secret store; never copy local test values.",missing:environment.missing},
        {code:"APPLY_MIGRATIONS",action:"Back up the target database, then apply every Supabase migration."},
        {code:"SCHEDULE_WORKERS",action:"Enable the protected production schedule for npm run workers:process and confirm every enabled worker heartbeat.",workers:requiredWorkers},
      ],
    }, { status: 503 });
  }

  const [authResult, readinessResult] = await Promise.allSettled([
      fetchWithTimeout(`${url}/auth/v1/health`, {
        headers: { apikey: key },
        cache: "no-store",
      }, READINESS_SUPABASE_TIMEOUT_MS),
      supabaseAdminJson<ReadinessSnapshot>("/rest/v1/rpc/service_readiness_snapshot_for_workers", {
        method: "POST",
        body: JSON.stringify({
          target_workspace: workspaceId,
          enabled_workers: requiredWorkers,
        }),
        signal: AbortSignal.timeout(READINESS_SUPABASE_TIMEOUT_MS),
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
          ...(environment.valid?[]:[{code:"CONFIGURE_RUNTIME",action:"Configure the missing variables for core delivery and explicitly enabled integrations.",missing:environment.missing}]),
          ...(diagnostics.components.auth.status!=="failed"?[]:[{code:"RESTORE_AUTH",action:"Verify the production Supabase Auth URL/key and provider health.",reason:diagnostics.components.auth.code}]),
          ...(diagnostics.components.database.status!=="failed"?[]:[{code:"VERIFY_DATABASE",action:"Apply pending migrations and verify service_readiness_snapshot with the production workspace.",reason:diagnostics.components.database.code}]),
          ...(diagnostics.components.workers.status!=="failed"?[]:[{code:"RUN_WORKERS",action:"Run npm run workers:process from the protected scheduler until all worker heartbeats are fresh.",workers:requiredWorkers,reason:diagnostics.components.workers.code}]),
          ...(diagnostics.components.queues.status!=="failed"?[]:[{code:"REPAIR_QUEUES",action:"Review failed/dead jobs in Operations, correct the recorded cause, then use the audited retry action.",reason:diagnostics.components.queues.code}]),
        ],
      },
      { status: ready ? 200 : 503 },
    );
}

export const GET = apiRoute(get, "HEALTH_CHECK_FAILED");
