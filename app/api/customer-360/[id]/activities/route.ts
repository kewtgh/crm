import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parseUuid, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { supabaseJson } from "@/lib/supabase-server";

const schema = z.object({
  contactId: z.uuid().nullable().optional(),
  opportunityId: z.uuid().nullable().optional(),
  activityKind: z.enum(["CALL", "EMAIL", "MEETING", "VISIT", "MEAL", "NOTE", "CAMPAIGN", "PAYMENT_FOLLOW_UP"]),
  occurredAt: z.iso.datetime(),
  summaryZh: z.string().trim().min(2).max(1000),
  summaryEn: z.string().trim().min(2).max(1000),
  nextStepZh: z.string().trim().min(2).max(1000),
  nextStepEn: z.string().trim().min(2).max(1000),
});

async function post(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiUser();
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_CUSTOMER_ACTIVITY", 400);
  const item = await supabaseJson<Record<string, unknown>>("/rest/v1/rpc/record_customer_activity", {
    method: "POST",
    body: JSON.stringify({
      target_organization: parseUuid(id),
      target_contact: parsed.data.contactId ?? null,
      target_opportunity: parsed.data.opportunityId ?? null,
      activity_kind: parsed.data.activityKind,
      occurred: parsed.data.occurredAt,
      summary_zh: parsed.data.summaryZh,
      summary_en: parsed.data.summaryEn,
      next_step_zh: parsed.data.nextStepZh,
      next_step_en: parsed.data.nextStepEn,
    }),
  });
  return NextResponse.json({ item }, { status: 201 });
}

export const POST = apiRoute(post, "CUSTOMER_ACTIVITY_CREATE_FAILED");
