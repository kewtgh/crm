import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { apiRoute } from "@/lib/api";
import { supabaseAdminJson } from "@/lib/supabase-server";

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

async function get(request: Request) {
  const checkedAt = new Date().toISOString();
  if (new URL(request.url).searchParams.get("mode") !== "ready") {
    return NextResponse.json({ status: "ok", version: APP_VERSION, checkedAt });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.CRM_WORKSPACE_ID;
  if (!url || !key || !serviceKey || !workspaceId || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    return NextResponse.json({
      code: "SERVICE_NOT_CONFIGURED",
      status: "unavailable",
      version: APP_VERSION,
      checkedAt,
      checks: { auth: false, database: false, workers: false, queues: false },
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
      },
      { status: ready ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({
      code: "DEPENDENCY_UNAVAILABLE",
      status: "degraded",
      version: APP_VERSION,
      checkedAt,
      checks: { auth: false, database: false, workers: false, queues: false },
    }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}

export const GET = apiRoute(get, "HEALTH_CHECK_FAILED");
