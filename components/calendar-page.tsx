"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {BellRing,CalendarDays,Check,ChevronLeft,ChevronRight,Clock3,Pencil,Plus,RefreshCw,X} from "lucide-react";
import {WorkspaceHeading} from "./workspace-heading";
import {CalendarEditor} from "./calendar-editor";
import {DateInput} from "./structured-inputs";
import {ConfirmDialog,InlineMessage,Pagination,Toast} from "./ui";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {apiFetch} from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {calendarMonthRange} from "@/lib/timezone";
import {calendarAgenda,upsertCalendarEvent,type CalendarView} from "@/lib/calendar-workspace";
import type {CalendarRecord,CalendarResult} from "@/lib/calendar-repository";
import type {CalendarAction} from "@/lib/calendar-actions";

type CalendarEvent=Omit<CalendarRecord,"eventVersion"|"titleEn"|"deliveryStatus">&Partial<Pick<CalendarRecord,"eventVersion"|"titleEn"|"deliveryStatus">>;
const weekDays={"zh-CN":["周一","周二","周三","周四","周五","周六","周日"],en:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]};
const pad=(value:number)=>String(value).padStart(2,"0");
const dateKey=(year:number,month:number,day:number)=>`${year}-${pad(month+1)}-${pad(day)}`;
const monthTitle=(month:Date,locale:"zh-CN"|"en")=>new Intl.DateTimeFormat(locale,{year:"numeric",month:"long"}).format(month);
const eventValueKeys:Record<string,string>={"提前 30 分钟":"calendar.reminder.30m","提前 2 小时":"calendar.reminder.2h","提前 1 天":"calendar.reminder.day","提前 3 天":"calendar.reminder.3d","办公室":"calendar.channel.office","会议室 A":"calendar.channel.roomA","电话":"calendar.channel.phone","系统任务":"calendar.channel.system","合同节点":"calendar.channel.contract"};
function monthCells(month:Date){const year=month.getFullYear(),index=month.getMonth(),leading=(new Date(year,index,1).getDay()+6)%7,count=new Date(year,index+1,0).getDate();return [...Array.from({length:leading},()=>null),...Array.from({length:count},(_,offset)=>({day:offset+1,key:dateKey(year,index,offset+1)}))];}

