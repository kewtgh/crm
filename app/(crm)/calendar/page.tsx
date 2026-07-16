import type { Metadata } from "next";
import { CalendarPage } from "@/components/calendar-page";

export const metadata: Metadata = { title: "双月日历与预约" };

export default function Page() {
  return <CalendarPage />;
}
