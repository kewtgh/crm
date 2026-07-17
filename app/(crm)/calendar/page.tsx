import { CalendarPage } from "@/components/calendar-page";
import { DataLoadError } from "@/components/data-state";
import { listAppointments } from "@/lib/calendar-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireUser } from "@/lib/auth";
import { loadUserSettings } from "@/lib/settings-repository";

export const generateMetadata = () => localizedPageMetadata("meta.calendar");

export default async function Page() {
  let events;
  try {
    const user=await requireUser();const settings=await loadUserSettings(user);
    const from = new Date(); from.setMonth(from.getMonth() - 1);
    const to = new Date(); to.setMonth(to.getMonth() + 4);
    events=await listAppointments(from.toISOString(), to.toISOString(),settings.timezone);
  } catch { events=undefined; }
  return events?<CalendarPage initialCalendarEvents={events} persistent />:<DataLoadError detailKey="calendar.loadFailed" />;
}
