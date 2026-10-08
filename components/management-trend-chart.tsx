"use client";
import { useId } from "react";
import type { ManagementTrendSeries } from "@/lib/management-trend-contract";
import { formatChannelCommissionAmount } from "@/lib/channel-analytics-input";
import { managementMetricLabelKey } from "@/lib/management-ux-presentation";
import { useI18n } from "./i18n-provider";

/** Coordinates are display-only. Every plotted value comes from the canonical series. */
export function ManagementTrendChart({ series }: { series: ManagementTrendSeries }) {
  const { t, locale } = useI18n(), titleId = useId();
  if (!series.points.length) return <p>{t("common.noData")}</p>;
  const values = series.points.map(point => Number(point.value));
  const low = Math.min(0, ...values), high = Math.max(0, ...values), range = high - low || 1;
  const y = (value: number) => 112 - (value - low) / range * 92;
  const step = 320 / values.length;
  const display = (value: string | number) => series.unit === "MONEY" ? `${series.currency} ${formatChannelCommissionAmount(String(value), locale)}` : String(value);
  return <figure className="management-trend-chart">
    <svg viewBox="0 0 360 142" role="img" aria-labelledby={titleId}>
      <title id={titleId}>{t(managementMetricLabelKey(series.key))}{series.currency ? ` · ${series.currency}` : ""}</title>
      <line x1="20" x2="340" y1={y(0)} y2={y(0)} className="trend-baseline"/>
      {values.map((value, index) => <rect key={series.points[index].bucketStart} x={20 + index * step + step * .15} y={Math.min(y(value), y(0))} width={step * .7} height={Math.max(1, Math.abs(y(value) - y(0)))} rx="2"><title>{series.points[index].bucketStart}: {display(series.points[index].value)}</title></rect>)}
      <text x="20" y="137">{series.points[0].bucketStart}</text><text x="340" y="137" textAnchor="end">{series.points.at(-1)?.bucketEnd}</text>
    </svg>
    <details><summary>{locale === "en" ? "View dated values" : "查看各期数值"}</summary><dl className="ux-detail-rows">{series.points.map(point => <div key={point.bucketStart}><dt>{point.bucketStart}–{point.bucketEnd}</dt><dd>{display(point.value)}</dd></div>)}</dl></details>
  </figure>;
}
