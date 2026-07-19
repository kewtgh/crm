import { NextResponse } from "next/server";
import { z } from "zod";
import { checkCrmDuplicate, createCrmRecord, listCrmRows, type PersistentResource } from "@/lib/crm-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";
import { apiRoute, parsePagination, requireApiUser } from "@/lib/api";

const resources = new Set<PersistentResource>(["schools", "people", "tasks"]);
const baseRecordSchema = z.object({
  operation: z.enum(["check", "create"]).default("create"),
  nameZh: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(160),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  contact: z.string().trim().max(200).optional(),
});
const resourceSchemas={
  schools:baseRecordSchema.extend({
    city:z.string().trim().min(1).max(80),
    curriculum:z.string().trim().min(1).max(120),
  }),
  people:baseRecordSchema.extend({
    title:z.string().trim().min(1).max(120),
    organizationId:z.string().uuid(),
  }).refine(value=>Boolean(value.email||value.phone),{path:["email"],message:"CONTACT_METHOD_REQUIRED"}),
  tasks:baseRecordSchema.extend({
    dueAt:z.string().datetime(),
    priority:z.enum(["LOW","NORMAL","HIGH","URGENT"]),
    ownerId:z.string().uuid().optional(),
    relatedType:z.enum(["ORGANIZATION","CONTACT"]),
    relatedId:z.string().uuid(),
    contact:z.string().trim().min(1).max(200),
  }),
} satisfies Record<PersistentResource,z.ZodType>;

function resolveResource(value: string) { return resources.has(value as PersistentResource) ? value as PersistentResource : null; }
function failure(error: unknown) {
  if (error instanceof SupabaseRequestError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  return NextResponse.json({ code: "CRM_OPERATION_FAILED" }, { status: 500 });
}

async function get(request: Request, context: { params: Promise<{ resource: string }> }) {
  await requireApiUser();
  const resource = resolveResource((await context.params).resource);
  if (!resource) return NextResponse.json({ code: "UNKNOWN_RESOURCE" }, { status: 404 });
  const url = new URL(request.url);
  try {
    const {page,pageSize}=parsePagination(url.searchParams,20);
    if (url.searchParams.get("format") === "csv") return NextResponse.json({code:"EXPORT_APPROVAL_REQUIRED"},{status:403});
    const result = await listCrmRows(resource, { query: url.searchParams.get("q") ?? "", page, pageSize, status: url.searchParams.get("status") ?? "all", sort: url.searchParams.get("sort") ?? "primary", direction: url.searchParams.get("direction") ?? "asc" });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}

async function post(request: Request, context: { params: Promise<{ resource: string }> }) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const resource = resolveResource((await context.params).resource);
  if (!resource) return NextResponse.json({ code: "UNKNOWN_RESOURCE" }, { status: 404 });
  const parsed = resourceSchemas[resource].safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 });
  const user=await requireApiUser();
  try {
    const duplicates = await checkCrmDuplicate(resource, parsed.data);
    if (parsed.data.operation === "check") return NextResponse.json({ duplicates });
    if (duplicates.length) return NextResponse.json({ code: "DUPLICATE_FOUND", duplicates }, { status: 409 });
    const item = await createCrmRecord(resource, parsed.data,user.id);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) { return failure(error); }
}
export const GET=apiRoute(get,"CRM_LOAD_FAILED");
export const POST=apiRoute(post,"CRM_OPERATION_FAILED");
