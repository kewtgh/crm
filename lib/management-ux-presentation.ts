import { z } from "zod";
import { managementModules, metricDefinitions, type ManagementModule, type ManagementMetricKey, type MetricValue, type ManagementOverviewProjection } from "./management-metric-contract";
import type { ManagementTrends, ManagementTrendSeries } from "./management-trend-contract";
import type { SuccessAnalytics } from "./student-success-analytics-repository";

// Presentation priorities only. These maps neither derive nor aggregate facts.
export const executiveKpiKeys: readonly ManagementMetricKey[] = ["openOpportunities", "activeEnrollments", "applicationsInProgress", "atRiskCases", "outstanding", "overdue"];
export const periodChangeKeys: readonly ManagementMetricKey[] = ["leadsCreated", "leadsConverted", "enrollmentsActivated", "applicationsSubmitted", "payments_in_period", "outcomesRecorded"];
const businessMetricLabels: readonly ManagementMetricKey[] = ["activeEnrollments", "enrollmentsActivated", "activeCases", "atRiskCases", "attentionCases", "recordedOutcomes"];
export function managementMetricLabelKey(key: ManagementMetricKey) { return `${businessMetricLabels.includes(key) ? "ux.management" : "management"}.metric.${key}`; }
export const domainSummaryKeys: Record<ManagementModule, readonly ManagementMetricKey[]> = {
  commercial: ["openOpportunities", "qualifiedLeads", "won_value"], delivery: ["activeEnrollments", "recruitingCohorts", "enrollmentsActivated"],
  finance: ["outstanding", "overdue", "payments_in_period"], channel: ["visibleAccounts", "primaryContributions", "eventsHeld"],
  admissions: ["applicationsInProgress", "applicationsDueSoon", "applicationsPastDeadline"], studentSuccess: ["activeCases", "atRiskCases", "highOpenRisks"],
};
export function moduleState(data: ManagementOverviewProjection, module: ManagementModule) {
  return !data.permissions[module] ? "restricted" : !data.modules[module].available ? "unavailable" : "available";
}
export function selectMetrics(data: ManagementOverviewProjection, keys: readonly ManagementMetricKey[]) {
  return keys.flatMap(key => {
    const owner = metricDefinitions[key][0];
    if (moduleState(data, owner) !== "available" || key.startsWith("commission") && !data.permissions.commissionMoney) return [];
    return data.modules[owner].metrics.filter(item => item.key === key).sort((a, b) => (a.currency ?? "").localeCompare(b.currency ?? ""));
  });
}
export function selectChanges(data: ManagementTrends): ManagementTrendSeries[] {
  return periodChangeKeys.flatMap(key => data.series.filter(series => series.key === key && metricDefinitions[key][1] === "PERIOD" && data.permissions[series.module]).sort((a, b) => (a.currency ?? "").localeCompare(b.currency ?? "")));
}
export function scopeQuery(filters: object) {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, String(value)])).toString();
}
export function scopeCount(filters: { from?: string; to?: string; productId?: string; cohortId?: string; ownerId?: string; health?: string }) {
  return Number(Boolean(filters.from || filters.to)) + [filters.productId, filters.cohortId, filters.ownerId, filters.health].filter(Boolean).length;
}

