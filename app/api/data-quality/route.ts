import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { listQualityIssues,qualityOperation } from "@/lib/phase2-repository";
import { mutationIsTrusted } from "@/lib/request-security";
const schema=z.discriminatedUnion("operation",[z.object({operation:z.literal("run")}),z.object({operation:z.literal("resolve"),id:z.uuid(),resolution:z.string().trim().min(2).max(500),dismiss:z.boolean().default(false)})]);
export async function GET(request:Request){await requireRole("SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER");const url=new URL(request.url);try{return NextResponse.json(await listQualityIssues({query:url.searchParams.get("q")??"",page:Number(url.searchParams.get("page")??1),pageSize:15,status:url.searchParams.get("status")??"all"}));}catch{return NextResponse.json({code:"QUALITY_LOAD_FAILED"},{status:500});}}
export async function POST(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireRole("SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER");const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_QUALITY_INPUT"},{status:400});try{return NextResponse.json({item:await qualityOperation(parsed.data)});}catch{return NextResponse.json({code:"QUALITY_OPERATION_FAILED"},{status:500});}}
