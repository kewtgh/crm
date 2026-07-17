import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parseUuid, requireApiAal2, requireApiRole } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { repairStaffIdentity } from "@/lib/admin-users-repository";
import {
  listRetryableJobs,
  loadBusinessInsights,
  loadOperationalSnapshot,
  loadReleaseReadiness,
  retryOperationalJob,
} from "@/lib/operations-repository";

const retrySchema = z.object({
  jobType: z.enum(["NOTIFICATION_OUTBOX", "CALENDAR_DELIVERIES", "GENERATED_JOBS", "REMINDERS", "WEBHOOK_INBOX", "IDENTITY_REPAIR"]),
  jobId: z.uuid(),
});

async function get() {
  await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  const [snapshot, retryableJobs, insights,readiness] = await Promise.all([
    loadOperationalSnapshot(),
    listRetryableJobs(),
    loadBusinessInsights(),
    loadReleaseReadiness(),
  ]);
  return NextResponse.json({ snapshot, retryableJobs, insights,readiness });
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  const parsed = retrySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_OPERATIONAL_RETRY", 400);
  if (parsed.data.jobType === "IDENTITY_REPAIR") {
    await repairStaffIdentity(parseUuid(parsed.data.jobId));
  } else {
    await retryOperationalJob(parsed.data.jobType, parseUuid(parsed.data.jobId));
  }
  return NextResponse.json({ ok: true });
}

export const GET = apiRoute(get, "OPERATIONS_LOAD_FAILED");
export const POST = apiRoute(post, "OPERATIONAL_RETRY_FAILED");
