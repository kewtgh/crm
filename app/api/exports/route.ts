import { NextResponse } from "next/server";
import { listGeneratedJobs } from "@/lib/generated-jobs-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";
import { apiRoute, parsePagination, requireApiUser } from "@/lib/api";

async function get(request:Request){await requireApiUser();try{const params=new URL(request.url).searchParams;const{page,pageSize}=parsePagination(params,10);return NextResponse.json(await listGeneratedJobs({query:params.get("q")??"",status:params.get("status")??"all",page,pageSize}));}catch(error){return error instanceof SupabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"EXPORTS_LOAD_FAILED"},{status:500});}}
export const GET=apiRoute(get,"EXPORTS_LOAD_FAILED");
