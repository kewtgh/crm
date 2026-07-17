"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Building2,
  CalendarClock,
  ChevronRight,
  FileCheck2,
  HandCoins,
  History,
  Landmark,
  Plus,
  RefreshCw,
  Target,
  UserRound,
} from "lucide-react";
import type { Organization360, TimelineEvent } from "@/lib/phase2-repository";
import { apiFetch } from "@/lib/api-client";
import { useI18n } from "./i18n-provider";
import { AccessibleDrawer, InlineMessage, Pagination, ProgressBar, StatusBadge, Toast } from "./ui";
import { useUserPreferences } from "@/components/user-preferences-context";

const eventIcons: Record<string, React.ElementType> = {
  ORGANIZATION: Building2, CONTACT: UserRound, OPPORTUNITY: Target, TASK: FileCheck2,
  ACTIVITY: History, APPOINTMENT: CalendarClock, CONTRACT: Landmark, PAYMENT: HandCoins,
  RELATIONSHIP: UserRound, APPROVAL: FileCheck2,
};
const types = ["CONTACT", "OPPORTUNITY", "TASK", "ACTIVITY", "APPOINTMENT", "CONTRACT", "PAYMENT", "RELATIONSHIP", "APPROVAL"];
const activityKinds = ["CALL", "EMAIL", "MEETING", "VISIT", "MEAL", "NOTE", "CAMPAIGN", "PAYMENT_FOLLOW_UP"];

export function Customer360Page({ initial }: { initial: Organization360 }) {
  const { locale, t } = useI18n();
  const { localDateTimeInput, localDateTimeToIso } = useUserPreferences();
  const [data, setData] = useState(initial);
  const [type, setType] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [activitySaving, setActivitySaving] = useState(false);
  const [toast, setToast] = useState("");

  const load = async (page: number, nextType = type) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (nextType !== "all") params.set("types", nextType);
      const result = await apiFetch<Organization360>(`/api/customer-360/${initial.id}?${params}`);
      if (!result.timeline) throw new Error();
      setData(result);
    } catch {
      setError(t("customer360.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const saveActivity = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActivitySaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/api/customer-360/${initial.id}/activities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityKind: form.get("activityKind"),
          occurredAt: localDateTimeToIso(String(form.get("occurredAt"))),
          summaryZh: form.get("summaryZh"),
          summaryEn: form.get("summaryEn"),
          nextStepZh: form.get("nextStepZh"),
          nextStepEn: form.get("nextStepEn"),
        }),
      });
    } catch {
      setActivitySaving(false);
      setError(t("customer360.activityFailed"));
      return;
    }
    setActivitySaving(false);
    setActivityOpen(false);
    setType("all");
    await load(1, "all");
    setToast(t("customer360.activitySaved"));
  };

  const pages = Math.max(1, Math.ceil(data.timeline.total / data.timeline.pageSize));
  return <div className="page-stack customer-360">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t("customer360.eyebrow")}</p><h1>{initial.nameZh} / {initial.nameEn}</h1><p>{t("customer360.description")}</p></div>
      <div className="page-actions"><Link className="secondary-button" href="/schools">{t("customer360.back")}</Link><button className="primary-button" type="button" onClick={() => setActivityOpen(true)}><Plus size={17}/>{t("customer360.recordActivity")}</button></div>
    </section>
    <section className="quick-summary">
      <span><b>{data.timeline.total}</b><small>{t("customer360.events")}</small></span>
      <span><b>{initial.status}</b><small>{t("common.status")}</small></span>
      <span><b>{initial.city || "—"}</b><small>{t("customer360.city")}</small></span>
      <span><ProgressBar value={initial.completeness} label={`${initial.completeness}%`}/><small>{t("modules.completeness")}</small></span>
    </section>
    <section className="surface timeline-surface">
      <div className="table-toolbar">
        <label className="compact-filter"><span>{t("customer360.filter")}</span><select value={type} onChange={(event) => { const next = event.target.value; setType(next); void load(1, next); }}><option value="all">{t("common.all")}</option>{types.map((item) => <option key={item} value={item}>{t(`timeline.type.${item.toLowerCase()}`)}</option>)}</select></label>
        {loading && <span role="status"><RefreshCw className="spin" size={15}/>{t("common.loading")}</span>}
      </div>
      {error && <InlineMessage type="error">{error}</InlineMessage>}
      <div className="timeline-list">{data.timeline.items.map((item, index) => <TimelineItem item={item} locale={locale} t={t} key={`${item.type}-${item.entityId}-${index}`}/>)}</div>
      {!data.timeline.items.length && !loading && <div className="empty-state"><span>{t("customer360.empty")}</span></div>}
      <Pagination page={data.timeline.page} totalPages={pages} total={data.timeline.total} pageSize={data.timeline.pageSize} onPage={(page) => void load(page)}/>
    </section>
    {activityOpen && <AccessibleDrawer title={t("customer360.recordActivity")} eyebrow="CUSTOMER 360" description={t("customer360.activityHelp")} onClose={() => setActivityOpen(false)}><form onSubmit={saveActivity}><div className="form-grid two-column"><label className="field"><span>{t("customer360.activityKind")}</span><select name="activityKind">{activityKinds.map((kind) => <option key={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label><label className="field"><span>{t("customer360.occurredAt")}</span><input name="occurredAt" type="datetime-local" max={localDateTimeInput()} defaultValue={localDateTimeInput()} required/></label></div><label className="field"><span>{t("customer360.summaryZh")}</span><textarea name="summaryZh" rows={3} minLength={2} maxLength={1000} required/></label><label className="field"><span>{t("customer360.summaryEn")}</span><textarea name="summaryEn" rows={3} minLength={2} maxLength={1000} required/></label><label className="field"><span>{t("customer360.nextStepZh")}</span><textarea name="nextStepZh" rows={2} minLength={2} maxLength={1000} required/></label><label className="field"><span>{t("customer360.nextStepEn")}</span><textarea name="nextStepEn" rows={2} minLength={2} maxLength={1000} required/></label>{error && <InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setActivityOpen(false)}>{t("common.cancel")}</button><button className="primary-button" disabled={activitySaving} type="submit">{activitySaving ? t("common.saving") : t("common.save")}</button></div></form></AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

function TimelineItem({
  item,
  locale,
  t,
}: {
  item: TimelineEvent;
  locale: "zh-CN" | "en";
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const { formatDate } = useUserPreferences();
  const Icon = eventIcons[item.type] ?? History;
  const title = locale === "en" ? item.titleEn || item.titleZh : item.titleZh || item.titleEn;
  const href = typeof item.metadata?.href === "string" ? item.metadata.href : "";
  const amount = typeof item.metadata?.amount === "number"
    ? `${item.metadata.currency ?? ""} ${new Intl.NumberFormat(locale).format(item.metadata.amount)}`
    : "";
  const summaryKey = `timeline.summary.${item.summary.toLowerCase()}`;
  const translatedSummary = t(summaryKey);
  return <article className="timeline-item">
    <span className={`timeline-icon ${item.type.toLowerCase()}`}><Icon size={17}/></span>
    <div><div><StatusBadge tone="blue">{t(`timeline.type.${item.type.toLowerCase()}`)}</StatusBadge><time>{formatDate(item.occurredAt, { includeTime: true })}</time></div><b>{title}</b><p>{translatedSummary === summaryKey ? item.summary : translatedSummary}{amount ? ` · ${amount}` : ""}</p></div>
    {href && <Link href={href} aria-label={t("customer360.openSource", { title })}><ChevronRight size={17}/></Link>}
  </article>;
}
