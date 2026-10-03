"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import type { EnrollmentRecord, EnrollmentAttribution, EnrollmentHistory } from "@/lib/enrollment-repository";
import { attributionSaveSchema, attributionSources, type AttributionData } from "@/lib/enrollment-input";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { AccessibleDrawer, InlineMessage, StatusBadge } from "./ui";
import {ContractEnrollmentSection} from "./contract-enrollment-section";
import Link from "next/link";
import {EnrollmentFinanceCard} from "./enrollment-finance-card";
import { DetailTabs } from "./detail-tabs";
import { EnrollmentRelation, type EnrollmentRelationType } from "./enrollment-relation";

export function EnrollmentDetail({record, onClose, onEdit, onRefresh}: {record: EnrollmentRecord; onClose: () => void; onEdit: () => void; onRefresh: () => Promise<void>}) {
  const {t, locale} = useI18n(), {formatDate} = useUserPreferences();
  const [tab, setTab] = useState("overview"), [page, setPage] = useState(1), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [history, setHistory] = useState<EnrollmentHistory[]>([]), [sources, setSources] = useState<EnrollmentAttribution[]>([]);
  const [adding, setAdding] = useState<"PRIMARY" | "ASSIST" | null>(null), [locked, setLocked] = useState(false), [notice, setNotice] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    if (tab === "overview") return;
    setLoading(true); setError("");
    try {
      if (tab === "history") {const result = await apiFetch<{items: EnrollmentHistory[]}>(`/api/enrollments?resource=history&id=${record.id}&page=${page}`, {signal}); if (!signal?.aborted) setHistory(result.items);}
      else {const result = await apiFetch<{items: EnrollmentAttribution[]}>(`/api/enrollments?resource=attributions&id=${record.id}&page=${page}`, {signal}); if (!signal?.aborted) setSources(result.items);}
    } catch (error) {if (!signal?.aborted) {setError(presentApiError(error, t, "enrollments.loadFailed").message); throw error;}}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [record.id, tab, page, t]);
  useEffect(() => {const controller = new AbortController(); const timer = setTimeout(() => void load(controller.signal).catch(() => {}), 0); return () => {clearTimeout(timer); controller.abort();};}, [load]);
  const saved = async () => {
    setAdding(null); setNotice(t("enrollments.attributionSaved"));
    try {await onRefresh(); await load();} catch {setNotice(t("enrollments.savedRefreshFailed"));}
  };
  const label = (zh: string | null | undefined, en: string | null | undefined) => (locale === "en" ? en : zh) || zh || en || "—";
  return <AccessibleDrawer pending={locked} title={label(record.student_name_zh, record.student_name_en)} description={label(record.cohort_name_zh, record.cohort_name_en)} onClose={onClose}>
    <DetailTabs label={t("enrollments.title")} active={tab} disabled={locked} onChange={value => {setTab(value); setPage(1); setAdding(null);}} items={[{key:"overview",label:"enrollments.overview"},{key:"attribution",label:"enrollments.attribution"},{key:"history",label:"enrollments.history"}]}>
      {notice && <InlineMessage type="success">{notice}</InlineMessage>}
      {tab === "overview" && <section className="detail-section"><dl className="enrollment-summary">
        <div><dt>{t("enrollments.student")}</dt><dd>{label(record.student_name_zh, record.student_name_en)}</dd></div>
        <div><dt>{t("products.product")}</dt><dd>{label(record.product_name_zh, record.product_name_en)}</dd></div>
        <div><dt>{t("enrollments.cohort")}</dt><dd>{label(record.cohort_name_zh, record.cohort_name_en)}</dd></div>
        <div><dt>{t("common.status")}</dt><dd><EnrollmentStatus status={record.status}/></dd></div>
        <div><dt>{t("enrollments.owner")}</dt><dd>{label(record.owner_name_zh, record.owner_name_en)}</dd></div>
        <div><dt>{t("enrollments.salesOwner")}</dt><dd>{label(record.sales_owner_name_zh, record.sales_owner_name_en)}</dd></div>
        <div><dt>{t("enrollments.household")}</dt><dd>{label(record.household_name_zh, record.household_name_en)}</dd></div>
        <div><dt>{t("enrollments.opportunity")}</dt><dd>{record.opportunity_id?<Link href={`/opportunities?focus=${record.opportunity_id}`}>{label(record.opportunity_title_zh,record.opportunity_title_en)}</Link>:"—"}</dd></div>
        {(["enrolled_at", "completed_at", "withdrawn_at"] as const).map(key => <div key={key}><dt>{t(`enrollments.${key}`)}</dt><dd>{record[key] ? formatDate(record[key], {includeTime:true}) : "—"}</dd></div>)}
        <div><dt>{t("enrollments.withdrawalReason")}</dt><dd>{record.withdrawal_reason || "—"}</dd></div>
        <div><dt>{t("enrollments.updatedAt")}</dt><dd>{formatDate(record.updated_at, {includeTime:true})}</dd></div>
      </dl><ContractEnrollmentSection enrollmentId={record.id}/><EnrollmentFinanceCard enrollmentId={record.id}/>{record.can_edit && <button className="primary-button" type="button" onClick={onEdit}>{t("enrollments.edit")}</button>}</section>}
      {tab !== "overview" && <>
        {error && <InlineMessage type="error">{error}<button className="secondary-button" type="button" onClick={() => void load().catch(() => {})}>{t("common.retry")}</button></InlineMessage>}
        {loading && <p role="status">{t("common.loading")}</p>}
        {tab === "attribution" && <section className="detail-section">
          {record.can_edit && !adding && <div className="detail-actions"><button className="secondary-button" type="button" disabled={record.has_primary_attribution} onClick={() => setAdding("PRIMARY")}>{t("enrollments.addPrimary")}</button><button className="secondary-button" type="button" onClick={() => setAdding("ASSIST")}>{t("enrollments.addAssist")}</button></div>}
          {adding && <AttributionForm key={adding} record={record} type={adding} onLocked={setLocked} onClose={() => setAdding(null)} onSaved={saved}/>}
          {!loading && !error && !sources.length && <p className="detail-empty">{t("enrollments.noAttribution")}</p>}
          <div className="detail-record-list">{!error && sources.map(source => <article key={source.id}><div><b>{t(`enrollments.type.${source.attribution_type}`)}</b><ul className="enrollment-source-list">
            {source.source_organization_id && <li>{t("enrollments.source_organization_id")}: {label(source.organization_name_zh, source.organization_name_en)}</li>}
            {source.source_contact_id && <li>{t("enrollments.source_contact_id")}: {label(source.contact_name_zh, source.contact_name_en)}</li>}
            {source.source_event_id && <li>{t("enrollments.source_event_id")}: {source.event_name}</li>}
            {source.source_campaign_id && <li>{t("enrollments.source_campaign_id")}: {label(source.campaign_name_zh, source.campaign_name_en)}</li>}
            {source.source_referral_id && <li>{t("enrollments.source_referral_id")}: {label(source.referral_organization_name_zh,source.referral_organization_name_en)} → {label(source.referral_household_name_zh,source.referral_household_name_en)} · {source.referral_on ? formatDate(source.referral_on) : "—"}</li>}
          </ul>{source.note && <p>{source.note}</p>}<small>{formatDate(source.created_at, {includeTime:true})}</small></div></article>)}</div>
        </section>}
        {tab === "history" && <section className="detail-section"><p className="field-help">{t("enrollments.historyHelp")}</p><div className="detail-record-list">{!error && history.map(item => <article key={item.id}><div><b>{item.from_status ? t(`enrollments.status.${item.from_status}`) : t("enrollments.created")} → {t(`enrollments.status.${item.to_status}`)}</b><small>{formatDate(item.changed_at, {includeTime:true})} · {t("enrollments.revision", {revision:item.enrollment_revision})}</small>{item.reason && <p>{item.reason}</p>}</div></article>)}</div>{!loading && !error && !history.length && <p className="detail-empty">{t("enrollments.noHistory")}</p>}</section>}
        <div className="detail-actions"><button className="secondary-button" type="button" disabled={loading || locked || page === 1} onClick={() => setPage(value => value - 1)}>{t("cohorts.previous")}</button><span>{page}</span><button className="secondary-button" type="button" disabled={loading || locked || (tab === "history" ? history : sources).length < 50} onClick={() => setPage(value => value + 1)}>{t("cohorts.next")}</button></div>
      </>}
    </DetailTabs>
  </AccessibleDrawer>;
}
export function EnrollmentStatus({status}: {status: EnrollmentRecord["status"]}) {
  const {t} = useI18n(); return <StatusBadge tone={status === "ACTIVE" || status === "COMPLETED" ? "green" : status === "WITHDRAWN" || status === "CANCELLED" ? "gray" : "blue"}>{t(`enrollments.status.${status}`)}</StatusBadge>;
}
function AttributionForm({record, type, onClose, onSaved, onLocked}: {record: EnrollmentRecord; type: "PRIMARY" | "ASSIST"; onClose: () => void; onSaved: () => Promise<void>; onLocked: (value: boolean) => void}) {
  const {t} = useI18n(), [id] = useState(() => crypto.randomUUID());
  const [data, setData] = useState<AttributionData>({enrollment_id:record.id,attribution_type:type,source_organization_id:null,source_contact_id:null,source_event_id:null,source_campaign_id:null,source_referral_id:null,note:""});
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const attempt = useRef<ReturnType<typeof attributionSaveSchema.parse> | null>(null), busy = useRef(false);
  const relationTypes: Record<typeof attributionSources[number], EnrollmentRelationType> = {source_organization_id:"ORGANIZATION",source_contact_id:"CONTACT",source_event_id:"EVENT",source_campaign_id:"CAMPAIGN",source_referral_id:"REFERRAL"};
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy.current) return;
    if (!attempt.current) {const parsed = attributionSaveSchema.safeParse({id,requestKey:crypto.randomUUID(),data}); if (!parsed.success) {setError(t("enrollments.sourceRequired")); return;} attempt.current = parsed.data;}
    busy.current = true; setPending(true); onLocked(true); setError("");
    try {await apiFetch("/api/enrollments", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"attribution",input:attempt.current})});}
    catch (error) {const unknown = !(error instanceof ApiClientError) || error.status === 0 || error.status >= 500; setUncertain(unknown); if (!unknown) attempt.current = null; setError(presentApiError(error,t,"enrollments.saveFailed").message); busy.current = false; setPending(false); onLocked(unknown); return;}
    attempt.current = null; setUncertain(false); onLocked(false); await onSaved(); busy.current = false; setPending(false);
  };
  return <form onSubmit={submit} aria-label={t(type === "PRIMARY" ? "enrollments.addPrimary" : "enrollments.addAssist")}><fieldset className="follow-up-fields" disabled={pending || uncertain}>
    {attributionSources.map(key => <EnrollmentRelation key={key} type={relationTypes[key]} label={t(`enrollments.${key}`)} value={data[key] ?? ""} onChange={value => setData(current => ({...current,[key]:value || null}))}/>)}
    <label className="field"><span>{t("enrollments.note")}</span><textarea name="note" rows={3} maxLength={1000} value={data.note} onChange={event => setData(current => ({...current,note:event.target.value}))}/></label>
  </fieldset>{error && <InlineMessage type="error">{error}</InlineMessage>}{uncertain && <InlineMessage type="warning">{t("enrollments.uncertain")}</InlineMessage>}
    <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending || uncertain} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{t(pending ? "common.saving" : uncertain ? "enrollments.retry" : "common.save")}</button></div>
  </form>;
}
