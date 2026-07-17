import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { supabaseJson } from "@/lib/supabase-server";

const schema = z.object({
  resourceType: z.enum(["ORGANIZATION", "CONTACT", "OPPORTUNITY", "CONTRACT", "APPOINTMENT", "TASK", "QUOTE"]),
  resourceId: z.uuid(),
  action: z.enum(["READ", "EDIT", "DELETE", "APPROVE", "RETRY"]).default("READ"),
});

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiUser();
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_PERMISSION_EXPLANATION", 400);
  const explanation = await supabaseJson<Record<string, unknown>>("/rest/v1/rpc/explain_record_access", {
    method: "POST",
    body: JSON.stringify({
      resource_type: parsed.data.resourceType,
      resource_id: parsed.data.resourceId,
      requested_action: parsed.data.action,
    }),
  });
  return NextResponse.json({ explanation });
}

export const POST = apiRoute(post, "PERMISSION_EXPLANATION_FAILED");
