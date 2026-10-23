"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, Filter, ShieldCheck } from "lucide-react";
import { useRemoteSearch } from "@/hooks/use-remote-search";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import type { ActionCenterSnapshot } from "@/lib/action-center-repository";
import { actionCategories, actionPriorities, filterActionItems, readActionFilters, writeActionFilters, type ActionFilters } from "@/lib/action-center-filters";
import { roleMessageKey } from "@/lib/roles";
import { useUserPreferences } from "./user-preferences-context";
import { useI18n } from "./i18n-provider";
import { StatusBadge, InlineMessage } from "./ui";
import { WorkspaceHeading } from "./workspace-heading";

export function ActionCenterPage({ snapshot: initial }: { snapshot: ActionCenterSnapshot }) {
  const { t } = useI18n(), { formatDate } = useUserPreferences(), latest = useRemoteSearch();
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const filters = readActionFilters(params);
  const [snapshot, setSnapshot] = useState(initial), [pending, setPending] = useState(false), [error, setError] = useState("");
  const unavailable = snapshot.unavailableSources ?? (snapshot.growthUnavailable ? ["growth"] : []);
  const incomplete = unavailable.length > 0 || Boolean(error);
  const visible = filterActionItems(snapshot.items, filters);
  const filtered = filters.category !== "all" || filters.priority !== "all";
  const select = (next: ActionFilters) => {
    const query = writeActionFilters(new URLSearchParams(params.toString()), next).toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const refresh = async () => {
    setPending(true);
    const result = await latest(signal => apiFetch<ActionCenterSnapshot>("/api/action-center", { signal }));
    if (!result.current) return;
    setPending(false);
    if ("error" in result) setError(presentApiError(result.error, t, "common.dataLoadError").message);
    else { setSnapshot(result.value); setError(""); }
  };

  return <div className="page-stack action-center-page" aria-busy={pending}>
    <section className="page-heading-row"><div><p className="eyebrow">{t("actionCenter.eyebrow")}</p><WorkspaceHeading>{t("actionCenter.title")}</WorkspaceHeading><p>{t("actionCenter.description", { role: t(roleMessageKey[snapshot.role]) })}</p></div>
      <StatusBadge tone={incomplete ? "amber" : snapshot.urgent ? "red" : "green"}>{t(incomplete ? "actionReview.incomplete" : snapshot.urgent ? "actionCenter.urgentCount" : "actionCenter.clear", { count: snapshot.urgent })}</StatusBadge>
    </section>
    {unavailable.length > 0 && <InlineMessage type="warning">{t("actionReview.unavailable", { sources: unavailable.map(source => t(`actionReview.source.${source}`)).join(" · ") })}</InlineMessage>}
    <div className="action-freshness"><span>{t("flow.asOf", { time: formatDate(snapshot.generatedAt, { includeTime: true }) })}</span><button type="button" className="secondary-button" disabled={pending} onClick={() => void refresh()}>{t(pending ? "common.loading" : "flow.refresh")}</button></div>
    {error && <InlineMessage type="error">{error} {t("actionReview.stale")}</InlineMessage>}
    <p className="field-help">{t("flow.overlapHelp")}{incomplete && <> {t("actionReview.confirmedOnly")}</>}</p>
    <section className="quick-summary action-center-summary" aria-label={t("actionCenter.summary")}><span><b>{snapshot.total}</b><small>{t("actionCenter.total")}</small></span><span><b>{snapshot.urgent}</b><small>{t("actionCenter.urgent")}</small></span><span><b>{snapshot.items.length}</b><small>{t("actionCenter.workstreams")}</small></span></section>
    <nav className="action-center-filters" aria-label={t("actionCenter.filters")}><Filter size={17} aria-hidden="true" />{actionCategories.map(category => <button key={category} className={filters.category === category ? "active" : ""} type="button" aria-pressed={filters.category === category} onClick={() => select({ ...filters, category })}>{t(`actionCenter.category.${category}`)}</button>)}</nav>
    <div className="action-review-controls"><label className="field"><span>{t("actionReview.priority")}</span><select value={filters.priority} onChange={event => select({ ...filters, priority: event.target.value as ActionFilters["priority"] })}>{actionPriorities.map(priority => <option value={priority} key={priority}>{t(`actionReview.priority.${priority}`)}</option>)}</select></label><p role="status" aria-live="polite">{t("actionReview.visible", { count: visible.length, total: snapshot.items.length })}</p>{filtered && <button type="button" className="secondary-button" onClick={() => select({ category: "all", priority: "all" })}>{t("actionReview.reset")}</button>}</div>
    <section className="action-center-grid">{visible.map(item => <Link className={`surface action-center-card ${item.priority}`} href={item.href} key={item.id}><span className="action-center-icon">{item.priority === "urgent" ? <CircleAlert size={21} /> : <ShieldCheck size={21} />}</span><div><span>{t(`actionCenter.category.${item.category}`)}</span><h2>{t(item.titleKey, { count: item.count })}</h2><p>{t(item.detailKey)}</p><small>{t("actionCenter.source")}</small></div><strong>{item.count}</strong><ArrowRight size={18} /></Link>)}</section>
    {!visible.length && <section className="surface action-center-empty">{incomplete ? <CircleAlert size={28} /> : <CheckCircle2 size={28} />}<h2>{t(incomplete ? "actionReview.emptyUnknown" : filtered ? "actionReview.emptyFiltered" : "actionCenter.empty")}</h2><p>{t(incomplete ? "actionReview.emptyUnknownHelp" : filtered ? "actionReview.emptyFilteredHelp" : "actionReview.emptyHelp")}</p></section>}
  </div>;
}
