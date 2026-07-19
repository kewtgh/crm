import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, requireApiUser } from "@/lib/api";
import { aal2Capabilities, CAPABILITIES, hasCapability, rolesForCapability } from "@/lib/capabilities";
import { mutationIsTrusted } from "@/lib/request-security";
import { supabaseJson } from "@/lib/supabase-server";

const schema = z.object({
  resourceType: z.enum(["ORGANIZATION", "CONTACT", "OPPORTUNITY", "CONTRACT", "APPOINTMENT", "TASK", "QUOTE"]),
  resourceId: z.uuid(),
  action: z.enum(["READ", "EDIT", "DELETE", "APPROVE", "RETRY"]).default("READ"),
});
const capabilitySchema = z.enum(CAPABILITIES);

async function get(request: Request) {
  const user = await requireApiUser();
  const parsed = capabilitySchema.safeParse(new URL(request.url).searchParams.get("capability"));
  if (!parsed.success) throw new ApiError("INVALID_CAPABILITY", 400);
  return NextResponse.json({
    capability: parsed.data,
    allowed: hasCapability(user.role, parsed.data),
    requiresMfa: aal2Capabilities.has(parsed.data),
    eligibleRoles: rolesForCapability(parsed.data),
    messageKey: hasCapability(user.role, parsed.data) ? "permission.allowed" : "permission.denied",
  });
}

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
export const GET = apiRoute(get, "PERMISSION_EXPLANATION_FAILED");
