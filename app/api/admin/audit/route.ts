import { NextResponse } from "next/server";
import { apiRoute, parsePagination, requireApiAal2, requireApiRole } from "@/lib/api";
import { listAdminAudits } from "@/lib/admin-dashboard-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

async function get(request:Request){
  await requireApiRole("SUPER_ADMIN","ADMIN");await requireApiAal2();const params=new URL(request.url).searchParams;const{page,pageSize}=parsePagination(params,20);
  try{return NextResponse.json(await listAdminAudits({query:params.get("q")??"",page,pageSize}));}
  catch(error){return error instanceof SupabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"AUDIT_LOAD_FAILED"},{status:500});}
}
export const GET=apiRoute(get,"AUDIT_LOAD_FAILED");
