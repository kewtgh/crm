import { NextResponse } from "next/server";
import { z } from "zod";
import { decideApproval } from "@/lib/governance-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";
import { apiRoute, parseUuid, requireApiAal2, requireApiRole } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
const schema=z.object({decision:z.enum(["APPROVED","REJECTED"]),comment:z.string().trim().max(1000).optional()}).refine((value)=>value.decision!=="REJECTED"||Boolean(value.comment),{path:["comment"],message:"REJECTION_REASON_REQUIRED"});
async function post(request:Request,context:{params:Promise<{id:string}>}){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:parsed.error.issues[0]?.message??"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});await requireApiRole("SUPER_ADMIN","ADMIN");await requireApiAal2();const id=parseUuid((await context.params).id);try{return NextResponse.json({item:await decideApproval(id,parsed.data.decision,parsed.data.comment)});}catch(error){return error instanceof SupabaseRequestError?NextResponse.json({code:error.code,message:error.message},{status:error.status}):NextResponse.json({code:"APPROVAL_DECISION_FAILED"},{status:500});}}
export const POST=apiRoute(post,"APPROVAL_DECISION_FAILED");
