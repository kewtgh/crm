import { NextResponse } from "next/server";
import { apiRoute, parseUuid, requireApiCapability } from "@/lib/api";
import { transitionOpportunitySchema } from "@/lib/opportunity-schema";
import { mutationIsTrusted } from "@/lib/request-security";
import { updateOpportunity } from "@/lib/sales-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

async function patch(request:Request,context:{params:Promise<{id:string}>}){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const id=parseUuid((await context.params).id);const parsed=transitionOpportunitySchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:parsed.error.issues[0]?.message??"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});await requireApiCapability("opportunities.manage");try{return NextResponse.json({item:await updateOpportunity(id,parsed.data)});}catch(error){return NextResponse.json({code:error instanceof SupabaseRequestError?error.code:"OPPORTUNITY_OPERATION_FAILED"},{status:error instanceof SupabaseRequestError?error.status:500});}}
export const PATCH=apiRoute(patch,"OPPORTUNITY_OPERATION_FAILED");
