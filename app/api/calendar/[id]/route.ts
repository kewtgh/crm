import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { completeAppointment } from "@/lib/calendar-repository";
import { mutationIsTrusted } from "@/lib/request-security";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403}); await requireUser(); const { id } = await context.params; try { await completeAppointment(id); return NextResponse.json({ ok: true }); } catch { return NextResponse.json({ code: "CALENDAR_COMPLETE_FAILED" }, { status: 500 }); } }
