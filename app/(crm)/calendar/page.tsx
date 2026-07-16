import { CalendarPage } from "@/components/calendar-page";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.calendar");

export default function Page() {
  return <CalendarPage />;
}
