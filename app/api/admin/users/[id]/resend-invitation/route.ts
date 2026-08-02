import { NextResponse } from "next/server";
import { z } from "zod";
import { resendStaffInvitation } from "@/lib/admin-users-repository";
import { apiRoute, parseUuid, requireApiAal2, requireApiRole } from "@/lib/api";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { mutationIsTrusted } from "@/lib/request-security";

const schema = z.object({ idempotencyKey: z.string().trim().min(8).max(160) });

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
    return NextResponse.json(result, { status:202 });
  } catch (error) {
    if (error instanceof DatabaseRequestError) {
      return NextResponse.json({ code:error.code }, { status:error.status });
    }
    return NextResponse.json({ code:"STAFF_INVITATION_RESEND_FAILED" }, { status:500 });
  }
}

export const POST = apiRoute(post, "STAFF_INVITATION_RESEND_FAILED");
