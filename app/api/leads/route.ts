import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parsePagination, requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { convertLead, createLead, listLeads } from "@/lib/v200-repository";

const createSchema = z.object({
  operation: z.literal("create"), type: z.enum(["SCHOOL", "HOUSEHOLD"]),
  organizationId: z.uuid().nullable().optional(), householdId: z.uuid().nullable().optional(),
  nameZh: z.string().trim().min(1).max(120), nameEn: z.string().trim().min(1).max(160),
  source: z.string().trim().min(1).max(80), score: z.number().int().min(0).max(100),
  note: z.string().trim().max(1000).default(""),
}).refine((value) => value.type === "SCHOOL" ? Boolean(value.organizationId) : Boolean(value.householdId), { path: ["type"] });
const convertSchema = z.object({
  operation: z.literal("convert"), id: z.uuid(), titleZh: z.string().trim().min(1).max(160),
  titleEn: z.string().trim().min(1).max(180), amount: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/), requestKey: z.string().trim().min(8).max(160),
});
const schema = z.discriminatedUnion("operation", [createSchema, convertSchema]);

async function get(request: Request) {
  await requireApiCapability("leads.view");
  const url = new URL(request.url);
  return NextResponse.json(await listLeads({
    ...parsePagination(url.searchParams, 20),
    query: url.searchParams.get("q") ?? "",
    status: url.searchParams.get("status") ?? "all",
  }));
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiCapability("leads.manage");
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_LEAD_INPUT", 400, "INVALID_LEAD_INPUT", { field: String(parsed.error.issues[0]?.path[0] ?? "form") });
  const item = parsed.data.operation === "create" ? await createLead(parsed.data) : await convertLead(parsed.data);
  return NextResponse.json({ item }, { status: parsed.data.operation === "create" ? 201 : 200 });
}

export const GET = apiRoute(get, "LEAD_LOAD_FAILED");
export const POST = apiRoute(post, "LEAD_OPERATION_FAILED");
