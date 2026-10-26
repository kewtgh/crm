import {completedSince,type CompletedPeriod} from "./calendar-history";
import type { CalendarAction } from "./calendar-actions";
import { databaseJson, databaseRequest } from "./db/gateway";
import {
  dateTimePartsFor,
  normalizeTimezone,
  zonedLocalDateTimeToUtc,
  type SupportedTimezone,
} from "./timezone";

export type CalendarRecord = { id: string; date: string; time: string; title: string; titleEn: string; related: string; type: "meeting" | "consultation" | "followup" | "deadline"; channel: string; reminder: string; deliveryStatus:string; eventVersion:number; relationType?:"ORGANIZATION"|"CONTACT"|"USER"|null;incoming?:boolean;status?:"SCHEDULED"|"COMPLETED";completedAt?:string|null };
export type CalendarResult = { items: CalendarRecord[]; total: number; truncated: boolean };
type AppointmentRow = { id: string; title_zh: string; title_en: string; appointment_type: string; related_label: string; starts_at: string; channel: string; reminder_minutes: number[]; related_type?:CalendarRecord["relationType"];related_id?:string|null;created_by?:string;status: "SCHEDULED"|"COMPLETED";completed_at?:string|null; event_version:number };
const CALENDAR_RESULT_LIMIT = 500;
const typeMap: Record<string, CalendarRecord["type"]> = { MEETING: "meeting", CONSULTATION: "consultation", FOLLOW_UP: "followup", DEADLINE: "deadline" };
const reminderLabel = (minutes: number[]) => minutes.includes(4320) ? "calendar.reminder.3d" : minutes.includes(1440) ? "calendar.reminder.day" : minutes.includes(120) ? "calendar.reminder.2h" : minutes.includes(30) ? "calendar.reminder.30m" : "calendar.reminder.start";

function localParts(value:Date,timezone:SupportedTimezone){const parts=dateTimePartsFor(value,timezone);return{date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};}

function calendarRows(rows:AppointmentRow[],timezone:SupportedTimezone,statuses=new Map<string,string>(),viewer?:string):CalendarRecord[]{return rows.map(row=>{const local=localParts(new Date(row.starts_at),timezone);return{id:row.id,eventVersion:row.event_version,date:local.date,time:local.time,title:row.title_zh,titleEn:row.title_en,related:row.related_label,type:typeMap[row.appointment_type]??"meeting",channel:row.channel,reminder:reminderLabel(row.reminder_minutes),deliveryStatus:statuses.get(row.id)??"NONE",status:row.status,completedAt:row.completed_at??null,relationType:row.related_type??null,incoming:Boolean(viewer&&row.related_type==="USER"&&row.related_id===viewer&&row.created_by!==viewer)};});}
function calendarTotal(response:Response,rows:unknown[]){const total=response.headers.get("content-range")?.split("/")[1];return total&&total!=="*"?Number(total):rows.length;}
const completedSelect="id,title_zh,title_en,appointment_type,related_label,starts_at,channel,reminder_minutes,status,completed_at,event_version,related_type,related_id,created_by";
export async function listAppointments(from:string,to:string,timezone:SupportedTimezone=normalizeTimezone(undefined),options:{includeCompleted?:boolean;period?:CompletedPeriod;viewer?:string;now?:Date;request?:typeof databaseRequest;json?:typeof databaseJson}={}):Promise<CalendarResult>{
 const request=options.request??databaseRequest,json=options.json??databaseJson;
 const response=await request('/db/table/appointments?select='+completedSelect+'&status=eq.SCHEDULED&starts_at=gte.'+encodeURIComponent(from)+'&starts_at=lt.'+encodeURIComponent(to)+'&order=starts_at.asc',{headers:{Prefer:"count=exact",Range:'0-'+(CALENDAR_RESULT_LIMIT-1)}});
 const rows=await response.json() as AppointmentRow[];let total=calendarTotal(response,rows);
 if(options.includeCompleted){const now=options.now??new Date(),params=new URLSearchParams({select:completedSelect,status:"eq.COMPLETED",completed_at:"gte."+completedSince(options.period??"3m",timezone,now),order:"starts_at.asc,id.asc"});params.append("completed_at","lte."+now.toISOString());params.append("starts_at","gte."+from);params.append("starts_at","lt."+to);
  const completed=await request('/db/table/appointments?'+params,{headers:{Prefer:"count=exact",Range:'0-'+(CALENDAR_RESULT_LIMIT-1)}}),history=await completed.json() as AppointmentRow[];total+=calendarTotal(completed,history);rows.push(...history);
 }
 const ids=rows.map(row=>row.id),deliveries=ids.length?await json<Array<{appointment_id:string;status:string}>>('/db/table/calendar_deliveries?select=appointment_id,status,created_at&appointment_id=in.('+ids.join(',')+')&order=created_at.desc'):[],statuses=new Map<string,string>();deliveries.forEach(item=>{if(!statuses.has(item.appointment_id))statuses.set(item.appointment_id,item.status);});
 const items=calendarRows(rows,timezone,statuses,options.viewer).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)||a.id.localeCompare(b.id));return{items,total,truncated:total>items.length};
}
export async function listCompletedAppointments(period:CompletedPeriod,page=1,pageSize=20,timezone:SupportedTimezone=normalizeTimezone(undefined),request=databaseRequest,now=new Date(),viewer?:string){
 const params=new URLSearchParams({select:completedSelect,status:"eq.COMPLETED",completed_at:"gte."+completedSince(period,timezone,now),order:"completed_at.desc,id.desc"});params.append("completed_at","lte."+now.toISOString());
 const response=await request('/db/table/appointments?'+params,{headers:{Prefer:"count=exact",Range:String((page-1)*pageSize)+'-'+(page*pageSize-1)}}),rows=await response.json() as AppointmentRow[];
 return{items:calendarRows(rows,timezone,new Map(),viewer),total:calendarTotal(response,rows),page,pageSize};
}

