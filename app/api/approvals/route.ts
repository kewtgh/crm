import { NextResponse } from "next/server";
import { z } from "zod";
import { createApproval,listApprovals } from "@/lib/governance-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

const schema=z.object({type:z.enum(["CONTRACT_SIGN","CONTRACT_EXPORT","PERFORMANCE_SUMMARY","PERFORMANCE_ALLOCATION"]),objectType:z.string().min(1).max(80),objectId:z.string().min(1).max(160),reason:z.string().trim().min(3).max(1000)});
const fail=(error:unknown)=>error instanceof SupabaseRequestError?NextResponse.json({code:error.code,message:error.message},{status:error.status}):NextResponse.json({code:"APPROVAL_FAILED"},{status:500});
export async function GET(){try{return NextResponse.json({items:await listApprovals()});}catch(error){return fail(error);}}
export async function POST(request:Request){const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});try{return NextResponse.json({item:await createApproval(parsed.data)},{status:201});}catch(error){return fail(error);}}
