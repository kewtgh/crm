import { NextResponse } from "next/server";
import { apiRoute, parsePagination, requireApiCapability } from "@/lib/api";
import { createOpportunitySchema } from "@/lib/opportunity-schema";
import { mutationIsTrusted } from "@/lib/request-security";
import { createOpportunity, listOpportunities, loadSalesPerformance } from "@/lib/sales-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

const fail=(error:unknown)=>NextResponse.json({code:error instanceof SupabaseRequestError?error.code:"OPPORTUNITY_OPERATION_FAILED"},{status:error instanceof SupabaseRequestError?error.status:500});
async function get(request:Request){await requireApiCapability("opportunities.view");const url=new URL(request.url);const{page,pageSize}=parsePagination(url.searchParams,20);const requestedCurrency=(url.searchParams.get("currency")??"").toUpperCase();const currency=/^[A-Z]{3}$/.test(requestedCurrency)?requestedCurrency:null;try{const performance=await loadSalesPerformance("quarter","all",currency);const opportunities=await listOpportunities({page,pageSize,query:url.searchParams.get("query")??"",stage:url.searchParams.get("stage")??"all",currency:performance.currency});return NextResponse.json({...opportunities,funnel:performance.funnel,currency:performance.currency,currencies:performance.currencies});}catch(error){return fail(error);}}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=createOpportunitySchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});await requireApiCapability("opportunities.manage");try{return NextResponse.json({item:await createOpportunity(parsed.data)});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"OPPORTUNITY_LOAD_FAILED");
export const POST=apiRoute(post,"OPPORTUNITY_OPERATION_FAILED");
