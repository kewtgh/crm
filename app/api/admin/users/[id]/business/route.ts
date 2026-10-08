import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,parseUuid,requireApiAal2,requireApiRole} from "@/lib/api";
import {mutationIsTrusted} from "@/lib/request-security";
import {databaseJson} from "@/lib/db/gateway";
import {BUSINESS_FUNCTIONS} from "@/lib/staff-business";
type Context={params:Promise<{id:string}>};
export const POST=apiRoute(async(request:Request,context:Context)=>{
 if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
 await requireApiRole("SUPER_ADMIN","ADMIN");await requireApiAal2();
 const parsed=z.object({requestKey:z.string().min(8).max(160),expectedRevision:z.number().int().positive(),primaryFunction:z.enum(BUSINESS_FUNCTIONS),additionalFunctions:z.array(z.enum(BUSINESS_FUNCTIONS)).max(7),salesEligible:z.boolean(),effectiveFrom:z.iso.date(),reason:z.string().trim().min(3).max(500)}).strict().safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT"},{status:400});
 const p=parsed.data;
 const item=await databaseJson("/db/rpc/staff_profile_command",{method:"POST",body:JSON.stringify({target_user:parseUuid((await context.params).id),expected_revision:p.expectedRevision,primary_function:p.primaryFunction,additional_functions:p.additionalFunctions,sales_eligible:p.salesEligible,effective_from:p.effectiveFrom,reason:p.reason,p_request_key:p.requestKey})});
 return NextResponse.json({item});
},"STAFF_PROFILE_CHANGE_FAILED");
