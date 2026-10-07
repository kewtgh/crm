"use client";
import type { MetricValue } from "@/lib/management-metric-contract";
import { metricDrillHref, metricContextHref, type TrendFilters } from "@/lib/management-trend-contract";
import { metricMode, managementMetricLabelKey } from "@/lib/management-ux-presentation";
import { formatChannelCommissionAmount } from "@/lib/channel-analytics-input";
import { MetricStrip, type DisplayMetric } from "./metric-strip";
import { useI18n } from "./i18n-provider";

export function ManagementMetrics({ metrics, filters, period, label }: { metrics: readonly MetricValue[]; filters: TrendFilters; period: { from: string; to: string; timezone: string }; label: string }) {
  const { t, locale } = useI18n();
  const items: DisplayMetric[] = metrics.map(metric => {
    const exact = metricDrillHref(metric, filters, period);
    return { id: `${metric.key}:${metric.currency ?? ""}`, label: t(managementMetricLabelKey(metric.key)), value: metric.value === null ? t("successAnalytics.notEvaluated") : metric.unit === "MONEY" ? formatChannelCommissionAmount(String(metric.value), locale) : metric.unit === "RATIO" ? `${(Number(metric.value) * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%` : metric.value,
      currency: metric.currency ?? undefined, mode: metric.mode, asOf: metricMode(metric), href: exact ?? metricContextHref(metric.key, { ...filters, from: period.from, to: period.to }), actionLabel: t(exact ? "management.drilldown" : "management.open") };
  });
  return <MetricStrip items={items} label={label}/>;
}
