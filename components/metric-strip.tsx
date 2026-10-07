"use client";
import { presentMissing } from "@/lib/ux-presentation";
import { useI18n } from "./i18n-provider";
import Link from "next/link";

export type DisplayMetric = {
  id: string; label: string; value: string | number; unit?: string; currency?: string;
  mode: "SNAPSHOT" | "PERIOD"; asOf: string; comparison?: string; state?: "restricted" | "unavailable"; href?: string; actionLabel?: string;
};
/** Supplied values and comparisons only: no aggregation, FX or business queries. */
export function MetricStrip({ items, label }: { items: readonly DisplayMetric[]; label: string }) {
  const { locale, t } = useI18n();
  return <section className="ux-metric-strip" aria-label={label}>{items.map(item => {
    const valid = typeof item.value === "string" && Boolean(item.value.trim()) || typeof item.value === "number" && Number.isFinite(item.value);
    return <article key={item.id} data-metric={item.id.split(":")[0]} data-mode={item.mode} data-currency={item.currency}><span>{item.label}</span><strong>{presentMissing(locale, valid ? item.value : null, item.state ?? (valid ? "missing" : "unavailable"))}{!item.state && valid && <small>{item.currency ?? item.unit}</small>}</strong><small>{t(item.mode === "PERIOD" ? "ux.metric.period" : "ux.metric.snapshot")} · {item.asOf}</small>{item.mode === "PERIOD" && item.comparison && !item.state && valid && <p>{item.comparison}</p>}{item.href && item.actionLabel && !item.state && <Link href={item.href}>{item.actionLabel}</Link>}</article>;
  })}</section>;
}