export async function createAppointment(input: { title: string; locale: "zh-CN" | "en"; date: string; time: string; type: CalendarRecord["type"]; channel: string; related: string; relatedType?:"ORGANIZATION"|"CONTACT"|"USER"|null;relatedId?:string|null; reminder: number;attendees:Array<{email:string;name?:string;contactId?:string|null;consentConfirmed:boolean}>;requestKey:string },timezone:SupportedTimezone=normalizeTimezone(undefined)) {
  const types = { meeting: "MEETING", consultation: "CONSULTATION", followup: "FOLLOW_UP", deadline: "DEADLINE" } as const;
  const startsAt = zonedLocalDateTimeToUtc(`${input.date}T${input.time}`,timezone); const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  return databaseJson<AppointmentRow>("/db/rpc/create_appointment_with_delivery",{method:"POST",body:JSON.stringify({title_zh:input.locale==="zh-CN"?input.title:input.title,title_en:input.title,event_type:types[input.type],relation_type:input.relatedType??null,relation_id:input.relatedId??null,relation_label:input.related,starts:startsAt.toISOString(),ends:endsAt.toISOString(),event_channel:input.channel,reminders:[input.reminder],attendees:input.attendees,target_request_key:input.requestKey})});
}

export async function mutateAppointment(id:string,input:CalendarAction,timezone:SupportedTimezone=normalizeTimezone(undefined),request=databaseJson){
  const start=input.action==="UPDATE"?zonedLocalDateTimeToUtc(input.date+"T"+input.time,timezone):null;
  return request<AppointmentRow>("/db/rpc/mutate_calendar_appointment",{method:"POST",body:JSON.stringify({target_appointment:id,action:input.action,expected_event_version:input.expectedVersion,p_request_key:input.requestKey,starts:start?.toISOString()??null,ends:start?new Date(start.getTime()+3600000).toISOString():null})});
}

export async function calendarFocus(id:string,timezone:SupportedTimezone){const rows=await databaseJson<Array<{starts_at:string;status:string}>>("/db/table/appointments?select=starts_at,status&id=eq."+id+"&limit=1");return rows[0]?{...localParts(new Date(rows[0].starts_at),timezone),status:rows[0].status}:null;}
