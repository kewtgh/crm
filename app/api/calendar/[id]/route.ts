import { NextResponse } from "next/server";
import { apiRoute, parseUuid, requireApiCapability } from "@/lib/api";
import { changeAppointmentDelivery,completeAppointment } from "@/lib/calendar-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { loadUserSettings } from "@/lib/settings-repository";
import { z } from "zod";
const schema=z.union([z.object({action:z.literal("COMPLETE")}),z.object({action:z.literal("CANCEL")}),z.object({action:z.literal("UPDATE"),date:z.string().date(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)})]);
async function patch(request: Request, context: { params: Promise<{ id: string }> }) { if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403}); const user=await requireApiCapability("calendar.manage"); const id=parseUuid((await context.params).id);const body=await request.json().catch(()=>({action:"COMPLETE"}));const parsed=schema.safeParse(body);if(!parsed.success)return NextResponse.json({code:"INVALID_CALENDAR_ACTION"},{status:400}); try {if(parsed.data.action==="COMPLETE")await completeAppointment(id);else{const settings=await loadUserSettings(user);await changeAppointmentDelivery(id,parsed.data.action,parsed.data.action==="UPDATE"?parsed.data.date:undefined,parsed.data.action==="UPDATE"?parsed.data.time:undefined,settings.timezone);} return NextResponse.json({ ok: true }); } catch { return NextResponse.json({ code: "CALENDAR_UPDATE_FAILED" }, { status: 500 }); } }
export const PATCH=apiRoute(patch,"CALENDAR_UPDATE_FAILED");
