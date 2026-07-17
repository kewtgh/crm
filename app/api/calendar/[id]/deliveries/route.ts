import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listCalendarDeliveries } from "@/lib/phase2-repository";
export async function GET(_:Request,context:{params:Promise<{id:string}>}){await requireUser();const{id}=await context.params;try{return NextResponse.json({items:await listCalendarDeliveries(id)});}catch{return NextResponse.json({code:"DELIVERY_LOAD_FAILED"},{status:500});}}
