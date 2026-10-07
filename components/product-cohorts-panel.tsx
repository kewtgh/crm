"use client";
import {RecordDeleteAction} from "./record-delete-action";
import {CohortParticipants} from "./cohort-participants";

import {CohortEnrollmentSnapshot} from "./cohort-enrollment-snapshot";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import type { ProductRecord } from "@/lib/product-repository";
import type { ProductCohort } from "@/lib/cohort-repository";
import { cohortIntakes, cohortStatuses, saveCohortSchema } from "@/lib/cohort-input";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { DateInput, CurrencySelect, BilingualNameHint } from "./structured-inputs";
import { InlineMessage, StatusBadge } from "./ui";

export function ProductCohortsPanel({product, canManage, onPendingChange}: {
  product: ProductRecord; canManage: boolean; onPendingChange?: (pending: boolean) => void;
}) {
  const {t, locale} = useI18n(); const {formatDate} = useUserPreferences();
  const [items, setItems] = useState<ProductCohort[]>([]), [page, setPage] = useState(1);
  const [status, setStatus] = useState(""), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState<{id: string; row?: ProductCohort} | null>(null);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const attempt = useRef<ReturnType<typeof saveCohortSchema.parse> | null>(null);
  const busy = useRef(false), generation = useRef(0);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const token = ++generation.current;
    setLoading(true); setLoadError("");
    try {
      const params = new URLSearchParams({productId: product.id, page: String(page)});
      if (status) params.set("status", status);
      const result = await apiFetch<{items: ProductCohort[]}>(`/api/product-cohorts?${params}`, {signal});
      if (!signal?.aborted && token === generation.current) setItems(result.items);
    } catch (error) {
      if (signal?.aborted) return;
      if (token === generation.current) setLoadError(presentApiError(error, t, "cohorts.loadFailed").message);
      throw error;
    } finally { if (!signal?.aborted && token === generation.current) setLoading(false); }
  }, [product.id, page, status, t]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void reload(controller.signal).catch(() => {}), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [reload]);
  const open = (row?: ProductCohort) => {
    attempt.current = null; setEditor({id: row?.id ?? crypto.randomUUID(), row});
    setError(""); setNotice(""); setUncertain(false);
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editor || busy.current) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "");
    const date = (key: string) => text(key) || null;
    const count = (key: string) => text(key) === "" ? null : Number(text(key));
    if (!attempt.current) {
      const parsed = saveCohortSchema.safeParse({id: editor.id, expectedRevision: editor.row?.revision ?? null,
        requestKey: crypto.randomUUID(), data: {
          productId: product.id, code: text("code"), nameZh: text("nameZh"), nameEn: text("nameEn"),
          intakeType: text("intakeType"), academicYear: text("academicYear"), applicationOpenOn: date("applicationOpenOn"),
          applicationDeadline: date("applicationDeadline"), startOn: date("startOn"), endOn: date("endOn"),
          targetEnrollment: count("targetEnrollment"), capacity: count("capacity"), status: text("status"),
          defaultCurrency: text("defaultCurrency"), ownerId: editor.row?.ownerId ?? null,
        }});
      if (!parsed.success) { setError(t("cohorts.invalid")); return; }
      attempt.current = parsed.data;
    }
    busy.current = true; setPending(true); onPendingChange?.(true); setError("");
    let unresolved = false;
    try {
      const {item} = await apiFetch<{item: ProductCohort}>("/api/product-cohorts", {
        method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(attempt.current),
      });
      setItems(current => current.map(row => row.id === item.id ? item : row));
      setEditor(null); attempt.current = null; setUncertain(false); setNotice(t("cohorts.saved"));
      try { await reload(); } catch { setNotice(t("cohorts.savedRefreshFailed")); }
    } catch (error) {
      const unknown = !(error instanceof ApiClientError) || error.status === 0 || error.status >= 500;
      unresolved = unknown;
      setUncertain(unknown);
      if (!unknown) attempt.current = null;
      setError(presentApiError(error, t, "cohorts.saveFailed").message);
    } finally { busy.current = false; setPending(false); onPendingChange?.(unresolved); }
  };
  const displayDate = (value: string | null) => value ? formatDate(value, {dateOnly: true}) : "—";
  return <section className="detail-section">
    <div className="surface-heading"><h3>{t("cohorts.title")}</h3>{canManage && !editor && <button className="secondary-button" type="button" onClick={() => open()}><Plus size={16}/>{t("cohorts.create")}</button>}</div>
    {notice && <InlineMessage type="success">{notice}</InlineMessage>}
    {editor && <form key={editor.id} onSubmit={submit} aria-label={t(editor.row ? "cohorts.edit" : "cohorts.create")}>
      <h3>{t(editor.row ? "cohorts.edit" : "cohorts.create")}</h3>
      <fieldset disabled={pending || uncertain} className="cohort-fieldset">
        <div className="form-grid two-column">
          <label className="field"><span>{t("products.nameZh")}</span><input name="nameZh" defaultValue={editor.row?.nameZh} maxLength={120}/></label>
          <label className="field"><span>{t("products.nameEn")}</span><input name="nameEn" defaultValue={editor.row?.nameEn} maxLength={120}/></label><BilingualNameHint/>
          <label className="field"><span>{t("products.code")}</span><input name="code" defaultValue={editor.row?.code} pattern={"[A-Za-z0-9\\-]{2,40}"} maxLength={40} required/></label>
          <label className="field"><span>{t("cohorts.intake")}</span><select name="intakeType" defaultValue={editor.row?.intakeType ?? "CUSTOM"}>{cohortIntakes.map(value => <option key={value} value={value}>{t(`cohorts.intake.${value}`)}</option>)}</select></label>
          <label className="field"><span>{t("cohorts.academicYear")}</span><input name="academicYear" defaultValue={editor.row?.academicYear} maxLength={40}/></label>
          <label className="field"><span>{t("common.status")}</span><select name="status" defaultValue={editor.row?.status ?? "DRAFT"}>{cohortStatuses.map(value => <option key={value} value={value}>{t(`cohorts.status.${value}`)}</option>)}</select></label>
          {(["applicationOpenOn", "applicationDeadline", "startOn", "endOn"] as const).map(key => <label className="field" key={key}><span>{t(`cohorts.${key}`)}</span><DateInput name={key} type="date" defaultValue={editor.row?.[key] ?? ""}/></label>)}
          {(["targetEnrollment", "capacity"] as const).map(key => <label className="field" key={key}><span>{t(`cohorts.${key}`)}</span><input name={key} type="number" min={0} max={2147483647} step={1} defaultValue={editor.row?.[key] ?? ""}/></label>)}
          <label className="field"><span>{t("products.currency")}</span><CurrencySelect name="defaultCurrency" defaultValue={editor.row?.defaultCurrency ?? product.currency} required/></label>
        </div>
      </fieldset>
      {error && <InlineMessage type="error">{error}</InlineMessage>}
      {uncertain && <InlineMessage type="warning">{t("cohorts.uncertain")}</InlineMessage>}
      <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending || uncertain} onClick={() => {setEditor(null); attempt.current = null; void reload().catch(() => {});}}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>{t(pending ? "common.processing" : uncertain ? "cohorts.retry" : "common.save")}</button></div>
    </form>}
    {!editor && <>
      <label className="field"><span>{t("common.status")}</span><select value={status} onChange={event => {setStatus(event.target.value); setPage(1);}}><option value="">{t("common.all")}</option>{cohortStatuses.map(value => <option key={value} value={value}>{t(`cohorts.status.${value}`)}</option>)}</select></label>
      {loadError && <InlineMessage type="error">{loadError}<button type="button" className="secondary-button" onClick={() => void reload().catch(() => {})}>{t("common.retry")}</button></InlineMessage>}
      {loading ? <p role="status">{t("common.loading")}</p> : !loadError && !items.length ? <p className="detail-empty">{t("cohorts.empty")}</p> : !loadError && <div className="detail-record-list">{items.map(row => <article key={row.id} className="cohort-record"><div><b>{locale === "en" ? row.nameEn : row.nameZh}</b><small>{row.code} · {t(`cohorts.intake.${row.intakeType}`)}</small><dl className="cohort-dates"><div><dt>{t("cohorts.applicationDeadline")}</dt><dd>{displayDate(row.applicationDeadline)}</dd></div><div><dt>{t("cohorts.startOn")}</dt><dd>{displayDate(row.startOn)}</dd></div><div><dt>{t("cohorts.targetEnrollment")}</dt><dd>{row.targetEnrollment ?? "—"}</dd></div><div><dt>{t("cohorts.capacity")}</dt><dd>{row.capacity ?? "—"}</dd></div></dl><CohortEnrollmentSnapshot cohortId={row.id}/><CohortParticipants cohortId={row.id} cohortLabel={locale==="en"?row.nameEn:row.nameZh}/></div><div><StatusBadge tone={row.status === "RECRUITING" || row.status === "ACTIVE" ? "green" : row.status === "CANCELLED" ? "gray" : "blue"}>{t(`cohorts.status.${row.status}`)}</StatusBadge>{canManage&&<RecordDeleteAction kind="COHORT" id={row.id} onDeleted={()=>reload()}/>} {canManage && <button className="secondary-button" type="button" aria-label={t("cohorts.editNamed", {name: locale === "en" ? row.nameEn : row.nameZh})} onClick={() => open(row)}><Pencil size={15}/>{t("common.edit")}</button>}</div></article>)}</div>}
      <div className="drawer-actions"><button type="button" className="secondary-button" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>{t("cohorts.previous")}</button><span>{page}</span><button type="button" className="secondary-button" disabled={loading || items.length < 50} onClick={() => setPage(value => value + 1)}>{t("cohorts.next")}</button></div>
    </>}
  </section>;
}
