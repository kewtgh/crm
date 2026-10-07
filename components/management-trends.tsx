"use client";
import Link from "next/link";
import { metricDefinitions, managementModules } from "@/lib/management-metric-contract";
import { metricDrillHref, type TrendFilters, type ManagementTrends, type ManagementTrendSeries } from "@/lib/management-trend-contract";
import { formatChannelCommissionAmount } from "@/lib/channel-analytics-input";
import { selectChanges, scopeQuery, validateTrends, managementMetricLabelKey } from "@/lib/management-ux-presentation";
import { useScopeQuery } from "@/hooks/use-scope-query";
import { useI18n } from "./i18n-provider";
import { InlineMessage } from "./ui";

function ChangeCard({ series, filters, data }: { series: ManagementTrendSeries; filters: TrendFilters; data: ManagementTrends }) {
  const { t, locale } = useI18n(), comparison = series.comparison;
  const display = (value: number | string) => series.unit === "MONEY" ? `${series.currency} ${formatChannelCommissionAmount(String(value), locale)}` : String(value);
  const href = metricDrillHref({ key: series.key, mode: "PERIOD", currency: series.currency }, filters, data.period);
  // Direction describes a supplied change, without favorable/unfavorable judgment.
  const direction = Number(comparison.absoluteChange) > 0 ? "increased" : Number(comparison.absoluteChange) < 0 ? "decreased" : "unchanged";
  return <article className="ux-change-card" data-series={series.key} data-currency={series.currency ?? undefined}>
    <h3>{t(managementMetricLabelKey(series.key))}</h3><strong>{display(comparison.current)}</strong>
    <p>{t(`ux.management.${direction}`)} {display(comparison.absoluteChange)} · {comparison.percentChange === null ? t("ux.management.notComparable") : `${Number(comparison.percentChange).toLocaleString(locale, { maximumFractionDigits: 2 })}%`}</p>
    <small>{t("management.previousPeriod")}: {display(comparison.previous)}</small>{href && <Link href={href}>{t("management.drilldown")}</Link>}
  </article>;
}
export function PeriodChanges({ data, filters }: { data: ManagementTrends; filters: TrendFilters }) {
  const { t } = useI18n(), selected = selectChanges(data);
  return <><p className="field-help">{data.period.from}–{data.period.to} · {t("management.previousPeriod")} {data.previousPeriod.from}–{data.previousPeriod.to} · {data.period.timezone}</p><div className="ux-change-grid">{selected.map(series => <ChangeCard key={`${series.key}:${series.currency ?? ""}`} series={series} filters={filters} data={data}/>)}</div>{!selected.length && <p>{t("ux.management.noComparisons")}</p>}</>;
}
/** Reuses supplied canonical data; opening detail performs no second fetch. */
export function ManagementTrendsView({ data, filters }: { data: ManagementTrends; filters: TrendFilters }) {
  const { t, locale } = useI18n();
  return <section className="page-stack" data-testid="management-trends"><p>{t("management.trendHelp")} · {t(`management.granularity.${data.granularity}`)}</p>{managementModules.map(module => <section key={module} data-trend-module={module}><h3>{t(`management.section.${module}`)}</h3>{!data.permissions[module] ? <InlineMessage type="info">{t("ux.management.restricted")}</InlineMessage> : <div className="ux-domain-grid">{data.series.filter(series => series.module === module && metricDefinitions[series.key][1] === "PERIOD" && (!series.key.startsWith("commission") || data.permissions.commissionMoney)).map(series => <div className="ux-trend-detail" key={`${series.key}:${series.currency ?? ""}`}><ChangeCard series={series} filters={filters} data={data}/><dl className="ux-detail-rows">{series.points.map(point => <div key={point.bucketStart}><dt>{point.bucketStart}–{point.bucketEnd}</dt><dd>{series.unit === "MONEY" ? `${series.currency} ${formatChannelCommissionAmount(String(point.value), locale)}` : String(point.value)}</dd></div>)}</dl></div>)}</div>}</section>)}</section>;
}
export function ManagementTrendsPanel({ filters, refreshKey = 0 }: { filters: TrendFilters; refreshKey?: number }) {
  const { t } = useI18n(), request = useScopeQuery("/api/management/trends", scopeQuery(filters), validateTrends, refreshKey);
  return <section className="surface page-stack"><h2>{t("management.trends")}</h2>{request.failure && <InlineMessage type="error">{t(request.failure === "restricted" ? "ux.management.restricted" : "management.trendFailed")} <button className="secondary-button" onClick={request.retry}>{t("common.retry")}</button></InlineMessage>}{!request.data && request.loading && <p role="status">{t("common.loading")}</p>}{request.data && <ManagementTrendsView data={request.data} filters={filters}/>}</section>;
}
