import {getDomainReportFilter} from "@/lib/domain-report-filter";
import {leadUpdateSchema,poolFilterSchema} from "@/lib/lead-pool-input";
import {listLeadPool,getPoolLead} from "@/lib/lead-assignment-repository";
import {databaseJson} from "@/lib/db/gateway";
import { bilingualSchema } from "@/lib/bilingual-names";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parsePagination, parseUuid, requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { convertLead, createLead } from "@/lib/v200-repository";

const createSchema = z.object({
  operation: z.literal("create"), type: z.enum(["SCHOOL", "HOUSEHOLD"]),
  organizationId: z.uuid().nullable().optional(), householdId: z.uuid().nullable().optional(),
  nameZh: z.string().trim().max(120).default(""), nameEn: z.string().trim().max(160).default(""),
  source: z.string().trim().min(1).max(80), score: z.number().int().min(0).max(100),
  note: z.string().trim().max(1000).default(""),status:z.enum(["NEW","QUALIFYING","QUALIFIED","DISQUALIFIED"]).optional(),poolVisibility:z.enum(["PRIVATE","WORKSPACE_PUBLIC"]).optional(),requestKey:z.string().min(8).max(120).optional(),id:z.uuid().optional(),
}).refine((value) => value.type === "SCHOOL" ? Boolean(value.organizationId) : Boolean(value.householdId), { path: ["type"] });
const convertSchema = z.object({
  operation: z.literal("convert"), id: z.uuid(), titleZh: z.string().trim().max(160).default(""),
  titleEn: z.string().trim().max(180).default(""), amount: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),productId:z.uuid().nullable().optional(),cohortId:z.uuid().nullable().optional(),ownerId:z.uuid().nullable().optional(), requestKey: z.string().trim().min(8).max(160),
});
const schema = z.discriminatedUnion("operation", [createSchema, convertSchema,leadUpdateSchema]);

const legacyFields=(row:Record<string,unknown>)=>({...row,type:row.subject_type,nameZh:row.name_zh??row.subject_name_zh,nameEn:row.name_en??row.subject_name_en,score:row.qualification_score,pipeline:row.pipeline_key,updatedAt:row.updated_at});

async function get(request: Request) {
  await requireApiCapability("leads.view");
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const item = await getPoolLead(parseUuid(id));
    if (!item) throw new ApiError("LEAD_NOT_FOUND", 404);
    return NextResponse.json({ item:legacyFields(item) });
  }
  const parsed=poolFilterSchema.safeParse(Object.fromEntries([...url.searchParams].filter(([,v])=>v!=="")));if(!parsed.success)throw new ApiError("LEAD_FILTER_INVALID",400);
  const result=await listLeadPool({...parsed.data,...parsePagination(url.searchParams,20),query:url.searchParams.get("q")??"",status:url.searchParams.get("status")??"all",reportFilter:getDomainReportFilter(Object.fromEntries(url.searchParams),"/leads")});return NextResponse.json({...result,items:result.items.map(legacyFields)});
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiCapability("leads.manage");
  const parsed = bilingualSchema(schema).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_LEAD_INPUT", 400, "INVALID_LEAD_INPUT", { field: String(parsed.error.issues[0]?.path[0] ?? "form") });
  const input=parsed.data;
  const item=input.operation==="create"?await createLead(input):input.operation==="convert"?await convertLead(input):await databaseJson("/db/rpc/save_lead",{method:"POST",body:JSON.stringify({record_id:input.id,expected_revision:input.expectedRevision,p_request_key:input.requestKey,data:{status:input.status,next_action:input.nextAction,qualification_score:input.score,qualification_note:input.note}})});
  return NextResponse.json({ item }, { status: parsed.data.operation === "create" ? 201 : 200 });
}

export const GET = apiRoute(get, "LEAD_LOAD_FAILED");
export const POST = apiRoute(post, "LEAD_OPERATION_FAILED");
