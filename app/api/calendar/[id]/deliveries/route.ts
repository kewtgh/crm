import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { listCalendarDeliveries } from "@/lib/phase2-repository";
async function get(_:Request,context:{params:Promise<{id:string}>}){await requireApiUser();const{id}=await context.params;try{return NextResponse.json({items:await listCalendarDeliveries(id)});}catch{return NextResponse.json({code:"DELIVERY_LOAD_FAILED"},{status:500});}}
export const GET=apiRoute(get,"DELIVERY_LOAD_FAILED");
