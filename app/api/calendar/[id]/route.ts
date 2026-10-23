import { NextResponse } from "next/server";
import { apiRoute, parseUuid, requireApiCapability } from "@/lib/api";
import { mutateAppointment } from "@/lib/calendar-repository";
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
    const settings=await loadUserSettings(user);
    const item=await mutateAppointment(id,parsed.data,settings.timezone);
    return NextResponse.json({ ok: true, eventVersion:item.event_version });
  } catch (error) {
    if (error instanceof InvalidLocalTimeError) {
      return NextResponse.json({ code: error.code }, { status: 400 });
    }
    if (error instanceof DatabaseRequestError) {
      return NextResponse.json({ code: error.code }, { status: ["APPOINTMENT_STATE_CHANGED","APPOINTMENT_REQUEST_CONFLICT"].includes(error.code)?409:error.code==="APPOINTMENT_FORBIDDEN"?403:error.status });
    }
    return NextResponse.json({ code: "CALENDAR_UPDATE_FAILED" }, { status: 500 });
  }
}

export const PATCH=apiRoute(patch,"CALENDAR_UPDATE_FAILED");
