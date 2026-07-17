import { supabaseJson } from "./supabase-server";

export type CalendarRecord = { id: string; date: string; time: string; title: string; titleEn: string; related: string; type: "meeting" | "consultation" | "followup" | "deadline"; channel: string; reminder: string; deliveryStatus:string };
type AppointmentRow = { id: string; title_zh: string; title_en: string; appointment_type: string; related_label: string; starts_at: string; channel: string; reminder_minutes: number[]; status: string };
const typeMap: Record<string, CalendarRecord["type"]> = { MEETING: "meeting", CONSULTATION: "consultation", FOLLOW_UP: "followup", DEADLINE: "deadline" };
const reminderLabel = (minutes: number[]) => minutes.includes(4320) ? "calendar.reminder.3d" : minutes.includes(1440) ? "calendar.reminder.day" : minutes.includes(120) ? "calendar.reminder.2h" : minutes.includes(30) ? "calendar.reminder.30m" : "calendar.reminder.start";

function localParts(value:Date,timezone:string){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(value);const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??"";return{date:`${get("year")}-${get("month")}-${get("day")}`,time:`${get("hour")}:${get("minute")}`};}
function zonedToUtc(date:string,time:string,timezone:string){const desired=Date.parse(`${date}T${time}:00Z`);let guess=desired;for(let index=0;index<3;index++){const parts=localParts(new Date(guess),timezone);const represented=Date.parse(`${parts.date}T${parts.time}:00Z`);guess+=desired-represented;}return new Date(guess);}

export async function listAppointments(from: string, to: string,timezone="Asia/Taipei") {
  const rows = await supabaseJson<AppointmentRow[]>(`/rest/v1/appointments?select=id,title_zh,title_en,appointment_type,related_label,starts_at,channel,reminder_minutes,status&status=eq.SCHEDULED&starts_at=gte.${encodeURIComponent(from)}&starts_at=lt.${encodeURIComponent(to)}&order=starts_at.asc&limit=300`);
  const ids=rows.map(row=>row.id);const deliveries=ids.length?await supabaseJson<Array<{appointment_id:string;status:string;created_at:string}>>(`/rest/v1/calendar_deliveries?select=appointment_id,status,created_at&appointment_id=in.(${ids.join(",")})&order=created_at.desc`):[];const status=new Map<string,string>();deliveries.forEach(item=>{if(!status.has(item.appointment_id))status.set(item.appointment_id,item.status);});
  return rows.map((row) => { const local=localParts(new Date(row.starts_at),timezone); return { id: row.id, date: local.date, time: local.time, title: row.title_zh, titleEn: row.title_en, related: row.related_label, type: typeMap[row.appointment_type] ?? "meeting", channel: row.channel, reminder: reminderLabel(row.reminder_minutes),deliveryStatus:status.get(row.id)??"NONE" }; });
}

export async function createAppointment(input: { title: string; locale: "zh-CN" | "en"; date: string; time: string; type: CalendarRecord["type"]; channel: string; related: string; relatedType?:"ORGANIZATION"|"CONTACT"|null;relatedId?:string|null; reminder: number;attendees:Array<{email:string;name?:string;contactId?:string|null;consentConfirmed:boolean}> },timezone="Asia/Taipei") {
  const types = { meeting: "MEETING", consultation: "CONSULTATION", followup: "FOLLOW_UP", deadline: "DEADLINE" } as const;
  const startsAt = zonedToUtc(input.date,input.time,timezone); const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  return supabaseJson<AppointmentRow>("/rest/v1/rpc/create_appointment_with_delivery",{method:"POST",body:JSON.stringify({title_zh:input.locale==="zh-CN"?input.title:input.title,title_en:input.title,event_type:types[input.type],relation_type:input.relatedType??null,relation_id:input.relatedId??null,relation_label:input.related,starts:startsAt.toISOString(),ends:endsAt.toISOString(),event_channel:input.channel,reminders:[input.reminder],attendees:input.attendees})});
}

export async function completeAppointment(id: string) { await supabaseJson("/rest/v1/rpc/complete_appointment", { method: "POST", body: JSON.stringify({ appointment_id: id }) }); }
export async function changeAppointmentDelivery(id:string,action:"UPDATE"|"CANCEL",date?:string,time?:string,timezone="Asia/Taipei"){let starts:string|null=null,ends:string|null=null;if(action==="UPDATE"&&date&&time){const start=zonedToUtc(date,time,timezone);starts=start.toISOString();ends=new Date(start.getTime()+3600000).toISOString();}return supabaseJson("/rest/v1/rpc/update_appointment_delivery",{method:"POST",body:JSON.stringify({target_appointment:id,action,starts,ends})});}
