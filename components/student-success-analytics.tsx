"use client";
import Link from "next/link";
import { useState } from "react";
import { supportPeriodKeys, supportComparisonKeys, scopeQuery, validateSuccessAnalytics } from "@/lib/management-ux-presentation";
import { useScopeQuery } from "@/hooks/use-scope-query";
import { useI18n } from "./i18n-provider";
import { InlineMessage } from "./ui";
import { MetricStrip, type DisplayMetric } from "./metric-strip";
import { ManagementScope, type ManagementScopeValues } from "./management-scope";
import { localeIdentity, presentMissing } from "@/lib/ux-presentation";

export function StudentSuccessAnalytics({ initialFilters = {} }: { initialFilters?: { from?: string; to?: string; productId?: string; cohortId?: string } } = {}) {
  const { t, locale, enumLabel } = useI18n(), [filters, setFilters] = useState<ManagementScopeValues>(initialFilters);
  const request = useScopeQuery("/api/student-success/analytics", scopeQuery(filters), validateSuccessAnalytics), data = request.data;
  const snapshotMetric = (key: "activeCases" | "attentionCases" | "atRiskCases" | "highOpenRisks" | "activeGoals" | "activeInterventions" | "recordedOutcomes"): DisplayMetric => ({ id: key, label: t(`${key.endsWith("Cases") ? "ux.support" : "successAnalytics"}.metric.${key}`), value: data!.snapshot[key], mode: "SNAPSHOT", asOf: data!.snapshot.asOf });
  const periodMetrics = (keys: readonly typeof supportPeriodKeys[number][]): DisplayMetric[] => keys.map(key => ({ id: key, label: t(`successAnalytics.period.${key}`), value: data!.period[key], mode: "PERIOD", asOf: `${data!.period.from}–${data!.period.to}` }));
  return <section className="page-stack ux-management ux-support-analytics" data-testid="success-analytics">
    <header className="page-heading-row"><div><h1>{t("successAnalytics.title")}</h1><p className="field-help">{t("ux.support.purpose")}</p></div><button className="secondary-button" onClick={request.retry} disabled={request.loading}>{t("ux.management.refresh")}</button></header>
    <ManagementScope support applied={filters} onApply={setFilters} period={data?.period} asOf={data?.snapshot.asOf}/>
    {request.failure && <InlineMessage type="error">{t(request.failure === "restricted" ? "ux.management.restricted" : "success.loadFailed")} <button className="secondary-button" onClick={request.retry}>{t("common.retry")}</button>{data && <p>{t("ux.management.retainedAsOf")} {data.snapshot.asOf}</p>}</InlineMessage>}
    {!data && request.loading && <p role="status">{t("common.loading")}</p>}
    {data && (!data.permissions.canRead ? <InlineMessage type="info">{t("ux.management.restricted")}</InlineMessage> : <>
      <section data-testid="support-health"><div className="surface-heading"><h2>{t("ux.support.health")}</h2><Link href="/student-success">{t("ux.support.openCases")}</Link></div><MetricStrip label={t("ux.support.health")} items={(["activeCases", "attentionCases", "atRiskCases", "highOpenRisks"] as const).map(snapshotMetric)}/>
        <p className="ux-support-context">{t("ux.support.metric.visibleCases")}: {data.snapshot.visibleCases} · {t("successAnalytics.metric.openRisks")}: {data.snapshot.openRisks} · {t("ux.support.recent")}: {data.snapshot.withoutRecentCheckin} · {t("successAnalytics.upcoming")}: {data.snapshot.upcomingReview}</p>
      </section>
      <div className="ux-management-priority">
        <section className="ux-secondary-summary" data-testid="support-goals"><h2>{t("ux.support.goals")}</h2><MetricStrip label={t("ux.support.goals")} items={(["activeGoals", "activeInterventions"] as const).map(snapshotMetric)}/><div className="ux-goal-attainment"><h3>{t("successAnalytics.goalAttainment")}</h3><strong data-testid="goal-attainment">{data.snapshot.goalAttainment.rate === null ? t("successAnalytics.notEvaluated") : `${(data.snapshot.goalAttainment.rate * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`}</strong><p>{t("successAnalytics.denominator")} ({data.snapshot.goalAttainment.achieved} / {data.snapshot.goalAttainment.evaluated})</p></div></section>
        <section className="ux-secondary-summary" data-testid="support-outcomes"><div className="surface-heading"><h2>{t("successOutcome.title")}</h2><Link href="/student-success?view=outcomes">{t("management.open")}</Link></div><MetricStrip label={t("successOutcome.title")} items={[snapshotMetric("recordedOutcomes")]}/><p>{t("ux.support.boundary")}</p></section>
      </div>
      <section><h2>{t("successAnalytics.period")}</h2><p className="field-help">{t("successAnalytics.periodHelp")} · {data.period.timezone}</p><MetricStrip label={t("successAnalytics.period")} items={periodMetrics(["checkins", "risksResolved", "outcomesRecorded"])}/><details className="ux-secondary-summary"><summary>{t("ux.management.details")}</summary><MetricStrip label={t("successAnalytics.period")} items={periodMetrics(supportPeriodKeys)}/></details></section>
      <details className="ux-secondary-summary" data-testid="support-comparison"><summary>{t("successAnalytics.comparison")}</summary><p className="field-help">{t("ux.support.cohortHelp")}</p><div className="ux-domain-grid">{data.comparison.map(row => <article key={row.cohort_id}><h3>{localeIdentity(locale, row.product_name_zh, row.product_name_en).primary} · {localeIdentity(locale, row.cohort_name_zh, row.cohort_name_en).primary}</h3><dl className="ux-detail-rows">{supportComparisonKeys.map(key => <div key={key}><dt>{t(`successAnalytics.compare.${key}`)}</dt><dd>{row[key]}</dd></div>)}</dl></article>)}</div>{!data.comparison.length && <p>{t("common.noData")}</p>}</details>
      <details className="ux-secondary-summary" data-testid="support-trends"><summary>{t("successAnalytics.trends")}</summary><div className="ux-domain-grid">{data.trends.map(row => <article key={row.month}><h3>{row.month}</h3><dl className="ux-detail-rows">{(["checkins", "risksObserved", "outcomes"] as const).map(key => <div key={key}><dt>{t(`successAnalytics.trend.${key}`)}</dt><dd>{presentMissing(locale, row.counts[key])}</dd></div>)}</dl></article>)}</div>{!data.trends.length && <p>{t("common.noData")}</p>}</details>
      <details className="ux-secondary-summary" data-testid="support-distributions"><summary>{t("ux.support.distributions")}</summary><div className="ux-domain-grid">{Object.entries(data.snapshot.distributions).map(([kind, values]) => {
        const prefix: Record<string, string> = { caseStatus: "success.status", health: "success.health", goalStatus: "success.goalStatus", riskStatus: "successOps.riskStatus", riskType: "successOps.riskType", riskSeverity: "successOps.severity", interventionStatus: "successOps.interventionStatus", interventionType: "successOps.interventionType", outcomeType: "success.goalType", outcomeResult: "successOutcome.result" };
        return <section key={kind}><h3>{t(`successAnalytics.distribution.${kind}`)}</h3><dl className="ux-detail-rows">{Object.entries(values).map(([key, count]) => <div key={key}><dt>{prefix[kind] ? enumLabel(`${prefix[kind]}.${key}`).label : t("ux.management.unknownCategory")}</dt><dd>{count}</dd></div>)}</dl></section>;
      })}</div></details>
    </>)}
  </section>;
}
