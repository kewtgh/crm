import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, requireApiAal2, requireApiRole } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { supabaseJson } from "@/lib/supabase-server";

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("preview"),
    resource: z.enum(["CONTACTS", "ORGANIZATIONS"]),
    targetId: z.uuid(),
    sourceId: z.uuid(),
  }),
  z.object({
    operation: z.literal("merge"),
    resource: z.enum(["CONTACTS", "ORGANIZATIONS"]),
    targetId: z.uuid(),
    sourceId: z.uuid(),
    fieldChoices: z.record(z.string(), z.enum(["TARGET", "SOURCE"])).default({}),
    confirmed: z.literal(true),
  }),
]);

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiRole("SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR", "SALES_MANAGER");
  await requireApiAal2();
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_DUPLICATE_OPERATION", 400);
  const payload = {
    resource: parsed.data.resource,
    target_record: parsed.data.targetId,
    source_record: parsed.data.sourceId,
  };
  if (parsed.data.operation === "preview") {
    const preview = await supabaseJson<Record<string, unknown>>("/rest/v1/rpc/duplicate_merge_preview", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return NextResponse.json({ preview });
  }
  const id = await supabaseJson<string>("/rest/v1/rpc/merge_duplicate_records", {
    method: "POST",
    body: JSON.stringify({ ...payload, field_choices: parsed.data.fieldChoices }),
  });
  return NextResponse.json({ id });
}

export const POST = apiRoute(post, "DUPLICATE_OPERATION_FAILED");
