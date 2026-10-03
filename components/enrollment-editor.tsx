"use client";
import { useRef, useState } from "react";
import type { EnrollmentData } from "@/lib/enrollment-input";
import { enrollmentStatuses, enrollmentSaveSchema, enrollmentTimestamp } from "@/lib/enrollment-input";
import type { EnrollmentRecord } from "@/lib/enrollment-repository";
import type { StudentDetail } from "@/lib/v200-repository";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { useRemoteSearch } from "@/hooks/use-remote-search";
import { useAppUser } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { DateInput } from "./structured-inputs";
import { AccessibleDrawer, InlineMessage } from "./ui";
import { EnrollmentRelation } from "./enrollment-relation";

export function EnrollmentEditor({record, studentId = "", onClose, onSaved}: {
  record?: EnrollmentRecord; studentId?: string; onClose: () => void; onSaved: (id: string) => Promise<void>;
}) {
  const {t, locale} = useI18n(), user = useAppUser(), preferences = useUserPreferences(), prefill = useRemoteSearch();
  const [id] = useState(() => record?.id ?? crypto.randomUUID());
  const [data, setData] = useState<EnrollmentData>(() => ({student_id: record?.student_id ?? studentId, cohort_id: record?.cohort_id ?? "",
    household_id: record?.household_id ?? null, opportunity_id: record?.opportunity_id ?? null, status: record?.status ?? "LEAD",
    owner_id: record?.owner_id ?? user.id, sales_owner_id: record?.sales_owner_id ?? null, enrolled_at: record?.enrolled_at ?? null,
    completed_at: record?.completed_at ?? null, withdrawn_at: record?.withdrawn_at ?? null, withdrawal_reason: record?.withdrawal_reason ?? ""}));
  const [statusReason, setStatusReason] = useState(""), [householdLabel, setHouseholdLabel] = useState(locale === "en" ? record?.household_name_en : record?.household_name_zh);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const attempt = useRef<ReturnType<typeof enrollmentSaveSchema.parse> | null>(null), busy = useRef(false);
  const change = <K extends keyof EnrollmentData>(key: K, value: EnrollmentData[K]) => setData(current => ({...current, [key]: value}));
  const selectStudent = async (value: string) => {
    setData(current => ({...current, student_id: value, household_id: null})); setHouseholdLabel(null);
    const outcome = await prefill(signal => apiFetch<{item: StudentDetail}>(`/api/education?resource=studentDetail&id=${value}`, {signal}));
    if (!outcome.current) return;
    if ("error" in outcome) {setError(t("enrollments.prefillFailed")); return;}
    setData(current => current.student_id === value ? {...current, household_id: outcome.value.item.householdId || null} : current);
    setHouseholdLabel(locale === "en" ? outcome.value.item.householdEn : outcome.value.item.householdZh);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy.current) return;
    if (!attempt.current) {
      const parsed = enrollmentSaveSchema.safeParse({id, expectedRevision: record?.revision ?? null, requestKey: crypto.randomUUID(), statusReason, data});
      if (!parsed.success) {setError(t("enrollments.invalid")); return;}
      attempt.current = parsed.data;
    }
    busy.current = true; setPending(true); setError("");
    try {
      await apiFetch("/api/enrollments", {method: record ? "PATCH" : "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(attempt.current)});
      attempt.current = null; setUncertain(false);
    } catch (error) {
      const unknown = !(error instanceof ApiClientError) || error.status === 0 || error.status >= 500;
      setUncertain(unknown); if (!unknown) attempt.current = null;
      setError(presentApiError(error, t, "enrollments.saveFailed").message);
      busy.current = false; setPending(false); return;
    }
    // A committed save remains successful even if a subsequent detail/list fetch fails.
    await onSaved(id);
    busy.current = false; setPending(false);
  };
  return <AccessibleDrawer pending={pending || uncertain} title={t(record ? "enrollments.edit" : "enrollments.create")} description={t("enrollments.identityHelp")} onClose={onClose}>
    <form onSubmit={submit}>
      <fieldset className="follow-up-fields" disabled={pending || uncertain}>
        {record ? <div className="form-grid two-column"><label className="field"><span>{t("enrollments.student")}</span><input readOnly value={locale === "en" ? record.student_name_en : record.student_name_zh}/></label><label className="field"><span>{t("enrollments.cohort")}</span><input readOnly value={locale === "en" ? record.cohort_name_en : record.cohort_name_zh}/></label></div> : <>
          <EnrollmentRelation type="STUDENT" label={t("enrollments.student")} value={data.student_id} required onChange={value => void selectStudent(value)}/>
          <EnrollmentRelation type="COHORT" label={t("enrollments.cohort")} value={data.cohort_id} required onChange={value => change("cohort_id", value)}/><p className="field-help">{t("enrollments.cohortRule")}</p>
        </>}
        <EnrollmentRelation type="HOUSEHOLD" label={t("enrollments.household")} value={data.household_id ?? ""} initialLabel={householdLabel ?? undefined} onChange={value => change("household_id", value || null)}/><p className="field-help">{t("enrollments.householdHelp")}</p>
        <EnrollmentRelation type="OPPORTUNITY" label={t("enrollments.opportunity")} value={data.opportunity_id ?? ""} initialLabel={(locale === "en" ? record?.opportunity_title_en : record?.opportunity_title_zh) ?? undefined} onChange={value => change("opportunity_id", value || null)}/>
        <label className="field"><span>{t("common.status")}</span><select name="status" value={data.status} onChange={event => change("status", event.target.value as EnrollmentData["status"])}>{enrollmentStatuses.map(value => <option key={value} value={value}>{t(`enrollments.status.${value}`)}</option>)}</select></label>
        <EnrollmentRelation type="USER" label={t("enrollments.owner")} value={data.owner_id} initialLabel={record ? (locale === "en" ? record.owner_name_en : record.owner_name_zh) ?? undefined : user.displayName} required onChange={value => change("owner_id", value)}/>
        <EnrollmentRelation type="USER" label={t("enrollments.salesOwner")} value={data.sales_owner_id ?? ""} initialLabel={(locale === "en" ? record?.sales_owner_name_en : record?.sales_owner_name_zh) ?? undefined} onChange={value => change("sales_owner_id", value || null)}/>
        <div className="form-grid two-column">{(["enrolled_at", "completed_at", "withdrawn_at"] as const).map(key => <label className="field" key={key}><span>{t(`enrollments.${key}`)}</span><DateInput name={key} type="datetime-local" value={data[key] ? preferences.localDateTimeInput(data[key]) : ""} onChange={event => change(key, enrollmentTimestamp(event.target.value, record?.[key] ?? null, preferences.localDateTimeInput, preferences.localDateTimeToIso))}/></label>)}</div>
        <label className="field"><span>{t("enrollments.withdrawalReason")}</span><textarea name="withdrawal_reason" maxLength={1000} rows={3} value={data.withdrawal_reason} onChange={event => change("withdrawal_reason", event.target.value)}/></label>
        <label className="field"><span>{t("enrollments.statusReason")}</span><textarea name="statusReason" maxLength={1000} rows={2} value={statusReason} onChange={event => setStatusReason(event.target.value)}/></label>
      </fieldset>
      {error && <InlineMessage type="error">{error}</InlineMessage>}{uncertain && <InlineMessage type="warning">{t("enrollments.uncertain")}</InlineMessage>}
      <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending || uncertain} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={pending} aria-busy={pending}>{t(pending ? "common.saving" : uncertain ? "enrollments.retry" : "common.save")}</button></div>
    </form>
  </AccessibleDrawer>;
}
