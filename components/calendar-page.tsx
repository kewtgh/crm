"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  Users,
  Video,
  X,
} from "lucide-react";
import { AccessibleDrawer, InlineMessage, Pagination, SearchableSelect, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import { apiFetch } from "@/lib/api-client";
import { useUserPreferences } from "@/components/user-preferences-context";
import { useRemoteSearch } from "@/hooks/use-remote-search";

type CalendarEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  titleEn?: string;
  related: string;
  type: "meeting" | "consultation" | "followup" | "deadline";
  channel: string;
  reminder: string;
  deliveryStatus?: string;
};

const weekDays = { "zh-CN":["周一","周二","周三","周四","周五","周六","周日"], en:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] };
const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
const monthTitle = (month: Date, locale: "zh-CN"|"en") => new Intl.DateTimeFormat(locale,{year:"numeric",month:"long"}).format(month);
const eventValueKeys: Record<string,string> = { "提前 30 分钟":"calendar.reminder.30m", "提前 2 小时":"calendar.reminder.2h", "提前 1 天":"calendar.reminder.day", "提前 3 天":"calendar.reminder.3d", "办公室":"calendar.channel.office", "会议室 A":"calendar.channel.roomA", "电话":"calendar.channel.phone", "系统任务":"calendar.channel.system", "合同节点":"calendar.channel.contract" };

function monthCells(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const leading = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const count = new Date(year, monthIndex + 1, 0).getDate();
  return [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: count }, (_, index) => ({ day: index + 1, key: dateKey(year, monthIndex, index + 1) })),
  ];
}

