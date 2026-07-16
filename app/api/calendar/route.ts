import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createAppointment, listAppointments } from "@/lib/calendar-repository";

const schema = z.object({ title: z.string().trim().min(1).max(160), locale: z.enum(["zh-CN", "en"]), date: z.iso.date(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), type: z.enum(["meeting", "consultation", "followup", "deadline"]), channel: z.string().trim().max(80), related: z.string().trim().max(160), reminder: z.number().int().min(0).max(43200) });
export async function GET(request: Request) { await requireUser(); const url = new URL(request.url); const from = url.searchParams.get("from") ?? new Date().toISOString(); const to = url.searchParams.get("to") ?? new Date(Date.now() + 120 * 86400000).toISOString(); try { return NextResponse.json({ items: await listAppointments(from, to) }); } catch { return NextResponse.json({ code: "CALENDAR_LOAD_FAILED" }, { status: 500 }); } }
export async function POST(request: Request) { await requireUser(); const parsed = schema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return NextResponse.json({ code: "INVALID_APPOINTMENT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 }); try { return NextResponse.json({ item: await createAppointment(parsed.data) }, { status: 201 }); } catch { return NextResponse.json({ code: "CALENDAR_SAVE_FAILED" }, { status: 500 }); } }
