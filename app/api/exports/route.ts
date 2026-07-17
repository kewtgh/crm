import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listGeneratedJobs } from "@/lib/generated-jobs-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

export async function GET(request:Request){try{if(!await getCurrentUser())return NextResponse.json({code:"UNAUTHORIZED"},{status:401});const params=new URL(request.url).searchParams;return NextResponse.json(await listGeneratedJobs({query:params.get("q")??"",status:params.get("status")??"all",page:Number(params.get("page")??1),pageSize:Number(params.get("pageSize")??10)}));}catch(error){return error instanceof SupabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"EXPORTS_LOAD_FAILED"},{status:500});}}
