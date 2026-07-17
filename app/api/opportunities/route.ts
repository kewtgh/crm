import { NextResponse } from "next/server";
import { apiRoute, parsePagination, requireApiUser } from "@/lib/api";
import { createOpportunitySchema } from "@/lib/opportunity-schema";
import { mutationIsTrusted } from "@/lib/request-security";
import { createOpportunity, listOpportunities, loadSalesPerformance } from "@/lib/sales-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

const fail=(error:unknown)=>NextResponse.json({code:error instanceof SupabaseRequestError?error.code:"OPPORTUNITY_OPERATION_FAILED"},{status:error instanceof SupabaseRequestError?error.status:500});
async function get(request:Request){await requireApiUser();const url=new URL(request.url);const{page,pageSize}=parsePagination(url.searchParams,50);try{const [opportunities,performance]=await Promise.all([listOpportunities({page,pageSize,query:url.searchParams.get("query")??"",stage:url.searchParams.get("stage")??"all"}),loadSalesPerformance("quarter","all")]);return NextResponse.json({...opportunities,funnel:performance.funnel});}catch(error){return fail(error);}}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=createOpportunitySchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});await requireApiUser();try{return NextResponse.json({item:await createOpportunity(parsed.data)});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"OPPORTUNITY_LOAD_FAILED");
export const POST=apiRoute(post,"OPPORTUNITY_OPERATION_FAILED");
