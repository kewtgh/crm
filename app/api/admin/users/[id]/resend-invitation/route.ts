import { NextResponse } from "next/server";
import { z } from "zod";
import { resendStaffInvitation } from "@/lib/admin-users-repository";
import { apiRequestId, apiRoute, parseUuid, requireApiAal2, requireApiRole } from "@/lib/api";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { mutationIsTrusted } from "@/lib/request-security";
import { emitObservabilityEvent } from "@/lib/observability";

const schema = z.object({ idempotencyKey: z.string().trim().min(8).max(160) });

export function databasePolicyDenied(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "42501";
}

async function post(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code:"UNTRUSTED_ORIGIN" }, { status:403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code:"INVALID_INPUT",field:"idempotencyKey" }, { status:400 });
  const actor = await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  try {
    const result = await resendStaffInvitation(
      parseUuid((await context.params).id),
      parsed.data.idempotencyKey,
      actor,
    );
    await emitObservabilityEvent({
      name:"admin.staff_invitation.resend",requestId:apiRequestId(request),
      route:"/api/admin/users/:id/resend-invitation",operation:"resendStaffInvitation",
      status:202,result:"queued",
    });
    return NextResponse.json(result, { status:202 });
  } catch (error) {
    if (error instanceof DatabaseRequestError) {
      await emitObservabilityEvent({
        name:"admin.staff_invitation.resend",requestId:apiRequestId(request),
        route:"/api/admin/users/:id/resend-invitation",operation:"resendStaffInvitation",
        status:error.status,result:"rejected",
      });
      return NextResponse.json({ code:error.code }, { status:error.status });
    }
    await emitObservabilityEvent({
      name:"admin.staff_invitation.resend",requestId:apiRequestId(request),
      route:"/api/admin/users/:id/resend-invitation",operation:"resendStaffInvitation",
      status:500,result:"failed",
      errorCode:databasePolicyDenied(error) ? "DATABASE_POLICY_DENIED" : "STAFF_INVITATION_RESEND_FAILED",
    });
    return NextResponse.json({ code:"STAFF_INVITATION_RESEND_FAILED" }, { status:500 });
  }
}

export const POST = apiRoute(post, "STAFF_INVITATION_RESEND_FAILED");
