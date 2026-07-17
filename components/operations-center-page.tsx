"use client";

import { useState } from "react";
import {
  Activity,
  Check,
  CloudCog,
  Database,
  Lightbulb,
  RefreshCw,
  RotateCcw,
  ShieldQuestion,
  TriangleAlert,
  X,
} from "lucide-react";
import { InlineMessage, StatusBadge, Toast } from "./ui";
import { useI18n } from "./i18n-provider";
import type {
  BusinessInsights,
  IntegrationConnection,
  NextBestAction,
  OperationalSnapshot,
  RetryableJob,
} from "@/lib/operations-repository";
import { apiFetch } from "@/lib/api-client";

type PermissionExplanation = {
  allowed?: boolean;
  exists?: boolean;
  reason?: string;
  role?: string;
  mfaLevel?: string;
  status?: string;
};

export function OperationsCenterPage({
  initialSnapshot,
  initialRetryableJobs,
  initialIntegrations,
  initialNextActions,
  initialInsights,
}: {
  initialSnapshot: OperationalSnapshot | null;
  initialRetryableJobs: RetryableJob[];
  initialIntegrations: IntegrationConnection[];
  initialNextActions: NextBestAction[];
  initialInsights: BusinessInsights | null;
}) {
  const { locale, t } = useI18n();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [retryableJobs, setRetryableJobs] = useState(initialRetryableJobs);
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [nextActions, setNextActions] = useState(initialNextActions);
  const [insights, setInsights] = useState(initialInsights);
  const [integrationPending, setIntegrationPending] = useState("");
  const [integrationDrafts, setIntegrationDrafts] = useState<Record<string, {
    status: IntegrationConnection["status"];
    syncDirection: IntegrationConnection["syncDirection"];
    accountLabel: string;
  }>>(() => Object.fromEntries(initialIntegrations.map((item) => [item.provider, {
    status: item.status,
    syncDirection: item.syncDirection,
    accountLabel: item.externalAccountLabel,
  }])));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialSnapshot ? "" : t("operations.loadFailed"));
  const [toast, setToast] = useState("");
  const [rejecting, setRejecting] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [permission, setPermission] = useState<PermissionExplanation | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [operationsResult, integrationsResult, actionsResult] = await Promise.all([
        apiFetch<{ snapshot: OperationalSnapshot; retryableJobs: RetryableJob[]; insights: BusinessInsights }>("/api/operations"),
        apiFetch<{ items: IntegrationConnection[] }>("/api/integrations"),
        apiFetch<{ items: NextBestAction[] }>("/api/next-actions"),
      ]);
      setSnapshot(operationsResult.snapshot);
      setRetryableJobs(operationsResult.retryableJobs);
      setInsights(operationsResult.insights);
      setIntegrations(integrationsResult.items);
      setIntegrationDrafts(Object.fromEntries(integrationsResult.items.map((item) => [item.provider, {
        status: item.status,
        syncDirection: item.syncDirection,
        accountLabel: item.externalAccountLabel,
      }])));
      setNextActions(actionsResult.items);
    } catch {
      setError(t("operations.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const retry = async (job: RetryableJob) => {
    try {
      await apiFetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobType: job.type, jobId: job.id }),
      });
    } catch {
      setError(t("operations.loadFailed"));
      return;
    }
    setRetryableJobs((current) => current.filter((item) => item.id !== job.id));
    setToast(t("operations.retrySuccess"));
    void refresh();
  };

  const generate = async () => {
    setLoading(true);
    try {
      const result = await apiFetch<{ items: NextBestAction[] }>("/api/next-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "generate", organizationId: null }),
      });
      setNextActions(result.items);
      setToast(t("operations.generated"));
      void refresh();
    } catch {
      setError(t("operations.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const decide = async (item: NextBestAction, decision: "ACCEPTED" | "REJECTED") => {
    try {
      await apiFetch("/api/next-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "decide",
          id: item.id,
          decision,
          reason: decision === "REJECTED" ? rejectReason : "",
        }),
      });
    } catch {
      setError(t("operations.loadFailed"));
      return;
    }
    setNextActions((current) => current.filter((action) => action.id !== item.id));
    setRejecting("");
    setRejectReason("");
  };

  const explain = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPermission(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiFetch<{ explanation: PermissionExplanation }>("/api/permissions/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resourceType: form.get("resourceType"),
          resourceId: form.get("resourceId"),
          action: form.get("action"),
        }),
      });
      setPermission(result.explanation);
    } catch {
      setError(t("operations.loadFailed"));
    }
  };

  const configure = async (provider: IntegrationConnection["provider"]) => {
    const draft = integrationDrafts[provider];
    if (!draft) return;
    setIntegrationPending(provider);
    setError("");
    try {
      const result = await apiFetch<{ items: IntegrationConnection[] }>("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "configure", provider, ...draft }),
      });
      setIntegrations(result.items);
      setToast(t("operations.integrationSaved"));
    } catch {
      setError(t("operations.integrationFailed"));
    } finally {
      setIntegrationPending("");
    }
  };

  const sync = async (provider: IntegrationConnection["provider"]) => {
    setIntegrationPending(provider);
    setError("");
    try {
      const result = await apiFetch<{ items: IntegrationConnection[] }>("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "sync", provider }),
      });
      setIntegrations(result.items);
      setToast(t("operations.syncQueued"));
      void refresh();
    } catch {
      setError(t("operations.integrationFailed"));
    } finally {
      setIntegrationPending("");
    }
  };

  const formatDate = (value: string | null) => value
    ? new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : t("operations.neverRun");

  return <div className="page-stack operations-center">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t("operations.eyebrow")}</p><h1>{t("operations.title")}</h1><p>{t("operations.description")}</p></div>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} size={17}/>{t("operations.refresh")}</button>
    </section>
    {error && <InlineMessage type="error">{error}</InlineMessage>}

    <section className="operations-insight-grid" aria-label={t("operations.businessInsights")}>
      <InsightCard value={`${insights?.retention.rate ?? 0}%`} label={t("operations.retention")} detail={t("operations.retentionDetail", { retained: insights?.retention.retained ?? 0, eligible: insights?.retention.eligible ?? 0 })}/>
      <InsightCard value={`${insights?.renewal.conversionRate ?? 0}%`} label={t("operations.renewalConversion")} detail={t("operations.renewalDetail", { renewed: insights?.renewal.renewed ?? 0, lost: insights?.renewal.lost ?? 0, overdue: insights?.renewal.overdue ?? 0 })}/>
      <InsightCard value={`${insights?.forecast.accuracy ?? 0}%`} label={t("operations.forecastAccuracy")} detail={t("operations.forecastDetail", { forecast: insights?.forecast.forecast ?? 0, actual: insights?.forecast.actual ?? 0 })}/>
      <InsightCard value={`${insights?.queueSla.attainment ?? 0}%`} label={t("operations.queueAttainment")} detail={t("operations.queueDetail", { pending: insights?.queueSla.pending ?? 0, breached: insights?.queueSla.breached ?? 0 })}/>
      <InsightCard value={`${insights?.nextBestAction.adoptionRate ?? 0}%`} label={t("operations.nbaAdoption")} detail={t("operations.nbaDetail", { accepted: insights?.nextBestAction.accepted ?? 0, rejected: insights?.nextBestAction.rejected ?? 0, completed: insights?.nextBestAction.completed ?? 0 })}/>
    </section>

    <section className="surface operations-section">
      <div className="surface-heading"><div><p className="eyebrow">SLA</p><h2>{t("operations.queues")}</h2></div><Database size={20}/></div>
      <div className="operations-queue-grid">{snapshot?.queues.map((queue) => <article key={queue.key}>
        <span className={queue.failed || queue.breached || queue.stuck ? "red" : queue.pending ? "amber" : "green"}>{queue.failed || queue.breached || queue.stuck ? <TriangleAlert size={19}/> : <Activity size={19}/>}</span>
        <div><b>{queue.key.replaceAll("_", " ")}</b><small>{queue.oldest ? t("operations.oldest", { date: formatDate(queue.oldest) }) : t("operations.emptyQueue")}</small><small>{t("operations.queueSla", { minutes: queue.slaMinutes, stuck: queue.stuck, breached: queue.breached })}</small></div>
        <strong>{t("operations.pending", { count: queue.pending })}</strong>
        <StatusBadge tone={queue.failed || queue.breached ? "red" : "green"}>{t("operations.failed", { count: queue.failed })}</StatusBadge>
      </article>)}</div>
    </section>

    <div className="operations-two-column">
      <section className="surface operations-section">
        <div className="surface-heading"><div><p className="eyebrow">WORKERS</p><h2>{t("operations.workers")}</h2></div><Activity size={20}/></div>
        <div className="worker-list">{snapshot?.workers.map((worker) => <article key={worker.key}>
          <span className={worker.stale || worker.consecutiveFailures ? "red" : "green"}>{worker.stale ? <TriangleAlert size={17}/> : <Check size={17}/>}</span>
          <div><b>{worker.key.replaceAll("_", " ")}</b><small>{formatDate(worker.lastSeenAt)} · {t("operations.failures", { count: worker.consecutiveFailures })}</small>{worker.lastError && <small className="error-text">{worker.lastError}</small>}</div>
          <StatusBadge tone={worker.stale || worker.consecutiveFailures ? "red" : "green"}>{t(worker.stale ? "operations.workerStale" : "operations.workerHealthy")}</StatusBadge>
        </article>)}
        {!snapshot?.workers.length && <div className="empty-state"><span>{t("operations.neverRun")}</span></div>}</div>
      </section>

      <section className="surface operations-section">
        <div className="surface-heading"><div><p className="eyebrow">RECOVERY</p><h2>{t("operations.retryable")}</h2></div><RotateCcw size={20}/></div>
        <div className="retry-list">{retryableJobs.map((job) => <article key={`${job.type}:${job.id}`}>
          <div><b>{job.label}</b><small>{job.type.replaceAll("_", " ")} · {formatDate(job.updatedAt)}</small><small className="error-text">{job.error || job.status}</small></div>
          <button className="secondary-button" type="button" onClick={() => void retry(job)}><RotateCcw size={15}/>{t("operations.retry")}</button>
        </article>)}
        {!retryableJobs.length && <div className="empty-state"><span>{t("operations.noRetryable")}</span></div>}</div>
      </section>
    </div>

    <section className="surface operations-section">
      <div className="surface-heading"><div><p className="eyebrow">PROVIDERS</p><h2>{t("operations.integrations")}</h2><p>{t("operations.integrationHelp")}</p></div><CloudCog size={20}/></div>
      <div className="integration-grid">{integrations.map((integration) => {
        const draft = integrationDrafts[integration.provider] ?? {
          status: integration.status,
          syncDirection: integration.syncDirection,
          accountLabel: integration.externalAccountLabel,
        };
        return <article key={integration.id}>
        <span><CloudCog size={20}/></span><div><b>{t(`operations.provider.${integration.provider}`)}</b><small>{integration.externalAccountLabel || t("operations.neverSynced")}</small><small>{integration.lastSyncedAt ? formatDate(integration.lastSyncedAt) : t("operations.neverSynced")}</small>{integration.lastError && <small className="error-text">{integration.lastError}</small>}</div>
        <StatusBadge tone={integration.status === "CONNECTED" ? "green" : integration.status === "DISCONNECTED" ? "gray" : "amber"}>{t(`operations.status.${integration.status}`)}</StatusBadge>
        <details><summary>{t("operations.configure")}</summary><div className="integration-controls">
          <label className="field"><span>{t("common.status")}</span><select value={draft.status} onChange={(event) => setIntegrationDrafts((current) => ({ ...current, [integration.provider]: { ...draft, status: event.target.value as IntegrationConnection["status"] } }))}>{(integration.status === "CONNECTED" || integration.status === "DEGRADED" ? ["DISCONNECTED","CONNECTING","CONNECTED","DEGRADED","ACTION_REQUIRED"] : ["DISCONNECTED","CONNECTING","ACTION_REQUIRED"]).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="field"><span>{t("operations.syncDirection")}</span><select value={draft.syncDirection} onChange={(event) => setIntegrationDrafts((current) => ({ ...current, [integration.provider]: { ...draft, syncDirection: event.target.value as IntegrationConnection["syncDirection"] } }))}>{["NONE","IMPORT_ONLY","EXPORT_ONLY","BIDIRECTIONAL"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="field"><span>{t("operations.accountLabel")}</span><input value={draft.accountLabel} maxLength={160} onChange={(event) => setIntegrationDrafts((current) => ({ ...current, [integration.provider]: { ...draft, accountLabel: event.target.value } }))}/></label>
          <div className="integration-buttons"><button className="secondary-button" type="button" disabled={integrationPending === integration.provider} onClick={() => void configure(integration.provider)}>{t("common.save")}</button><button className="primary-button" type="button" disabled={integrationPending === integration.provider || integration.status !== "CONNECTED" || integration.syncDirection === "NONE"} onClick={() => void sync(integration.provider)}><RefreshCw size={15}/>{t("operations.syncNow")}</button></div>
        </div></details>
      </article>})}</div>
    </section>

    <section className="surface operations-section">
      <div className="surface-heading"><div><p className="eyebrow">RULES-FIRST</p><h2>{t("operations.nextActions")}</h2><p>{t("operations.nextActionsHelp")}</p></div><button className="secondary-button" type="button" disabled={loading} onClick={() => void generate()}><Lightbulb size={16}/>{t("operations.generate")}</button></div>
      <div className="next-action-grid">{nextActions.map((item) => <article key={item.id}>
        <div className="next-action-heading"><span className={item.priority.toLowerCase()}><Lightbulb size={18}/></span><div><b>{locale === "zh-CN" ? item.titleZh : item.titleEn}</b><small>{locale === "zh-CN" ? item.organizationNameZh : item.organizationNameEn}</small></div><StatusBadge tone={item.priority === "HIGH" ? "red" : "amber"}>{item.priority}</StatusBadge></div>
        <p>{locale === "zh-CN" ? item.rationaleZh : item.rationaleEn}</p>
        <small>{t("operations.ruleEvidence", { rule: `${item.ruleKey}/${item.ruleVersion}`, confidence: Math.round(item.confidence * 100) })}</small>
        <small>{t("operations.validUntil", { date: formatDate(item.validUntil) })}</small>
        {rejecting === item.id ? <div className="reject-row"><input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder={t("operations.rejectReason")} maxLength={500}/><button type="button" disabled={!rejectReason.trim()} onClick={() => void decide(item, "REJECTED")}><Check size={15}/></button><button type="button" onClick={() => setRejecting("")}><X size={15}/></button></div> : <div className="next-action-buttons"><button className="primary-button" type="button" onClick={() => void decide(item, "ACCEPTED")}><Check size={15}/>{t("operations.accept")}</button><button className="secondary-button" type="button" onClick={() => setRejecting(item.id)}><X size={15}/>{t("operations.reject")}</button></div>}
      </article>)}
      {!nextActions.length && <div className="empty-state"><span>{t("operations.noActions")}</span></div>}</div>
    </section>

    <section className="surface operations-section permission-explainer">
      <div className="surface-heading"><div><p className="eyebrow">AUTHORIZATION</p><h2>{t("operations.permission")}</h2><p>{t("operations.permissionHelp")}</p></div><ShieldQuestion size={20}/></div>
      <form onSubmit={explain}><label className="field"><span>{t("operations.resourceType")}</span><select name="resourceType">{["ORGANIZATION","CONTACT","OPPORTUNITY","CONTRACT","APPOINTMENT","TASK","QUOTE"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="field"><span>{t("operations.resourceId")}</span><input name="resourceId" type="text" pattern="[0-9a-fA-F-]{36}" required/></label><label className="field"><span>{t("operations.action")}</span><select name="action">{["READ","EDIT","DELETE","APPROVE","RETRY"].map((value) => <option key={value}>{value}</option>)}</select></label><button className="primary-button" type="submit">{t("operations.explain")}</button></form>
      {permission && <InlineMessage type={permission.allowed ? "success" : "warning"}><b>{t(permission.allowed ? "operations.allowed" : "operations.denied")}</b> · {t("operations.reason", { reason: permission.reason ?? "UNKNOWN" })} · {t("operations.mfa", { level: permission.mfaLevel ?? "unknown" })}</InlineMessage>}
    </section>
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

function InsightCard({ value, label, detail }: { value: string; label: string; detail: string }) {
  return <article className="surface operations-insight-card"><strong>{value}</strong><b>{label}</b><small>{detail}</small></article>;
}
