import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { completeAppointment } from "@/lib/calendar-repository";
export async function PATCH(_: Request, context: { params: Promise<{ id: string }> }) { await requireUser(); const { id } = await context.params; try { await completeAppointment(id); return NextResponse.json({ ok: true }); } catch { return NextResponse.json({ code: "CALENDAR_COMPLETE_FAILED" }, { status: 500 }); } }
