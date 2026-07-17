import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, parsePagination, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { createOpportunity, listOpportunities } from "@/lib/sales-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

const schema=z.object({organizationId:z.string().uuid(),productId:z.string().uuid().nullable().optional(),titleZh:z.string().trim().min(1).max(160),titleEn:z.string().trim().min(1).max(180),stage:z.enum(["DISCOVERY","EVALUATION","HESITATION","PAYMENT"]),amount:z.number().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/),probability:z.number().int().min(0).max(100),expectedCloseDate:z.string().date(),nextActionZh:z.string().trim().min(1).max(300),nextActionEn:z.string().trim().min(1).max(300)});
const fail=(error:unknown)=>NextResponse.json({code:error instanceof SupabaseRequestError?error.code:"OPPORTUNITY_OPERATION_FAILED"},{status:error instanceof SupabaseRequestError?error.status:500});
async function get(request:Request){await requireApiUser();const url=new URL(request.url);const{page,pageSize}=parsePagination(url.searchParams,50);try{return NextResponse.json(await listOpportunities({page,pageSize,query:url.searchParams.get("query")??"",stage:url.searchParams.get("stage")??"all"}));}catch(error){return fail(error);}}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});await requireApiUser();try{return NextResponse.json({item:await createOpportunity(parsed.data)});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"OPPORTUNITY_LOAD_FAILED");
export const POST=apiRoute(post,"OPPORTUNITY_OPERATION_FAILED");
