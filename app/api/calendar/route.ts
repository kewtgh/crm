import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiCapability } from "@/lib/api";
import { createAppointment, listAppointments } from "@/lib/calendar-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { loadUserSettings } from "@/lib/settings-repository";

const schema = z.object({ title: z.string().trim().min(1).max(160), locale: z.enum(["zh-CN", "en"]), date: z.iso.date(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), type: z.enum(["meeting", "consultation", "followup", "deadline"]), channel: z.string().trim().max(80), related: z.string().trim().max(160), relatedType:z.enum(["ORGANIZATION","CONTACT"]).nullable().optional(),relatedId:z.uuid().nullable().optional(), reminder: z.number().int().min(0).max(43200),attendees:z.array(z.object({email:z.email(),name:z.string().trim().max(120).optional(),contactId:z.uuid().nullable().optional(),consentConfirmed:z.literal(true)})).max(50).default([]) });
async function get(request: Request) { const user=await requireApiCapability("calendar.view"); const url = new URL(request.url); const from = url.searchParams.get("from") ?? new Date().toISOString(); const to = url.searchParams.get("to") ?? new Date(Date.now() + 120 * 86400000).toISOString(); try { const settings=await loadUserSettings(user);return NextResponse.json({ items: await listAppointments(from, to,settings.timezone) }); } catch { return NextResponse.json({ code: "CALENDAR_LOAD_FAILED" }, { status: 500 }); } }
async function post(request: Request) { if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403}); const user=await requireApiCapability("calendar.manage"); const parsed = schema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return NextResponse.json({ code: "INVALID_APPOINTMENT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 }); try { const settings=await loadUserSettings(user);return NextResponse.json({ item: await createAppointment(parsed.data,settings.timezone) }, { status: 201 }); } catch { return NextResponse.json({ code: "CALENDAR_SAVE_FAILED" }, { status: 500 }); } }
export const GET=apiRoute(get,"CALENDAR_LOAD_FAILED");
export const POST=apiRoute(post,"CALENDAR_SAVE_FAILED");
