import { ApiError, apiRoute, parseUuid, requireApiCapability, requireApiAal2 } from "@/lib/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { mutationIsTrusted } from "@/lib/request-security";
import { databaseJson, DatabaseRequestError } from "@/lib/db/gateway";

const input = z.object({ expectedRevision: z.number().int().positive(), requestKey: z.string().min(8).max(120) }).strict();
export const POST = apiRoute(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiCapability("leads.manage");
  await requireApiAal2();
  const id = parseUuid((await context.params).id);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new ApiError("LEAD_INPUT_INVALID", 400);
  try {
    const item = await databaseJson("/db/rpc/archive_lead", { method: "POST", body: JSON.stringify({ target_lead: id, expected_revision: parsed.data.expectedRevision, p_request_key: parsed.data.requestKey }) });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof DatabaseRequestError) throw new ApiError(error.code, error.code.includes("FORBIDDEN") ? 403 : error.code.includes("CONFLICT") ? 409 : error.status);
    throw error;
  }
}, "LEAD_ARCHIVE_FAILED");
