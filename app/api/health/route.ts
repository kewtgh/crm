import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { apiRoute } from "@/lib/api";
import { supabaseAdminJson } from "@/lib/supabase-server";
import { inspectCoreRuntimeEnvironment } from "@/lib/runtime-environment";

export const dynamic = "force-dynamic";

type ServiceReadiness = {
  ready?: boolean;
  database?: boolean;
  staleWorkers?: number;
  failedJobs?: number;
  stuckJobs?: number;
  missingWorkers?: number;
  oldestPendingAt?: string | null;
  checkedAt?: string;
};

const requiredWorkers=["REMINDERS","NOTIFICATION_OUTBOX","CALENDAR_DELIVERIES","GENERATED_JOBS","WEBHOOK_INBOX","INTEGRATION_SYNC"];
const integrationStatus=()=>({
  email:Boolean(process.env.EMAIL_DELIVERY_URL&&process.env.EMAIL_DELIVERY_TOKEN),
  webhook:Boolean(process.env.WEBHOOK_PROCESSOR_URL),
  integrationSync:Boolean(process.env.INTEGRATION_SYNC_PROCESSOR_URL),
  externalAi:false,
});

async function get(request: Request) {
  const checkedAt = new Date().toISOString();
  if (new URL(request.url).searchParams.get("mode") !== "ready") {
    return NextResponse.json({ status: "ok", version: APP_VERSION, checkedAt });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.CRM_WORKSPACE_ID;
  const environment = inspectCoreRuntimeEnvironment();
  if (!environment.valid || !url || !key || !serviceKey || !workspaceId) {
    return NextResponse.json({
      code: "SERVICE_NOT_CONFIGURED",
      status: "unavailable",
      version: APP_VERSION,
      checkedAt,
      checks: { environment: false, auth: false, database: false, workers: false, queues: false },
      configuration: { configured: environment.configured, expected: environment.expected, missing: environment.missing },
      integrations:integrationStatus(),
      remediation:[
        {code:"CONFIGURE_RUNTIME",action:"Configure every named missing variable in the private Sites/runtime secret store; never copy local test values.",missing:environment.missing},
        {code:"APPLY_MIGRATIONS",action:"Back up the target database, then apply all Supabase migrations through 202607190040."},
        {code:"SCHEDULE_WORKERS",action:"Enable the protected production schedule for npm run workers:process and confirm all six heartbeats.",workers:requiredWorkers},
      ],
    }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const [authHealth, readiness] = await Promise.all([
      fetch(`${url}/auth/v1/health`, {
        headers: { apikey: key },
        cache: "no-store",
        signal: controller.signal,
      }),
      supabaseAdminJson<ServiceReadiness>("/rest/v1/rpc/service_readiness_snapshot", {
        method: "POST",
        body: JSON.stringify({
          target_workspace: workspaceId,
        }),
        signal: controller.signal,
      }),
    ]);
    const ready = authHealth.ok && readiness.database === true && readiness.ready === true;
    return NextResponse.json(
      {
        ...(ready ? {} : { code: "SERVICE_NOT_READY" }),
        status: ready ? "ok" : "degraded",
        version: APP_VERSION,
        checkedAt,
        checks: {
          environment: true,
          auth: authHealth.ok,
          database: readiness.database === true,
          workers: Number(readiness.staleWorkers ?? 0) === 0,
          queues: Number(readiness.failedJobs ?? 0) === 0,
        },
        metrics: {
          staleWorkers: Number(readiness.staleWorkers ?? 0),
          missingWorkers: Number(readiness.missingWorkers ?? 0),
          failedJobs: Number(readiness.failedJobs ?? 0),
          stuckJobs: Number(readiness.stuckJobs ?? 0),
          oldestPendingAt: readiness.oldestPendingAt ?? null,
        },
        integrations:integrationStatus(),
        remediation:ready?[]:[
          ...(authHealth.ok?[]:[{code:"RESTORE_AUTH",action:"Verify the production Supabase Auth URL/key and provider health."}]),
          ...(readiness.database===true?[]:[{code:"VERIFY_DATABASE",action:"Apply pending migrations and verify service_readiness_snapshot with the production workspace."}]),
          ...(Number(readiness.missingWorkers??0)===0&&Number(readiness.staleWorkers??0)===0?[]:[{code:"RUN_WORKERS",action:"Run npm run workers:process from the protected scheduler until all worker heartbeats are fresh.",workers:requiredWorkers}]),
          ...(Number(readiness.failedJobs??0)===0&&Number(readiness.stuckJobs??0)===0?[]:[{code:"REPAIR_QUEUES",action:"Review failed/dead jobs in Operations, correct the recorded cause, then use the audited retry action."}]),
        ],
      },
      { status: ready ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({
      code: "DEPENDENCY_UNAVAILABLE",
      status: "degraded",
      version: APP_VERSION,
      checkedAt,
      checks: { environment: true, auth: false, database: false, workers: false, queues: false },
      integrations:integrationStatus(),
      remediation:[{code:"DEPENDENCY_RETRY",action:"Verify Supabase reachability, runtime secrets, and database readiness, then retry the readiness check."}],
    }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}

export const GET = apiRoute(get, "HEALTH_CHECK_FAILED");
