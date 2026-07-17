import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { mutationIsTrusted } from "@/lib/request-security";
import { createOpportunity, listOpportunities } from "@/lib/sales-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

const schema=z.object({organizationId:z.string().uuid(),productId:z.string().uuid().nullable().optional(),titleZh:z.string().trim().min(1).max(160),titleEn:z.string().trim().min(1).max(180),stage:z.enum(["DISCOVERY","EVALUATION","HESITATION","PAYMENT"]),amount:z.number().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/),probability:z.number().int().min(0).max(100),expectedCloseDate:z.string().date().nullable().optional(),nextActionZh:z.string().trim().max(300).default(""),nextActionEn:z.string().trim().max(300).default("")});
const fail=(error:unknown)=>NextResponse.json({code:error instanceof SupabaseRequestError?error.code:"OPPORTUNITY_OPERATION_FAILED"},{status:error instanceof SupabaseRequestError?error.status:500});
export async function GET(request:Request){await requireUser();const url=new URL(request.url);try{return NextResponse.json(await listOpportunities({page:Number(url.searchParams.get("page")??1),pageSize:Number(url.searchParams.get("pageSize")??50),query:url.searchParams.get("query")??"",stage:url.searchParams.get("stage")??"all"}));}catch(error){return fail(error);}}
export async function POST(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});try{await requireUser();return NextResponse.json({item:await createOpportunity(parsed.data)});}catch(error){return fail(error);}}
