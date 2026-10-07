import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parsePagination, requireApiCapability, requireApiAal2 } from "@/lib/api";
import { databaseJson, DatabaseRequestError } from "@/lib/db/gateway";
import { deletionResources } from "@/lib/record-deletion-contract";
import { mutationIsTrusted } from "@/lib/request-security";

const kindSchema = z.enum(deletionResources.map(item => item.kind));
async function authority(kind: string) {
  const resource = deletionResources.find(item => item.kind === kind);
  if (!resource) throw new ApiError("DELETION_RESOURCE_INVALID", 400);
  await requireApiCapability(resource.capability);
}
export const GET = apiRoute(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const kind = kindSchema.safeParse(params.get("kind"));
  if (!kind.success) throw new ApiError("DELETION_RESOURCE_INVALID", 400);
  await authority(kind.data);
  const page = parsePagination(params, 20);
  const result = await databaseJson("/db/rpc/list_deletable_business_records", { method: "POST", body: JSON.stringify({kind:kind.data,search_query:(params.get("q")??"").slice(0,100),page_number:page.page,page_size:page.pageSize}) });
  return NextResponse.json(result, {headers:{"cache-control":"no-store"}});
}, "DELETION_LOAD_FAILED");

const input = z.object({kind:kindSchema,id:z.uuid(),expectedRevision:z.number().int().positive().nullable(),expectedUpdatedAt:z.iso.datetime({offset:true}).nullable(),requestKey:z.string().min(8).max(120)}).strict();
export const POST = apiRoute(async (request: Request) => {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = input.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) throw new ApiError("DELETION_INPUT_INVALID", 400);
  await authority(parsed.data.kind);
  await requireApiAal2();
  const value = parsed.data;
  try {
    await databaseJson("/db/rpc/archive_business_record", {method:"POST",body:JSON.stringify({kind:value.kind,record_id:value.id,expected_revision:value.expectedRevision,expected_updated_at:value.expectedUpdatedAt,p_request_key:value.requestKey})});
    return NextResponse.json({saved:true});
  } catch(error) {
    if(error instanceof DatabaseRequestError) throw new ApiError(error.code,error.code.includes("FORBIDDEN")?403:error.code.includes("CONFLICT")?409:error.code.includes("REFERENCED")?422:error.status);
    throw error;
  }
}, "DELETION_FAILED");
