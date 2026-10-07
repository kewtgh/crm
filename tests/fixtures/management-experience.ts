import { managementFixture } from "./management-overview";
import { projectManagementOverview } from "../../lib/management-overview-projection";
import type { ManagementTrends } from "../../lib/management-trend-contract";
export const filterApplicability = { commercial: "OPPORTUNITIES_ONLY", delivery: "PRODUCT_COHORT", finance: "CONTRACT_CONTEXT_NO_ALLOCATION", channel: "CANONICAL_CHANNEL_CONTEXT", admissions: "ENROLLMENT_CONTEXT", studentSuccess: "CASE_ENROLLMENT_CONTEXT" };
/** Independently fictional, supplied canonical response shapes; never live business data. */
export function executiveFixture() {
  const data = projectManagementOverview(managementFixture());
  data.filterApplied = filterApplicability;
  data.filters = { productId: null, cohortId: null };
  return data;
}
export function trendsFixture(): ManagementTrends {
  return { asOf: "2026-10-05T00:00:00Z", period: { from: "2026-10-01", to: "2026-10-05", timezone: "Asia/Taipei" }, previousPeriod: { from: "2026-09-26", to: "2026-09-30" }, granularity: "DAY", permissions: { commercial: true, delivery: true, finance: true, channel: true, commissionMoney: true, admissions: true, studentSuccess: true }, filters: { productId: null, cohortId: null }, filterApplied: filterApplicability,
    series: [
      { key: "leadsCreated", module: "commercial", unit: "COUNT", currency: null, comparison: { current: 1, previous: 2, absoluteChange: -1, percentChange: -50 }, points: [{ bucketStart: "2026-10-01", bucketEnd: "2026-10-01", value: 1 }] },
      { key: "leadsConverted", module: "commercial", unit: "COUNT", currency: null, comparison: { current: 0, previous: 0, absoluteChange: 0, percentChange: null }, points: [] },
      { key: "enrollmentsActivated", module: "delivery", unit: "COUNT", currency: null, comparison: { current: 2, previous: 1, absoluteChange: 1, percentChange: 100 }, points: [] },
      { key: "applicationsSubmitted", module: "admissions", unit: "COUNT", currency: null, comparison: { current: 1, previous: 0, absoluteChange: 1, percentChange: null }, points: [] },
      { key: "payments_in_period", module: "finance", unit: "MONEY", currency: "CNY", comparison: { current: "20000.00", previous: "25000.00", absoluteChange: "-5000.00", percentChange: "-20" }, points: [] },
      { key: "payments_in_period", module: "finance", unit: "MONEY", currency: "USD", comparison: { current: "5000.00", previous: "0.00", absoluteChange: "5000.00", percentChange: null }, points: [] },
      { key: "outcomesRecorded", module: "studentSuccess", unit: "COUNT", currency: null, comparison: { current: 1, previous: 1, absoluteChange: 0, percentChange: 0 }, points: [] },
    ] };
}
export function supportFixture() {
  const data = managementFixture().studentSuccess;
  data.comparison = [{ product_id: "00000000-0000-4000-8000-000000000010", cohort_id: "00000000-0000-4000-8000-000000000011", product_name_zh: "示例学习项目", product_name_en: "Example Learning Program", cohort_name_zh: "示例秋季批次", cohort_name_en: "Example Autumn Cohort", cases: 2, active_cases: 1, on_track: 0, attention: 0, at_risk: 1, unknown: 1, checkins: 1, goals_achieved: 8, goals_not_achieved: 2, open_risks: 1, resolved_risks: 1, active_interventions: 1, completed_interventions: 1, outcomes: 10 }];
  data.trends = [{ month: "2026-10", counts: { checkins: 1, risksObserved: 1, outcomes: 1 } }];
  return data;
}
