import { supabaseJson } from "./supabase-server";

export type CalendarRecord = { id: string; date: string; time: string; title: string; titleEn: string; related: string; type: "meeting" | "consultation" | "followup" | "deadline"; channel: string; reminder: string };
type AppointmentRow = { id: string; title_zh: string; title_en: string; appointment_type: string; related_label: string; starts_at: string; channel: string; reminder_minutes: number[]; status: string };
const typeMap: Record<string, CalendarRecord["type"]> = { MEETING: "meeting", CONSULTATION: "consultation", FOLLOW_UP: "followup", DEADLINE: "deadline" };
const reminderLabel = (minutes: number[]) => minutes.includes(4320) ? "提前 3 天" : minutes.includes(1440) ? "提前 1 天" : minutes.includes(120) ? "提前 2 小时" : minutes.includes(30) ? "提前 30 分钟" : "开始时";

export async function listAppointments(from: string, to: string) {
  const rows = await supabaseJson<AppointmentRow[]>(`/rest/v1/appointments?select=id,title_zh,title_en,appointment_type,related_label,starts_at,channel,reminder_minutes,status&status=eq.SCHEDULED&starts_at=gte.${encodeURIComponent(from)}&starts_at=lt.${encodeURIComponent(to)}&order=starts_at.asc&limit=300`);
  return rows.map((row) => { const starts = new Date(row.starts_at); return { id: row.id, date: starts.toISOString().slice(0, 10), time: starts.toISOString().slice(11, 16), title: row.title_zh, titleEn: row.title_en, related: row.related_label, type: typeMap[row.appointment_type] ?? "meeting", channel: row.channel, reminder: reminderLabel(row.reminder_minutes) }; });
}

export async function createAppointment(input: { title: string; locale: "zh-CN" | "en"; date: string; time: string; type: CalendarRecord["type"]; channel: string; related: string; reminder: number }) {
  const types = { meeting: "MEETING", consultation: "CONSULTATION", followup: "FOLLOW_UP", deadline: "DEADLINE" } as const;
  const startsAt = new Date(`${input.date}T${input.time}:00`); const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const body = { title_zh: input.title, title_en: input.title, appointment_type: types[input.type], starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), channel: input.channel, related_label: input.related, reminder_minutes: [input.reminder] };
  const rows = await supabaseJson<AppointmentRow[]>("/rest/v1/appointments?select=id,title_zh,title_en,appointment_type,related_label,starts_at,channel,reminder_minutes,status", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation" } });
  return rows[0];
}

export async function completeAppointment(id: string) { await supabaseJson("/rest/v1/rpc/complete_appointment", { method: "POST", body: JSON.stringify({ appointment_id: id }) }); }
