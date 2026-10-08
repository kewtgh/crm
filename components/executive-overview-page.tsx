"use client";
import {WorkspaceHeading} from "./workspace-heading";

import Link from "next/link";
import {ReadFailureDetail} from "./read-failure-detail";
import { useState } from "react";
import { attentionHref, managementModules, type ManagementModule } from "@/lib/management-metric-contract";
import { attentionQueueHref } from "@/lib/management-attention-contract";
import { metricContextHref, type TrendFilters } from "@/lib/management-trend-contract";
import { domainSummaryKeys, executiveKpiKeys, moduleState, scopeQuery, selectMetrics, validateOverview, validateTrends } from "@/lib/management-ux-presentation";
import { useScopeQuery } from "@/hooks/use-scope-query";
import { localeIdentity } from "@/lib/ux-presentation";
import { useI18n } from "./i18n-provider";
import { AttentionPanel } from "./attention-panel";
import { ManagementMetrics } from "./management-metrics";
import { ManagementScope } from "./management-scope";
import { ManagementTrendsView, PeriodChanges } from "./management-trends";
import { InlineMessage } from "./ui";

export function ExecutiveOverviewPage({ initialFilters = {} }: { initialFilters?: TrendFilters }) {
  const { t, locale, enumLabel } = useI18n(), [filters, setFilters] = useState(initialFilters), [refresh, setRefresh] = useState(0);
  const query = scopeQuery(filters), overview = useScopeQuery("/api/management/overview", query, validateOverview, refresh), trends = useScopeQuery("/api/management/trends", query, validateTrends, refresh), data = overview.data;
  const period = data?.period ?? trends.data?.period;
  const title = (module: ManagementModule) => t(`management.section.${module}`);
  return <div className="page-stack executive-overview ux-management" data-testid="executive-overview">
    <header className="page-heading-row"><div><WorkspaceHeading>{t("management.title")}</WorkspaceHeading><p>{t("ux.management.purpose")}</p></div><button className="secondary-button" disabled={overview.loading || trends.loading} onClick={() => setRefresh(value => value + 1)}>{t("ux.management.refresh")}</button></header>
    <ManagementScope applied={filters} onApply={setFilters} period={period} asOf={data?.asOf ?? trends.data?.asOf}/>
    {overview.failure && <InlineMessage type="error"><ReadFailureDetail failure={overview.diagnostic}/>{t(overview.failure === "restricted" ? "ux.management.restricted" : "management.failed")} <button className="secondary-button" onClick={overview.retry}>{t("common.retry")}</button>{data && <p>{t("ux.management.retainedAsOf")} {data.asOf}</p>}</InlineMessage>}
    {!data && overview.loading && <p role="status">{t("common.loading")}</p>}
    <div className="ux-management-priority">
      {data && <div data-testid="executive-attention"><AttentionPanel title={t("management.attention")} summary={<p><strong data-testid="attention-total">{data.attention.total}</strong> {t("ux.management.signals")} · {t("management.attentionHelp")}</p>} action={<Link href={attentionQueueHref(filters)} data-view-all-attention>{t("management.queue.viewAll")}</Link>} emptyLabel={t("ux.management.attentionEmpty")} items={data.attention.items.slice(0, 3).map(item => ({ id: `${item.source_domain}:${item.source_type}:${item.source_id}:${item.reason_code}`, title: t(`management.reason.${item.reason_code}`), description: `${t(`management.section.${item.source_domain === "STUDENT_SUCCESS" ? "studentSuccess" : item.source_domain === "DATA_QUALITY" ? "quality" : item.source_domain.toLowerCase()}`)} · ${t(`management.severity.${item.severity}`)}${item.business_date ? ` · ${item.business_date}` : ""}`, href: attentionHref(item), actionLabel: t("management.openSource"), priority: item.severity === "CRITICAL" ? "urgent" : "high" }))}/></div>}
      <section className="ux-change-panel" data-testid="executive-changes" aria-label={t("ux.management.changes")}><h2>{t("ux.management.changes")}</h2>{trends.failure && <InlineMessage type="error"><ReadFailureDetail failure={trends.diagnostic}/>{t(trends.failure === "restricted" ? "ux.management.restricted" : "management.trendFailed")} <button className="secondary-button" onClick={trends.retry}>{t("common.retry")}</button>{trends.data && <p>{t("ux.management.retainedAsOf")} {trends.data.asOf}</p>}</InlineMessage>}{!trends.data && trends.loading && <p role="status">{t("common.loading")}</p>}{trends.data && <PeriodChanges data={trends.data} filters={filters}/>}</section>
    </div>
    {data && <>
      <section data-testid="executive-kpis"><h2>{t("ux.management.keyFacts")}</h2><ManagementMetrics metrics={selectMetrics(data, executiveKpiKeys)} filters={filters} period={data.period} label={t("ux.management.keyFacts")}/></section>
      <section aria-label={t("ux.management.domains")}><div className="surface-heading"><h2>{t("ux.management.domains")}</h2><p className="field-help">{t("management.filterHelp")}</p></div><div className="ux-domain-grid">{managementModules.map(module => {
        const state = moduleState(data, module), section = data.modules[module];
        return <section className="ux-domain-summary" data-module={module} key={module}><div className="surface-heading"><h3>{title(module)}</h3>{state === "available" && <Link href={metricContextHref(domainSummaryKeys[module][0], { ...filters, from: data.period.from, to: data.period.to })}>{t("management.open")}</Link>}</div>
          {state !== "available" ? <InlineMessage type="info">{t(state === "restricted" ? "ux.management.restricted" : "ux.management.unavailable")}</InlineMessage> : <>
            <ManagementMetrics metrics={selectMetrics(data, domainSummaryKeys[module])} filters={filters} period={data.period} label={title(module)}/>
            <p className="field-help">{data.filterApplied?.[module] && ["OPPORTUNITIES_ONLY", "PRODUCT_COHORT", "CONTRACT_CONTEXT_NO_ALLOCATION", "CANONICAL_CHANNEL_CONTEXT", "ENROLLMENT_CONTEXT", "CASE_ENROLLMENT_CONTEXT"].includes(data.filterApplied[module]) ? t(`ux.management.scope.${data.filterApplied[module]}`) : t("ux.management.scopeUnspecified")}</p>
            {module === "channel" && !data.permissions.commissionMoney && <p>{t("management.moneyRestricted")}</p>}
            <details data-domain-detail={module}><summary>{t("ux.management.details")}</summary><div className="page-stack">
              <ManagementMetrics metrics={selectMetrics(data, section.metrics.map(metric => metric.key).filter((key, index, keys) => keys.indexOf(key) === index))} filters={filters} period={data.period} label={title(module)}/>
              {module === "finance" && <p>{t("management.financeHelp")}</p>}{module === "channel" && <><p>{t("management.channelHelp")}</p>{data.channelContributions.map(row => <div className="ux-detail-row" key={row.organizationId}><Link href={`/schools/${row.organizationId}`}>{localeIdentity(locale, row.nameZh, row.nameEn).primary}</Link><span>{t("management.metric.primaryContributions")}: {row.primary} · {t("management.metric.assistContributions")}: {row.assist}</span></div>)}</>}
              {Object.entries(section.distributions).map(([kind, counts]) => <section key={kind}><h4>{t(`management.distribution.${kind}`)}</h4><dl className="ux-detail-rows">{Object.entries(counts).map(([status, count]) => <div key={status}><dt>{enumLabel(`management.status.${status}`).label}</dt><dd>{count}</dd></div>)}</dl></section>)}
            </div></details>
          </>}
        </section>;
      })}</div></section>
      {data.permissions.quality && <section className="ux-secondary-summary"><div className="surface-heading"><h2>{t("management.section.quality")}</h2><Link href="/data-quality">{t("management.open")}</Link></div><p>{t("management.qualityHelp")} · {data.quality.count}</p><details><summary>{t("ux.management.details")}</summary><dl className="ux-detail-rows">{data.quality.distribution.map(row => <div key={`${row.entity_type}:${row.severity}`}><dt>{t(`management.source.${row.entity_type}`)} · {t(`quality.severity.${row.severity.toLowerCase()}`)}</dt><dd>{row.count}</dd></div>)}</dl></details></section>}
    </>}
    {trends.data && <details className="ux-secondary-summary" data-testid="detailed-trends"><summary>{t("management.trends")}</summary><ManagementTrendsView data={trends.data} filters={filters}/></details>}
  </div>;
}
