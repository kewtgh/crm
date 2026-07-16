import { CalendarPage } from "@/components/calendar-page";
import { listAppointments } from "@/lib/calendar-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.calendar");

export default async function Page() {
  let events;
  try {
    const from = new Date(); from.setMonth(from.getMonth() - 1);
    const to = new Date(); to.setMonth(to.getMonth() + 4);
    events=await listAppointments(from.toISOString(), to.toISOString());
  } catch { events=undefined; }
  return events?<CalendarPage initialCalendarEvents={events} persistent />:<CalendarPage />;
}
