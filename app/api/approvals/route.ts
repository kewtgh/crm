import { NextResponse } from "next/server";
import { z } from "zod";
import { createApproval,listApprovals } from "@/lib/governance-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";
import { apiRoute, parsePagination, requireApiUser } from "@/lib/api";

const schema=z.object({type:z.enum(["CONTRACT_SIGN","CONTRACT_EXPORT","PERFORMANCE_SUMMARY","PERFORMANCE_ALLOCATION"]),objectType:z.string().min(1).max(80),objectId:z.string().min(1).max(160),reason:z.string().trim().min(3).max(1000)});
const fail=(error:unknown)=>error instanceof SupabaseRequestError?NextResponse.json({code:error.code,message:error.message},{status:error.status}):NextResponse.json({code:"APPROVAL_FAILED"},{status:500});
async function get(request:Request){await requireApiUser();const params=new URL(request.url).searchParams;const{page,pageSize}=parsePagination(params,10);try{return NextResponse.json(await listApprovals({query:params.get("q")??"",type:params.get("type")??"all",status:params.get("status")??"pending",page,pageSize}));}catch(error){return fail(error);}}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireApiUser();const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});try{return NextResponse.json({item:await createApproval(parsed.data)},{status:201});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"APPROVAL_LOAD_FAILED");
export const POST=apiRoute(post,"APPROVAL_FAILED");
