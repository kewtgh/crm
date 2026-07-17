import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { loadOrganization360 } from "@/lib/phase2-repository";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){await requireUser();const{id}=await context.params;const url=new URL(request.url);const page=Math.max(1,Number(url.searchParams.get("page")??1));const types=(url.searchParams.get("types")??"").split(",").filter(Boolean);try{return NextResponse.json(await loadOrganization360(id,page,20,types));}catch{return NextResponse.json({code:"TIMELINE_LOAD_FAILED"},{status:500});}}