// Reject malformed required response fields at the presentation boundary. Return
// the original response unchanged; repositories and accounting contracts remain authoritative.
const date = z.iso.date(), text = z.string().min(1), count = z.number().int().nonnegative(), numeric = z.union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d+)?$/)]);
const period = z.object({ from: date, to: date, timezone: text });
const permissions = z.object(Object.fromEntries([...managementModules, "commissionMoney"].map(key => [key, z.boolean()])));
const distribution = z.record(z.string(), z.record(z.string(), count));
function canonicalUnit(key: ManagementMetricKey) { return key === "goalAttainment" ? "RATIO" : metricDefinitions[key][0] === "finance" || key.endsWith("_value") || key.startsWith("commission") ? "MONEY" : "COUNT"; }
const metric = z.object({ key: z.enum(Object.keys(metricDefinitions) as [ManagementMetricKey, ...ManagementMetricKey[]]), value: numeric.nullable(), unit: z.enum(["COUNT", "MONEY", "RATIO"]), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), mode: z.enum(["SNAPSHOT", "PERIOD"]), source: text, dateSemantics: text, asOf: text, period: period.nullable() }).refine(value => value.mode === metricDefinitions[value.key][1] && value.unit === canonicalUnit(value.key) && (value.unit !== "MONEY" || value.currency !== null && typeof value.value === "string") && (value.value !== null || value.unit === "RATIO") && (value.mode !== "PERIOD" || value.period !== null));
const overviewSchema = z.object({ asOf: text, period, permissions: permissions.extend({ quality: z.boolean() }), modules: z.object(Object.fromEntries(managementModules.map(module => [module, z.object({ available: z.boolean(), metrics: z.array(metric), distributions: distribution })]))), attention: z.object({ total: count, limit: count, items: z.array(z.object({ source_domain: text, source_type: text, source_id: text, context_id: text, reason_code: text, severity: z.enum(["ATTENTION", "CRITICAL"]), business_date: text.nullable() })) }), quality: z.object({ count, distribution: z.array(z.object({ entity_type: text, severity: text, count })) }), channelContributions: z.array(z.object({ organizationId: text, nameZh: z.string(), nameEn: z.string(), primary: count, assist: count })) });
const seriesSchema = z.object({ key: metric.shape.key, module: z.enum(managementModules), unit: z.enum(["COUNT", "MONEY"]), currency: metric.shape.currency, comparison: z.object({ current: numeric, previous: numeric, absoluteChange: numeric, percentChange: numeric.nullable() }), points: z.array(z.object({ bucketStart: date, bucketEnd: date, value: numeric })) }).refine(value => value.module === metricDefinitions[value.key][0] && value.unit === canonicalUnit(value.key) && (value.unit !== "MONEY" || value.currency !== null && [value.comparison.current, value.comparison.previous, value.comparison.absoluteChange, ...value.points.map(point => point.value)].every(amount => typeof amount === "string")));
const trendsSchema = z.object({ asOf: text, period, previousPeriod: z.object({ from: date, to: date }), granularity: z.enum(["DAY", "WEEK", "MONTH"]), permissions, series: z.array(seriesSchema), filters: z.object({ productId: z.string().nullable(), cohortId: z.string().nullable() }), filterApplied: z.record(z.string(), z.string()) });
export const supportSnapshotKeys = ["visibleCases", "activeCases", "attentionCases", "atRiskCases", "openRisks", "highOpenRisks", "activeInterventions", "activeGoals", "withoutRecentCheckin", "upcomingReview", "recordedOutcomes"] as const;
export const supportPeriodKeys = ["checkins", "casesCheckedIn", "healthAssessments", "risksObserved", "risksResolved", "interventionsStarted", "interventionsCompleted", "goalsAchieved", "outcomesRecorded"] as const;
export const supportComparisonKeys = ["cases", "active_cases", "on_track", "attention", "at_risk", "unknown", "checkins", "goals_achieved", "goals_not_achieved", "open_risks", "resolved_risks", "active_interventions", "completed_interventions", "outcomes"] as const;
const analyticsSchema = z.object({ filters: z.object({}), permissions: z.object({ canRead: z.boolean() }), snapshot: z.object({ asOf: text, ...Object.fromEntries(supportSnapshotKeys.map(key => [key, count])), distributions: distribution, goalAttainment: z.object({ achieved: count, evaluated: count, rate: z.number().min(0).max(1).nullable() }).refine(value => value.evaluated !== 0 || value.rate === null) }), period: period.extend(Object.fromEntries(supportPeriodKeys.map(key => [key, count]))), comparison: z.array(z.object({ product_id: text, cohort_id: text, product_name_zh: z.string(), product_name_en: z.string(), cohort_name_zh: z.string(), cohort_name_en: z.string(), ...Object.fromEntries(supportComparisonKeys.map(key => [key, count])) })), trends: z.array(z.object({ month: text, counts: z.record(z.string(), count) })) });
export function validateOverview(value: unknown): ManagementOverviewProjection { overviewSchema.parse(value); return value as ManagementOverviewProjection; }
export function validateTrends(value: unknown): ManagementTrends { trendsSchema.parse(value); return value as ManagementTrends; }
export function validateSuccessAnalytics(value: unknown): SuccessAnalytics { analyticsSchema.parse(value); return value as SuccessAnalytics; }
export function metricMode(metric: Pick<MetricValue, "mode" | "asOf" | "period">) { return metric.mode === "PERIOD" && metric.period ? `${metric.period.from}–${metric.period.to}` : metric.asOf; }
