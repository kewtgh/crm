import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { mutationIsTrusted } from "@/lib/request-security";
import { updateOpportunity } from "@/lib/sales-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

const schema=z.object({stage:z.enum(["DISCOVERY","EVALUATION","HESITATION","PAYMENT","WON","LOST"]).optional(),probability:z.number().int().min(0).max(100).optional(),expectedCloseDate:z.string().date().nullable().optional(),nextActionZh:z.string().trim().max(300).optional(),nextActionEn:z.string().trim().max(300).optional()}).refine(value=>Object.keys(value).length>0);
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const {id}=await context.params;if(!z.string().uuid().safeParse(id).success)return NextResponse.json({code:"INVALID_ID"},{status:400});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT"},{status:400});try{await requireUser();return NextResponse.json({item:await updateOpportunity(id,parsed.data)});}catch(error){return NextResponse.json({code:error instanceof SupabaseRequestError?error.code:"OPPORTUNITY_OPERATION_FAILED"},{status:error instanceof SupabaseRequestError?error.status:500});}}
