import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, parsePagination, requireApiCapability } from "@/lib/api";
import { listQualityIssues,qualityOperation } from "@/lib/phase2-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { SupabaseRequestError } from "@/lib/supabase-server";
const schema=z.discriminatedUnion("operation",[z.object({operation:z.literal("run")}),z.object({operation:z.literal("resolve"),id:z.uuid(),resolution:z.string().trim().min(2).max(500),dismiss:z.boolean().default(false)})]);
async function get(request:Request){await requireApiCapability("dataQuality.manage");const url=new URL(request.url);const{page,pageSize}=parsePagination(url.searchParams,10);try{return NextResponse.json(await listQualityIssues({query:url.searchParams.get("q")??"",page,pageSize,status:url.searchParams.get("status")??"all"}));}catch{return NextResponse.json({code:"QUALITY_LOAD_FAILED"},{status:500});}}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireApiCapability("dataQuality.manage");const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_QUALITY_INPUT"},{status:400});try{return NextResponse.json({item:await qualityOperation(parsed.data)});}catch(error){if(error instanceof SupabaseRequestError&&`${error.code} ${error.message}`.toLowerCase().includes("quality_source_not_fixed"))return NextResponse.json({code:"QUALITY_SOURCE_NOT_FIXED"},{status:409});return NextResponse.json({code:"QUALITY_OPERATION_FAILED"},{status:500});}}
export const GET=apiRoute(get,"QUALITY_LOAD_FAILED");
export const POST=apiRoute(post,"QUALITY_OPERATION_FAILED");
