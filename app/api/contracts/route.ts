import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listContracts } from "@/lib/contract-repository";
export async function GET(request:Request){await requireUser();const url=new URL(request.url);try{return NextResponse.json(await listContracts({page:Number(url.searchParams.get("page")??1),pageSize:Number(url.searchParams.get("pageSize")??5),query:url.searchParams.get("query")??"",status:url.searchParams.get("status")??"all"}));}catch{return NextResponse.json({code:"CONTRACTS_LOAD_FAILED"},{status:500});}}