export function CalendarPage({ initialCalendarEvents = [], persistent = false }: { initialCalendarEvents?: CalendarEvent[]; persistent?: boolean }) {
  const { locale, t } = useI18n();
  const {todayKey:preferredTodayKey}=useUserPreferences();
  const todayKey=preferredTodayKey();
  const [todayYear,todayMonth]=todayKey.split("-").map(Number);
  const [month, setMonth] = useState(() => new Date(todayYear, todayMonth-1, 1));
  const [events, setEvents] = useState(initialCalendarEvents);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [related, setRelated] = useState("");
  const [relatedOptions, setRelatedOptions] = useState<Array<{value:string;label:string;detail:string}>>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [upcomingPage,setUpcomingPage]=useState(1);
  const [upcomingPageSize,setUpcomingPageSize]=useState(10);
  const [toast, setToast] = useState("");
  const [formError, setFormError] = useState("");
  const [reschedule,setReschedule]=useState<{id:string;date:string;time:string}|null>(null);
  const runRelatedSearch=useRemoteSearch();
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  const upcoming = useMemo(
    () => events.filter((event) => event.date >= todayKey && !dismissed.includes(event.id)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
    [dismissed, events, todayKey],
  );
  const upcomingPages=Math.max(1,Math.ceil(upcoming.length/upcomingPageSize));
  const safeUpcomingPage=Math.min(upcomingPage,upcomingPages);
  const visibleUpcoming=upcoming.slice((safeUpcomingPage-1)*upcomingPageSize,safeUpcomingPage*upcomingPageSize);

  useEffect(()=>{if(!persistent)return;const from=new Date(Date.UTC(month.getFullYear(),month.getMonth(),1));const to=new Date(Date.UTC(month.getFullYear(),month.getMonth()+2,1));const controller=new AbortController();void apiFetch<{items:CalendarEvent[]}>(`/api/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,{signal:controller.signal}).then(result=>setEvents(result.items)).catch(()=>{if(!controller.signal.aborted)setFormError(t("calendar.loadFailed"));});return()=>controller.abort();},[month,persistent,t]);

  const searchRelated=useCallback(async(query:string)=>{if(!persistent)return;setRelatedLoading(true);const result=await runRelatedSearch(signal=>apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string;type:string}>}>(`/api/search/related?q=${encodeURIComponent(query)}`,{signal}));if(!result.current)return;setRelatedLoading(false);if("error" in result){setFormError(t("calendar.relatedLoadFailed"));return;}setRelatedOptions(result.value.items.filter(item=>item.type!=="USER").map((item)=>({value:item.value,label:locale==="zh-CN"?item.labelZh:item.labelEn,detail:t(item.type==="ORGANIZATION"?"calendar.relatedOrganization":"calendar.relatedContact")})));},[locale,persistent,runRelatedSearch,t]);

  const openSchedule = (date = selectedDate) => {
    setSelectedDate(date);
    setRelated("");
    setDrawerOpen(true);
  };

  const submitSchedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    const form = new FormData(event.currentTarget);
    const relation = relatedOptions.find((option) => option.value === related)?.label ?? t("calendar.unlinked");
    const reminderValues: Record<string, number> = { [t("calendar.reminder.start")]: 0, [t("calendar.reminder.30m")]: 30, [t("calendar.reminder.2h")]: 120, [t("calendar.reminder.day")]: 1440, [t("calendar.reminder.3d")]: 4320 };
    let id = `local-${Date.now()}`;
    if (persistent) {
      const [relatedType,relatedId]=related.includes(":")?related.split(":"):["",""];
      const attendeeEmails=String(form.get("attendees")??"").split(/[,;\n]/).map(value=>value.trim()).filter(Boolean);const consentConfirmed=form.get("attendeeConsent")==="on";
      try{const result=await apiFetch<{item:{id:string}}>("/api/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: String(form.get("title")), locale, date: String(form.get("date")), time: String(form.get("time")), type: String(form.get("type")), channel: String(form.get("channel")), related: relation, relatedType:relatedType||null,relatedId:relatedId||null, reminder: reminderValues[String(form.get("reminder"))] ?? 1440,attendees:attendeeEmails.map(email=>({email,consentConfirmed})) }) });id=result.item.id;}catch{setFormError(t("calendar.saveFailed"));return;}
    }
    setEvents((current) => [...current, {
      id,
      date: String(form.get("date")),
      time: String(form.get("time")),
      title: String(form.get("title")),
      related: relation,
      type: String(form.get("type")) as CalendarEvent["type"],
      channel: String(form.get("channel")),
      reminder: String(form.get("reminder")),
      deliveryStatus:String(form.get("attendees")??"").trim()?"QUEUED":"NONE",
    }]);
    setDrawerOpen(false);
    setToast(t("calendar.saved"));
  };

  const completeEvent = async (id: string) => {
    if (persistent) { try{await apiFetch(`/api/calendar/${id}`, { method: "PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"COMPLETE"}) });}catch{setToast(t("calendar.completeFailed")); return;} }
    setDismissed((current) => [...current, id]);
  };
  const updateEvent=async(id:string,action:"UPDATE"|"CANCEL",date?:string,time?:string)=>{setFormError("");try{await apiFetch(`/api/calendar/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action,date,time})});}catch{setFormError(t("calendar.deliveryUpdateFailed"));return;}if(action==="CANCEL")setEvents(current=>current.filter(item=>item.id!==id));else setEvents(current=>current.map(item=>item.id===id?{...item,date:date!,time:time!,deliveryStatus:"QUEUED"}:item));setReschedule(null);setToast(t(action==="CANCEL"?"calendar.cancelQueued":"calendar.updateQueued"));};

  return <div className="page-stack calendar-page">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t("calendar.eyebrow")}</p><h1>{t("calendar.title")}</h1><p>{t("calendar.description")}</p></div>
      <div className="page-actions"><button className="secondary-button" type="button" onClick={() => {setMonth(new Date(todayYear,todayMonth-1,1));setSelectedDate(todayKey);}}>{t("calendar.today")}</button><button className="primary-button" type="button" onClick={() => openSchedule()}><Plus size={17} />{t("calendar.new")}</button></div>
    </section>
    <section className="calendar-layout">
      <div className="surface calendar-surface">
        <div className="calendar-toolbar">
          <div><button type="button" aria-label={t("calendar.previousMonth")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} /></button><button type="button" aria-label={t("calendar.nextMonth")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} /></button></div>
          <h2>{monthTitle(month,locale)} — {monthTitle(nextMonth,locale)}</h2>
          <span className="calendar-legend"><i className="meeting" />{t("calendar.meeting")} <i className="consultation" />{t("calendar.consultation")} <i className="followup" />{t("calendar.followup")} <i className="deadline" />{t("calendar.deadline")}</span>
        </div>
        <div className="double-calendar">
          <MonthView month={month} events={events} selectedDate={selectedDate} today={todayKey} onSelect={openSchedule} />
          <MonthView month={nextMonth} events={events} selectedDate={selectedDate} today={todayKey} onSelect={openSchedule} />
        </div>
      </div>
      <aside className="surface reminder-panel">
        <div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.reminders")}</p><h2>{t("calendar.reminders")}</h2></div><span className="count-pill">{upcoming.length}</span></div>
        {visibleUpcoming.map((item) => <article className="reminder-item" key={item.id}>
          <span className={`reminder-type ${item.type}`}><BellRing size={17} /></span>
          <div><b>{locale==="en"&&item.titleEn?item.titleEn:item.title}</b><small><CalendarDays size={13} />{item.date} · {item.time}</small><small><Clock3 size={13} />{item.reminder.startsWith("calendar.")?t(item.reminder):eventValueKeys[item.reminder]?t(eventValueKeys[item.reminder]):item.reminder} · {eventValueKeys[item.channel]?t(eventValueKeys[item.channel]):item.channel}</small><small>{t("calendar.deliveryStatus")}: {t(`calendar.delivery.${(item.deliveryStatus??"NONE").toLowerCase()}`)}</small></div>
          <span className="reminder-actions"><button type="button" aria-label={t("calendar.reschedule")} onClick={()=>setReschedule({id:item.id,date:item.date,time:item.time})}><Pencil size={15}/></button><button type="button" aria-label={t("calendar.cancelEvent")} onClick={()=>void updateEvent(item.id,"CANCEL")}><X size={15}/></button><button type="button" aria-label={t("calendar.complete",{title:locale==="en"&&item.titleEn?item.titleEn:item.title})} onClick={() => completeEvent(item.id)}><Check size={16} /></button></span>
          {reschedule?.id===item.id&&<form className="reschedule-form" onSubmit={event=>{event.preventDefault();void updateEvent(item.id,"UPDATE",reschedule.date,reschedule.time);}}><input type="date" value={reschedule.date} onChange={event=>setReschedule({...reschedule,date:event.target.value})} required/><input type="time" value={reschedule.time} onChange={event=>setReschedule({...reschedule,time:event.target.value})} required/><button className="primary-button">{t("calendar.queueUpdate")}</button></form>}
        </article>)}
        {!upcoming.length && <div className="empty-state"><span>{t("calendar.empty")}</span><p>{t("calendar.emptyHelp")}</p></div>}
        <Pagination page={safeUpcomingPage} totalPages={upcomingPages} total={upcoming.length} pageSize={upcomingPageSize} onPage={setUpcomingPage} onPageSize={(value)=>{setUpcomingPageSize(value);setUpcomingPage(1);}}/>
      </aside>
    </section>

    {drawerOpen && <AccessibleDrawer title={t("calendar.new")} eyebrow={t("eyebrow.newAppointment")} description={t("calendar.formHelp")} onClose={() => setDrawerOpen(false)}>
        <form onSubmit={submitSchedule}>
          <label className="field"><span>{t("calendar.subject")} <b>*</b></span><input name="title" required placeholder={t("calendar.subjectPlaceholder")} /></label>
          <div className="form-grid two-column"><label className="field"><span>{t("calendar.date")} <b>*</b></span><input name="date" type="date" defaultValue={selectedDate} required /></label><label className="field"><span>{t("calendar.time")} <b>*</b></span><input name="time" type="time" defaultValue="10:00" required /></label></div>
          <div className="form-grid two-column"><label className="field"><span>{t("calendar.type")}</span><select name="type" defaultValue="meeting"><option value="meeting">{t("calendar.meeting")}</option><option value="consultation">{t("calendar.consultation")}</option><option value="followup">{t("calendar.followup")}</option><option value="deadline">{t("calendar.deadline")}</option></select></label><label className="field"><span>{t("calendar.channel")}</span><span className="input-icon"><Video size={16} /><input name="channel" defaultValue="Teams" /></span></label></div>
          <SearchableSelect label={t("calendar.related")} options={relatedOptions} value={related} onChange={setRelated} onSearch={searchRelated} loading={relatedLoading} placeholder={t("calendar.relatedPlaceholder")} />
          <label className="field"><span>{t("calendar.attendees")}</span><textarea name="attendees" rows={3} placeholder={t("calendar.attendeesPlaceholder")}/></label>
          <label className="check-row"><input name="attendeeConsent" type="checkbox"/><span>{t("calendar.attendeeConsent")}</span></label>
          <label className="field"><span>{t("calendar.remindAt")}</span><select name="reminder" defaultValue={t("calendar.reminder.day")}><option>{t("calendar.reminder.start")}</option><option>{t("calendar.reminder.30m")}</option><option>{t("calendar.reminder.2h")}</option><option>{t("calendar.reminder.day")}</option><option>{t("calendar.reminder.3d")}</option></select></label>
          <div className="appointment-hints"><span><Users size={16} />{t("calendar.deliveryHelp")}</span><span><MapPin size={16} />{t("calendar.locationHelp")}</span></div>
          {formError && <InlineMessage type="error">{formError}</InlineMessage>}
          <div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setDrawerOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit"><CalendarDays size={17} />{t("calendar.save")}</button></div>
        </form>
    </AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

function MonthView({ month, events, selectedDate, today, onSelect }: { month: Date; events: CalendarEvent[]; selectedDate: string; today:string; onSelect: (date: string) => void }) {
  const { locale, t } = useI18n();
  return <section className="month-view" aria-label={monthTitle(month,locale)}>
    <h3>{monthTitle(month,locale)}</h3>
    <div className="calendar-weekdays">{weekDays[locale].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{monthCells(month).map((cell, index) => {
      if (!cell) return <span className="calendar-blank" key={`blank-${index}`} />;
      const dayEvents = events.filter((event) => event.date === cell.key);
      return <button type="button" className={`calendar-day ${cell.key === today ? "today" : ""} ${cell.key === selectedDate ? "selected" : ""}`} key={cell.key} onClick={() => onSelect(cell.key)} aria-label={t("calendar.eventsCount",{date:cell.key,count:dayEvents.length})}>
        <span>{cell.day}</span>
        <div>{dayEvents.slice(0, 2).map((item) => <i className={item.type} key={item.id}>{item.time} {locale==="en"&&item.titleEn?item.titleEn:item.title}</i>)}{dayEvents.length > 2 && <small>{t("calendar.more",{count:dayEvents.length-2})}</small>}</div>
      </button>;
    })}</div>
  </section>;
}
