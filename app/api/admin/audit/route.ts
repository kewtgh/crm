import { NextResponse } from "next/server";
import { AuthSecurityError, requireAal2, requireRole } from "@/lib/auth";
import { listAdminAudits } from "@/lib/admin-dashboard-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

export async function GET(request:Request){
  try{await requireRole("SUPER_ADMIN","ADMIN");await requireAal2();const params=new URL(request.url).searchParams;return NextResponse.json(await listAdminAudits({query:params.get("q")??"",page:Number(params.get("page")??1),pageSize:Number(params.get("pageSize")??20)}));}
  catch(error){if(error instanceof AuthSecurityError)return NextResponse.json({code:error.code},{status:error.status});return error instanceof SupabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"AUDIT_LOAD_FAILED"},{status:500});}
}
