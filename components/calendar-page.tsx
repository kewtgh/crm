"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  Users,
  Video,
  X,
} from "lucide-react";
import { InlineMessage, SearchableSelect, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";

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
};

const weekDays = { "zh-CN":["周一","周二","周三","周四","周五","周六","周日"], en:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] };
const relatedRecords = [
  { value:"tes", zh:"台北欧洲学校", en:"Taipei European School", detailZh:"学校", detailEn:"School" },
  { value:"theo", zh:"吴天乐 / Theo Wu", en:"吴天乐 / Theo Wu", detailZh:"学生 · A2", detailEn:"Student · A2" },
  { value:"zhao", zh:"赵氏家庭", en:"Zhao Household", detailZh:"家庭 · 待验证", detailEn:"Household · Pending verification" },
  { value:"wellington", zh:"上海惠灵顿", en:"Wellington College Shanghai", detailZh:"学校 · 续约机会", detailEn:"School · Renewal opportunity" },
  { value:"rachel", zh:"王若晴 / Rachel Wang", en:"王若晴 / Rachel Wang", detailZh:"联系人 · 升学指导主任", detailEn:"Contact · Admissions director" },
];

const initialEvents: CalendarEvent[] = [
  { id: "e1", date: "2026-07-16", time: "10:30", title: "台北欧洲学校续约回访", titleEn:"Taipei European School renewal follow-up", related: "台北欧洲学校", type: "followup", channel: "Teams", reminder: "提前 30 分钟" },
  { id: "e2", date: "2026-07-16", time: "15:00", title: "Theo UCAS 材料确认", titleEn:"Confirm Theo's UCAS materials", related: "吴天乐 / Theo Wu", type: "deadline", channel: "办公室", reminder: "提前 2 小时" },
  { id: "e3", date: "2026-07-18", time: "09:30", title: "赵氏家庭首次咨询", titleEn:"First consultation with Zhao Household", related: "赵氏家庭", type: "consultation", channel: "Zoom", reminder: "提前 1 天" },
  { id: "e4", date: "2026-07-21", time: "14:00", title: "上海惠灵顿合作方案评审", titleEn:"Wellington partnership proposal review", related: "上海惠灵顿", type: "meeting", channel: "会议室 A", reminder: "提前 1 天" },
  { id: "e5", date: "2026-07-27", time: "11:00", title: "Q3 销售目标中期检查", titleEn:"Q3 sales target midpoint review", related: "销售团队", type: "meeting", channel: "Teams", reminder: "提前 2 小时" },
  { id: "e6", date: "2026-08-03", time: "16:30", title: "曼谷国际学校意向跟进", titleEn:"Bangkok International School lead follow-up", related: "曼谷国际学校", type: "followup", channel: "电话", reminder: "提前 30 分钟" },
  { id: "e7", date: "2026-08-15", time: "09:00", title: "学生升年级批次生效", titleEn:"Student progression batch takes effect", related: "148 名候选学生", type: "deadline", channel: "系统任务", reminder: "提前 3 天" },
  { id: "e8", date: "2026-07-23", time: "11:30", title: "苏州新加坡学校续约风险复核", titleEn:"Suzhou Singapore School renewal risk review", related: "苏州新加坡学校", type: "followup", channel: "Teams", reminder: "提前 1 天" },
  { id: "e9", date: "2026-08-03", time: "10:00", title: "台北欧洲学校合同到期", titleEn:"Taipei European School contract expiry", related: "台北欧洲学校", type: "deadline", channel: "合同节点", reminder: "提前 3 天" },
];

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

