import { supabaseJson } from "./supabase-server";

export type CalendarRecord = { id: string; date: string; time: string; title: string; titleEn: string; related: string; type: "meeting" | "consultation" | "followup" | "deadline"; channel: string; reminder: string };
type AppointmentRow = { id: string; title_zh: string; title_en: string; appointment_type: string; related_label: string; starts_at: string; channel: string; reminder_minutes: number[]; status: string };
const typeMap: Record<string, CalendarRecord["type"]> = { MEETING: "meeting", CONSULTATION: "consultation", FOLLOW_UP: "followup", DEADLINE: "deadline" };
const reminderLabel = (minutes: number[]) => minutes.includes(4320) ? "calendar.reminder.3d" : minutes.includes(1440) ? "calendar.reminder.day" : minutes.includes(120) ? "calendar.reminder.2h" : minutes.includes(30) ? "calendar.reminder.30m" : "calendar.reminder.start";

function localParts(value:Date,timezone:string){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(value);const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??"";return{date:`${get("year")}-${get("month")}-${get("day")}`,time:`${get("hour")}:${get("minute")}`};}
function zonedToUtc(date:string,time:string,timezone:string){const desired=Date.parse(`${date}T${time}:00Z`);let guess=desired;for(let index=0;index<3;index++){const parts=localParts(new Date(guess),timezone);const represented=Date.parse(`${parts.date}T${parts.time}:00Z`);guess+=desired-represented;}return new Date(guess);}

export async function listAppointments(from: string, to: string,timezone="Asia/Taipei") {
  const rows = await supabaseJson<AppointmentRow[]>(`/rest/v1/appointments?select=id,title_zh,title_en,appointment_type,related_label,starts_at,channel,reminder_minutes,status&status=eq.SCHEDULED&starts_at=gte.${encodeURIComponent(from)}&starts_at=lt.${encodeURIComponent(to)}&order=starts_at.asc&limit=300`);
  return rows.map((row) => { const local=localParts(new Date(row.starts_at),timezone); return { id: row.id, date: local.date, time: local.time, title: row.title_zh, titleEn: row.title_en, related: row.related_label, type: typeMap[row.appointment_type] ?? "meeting", channel: row.channel, reminder: reminderLabel(row.reminder_minutes) }; });
}

export async function createAppointment(input: { title: string; locale: "zh-CN" | "en"; date: string; time: string; type: CalendarRecord["type"]; channel: string; related: string; relatedType?:"ORGANIZATION"|"CONTACT"|null;relatedId?:string|null; reminder: number },timezone="Asia/Taipei") {
  const types = { meeting: "MEETING", consultation: "CONSULTATION", followup: "FOLLOW_UP", deadline: "DEADLINE" } as const;
  const startsAt = zonedToUtc(input.date,input.time,timezone); const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const body = { title_zh: input.title, title_en: input.title, appointment_type: types[input.type], starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), channel: input.channel, related_label: input.related, related_type:input.relatedType??null,related_id:input.relatedId??null, reminder_minutes: [input.reminder] };
  const rows = await supabaseJson<AppointmentRow[]>("/rest/v1/appointments?select=id,title_zh,title_en,appointment_type,related_label,starts_at,channel,reminder_minutes,status", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation" } });
  return rows[0];
}

export async function completeAppointment(id: string) { await supabaseJson("/rest/v1/rpc/complete_appointment", { method: "POST", body: JSON.stringify({ appointment_id: id }) }); }
