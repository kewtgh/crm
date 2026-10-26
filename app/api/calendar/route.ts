import {completedPeriodSchema} from "@/lib/calendar-history";
import {appointmentCreateSchema} from "@/lib/calendar-actions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiCapability } from "@/lib/api";
import { createAppointment, listAppointments, listCompletedAppointments } from "@/lib/calendar-repository";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { mutationIsTrusted } from "@/lib/request-security";
import { loadUserSettings } from "@/lib/settings-repository";
import { InvalidLocalTimeError } from "@/lib/timezone";

const rangeSchema=z.object({from:z.iso.datetime({offset:true}),to:z.iso.datetime({offset:true})}).refine(value=>Date.parse(value.from)<Date.parse(value.to)&&Date.parse(value.to)-Date.parse(value.from)<=370*86400000,{message:"INVALID_CALENDAR_RANGE"});
async function get(request:Request){
 const user=await requireApiCapability("calendar.view"),params=new URL(request.url).searchParams,period=completedPeriodSchema.safeParse(params.get('period')??'3m');
 if(!period.success||params.has('includeCompleted')&&!['0','1'].includes(params.get('includeCompleted')!))return NextResponse.json({code:'INVALID_CALENDAR_RANGE'},{status:400});
 const parsed=rangeSchema.safeParse({from:params.get('from')??new Date().toISOString(),to:params.get('to')??new Date(Date.now()+120*86400000).toISOString()});if(!parsed.success)return NextResponse.json({code:'INVALID_CALENDAR_RANGE'},{status:400});
 if(params.has('view')&&params.get('view')!=='completed')return NextResponse.json({code:'INVALID_CALENDAR_RANGE'},{status:400});
 const page=z.coerce.number().int().min(1).max(100000).safeParse(params.get('page')??1),size=z.coerce.number().int().min(1).max(50).safeParse(params.get('pageSize')??20);if(!page.success||!size.success)return NextResponse.json({code:'INVALID_CALENDAR_RANGE'},{status:400});
 try{const settings=await loadUserSettings(user);return NextResponse.json(params.get('view')==='completed'?await listCompletedAppointments(period.data,page.data,size.data,settings.timezone,undefined,undefined,user.id):await listAppointments(parsed.data.from,parsed.data.to,settings.timezone,{includeCompleted:params.get('includeCompleted')==='1',period:period.data,viewer:user.id}),{headers:{'cache-control':'private, no-store'}});}
 catch{return NextResponse.json({code:'CALENDAR_LOAD_FAILED'},{status:500});}
}
async function post(request: Request) { if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403}); const user=await requireApiCapability("calendar.manage"); const parsed = appointmentCreateSchema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return NextResponse.json({ code: "INVALID_APPOINTMENT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 }); try { const settings=await loadUserSettings(user);return NextResponse.json({ item: await createAppointment(parsed.data,settings.timezone) }, { status: 201 }); } catch(error) { if(error instanceof InvalidLocalTimeError)return NextResponse.json({code:error.code},{status:400});if(error instanceof DatabaseRequestError)return NextResponse.json({code:error.code},{status:error.code==="APPOINTMENT_IDEMPOTENCY_CONFLICT"?409:error.status});return NextResponse.json({code:"CALENDAR_SAVE_FAILED"},{status:500}); } }
export const GET=apiRoute(get,"CALENDAR_LOAD_FAILED");
export const POST=apiRoute(post,"CALENDAR_SAVE_FAILED");
