import { NextResponse } from "next/server";
import { apiRoute, parsePagination, parseUuid, requireApiUser } from "@/lib/api";
import { loadOrganization360 } from "@/lib/phase2-repository";
async function get(request:Request,context:{params:Promise<{id:string}>}){await requireApiUser();const id=parseUuid((await context.params).id);const url=new URL(request.url);const{page,pageSize}=parsePagination(url.searchParams,20);const types=(url.searchParams.get("types")??"").split(",").filter(Boolean);try{return NextResponse.json(await loadOrganization360(id,page,pageSize,types));}catch{return NextResponse.json({code:"TIMELINE_LOAD_FAILED"},{status:500});}}
export const GET=apiRoute(get,"TIMELINE_LOAD_FAILED");
