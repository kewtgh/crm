import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { loadSalesPerformance } from "@/lib/sales-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

export async function GET(request:Request){
  await requireUser();const url=new URL(request.url);const value=url.searchParams.get("period");const period=value==="month"||value==="year"?value:"quarter";const team=(url.searchParams.get("team")??"all").slice(0,80);
  try{return NextResponse.json({data:await loadSalesPerformance(period,team)});}catch(error){return NextResponse.json({code:error instanceof SupabaseRequestError?error.code:"SALES_REPORT_FAILED"},{status:error instanceof SupabaseRequestError?error.status:500});}
}