export function CalendarPage() {
  const { locale, t } = useI18n();
  const relatedOptions = relatedRecords.map(item=>({value:item.value,label:locale==="zh-CN"?item.zh:item.en,detail:locale==="zh-CN"?item.detailZh:item.detailEn}));
  const [month, setMonth] = useState(() => new Date(2026, 6, 1));
  const [events, setEvents] = useState(initialEvents);
  const [selectedDate, setSelectedDate] = useState("2026-07-16");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [related, setRelated] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  const upcoming = useMemo(
    () => events.filter((event) => event.date >= "2026-07-16" && !dismissed.includes(event.id)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 5),
    [dismissed, events],
  );

  useEffect(() => {
    if (!drawerOpen) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);

  const openSchedule = (date = selectedDate) => {
    setSelectedDate(date);
    setRelated("");
    setDrawerOpen(true);
  };

  const submitSchedule = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const relation = relatedOptions.find((option) => option.value === related)?.label ?? t("calendar.unlinked");
    setEvents((current) => [...current, {
      id: `local-${Date.now()}`,
      date: String(form.get("date")),
      time: String(form.get("time")),
      title: String(form.get("title")),
      related: relation,
      type: String(form.get("type")) as CalendarEvent["type"],
      channel: String(form.get("channel")),
      reminder: String(form.get("reminder")),
    }]);
    setDrawerOpen(false);
    setToast(t("calendar.savedPrototype"));
  };

  return <div className="page-stack calendar-page">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t("calendar.eyebrow")}</p><h1>{t("calendar.title")}</h1><p>{t("calendar.description")}</p></div>
      <div className="page-actions"><button className="secondary-button" type="button" onClick={() => setMonth(new Date(2026, 6, 1))}>{t("calendar.today")}</button><button className="primary-button" type="button" onClick={() => openSchedule()}><Plus size={17} />{t("calendar.new")}</button></div>
    </section>
    <InlineMessage type="warning">{t("calendar.prototypeWarning")}</InlineMessage>
    <section className="calendar-layout">
      <div className="surface calendar-surface">
        <div className="calendar-toolbar">
          <div><button type="button" aria-label={t("calendar.previousMonth")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} /></button><button type="button" aria-label={t("calendar.nextMonth")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} /></button></div>
          <h2>{monthTitle(month,locale)} — {monthTitle(nextMonth,locale)}</h2>
          <span className="calendar-legend"><i className="meeting" />{t("calendar.meeting")} <i className="consultation" />{t("calendar.consultation")} <i className="followup" />{t("calendar.followup")} <i className="deadline" />{t("calendar.deadline")}</span>
        </div>
        <div className="double-calendar">
          <MonthView month={month} events={events} selectedDate={selectedDate} onSelect={openSchedule} />
          <MonthView month={nextMonth} events={events} selectedDate={selectedDate} onSelect={openSchedule} />
        </div>
      </div>
      <aside className="surface reminder-panel">
        <div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.reminders")}</p><h2>{t("calendar.reminders")}</h2></div><span className="count-pill">{upcoming.length}</span></div>
        {upcoming.map((item) => <article className="reminder-item" key={item.id}>
          <span className={`reminder-type ${item.type}`}><BellRing size={17} /></span>
          <div><b>{locale==="en"&&item.titleEn?item.titleEn:item.title}</b><small><CalendarDays size={13} />{item.date} · {item.time}</small><small><Clock3 size={13} />{eventValueKeys[item.reminder]?t(eventValueKeys[item.reminder]):item.reminder} · {eventValueKeys[item.channel]?t(eventValueKeys[item.channel]):item.channel}</small></div>
          <button type="button" aria-label={t("calendar.complete",{title:locale==="en"&&item.titleEn?item.titleEn:item.title})} onClick={() => setDismissed((current) => [...current, item.id])}><Check size={16} /></button>
        </article>)}
        {!upcoming.length && <div className="empty-state"><span>{t("calendar.empty")}</span><p>{t("calendar.emptyHelp")}</p></div>}
      </aside>
    </section>

    {drawerOpen && <>
      <button className="drawer-overlay" type="button" aria-label={t("calendar.closeForm")} onClick={() => setDrawerOpen(false)} />
      <aside className="record-drawer" role="dialog" aria-modal="true" aria-label={t("calendar.new")}>
        <div className="drawer-heading"><div><p className="eyebrow">{t("eyebrow.newAppointment")}</p><h2>{t("calendar.new")}</h2><p>{t("calendar.formHelp")}</p></div><button ref={closeButtonRef} className="icon-button" type="button" aria-label={t("common.close")} onClick={() => setDrawerOpen(false)}><X size={20} /></button></div>
        <form onSubmit={submitSchedule}>
          <label className="field"><span>{t("calendar.subject")} <b>*</b></span><input name="title" required placeholder={t("calendar.subjectPlaceholder")} /></label>
          <div className="form-grid two-column"><label className="field"><span>{t("calendar.date")} <b>*</b></span><input name="date" type="date" defaultValue={selectedDate} required /></label><label className="field"><span>{t("calendar.time")} <b>*</b></span><input name="time" type="time" defaultValue="10:00" required /></label></div>
          <div className="form-grid two-column"><label className="field"><span>{t("calendar.type")}</span><select name="type" defaultValue="meeting"><option value="meeting">{t("calendar.meeting")}</option><option value="consultation">{t("calendar.consultation")}</option><option value="followup">{t("calendar.followup")}</option><option value="deadline">{t("calendar.deadline")}</option></select></label><label className="field"><span>{t("calendar.channel")}</span><span className="input-icon"><Video size={16} /><input name="channel" defaultValue="Teams" /></span></label></div>
          <SearchableSelect label={t("calendar.related")} options={relatedOptions} value={related} onChange={setRelated} placeholder={t("calendar.relatedPlaceholder")} />
          <label className="field"><span>{t("calendar.remindAt")}</span><select name="reminder" defaultValue={t("calendar.reminder.day")}><option>{t("calendar.reminder.start")}</option><option>{t("calendar.reminder.30m")}</option><option>{t("calendar.reminder.2h")}</option><option>{t("calendar.reminder.day")}</option><option>{t("calendar.reminder.3d")}</option></select></label>
          <div className="appointment-hints"><span><Users size={16} />{t("calendar.inviteHelp")}</span><span><MapPin size={16} />{t("calendar.locationHelp")}</span></div>
          <div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setDrawerOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit"><CalendarDays size={17} />{t("calendar.save")}</button></div>
        </form>
      </aside>
    </>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

function MonthView({ month, events, selectedDate, onSelect }: { month: Date; events: CalendarEvent[]; selectedDate: string; onSelect: (date: string) => void }) {
  const { locale, t } = useI18n();
  return <section className="month-view" aria-label={monthTitle(month,locale)}>
    <h3>{monthTitle(month,locale)}</h3>
    <div className="calendar-weekdays">{weekDays[locale].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid">{monthCells(month).map((cell, index) => {
      if (!cell) return <span className="calendar-blank" key={`blank-${index}`} />;
      const dayEvents = events.filter((event) => event.date === cell.key);
      return <button type="button" className={`calendar-day ${cell.key === "2026-07-16" ? "today" : ""} ${cell.key === selectedDate ? "selected" : ""}`} key={cell.key} onClick={() => onSelect(cell.key)} aria-label={t("calendar.eventsCount",{date:cell.key,count:dayEvents.length})}>
        <span>{cell.day}</span>
        <div>{dayEvents.slice(0, 2).map((item) => <i className={item.type} key={item.id}>{item.time} {locale==="en"&&item.titleEn?item.titleEn:item.title}</i>)}{dayEvents.length > 2 && <small>{t("calendar.more",{count:dayEvents.length-2})}</small>}</div>
      </button>;
    })}</div>
  </section>;
}
