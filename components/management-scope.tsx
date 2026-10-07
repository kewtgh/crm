"use client";
import { useState } from "react";
import { overviewFiltersSchema, type TrendFilters } from "@/lib/management-trend-contract";
import { successAnalyticsFiltersSchema } from "@/lib/student-success-outcomes-input";
import { successHealth } from "@/lib/student-success-input";
import { scopeCount } from "@/lib/management-ux-presentation";
import { useI18n } from "./i18n-provider";
import { FilterBar } from "./filter-bar";
import { DateInput } from "./structured-inputs";
import { EnrollmentRelation } from "./enrollment-relation";
import { InlineMessage } from "./ui";

export type ManagementScopeValues = Pick<TrendFilters, "from" | "to" | "productId" | "cohortId"> & { ownerId?: string; health?: typeof successHealth[number] };
type ScopeDraft = ManagementScopeValues & { productLabel?: string; cohortLabel?: string; ownerLabel?: string };
/** Draft presentation only. The page owns applied query state and canonical loading. */
export function ManagementScope({ applied, onApply, period, asOf, support = false }: {
  applied: ManagementScopeValues; onApply: (value: ManagementScopeValues) => void;
  period?: { from: string; to: string; timezone: string }; asOf?: string; support?: boolean;
}) {
  const { t } = useI18n(), [labels, setLabels] = useState<Pick<ScopeDraft, "productLabel" | "cohortLabel" | "ownerLabel">>({}), [invalid, setInvalid] = useState(false);
  const draft: ScopeDraft = { ...applied, ...labels, from: applied.from ?? period?.from, to: applied.to ?? period?.to };
  return <FilterBar applied={draft} defaults={{} as ScopeDraft} advancedCount={scopeCount(applied)} activeCount={scopeCount(applied)} onOpen={() => setInvalid(false)} onReset={() => { setLabels({}); onApply({}); }}
    summary={<div className="ux-scope-summary" data-testid="applied-scope"><b>{t("management.period")}: {applied.from ?? period?.from ?? t("ux.management.defaultPeriod")} – {applied.to ?? period?.to ?? t("ux.management.defaultPeriod")}</b><span>{t("products.product")}: {applied.productId ? labels.productLabel || t("flow.selectedRecord") : t("common.all")} · {t("enrollments.cohort")}: {applied.cohortId ? labels.cohortLabel || t("flow.selectedRecord") : t("common.all")}</span>{support && <span>{t("enrollments.owner")}: {applied.ownerId ? labels.ownerLabel || t("flow.selectedRecord") : t("common.all")} · {t("ux.support.healthStatus")}: {applied.health ? t(`success.health.${applied.health}`) : t("common.all")}</span>}<small>{period?.timezone ?? t("ux.management.timezonePending")} · {t("management.asOf")} {asOf ?? t("common.loading")}</small></div>}
    onApply={value => {
      const { productLabel, cohortLabel, ownerLabel, ...filters } = value;
      const parsed = (support ? successAnalyticsFiltersSchema : overviewFiltersSchema).safeParse(filters);
      setInvalid(!parsed.success);
      if (!parsed.success) return false;
      setLabels({ productLabel, cohortLabel, ownerLabel }); onApply(parsed.data); return true;
    }} renderAdvanced={(value, change) => <>
      <div className="form-grid two-column">{(["from", "to"] as const).map(key => <label className="field" key={key}><span>{t(`management.${key}`)}</span><DateInput name={`scope-${key}`} value={value[key] ?? ""} onChange={event => change({ ...value, [key]: event.target.value || undefined })}/></label>)}</div>
      <EnrollmentRelation type="PRODUCT" label={t("products.product")} value={value.productId ?? ""} initialLabel={value.productLabel} onChange={() => {}} onSelection={(id, label) => change({ ...value, productId: id || undefined, productLabel: label, cohortId: undefined, cohortLabel: undefined })}/>
      <EnrollmentRelation type="COHORT" label={t("enrollments.cohort")} value={value.cohortId ?? ""} initialLabel={value.cohortLabel} onChange={() => {}} onSelection={(id, label) => change({ ...value, cohortId: id || undefined, cohortLabel: label })}/>
      {support && <><EnrollmentRelation type="USER" label={t("enrollments.owner")} value={value.ownerId ?? ""} initialLabel={value.ownerLabel} onChange={() => {}} onSelection={(id, label) => change({ ...value, ownerId: id || undefined, ownerLabel: label })}/><label className="field"><span>{t("ux.support.healthStatus")}</span><select name="scope-health" value={value.health ?? ""} onChange={event => change({ ...value, health: event.target.value ? event.target.value as ScopeDraft["health"] : undefined })}><option value="">{t("common.all")}</option>{successHealth.map(health => <option key={health} value={health}>{t(`success.health.${health}`)}</option>)}</select></label></>}
      {invalid && <InlineMessage type="error">{t("management.invalid")}</InlineMessage>}
    </>}/>;
}
