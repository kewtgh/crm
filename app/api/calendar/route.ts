import {appointmentCreateSchema} from "@/lib/calendar-actions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiCapability } from "@/lib/api";
import { createAppointment, listAppointments } from "@/lib/calendar-repository";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { mutationIsTrusted } from "@/lib/request-security";
import { loadUserSettings } from "@/lib/settings-repository";
import { InvalidLocalTimeError } from "@/lib/timezone";

const rangeSchema=z.object({from:z.iso.datetime({offset:true}),to:z.iso.datetime({offset:true})}).refine(value=>Date.parse(value.from)<Date.parse(value.to)&&Date.parse(value.to)-Date.parse(value.from)<=370*86400000,{message:"INVALID_CALENDAR_RANGE"});
async function get(request: Request) { const user=await requireApiCapability("calendar.view"); const url = new URL(request.url); const parsed=rangeSchema.safeParse({from:url.searchParams.get("from")??new Date().toISOString(),to:url.searchParams.get("to")??new Date(Date.now()+120*86400000).toISOString()});if(!parsed.success)return NextResponse.json({code:"INVALID_CALENDAR_RANGE"},{status:400});try { const settings=await loadUserSettings(user);return NextResponse.json(await listAppointments(parsed.data.from, parsed.data.to,settings.timezone)); } catch { return NextResponse.json({ code: "CALENDAR_LOAD_FAILED" }, { status: 500 }); } }
async function post(request: Request) { if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403}); const user=await requireApiCapability("calendar.manage"); const parsed = appointmentCreateSchema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return NextResponse.json({ code: "INVALID_APPOINTMENT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 }); try { const settings=await loadUserSettings(user);return NextResponse.json({ item: await createAppointment(parsed.data,settings.timezone) }, { status: 201 }); } catch(error) { if(error instanceof InvalidLocalTimeError)return NextResponse.json({code:error.code},{status:400});if(error instanceof DatabaseRequestError)return NextResponse.json({code:error.code},{status:error.code==="APPOINTMENT_IDEMPOTENCY_CONFLICT"?409:error.status});return NextResponse.json({code:"CALENDAR_SAVE_FAILED"},{status:500}); } }
export const GET=apiRoute(get,"CALENDAR_LOAD_FAILED");
export const POST=apiRoute(post,"CALENDAR_SAVE_FAILED");
