import type { CalendarRecord } from "./calendar-repository";

export const calendarRelationTypes = ["ORGANIZATION", "CONTACT", "USER"] as const;
export const calendarReminders = [0, 30, 120, 1440, 4320] as const;
export const reminderKeys: Record<number, string> = {0:"calendar.reminder.start",30:"calendar.reminder.30m",120:"calendar.reminder.2h",1440:"calendar.reminder.day",4320:"calendar.reminder.3d"};
export type CalendarView = "upcoming" | "day";

export function calendarAgenda<T extends Pick<CalendarRecord,"date"|"time"|"id">&{status?:string}>(items:readonly T[],view:CalendarView,today:string,selectedDate:string) {
  return items.filter(item=>view==="day"?item.date===selectedDate:item.status!=="COMPLETED"&&item.date>=today)
    .sort((a,b)=>`${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)||a.id.localeCompare(b.id));
}

export function upsertCalendarEvent<T extends {id:string}>(items:readonly T[],item:T) {
  return [...items.filter(current=>current.id!==item.id),item];
}

export function calendarRelationKind(item:{incoming?:boolean;relationType?:string|null}){return item.incoming?"invited":item.relationType==="USER"?"member":item.relationType==="ORGANIZATION"?"organization":item.relationType==="CONTACT"?"contact":"unlinked";}
