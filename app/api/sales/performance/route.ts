import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { loadSalesPerformance } from "@/lib/sales-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

async function get(request:Request){
  await requireApiUser();const url=new URL(request.url);const value=url.searchParams.get("period");const period=value==="month"||value==="year"?value:"quarter";const team=(url.searchParams.get("team")??"all").slice(0,80);const requestedCurrency=(url.searchParams.get("currency")??"").toUpperCase();const currency=/^[A-Z]{3}$/.test(requestedCurrency)?requestedCurrency:null;
  try{return NextResponse.json({data:await loadSalesPerformance(period,team,currency)});}catch(error){return NextResponse.json({code:error instanceof SupabaseRequestError?error.code:"SALES_REPORT_FAILED"},{status:error instanceof SupabaseRequestError?error.status:500});}
}
export const GET=apiRoute(get,"SALES_REPORT_FAILED");
