import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, requireApiAal2, requireApiRole } from "@/lib/api";
import {
  configureIntegration,
  listIntegrations,
  requestIntegrationSync,
  validateIntegration,
} from "@/lib/operations-repository";
import { mutationIsTrusted } from "@/lib/request-security";

const provider = z.enum(["MICROSOFT_365", "GOOGLE_CALENDAR", "EMAIL", "E_SIGNATURE", "ACCOUNTING", "PAYMENT"]);
const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("configure"),
    provider,
    status: z.enum(["DISCONNECTED", "CONNECTING", "CONNECTED", "DEGRADED", "ACTION_REQUIRED"]),
    syncDirection: z.enum(["NONE", "IMPORT_ONLY", "EXPORT_ONLY", "BIDIRECTIONAL"]),
    accountLabel: z.string().trim().max(160).default(""),
  }),
  z.object({ operation: z.literal("sync"), provider }),
  z.object({ operation: z.literal("validate"), provider }),
]);

async function get() {
  await requireApiRole("SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR");
  return NextResponse.json({ items: await listIntegrations() });
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_INTEGRATION_OPERATION", 400);
  let validation;
  if (parsed.data.operation === "configure") {
    await configureIntegration(parsed.data);
  } else if(parsed.data.operation === "sync") {
    await requestIntegrationSync(parsed.data.provider);
  } else {
    validation=await validateIntegration(parsed.data.provider,(await requireApiRole("SUPER_ADMIN","ADMIN")).id);
  }
  return NextResponse.json({ items: await listIntegrations(),...(validation?{validation}:{}) });
}

export const GET = apiRoute(get, "INTEGRATIONS_LOAD_FAILED");
export const POST = apiRoute(post, "INTEGRATION_OPERATION_FAILED");