export function CalendarPage({initialCalendarEvents=[],initialCalendarTotal,initialCalendarTruncated=false,persistent=false}:{initialCalendarEvents?:CalendarEvent[];initialCalendarTotal?:number;initialCalendarTruncated?:boolean;persistent?:boolean}){
 const {locale,t}=useI18n(),{todayKey:preferredTodayKey,timezone}=useUserPreferences();const today=preferredTodayKey();
 const [year,currentMonth]=today.split("-").map(Number),[month,setMonth]=useState(()=>new Date(year,currentMonth-1,1));
 const rangeKey=`${month.getFullYear()}-${month.getMonth()}-${timezone}`;
 const [loadedRange,setLoadedRange]=useState(rangeKey),[events,setEvents]=useState(initialCalendarEvents),[total,setTotal]=useState(initialCalendarTotal??initialCalendarEvents.length),[truncated,setTruncated]=useState(initialCalendarTruncated);
 const [selectedDate,setSelectedDate]=useState(today),[view,setView]=useState<CalendarView>("upcoming"),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10);
 const [drawerOpen,setDrawerOpen]=useState(false),[refreshing,setRefreshing]=useState(false),[readError,setReadError]=useState(""),[actionError,setActionError]=useState(""),[toast,setToast]=useState("");
 const [reschedule,setReschedule]=useState<{id:string;date:string;time:string}|null>(null),[cancelEvent,setCancelEvent]=useState<CalendarEvent|null>(null);
 const [writePending,setWritePending]=useState(false),[uncertain,setUncertain]=useState(false),[createLocked,setCreateLocked]=useState(false);
 const sequence=useRef(0),readController=useRef<AbortController|null>(null),mutationBusy=useRef(false);
 const actionAttempt=useRef<{url:string;body:string;item:CalendarEvent;input:CalendarAction}|null>(null);
 const locked=writePending||uncertain||createLocked;
 const cancelRead=useCallback(()=>{sequence.current++;readController.current?.abort();},[]);
 const refresh=useCallback(async()=>{
  if(!persistent||mutationBusy.current||actionAttempt.current)return;
  const current=++sequence.current;readController.current?.abort();const controller=new AbortController();readController.current=controller;
  setRefreshing(true);setReadError("");
  try{const range=calendarMonthRange(month.getFullYear(),month.getMonth(),2,timezone);const params=new URLSearchParams(range);const result=await apiFetch<CalendarResult>(`/api/calendar?${params}`,{signal:controller.signal});
   if(current!==sequence.current||controller.signal.aborted)return;setEvents(result.items);setTotal(result.total);setTruncated(result.truncated);setLoadedRange(rangeKey);
  }catch(caught){if(current===sequence.current&&!controller.signal.aborted)setReadError(presentApiError(caught,t,"calendar.loadFailed").message);}
  finally{if(current===sequence.current&&!controller.signal.aborted)setRefreshing(false);}
 },[month,persistent,rangeKey,t,timezone]);
 useEffect(()=>{const timer=window.setTimeout(()=>void refresh(),0);return()=>{window.clearTimeout(timer);cancelRead();};},[refresh,cancelRead]);
 const visibleEvents=useMemo(()=>loadedRange===rangeKey?events:[],[loadedRange,rangeKey,events]);
 const agenda=useMemo(()=>calendarAgenda(visibleEvents,view,today,selectedDate),[visibleEvents,view,today,selectedDate]);
 const pages=Math.max(1,Math.ceil(agenda.length/pageSize)),safePage=Math.min(page,pages),pageItems=agenda.slice((safePage-1)*pageSize,safePage*pageSize);
 const nextMonth=new Date(month.getFullYear(),month.getMonth()+1,1);
 const selectDay=(date:string)=>{setSelectedDate(date);setView("day");setPage(1);};
 const navigateMonth=(offset:number)=>{const next=new Date(month.getFullYear(),month.getMonth()+offset,1);setMonth(next);selectDay(dateKey(next.getFullYear(),next.getMonth(),1));};
 const openSchedule=()=>{setActionError("");setDrawerOpen(true);};
 const action=async(item?:CalendarEvent,kind?:CalendarAction["action"],date?:string,time?:string)=>{
  if(mutationBusy.current)return;
  if(!actionAttempt.current){
   if(!item||!kind)return;if(persistent&&!item.eventVersion){setActionError(t("calendarRecovery.reload"));return;}
   const input:CalendarAction=kind==="UPDATE"?{action:kind,date:date!,time:time!,expectedVersion:item.eventVersion??1,requestKey:crypto.randomUUID()}:{action:kind,expectedVersion:item.eventVersion??1,requestKey:crypto.randomUUID()};
   actionAttempt.current={url:`/api/calendar/${item.id}`,body:JSON.stringify(input),item,input};
  }
  const attempt=actionAttempt.current;mutationBusy.current=true;cancelRead();setRefreshing(false);setWritePending(true);setActionError("");
  try{
   const result=persistent?await apiFetch<{eventVersion:number}>(attempt.url,{method:"PATCH",headers:{"content-type":"application/json"},body:attempt.body}):{eventVersion:attempt.input.expectedVersion+1};
   if(!Number.isInteger(result.eventVersion)||result.eventVersion<=attempt.input.expectedVersion)throw new Error("INVALID_CALENDAR_RESULT");
   if(attempt.input.action==="UPDATE"){const input=attempt.input;const start=dateKey(month.getFullYear(),month.getMonth(),1),end=dateKey(month.getFullYear(),month.getMonth()+2,1);if(input.date>=start&&input.date<end)setEvents(current=>upsertCalendarEvent(current,{...attempt.item,date:input.date,time:input.time,eventVersion:result.eventVersion,deliveryStatus:"QUEUED"}));else {setEvents(current=>current.filter(event=>event.id!==attempt.item.id));setTotal(current=>Math.max(0,current-1));}}
   else {setEvents(current=>current.filter(event=>event.id!==attempt.item.id));setTotal(current=>Math.max(0,current-1));}
   setToast(t(attempt.input.action==="COMPLETE"?"calendarRecovery.completed":attempt.input.action==="CANCEL"?"calendar.cancelQueued":"calendar.updateQueued"));
   actionAttempt.current=null;setUncertain(false);setReschedule(null);setCancelEvent(null);
  }catch(caught){
   if(isDefinitiveMutationFailure(caught)){actionAttempt.current=null;setUncertain(false);setActionError(presentApiError(caught,t,"calendar.deliveryUpdateFailed").message);}
   else {setUncertain(true);setActionError(t("calendarRecovery.uncertainAction"));setCancelEvent(null);}
  }finally{mutationBusy.current=false;setWritePending(false);}
 };
 const creating=()=>{mutationBusy.current=true;cancelRead();setRefreshing(false);setCreateLocked(true);};
 const creationSettled=()=>{mutationBusy.current=false;setCreateLocked(false);};
 const saved=(item:CalendarRecord)=>{setEvents(current=>upsertCalendarEvent(current,item));setTotal(current=>current+1);selectDay(item.date);setDrawerOpen(false);setToast(t("calendar.saved"));const start=dateKey(month.getFullYear(),month.getMonth(),1),end=dateKey(month.getFullYear(),month.getMonth()+2,1);if(item.date<start||item.date>=end){const [y,m]=item.date.split("-").map(Number);setMonth(new Date(y,m-1,1));}};
 const completeEvent=(id:string)=>void action(events.find(item=>item.id===id),"COMPLETE");
 return <div className="page-stack calendar-page">
  <section className="page-heading-row"><div><p className="eyebrow">{t("calendar.eyebrow")}</p><WorkspaceHeading>{t("calendar.title")}</WorkspaceHeading><p>{t("calendar.description")}</p></div><div className="page-actions"><button className="secondary-button" type="button" disabled={locked} onClick={()=>{setMonth(new Date(year,currentMonth-1,1));selectDay(today);}}>{t("calendar.today")}</button>{persistent&&<button className="secondary-button" type="button" disabled={locked||refreshing} onClick={()=>void refresh()}><RefreshCw size={16}/>{t(refreshing?"common.loading":"calendarRecovery.refresh")}</button>}<button className="primary-button" type="button" disabled={locked} onClick={openSchedule}><Plus size={17}/>{t("calendar.new")}</button></div></section>
  <p className="field-help">{t("calendarRecovery.scope",{from:monthTitle(month,locale),to:monthTitle(nextMonth,locale)})}</p>
  {readError&&<InlineMessage type="error">{readError} {t("calendarRecovery.readStale")}</InlineMessage>}{refreshing&&<p role="status">{t("common.loading")}</p>}
  {actionError&&<InlineMessage type="error">{actionError}</InlineMessage>}{uncertain&&<button type="button" className="secondary-button" disabled={writePending} onClick={()=>void action()}>{t("business.retrySame")}</button>}
  {truncated&&loadedRange===rangeKey&&<InlineMessage type="warning">{t("calendar.truncated",{shown:events.length,total})}</InlineMessage>}
  <section className="calendar-layout" aria-busy={refreshing||locked}>
   <div className="surface calendar-surface"><div className="calendar-toolbar"><div><button type="button" disabled={locked} aria-label={t("calendar.previousMonth")} onClick={()=>navigateMonth(-1)}><ChevronLeft size={18}/></button><button type="button" disabled={locked} aria-label={t("calendar.nextMonth")} onClick={()=>navigateMonth(1)}><ChevronRight size={18}/></button></div><h2>{monthTitle(month,locale)} — {monthTitle(nextMonth,locale)}</h2><span className="calendar-legend"><span><i className="meeting"/>{t("calendar.meeting")}</span><span><i className="consultation"/>{t("calendar.consultation")}</span><span><i className="followup"/>{t("calendar.followup")}</span><span><i className="deadline"/>{t("calendar.deadline")}</span></span></div><div className="double-calendar"><MonthView month={month} events={visibleEvents} selectedDate={selectedDate} today={today} onSelect={selectDay} disabled={locked}/><MonthView month={nextMonth} events={visibleEvents} selectedDate={selectedDate} today={today} onSelect={selectDay} disabled={locked}/></div></div>
   <aside className="surface reminder-panel"><div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.reminders")}</p><h2>{t(view==="day"?"calendarRecovery.day":"calendar.reminders",{date:selectedDate})}</h2></div><span className="count-pill">{agenda.length}</span></div>
    <div className="calendar-agenda-tabs" role="group" aria-label={t("calendarRecovery.view")}>{(["upcoming","day"] as const).map(value=><button type="button" className="secondary-button" aria-pressed={view===value} key={value} disabled={locked} onClick={()=>{setView(value);setPage(1);}}>{t(value==="day"?"calendarRecovery.selectedDay":"calendar.reminders")}</button>)}</div>
    {pageItems.map(item=><article className="reminder-item" key={item.id}><span className={`reminder-type ${item.type}`}><BellRing size={17}/></span><div><b>{locale==="en"&&item.titleEn?item.titleEn:item.title}</b><small><CalendarDays size={13}/>{item.date} · {item.time}</small><small><Clock3 size={13}/>{item.reminder.startsWith("calendar.")?t(item.reminder):eventValueKeys[item.reminder]?t(eventValueKeys[item.reminder]):item.reminder} · {eventValueKeys[item.channel]?t(eventValueKeys[item.channel]):item.channel}</small><small>{t("calendar.deliveryStatus")}: {t(`calendar.delivery.${(item.deliveryStatus??"NONE").toLowerCase()}`)}</small>{item.related&&<small>{item.related}</small>}</div><span className="reminder-actions"><button type="button" disabled={locked||refreshing} aria-label={t("calendar.reschedule")} onClick={()=>setReschedule({id:item.id,date:item.date,time:item.time})}><Pencil size={15}/></button><button type="button" disabled={locked||refreshing} aria-label={t("calendar.cancelEvent")} onClick={()=>setCancelEvent(item)}><X size={15}/></button><button type="button" disabled={locked||refreshing} aria-label={t("calendar.complete",{title:locale==="en"&&item.titleEn?item.titleEn:item.title})} onClick={()=>completeEvent(item.id)}><Check size={16}/></button></span>{reschedule?.id===item.id&&<form className="reschedule-form" onSubmit={event=>{event.preventDefault();void action(item,"UPDATE",reschedule.date,reschedule.time);}}><fieldset disabled={locked}><label className="field"><span>{t("calendar.date")}</span><DateInput type="date" value={reschedule.date} onChange={event=>setReschedule({...reschedule,date:event.target.value})} required/></label><label className="field"><span>{t("calendar.time")}</span><DateInput type="time" value={reschedule.time} onChange={event=>setReschedule({...reschedule,time:event.target.value})} required/></label><button className="primary-button">{t("calendar.queueUpdate")}</button><button className="secondary-button" type="button" onClick={()=>setReschedule(null)}>{t("common.cancel")}</button></fieldset></form>}</article>)}
    {!agenda.length&&!refreshing&&!readError&&loadedRange===rangeKey&&<div className="empty-state"><span>{t(view==="day"?"calendarRecovery.emptyDay":"calendar.empty")}</span><p>{t("calendarRecovery.inspectHelp")}</p></div>}
    <Pagination page={safePage} totalPages={pages} total={agenda.length} pageSize={pageSize} onPage={setPage} onPageSize={value=>{setPageSize(value);setPage(1);}}/>
   </aside>
  </section>
  {drawerOpen&&<CalendarEditor date={selectedDate} persistent={persistent} onClose={()=>setDrawerOpen(false)} onSaved={saved} onWriting={creating} onSettled={creationSettled}/>}
  {cancelEvent&&<ConfirmDialog title={t("common.confirmAction")} description={t("calendar.cancelConfirm",{title:locale==="en"&&cancelEvent.titleEn?cancelEvent.titleEn:cancelEvent.title})} confirmLabel={t("calendar.cancelEvent")} pending={writePending} onClose={()=>setCancelEvent(null)} onConfirm={()=>void action(cancelEvent,"CANCEL")}/>}
  {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
 </div>;
}

