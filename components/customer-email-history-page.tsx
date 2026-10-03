"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { emailHistoryPurposes, emailHistoryStatuses, type EmailHistoryResult } from "@/lib/customer-email-history";
import { useRemoteSearch } from "@/hooks/use-remote-search";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { InlineMessage, Pagination, SearchField, StatusBadge } from "./ui";

export function CustomerEmailHistoryPage({ initial }: { initial: EmailHistoryResult }) {
  const { locale, t } = useI18n();
  const { formatDate } = useUserPreferences();
  const [result, setResult] = useState(initial);
  const [q, setQuery] = useState("");
  const [purpose, setPurpose] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const runLatest = useRemoteSearch();

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ q, purpose, status, page: String(page), pageSize: String(pageSize) });
      const outcome = await runLatest(signal => apiFetch<EmailHistoryResult>(`/api/customer-email/history?${params}`, { signal }), controller.signal);
      if (!outcome.current) return;
      setLoading(false);
      if ("value" in outcome) { setResult(outcome.value); setPage(outcome.value.page); }
      else setError(presentApiError(outcome.error, t, "emailHistory.failed").message);
    }, q ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [q, purpose, status, page, pageSize, refresh, runLatest, t]);

  return <div className="page-stack email-history-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("nav.messages")}</p><h1>{t("emailHistory.title")}</h1><p>{t("emailHistory.help")}</p></div><button className="secondary-button" type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16}/>{t("emailHistory.refresh")}</button></section>
    <section className="surface" aria-busy={loading}>
      <div className="email-history-filters">
        <SearchField value={q} onChange={value => { setQuery(value); setPage(1); }} placeholder={t("emailHistory.search")}/>
        <label className="compact-select"><span>{t("emailHistory.purpose")}</span><select aria-label={t("emailHistory.purpose")} value={purpose} onChange={event => { setPurpose(event.target.value); setPage(1); }}><option value="">{t("emailHistory.allPurposes")}</option>{emailHistoryPurposes.map(value => <option key={value} value={value}>{t(`communications.purpose.${value.toLowerCase()}`)}</option>)}</select></label>
        <label className="compact-select"><span>{t("emailHistory.status")}</span><select aria-label={t("emailHistory.status")} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">{t("emailHistory.allStatuses")}</option>{emailHistoryStatuses.map(value => <option key={value} value={value}>{t(`communications.delivery.${value.toLowerCase()}`)}</option>)}</select></label>
        <button className="secondary-button" type="button" onClick={() => { setQuery(""); setPurpose(""); setStatus(""); setPage(1); }}>{t("emailHistory.clear")}</button>
      </div>
      {error && <InlineMessage type="error">{error}</InlineMessage>}
      {loading && <p role="status">{t("common.loading")}</p>}
      {!loading && !error && <p className="email-history-count">{t("emailHistory.count", { count: result.total })}</p>}
      {!loading && !error && result.items.map(item => <article className="email-history-record" key={item.id}>
        <div><b>{item.subject}</b><span>{(locale === "zh-CN" ? item.contactZh || item.contactEn : item.contactEn || item.contactZh)} · {item.email}</span><small>{t(`communications.purpose.${item.purpose.toLowerCase()}`)} · {t("emailHistory.submittedAt")} {formatDate(item.createdAt, { includeTime: true })}{item.deliveredAt && <> · {t("emailHistory.sentAt")} {formatDate(item.deliveredAt, { includeTime: true })}</>}</small></div>
        <StatusBadge tone={["SENT", "DELIVERED"].includes(item.deliveryStatus) ? "green" : item.deliveryStatus === "FAILED" ? "red" : item.deliveryStatus === "UNCERTAIN" ? "amber" : "blue"}>{t(`communications.delivery.${item.deliveryStatus.toLowerCase()}`)}</StatusBadge>
        <Link className="text-button" href={`/messages?thread=${encodeURIComponent(item.threadId)}`}>{t("emailHistory.openThread")}</Link>
      </article>)}
      {!loading && !error && !result.items.length && <div className="empty-state"><span>{t(q || purpose || status ? "emailHistory.noResults" : "emailHistory.empty")}</span></div>}
      {!loading && !error && result.total > 0 && <Pagination page={result.page} totalPages={Math.max(1, Math.ceil(result.total / result.pageSize))} total={result.total} pageSize={result.pageSize} onPage={setPage} onPageSize={value => { setPageSize(value); setPage(1); }}/>}
    </section>
  </div>;
}
