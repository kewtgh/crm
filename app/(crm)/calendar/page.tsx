import { CalendarPage } from "@/components/calendar-page";
import { DataLoadError } from "@/components/data-state";
import { calendarFocus,listAppointments } from "@/lib/calendar-repository";
import {z} from "zod";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
import { loadUserSettings } from "@/lib/settings-repository";
import { calendarMonthRange, dateTimePartsFor } from "@/lib/timezone";

export const generateMetadata = () => localizedPageMetadata("meta.calendar");

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const user=await requireCapability("calendar.view");
  let result,initialDate:string|undefined,initialIncludeCompleted=false,focusUnavailable=false;
  try {
    const settings=await loadUserSettings(user);
    const params=await searchParams,id=z.uuid().safeParse(params.event),focus=id.success?await calendarFocus(id.data,settings.timezone):null;
    focusUnavailable=Boolean(params.event&&(!focus||focus.status==='CANCELLED'));
    if(focus&&focus.status!=="CANCELLED"){initialDate=focus.date;initialIncludeCompleted=focus.status==="COMPLETED";}
    const current=dateTimePartsFor(new Date(),settings.timezone),[year,month]=initialDate?initialDate.split('-').map(Number):[Number(current.year),Number(current.month)];
    const range=calendarMonthRange(year,month-1,2,settings.timezone);
    result=await listAppointments(range.from,range.to,settings.timezone,{viewer:user.id,includeCompleted:initialIncludeCompleted,period:"1y"});
  } catch { result=undefined; }
  return result?<CalendarPage focusUnavailable={focusUnavailable} initialDate={initialDate} initialIncludeCompleted={initialIncludeCompleted} initialCalendarEvents={result.items} initialCalendarTotal={result.total} initialCalendarTruncated={result.truncated} persistent />:<DataLoadError detailKey="calendar.loadFailed" />;
}
