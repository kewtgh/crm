import { NextResponse } from "next/server";
import { z } from "zod";
import { savePerformanceWorkspace,submitPerformanceWorkspace } from "@/lib/governance-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";
import { AuthSecurityError, requireAal2, requireRole } from "@/lib/auth";
import { mutationIsTrusted } from "@/lib/request-security";
const allocation=z.object({memberId:z.string().uuid(),amount:z.number().positive(),rule:z.enum(["direct","assisted"])});
const saveSchema=z.object({operation:z.literal("save"),targetId:z.string().uuid().nullable(),managerId:z.string().uuid(),target:z.number().positive(),periodStart:z.string().date(),periodEnd:z.string().date(),currency:z.string().regex(/^[A-Z]{3}$/),allocations:z.array(allocation).max(100)});
const submitSchema=z.object({operation:z.literal("submit"),targetId:z.string().uuid(),reason:z.string().trim().min(3).max(1000)});
const schema=z.discriminatedUnion("operation",[saveSchema,submitSchema]);
export async function POST(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});try{await requireRole("SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER");await requireAal2();const item=parsed.data.operation==="save"?await savePerformanceWorkspace(parsed.data):await submitPerformanceWorkspace(parsed.data.targetId,parsed.data.reason);return NextResponse.json({item});}catch(error){if(error instanceof AuthSecurityError)return NextResponse.json({code:error.code},{status:error.status});return error instanceof SupabaseRequestError?NextResponse.json({code:error.code,message:error.message},{status:error.status}):NextResponse.json({code:"PERFORMANCE_SAVE_FAILED"},{status:500});}}