function MonthView({month,events,selectedDate,today,onSelect,disabled}:{month:Date;events:CalendarEvent[];selectedDate:string;today:string;onSelect:(date:string)=>void;disabled:boolean}){
 const {locale,t}=useI18n();return <section className="month-view" aria-label={monthTitle(month,locale)}><h3>{monthTitle(month,locale)}</h3><div className="calendar-weekdays">{weekDays[locale].map(day=><span key={day}>{day}</span>)}</div><div className="calendar-grid">{monthCells(month).map((cell,index)=>{if(!cell)return <span className="calendar-blank" key={`blank-${index}`}/>;const dayEvents=events.filter(event=>event.date===cell.key);return <button type="button" disabled={disabled} aria-pressed={cell.key===selectedDate} className={`calendar-day ${cell.key===today?"today":""} ${cell.key===selectedDate?"selected":""}`} key={cell.key} onClick={()=>onSelect(cell.key)} aria-label={t("calendar.eventsCount",{date:cell.key,count:dayEvents.length})}><span>{cell.day}</span><div>{dayEvents.slice(0,2).map(item=><i className={item.type} key={item.id}>{item.time} {locale==="en"&&item.titleEn?item.titleEn:item.title}</i>)}{dayEvents.length>2&&<small>{t("calendar.more",{count:dayEvents.length-2})}</small>}</div></button>;})}</div></section>;
}
