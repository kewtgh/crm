import { NextResponse } from "next/server";
import { z } from "zod";
import { checkCrmDuplicate, createCrmRecord, listCrmRows, type PersistentResource } from "@/lib/crm-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";
import { requireUser } from "@/lib/auth";

const resources = new Set<PersistentResource>(["schools", "people", "tasks"]);
const recordSchema = z.object({
  operation: z.enum(["check", "create"]).default("create"),
  nameZh: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(160),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  contact: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  curriculum: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
  dueAt: z.string().datetime().optional().or(z.literal("")),
});

function resolveResource(value: string) { return resources.has(value as PersistentResource) ? value as PersistentResource : null; }
function failure(error: unknown) {
  if (error instanceof SupabaseRequestError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  return NextResponse.json({ code: "CRM_OPERATION_FAILED" }, { status: 500 });
}

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  await requireUser();
  const resource = resolveResource((await context.params).resource);
  if (!resource) return NextResponse.json({ code: "UNKNOWN_RESOURCE" }, { status: 404 });
  const url = new URL(request.url);
  try {
    const result = await listCrmRows(resource, { query: url.searchParams.get("q") ?? "", page: Number(url.searchParams.get("page") ?? 1), pageSize: Number(url.searchParams.get("pageSize") ?? 20), status: url.searchParams.get("status") ?? "all", sort: url.searchParams.get("sort") ?? "primary", direction: url.searchParams.get("direction") ?? "desc" });
    if (url.searchParams.get("format") === "csv") return NextResponse.json({code:"EXPORT_APPROVAL_REQUIRED"},{status:403});
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const resource = resolveResource((await context.params).resource);
  if (!resource) return NextResponse.json({ code: "UNKNOWN_RESOURCE" }, { status: 404 });
  const parsed = recordSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 });
  try {
    const user=await requireUser();
    const duplicates = await checkCrmDuplicate(resource, parsed.data);
    if (parsed.data.operation === "check") return NextResponse.json({ duplicates });
    if (duplicates.length) return NextResponse.json({ code: "DUPLICATE_FOUND", duplicates }, { status: 409 });
    const item = await createCrmRecord(resource, parsed.data,user.id);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) { return failure(error); }
}
