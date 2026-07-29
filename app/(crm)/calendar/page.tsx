import { CalendarPage } from "@/components/calendar-page";
import { DataLoadError } from "@/components/data-state";
import { listAppointments } from "@/lib/calendar-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
import { loadUserSettings } from "@/lib/settings-repository";
import { calendarMonthRange, dateTimePartsFor } from "@/lib/timezone";

export const generateMetadata = () => localizedPageMetadata("meta.calendar");

export default async function Page() {
  const user=await requireCapability("calendar.view");
  let result;
  try {
    const settings=await loadUserSettings(user);
    const current=dateTimePartsFor(new Date(),settings.timezone);
    const range=calendarMonthRange(Number(current.year),Number(current.month)-1,2,settings.timezone);
    result=await listAppointments(range.from,range.to,settings.timezone);
  } catch { result=undefined; }
  return result?<CalendarPage initialCalendarEvents={result.items} initialCalendarTotal={result.total} initialCalendarTruncated={result.truncated} persistent />:<DataLoadError detailKey="calendar.loadFailed" />;
}
