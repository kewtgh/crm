import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,ApiError,requireApiCapability,parseUuid} from "@/lib/api";
import {databaseJson,DatabaseRequestError} from "@/lib/db/gateway";
import {mutationIsTrusted} from "@/lib/request-security";

const schema=z.object({expectedUpdatedAt:z.iso.datetime({offset:true}),contractNumber:z.string().trim().min(2).max(80),productId:z.uuid().nullable(),startDate:z.iso.date(),endDate:z.iso.date(),currency:z.string().regex(/^[A-Z]{3}$/),amount:z.string().regex(/^\d{1,12}(\.\d{1,2})?$/)}).strict().refine(v=>v.endDate>=v.startDate);
type Context={params:Promise<{id:string}>};
export const GET=apiRoute(async(_request:Request,context:Context)=>{
 await requireApiCapability("contracts.view");const id=parseUuid((await context.params).id,"id");
 const item=await databaseJson<Record<string,unknown>|null>("/db/rpc/get_contract_draft_detail",{method:"POST",body:JSON.stringify({target_contract:id})});if(!item)throw new ApiError("CONTRACT_NOT_FOUND",404);
 return NextResponse.json({item:Object.fromEntries(["id","contract_number","product_id","start_date","end_date","currency","contract_value","status","updated_at"].map(key=>[key,item[key]]))});
},"CONTRACT_LOAD_FAILED");
export const PATCH=apiRoute(async(request:Request,context:Context)=>{
 if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
 await requireApiCapability("contracts.manage");const id=parseUuid((await context.params).id,"id"),parsed=schema.safeParse(await request.json());
 if(!parsed.success)throw new ApiError("INVALID_INPUT",400);const d=parsed.data;
 try{await databaseJson("/db/rpc/update_buyer_contract_draft",{method:"POST",body:JSON.stringify({target_contract:id,expected_updated_at:d.expectedUpdatedAt,contract_no:d.contractNumber,target_product:d.productId,period_start:d.startDate,period_end:d.endDate,contract_currency:d.currency,contract_amount:d.amount})});}catch(error){if(error instanceof DatabaseRequestError){const status=error.code==="CONTRACT_VERSION_CONFLICT"?409:error.code==="CONTRACT_NOT_FOUND"?404:error.code==="CONTRACT_NOT_AUTHORIZED"?403:error.code.startsWith("CONTRACT_")?400:error.status;throw new ApiError(error.code,status);}throw error;}
 return NextResponse.json({saved:true});
},"CONTRACT_SAVE_FAILED");
