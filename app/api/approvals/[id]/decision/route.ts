import { NextResponse } from "next/server";
import { z } from "zod";
import { decideApproval } from "@/lib/governance-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";
import { AuthSecurityError, requireAal2, requireRole } from "@/lib/auth";
import { mutationIsTrusted } from "@/lib/request-security";
const schema=z.object({decision:z.enum(["APPROVED","REJECTED"]),comment:z.string().trim().max(1000).optional()}).refine((value)=>value.decision!=="REJECTED"||Boolean(value.comment),{path:["comment"],message:"REJECTION_REASON_REQUIRED"});
export async function POST(request:Request,context:{params:Promise<{id:string}>}){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:parsed.error.issues[0]?.message??"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});try{await requireRole("SUPER_ADMIN","ADMIN");await requireAal2();return NextResponse.json({item:await decideApproval((await context.params).id,parsed.data.decision,parsed.data.comment)});}catch(error){if(error instanceof AuthSecurityError)return NextResponse.json({code:error.code},{status:error.status});return error instanceof SupabaseRequestError?NextResponse.json({code:error.code,message:error.message},{status:error.status}):NextResponse.json({code:"APPROVAL_DECISION_FAILED"},{status:500});}}
