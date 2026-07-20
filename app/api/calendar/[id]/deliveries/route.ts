import { NextResponse } from "next/server";
import { apiRoute, parseUuid, requireApiCapability } from "@/lib/api";
import { listCalendarDeliveries } from "@/lib/phase2-repository";
async function get(_:Request,context:{params:Promise<{id:string}>}){await requireApiCapability("calendar.view");const id=parseUuid((await context.params).id);try{return NextResponse.json({items:await listCalendarDeliveries(id)});}catch{return NextResponse.json({code:"DELIVERY_LOAD_FAILED"},{status:500});}}
export const GET=apiRoute(get,"DELIVERY_LOAD_FAILED");
