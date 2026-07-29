import { NextResponse } from "next/server";
import { apiRoute, parseUuid, requireApiCapability } from "@/lib/api";
import { changeAppointmentDelivery,completeAppointment } from "@/lib/calendar-repository";
import { parseCalendarAction } from "@/lib/calendar-actions";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { mutationIsTrusted } from "@/lib/request-security";
import { loadUserSettings } from "@/lib/settings-repository";
import { InvalidLocalTimeError } from "@/lib/timezone";

async function patch(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationIsTrusted(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }
  const user = await requireApiCapability("calendar.manage");
  const id = parseUuid((await context.params).id);
  const parsed = parseCalendarAction(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ code: "INVALID_CALENDAR_ACTION" }, { status: 400 });
  }
  try {
    if (parsed.data.action === "COMPLETE") {
      await completeAppointment(id);
    } else {
      const settings = await loadUserSettings(user);
      await changeAppointmentDelivery(
        id,
        parsed.data.action,
        parsed.data.action === "UPDATE" ? parsed.data.date : undefined,
        parsed.data.action === "UPDATE" ? parsed.data.time : undefined,
        settings.timezone,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InvalidLocalTimeError) {
      return NextResponse.json({ code: error.code }, { status: 400 });
    }
    if (error instanceof DatabaseRequestError) {
      return NextResponse.json({ code: error.code }, { status: error.status });
    }
    return NextResponse.json({ code: "CALENDAR_UPDATE_FAILED" }, { status: 500 });
  }
}

export const PATCH=apiRoute(patch,"CALENDAR_UPDATE_FAILED");
