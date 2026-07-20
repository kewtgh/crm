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
import { InlineMessage, Pagination, StatusBadge, Toast } from "./ui";
import { useI18n } from "./i18n-provider";
import type {
  BusinessInsights,
  IntegrationConnection,
  NextBestAction,
  OperationalSnapshot,
  PagedResult,
  ReleaseReadiness,
  RetryableJob,
} from "@/lib/operations-repository";
import { apiFetch } from "@/lib/api-client";
import { useUserPreferences } from "@/components/user-preferences-context";
import { useRemoteSearch } from "@/hooks/use-remote-search";

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
  initialReadiness,
  initialLoadFailed,
  aiProviderConfigured,
}: {
  initialSnapshot: OperationalSnapshot | null;
  initialRetryableJobs: PagedResult<RetryableJob>;
  initialIntegrations: IntegrationConnection[];
  initialNextActions: PagedResult<NextBestAction>;
  initialInsights: BusinessInsights | null;
  initialReadiness:ReleaseReadiness|null;
  initialLoadFailed:boolean;
  aiProviderConfigured:boolean;
}) {
  const { locale, t } = useI18n();
  const { formatDate: formatPreferredDate } = useUserPreferences();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [retryableJobs, setRetryableJobs] = useState(initialRetryableJobs.items);
  const [retryTotal, setRetryTotal] = useState(initialRetryableJobs.total);
  const [retryPage, setRetryPage] = useState(initialRetryableJobs.page);
  const [retryPageSize, setRetryPageSize] = useState(initialRetryableJobs.pageSize);
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [nextActions, setNextActions] = useState(initialNextActions.items);
  const [actionTotal, setActionTotal] = useState(initialNextActions.total);
  const [actionPage, setActionPage] = useState(initialNextActions.page);
  const [actionPageSize, setActionPageSize] = useState(initialNextActions.pageSize);
  const [insights, setInsights] = useState(initialInsights);
  const [readiness,setReadiness]=useState(initialReadiness);
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
  const [error, setError] = useState(initialLoadFailed || !initialSnapshot ? t("operations.loadFailed") : "");
  const [toast, setToast] = useState("");
  const [rejecting, setRejecting] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [permission, setPermission] = useState<PermissionExplanation | null>(null);
  const runOperationsLoad=useRemoteSearch();
  const runActionsLoad=useRemoteSearch();
  const runIntegrationsLoad=useRemoteSearch();

  const applyOperationsResult = (result: {
    snapshot: OperationalSnapshot;
    retryableJobs: PagedResult<RetryableJob>;
    insights: BusinessInsights;
    readiness: ReleaseReadiness;
  }) => {
    setSnapshot(result.snapshot);
    setRetryableJobs(result.retryableJobs.items);
    setRetryTotal(result.retryableJobs.total);
    setRetryPage(result.retryableJobs.page);
    setRetryPageSize(result.retryableJobs.pageSize);
    setInsights(result.insights);
    setReadiness(result.readiness);
  };

  const loadRetryablePage = async (nextPage: number, nextPageSize: number) => {
    setLoading(true);
    setError("");
    const request=await runOperationsLoad(signal=>apiFetch<{
        snapshot: OperationalSnapshot;
        retryableJobs: PagedResult<RetryableJob>;
        insights: BusinessInsights;
        readiness: ReleaseReadiness;
      }>(`/api/operations?page=${nextPage}&pageSize=${nextPageSize}`,{signal}));
    if(!request.current)return;
    if("error" in request){
      setError(t("operations.loadFailed"));
      setLoading(false);
      return;
    }
    applyOperationsResult(request.value);
    setLoading(false);
  };

  const loadNextActionsPage = async (nextPage: number, nextPageSize: number) => {
    setLoading(true);
    setError("");
    const request=await runActionsLoad(signal=>apiFetch<PagedResult<NextBestAction>>(
      `/api/next-actions?page=${nextPage}&pageSize=${nextPageSize}`,{signal},
    ));
    if(!request.current)return;
    if("error" in request){
      setError(t("operations.loadFailed"));
      setLoading(false);
      return;
    }
    setNextActions(request.value.items);
    setActionTotal(request.value.total);
    setActionPage(request.value.page);
    setActionPageSize(request.value.pageSize);
    setLoading(false);
  };

  const refresh = async () => {
    setLoading(true);
    setError("");
    const [operationsRequest,integrationsRequest,actionsRequest]=await Promise.all([
      runOperationsLoad(signal=>apiFetch<{ snapshot: OperationalSnapshot; retryableJobs: PagedResult<RetryableJob>; insights: BusinessInsights;readiness:ReleaseReadiness }>(`/api/operations?page=${retryPage}&pageSize=${retryPageSize}`,{signal})),
      runIntegrationsLoad(signal=>apiFetch<{ items: IntegrationConnection[] }>("/api/integrations",{signal})),
      runActionsLoad(signal=>apiFetch<PagedResult<NextBestAction>>(`/api/next-actions?page=${actionPage}&pageSize=${actionPageSize}`,{signal})),
    ]);
    if(!operationsRequest.current||!integrationsRequest.current||!actionsRequest.current)return;
    if("error" in operationsRequest||"error" in integrationsRequest||"error" in actionsRequest){
      setError(t("operations.loadFailed"));
      setLoading(false);
      return;
    }
      applyOperationsResult(operationsRequest.value);
      setIntegrations(integrationsRequest.value.items);
      setIntegrationDrafts(Object.fromEntries(integrationsRequest.value.items.map((item) => [item.provider, {
        status: item.status,
        syncDirection: item.syncDirection,
        accountLabel: item.externalAccountLabel,
      }])));
      setNextActions(actionsRequest.value.items);
      setActionTotal(actionsRequest.value.total);
      setActionPage(actionsRequest.value.page);
      setActionPageSize(actionsRequest.value.pageSize);
      setLoading(false);
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
    setToast(t("operations.retrySuccess"));
    const nextTotal = Math.max(0, retryTotal - 1);
    const nextPage = Math.min(retryPage, Math.max(1, Math.ceil(nextTotal / retryPageSize)));
    await loadRetryablePage(nextPage, retryPageSize);
  };

  const generate = async () => {
    setLoading(true);
    try {
      await apiFetch("/api/next-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "generate", organizationId: null }),
      });
      setActionPage(1);
      await loadNextActionsPage(1, actionPageSize);
      setToast(t("operations.generated"));
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
    const nextTotal = Math.max(0, actionTotal - 1);
    const nextPage = Math.min(actionPage, Math.max(1, Math.ceil(nextTotal / actionPageSize)));
    await loadNextActionsPage(nextPage, actionPageSize);
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
    ? formatPreferredDate(value, { includeTime: true })
    : t("operations.neverRun");

  return <div className="page-stack operations-center">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t("operations.eyebrow")}</p><h1>{t("operations.title")}</h1><p>{t("operations.description")}</p></div>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} size={17}/>{t("operations.refresh")}</button>
    </section>
    {error && <InlineMessage type="error">{error}</InlineMessage>}

    <section className="surface operations-section release-readiness">
      <div className="surface-heading"><div><p className="eyebrow">{t("operations.releaseEyebrow")}</p><h2>{t("operations.releaseReadiness")}</h2><p>{t("operations.releaseHelp")}</p></div><StatusBadge tone={readiness?.ready?"green":"red"}>{t(readiness?.ready?"operations.releaseReady":"operations.releaseBlocked")}</StatusBadge></div>
      <div className="operations-insight-grid">
        <InsightCard value={`${readiness?.environment.configured??0}/${readiness?.environment.expected??0}`} label={t("operations.environment")} detail={t(readiness?.environment.core?"operations.coreConfigured":"operations.coreMissing")}/>
        <InsightCard value={String(readiness?.missingWorkers??4)} label={t("operations.missingWorkers")} detail={t((readiness?.staleWorkers??0)>0?"operations.workersUnhealthy":"operations.workersReady")}/>
        <InsightCard value={String(readiness?.failedJobs??0)} label={t("operations.failedJobs")} detail={t((readiness?.stuckJobs??0)>0?"operations.jobsStuck":"operations.jobsReady")}/>
        <InsightCard value={`${[readiness?.environment.delivery,...(readiness?.environment.webhooksEnabled?[readiness.environment.webhooks]:[]),...(readiness?.environment.integrationsEnabled?[readiness.environment.integrations]:[])].filter(Boolean).length}/${1+(readiness?.environment.webhooksEnabled?1:0)+(readiness?.environment.integrationsEnabled?1:0)}`} label={t("operations.externalServices")} detail={t("operations.externalServicesHelp")}/>
      </div>
      <div className="release-feature-flags"><StatusBadge tone={readiness?.environment.webhooksEnabled?readiness.environment.webhooks?"green":"red":"gray"}>{t(readiness?.environment.webhooksEnabled?"operations.webhooksEnabled":"operations.webhooksDisabled")}</StatusBadge><StatusBadge tone={readiness?.environment.integrationsEnabled?readiness.environment.integrations?"green":"red":"gray"}>{t(readiness?.environment.integrationsEnabled?"operations.integrationsEnabled":"operations.integrationsDisabled")}</StatusBadge><small>{t("operations.optionalWorkerHelp")}</small></div>
    </section>

    <section className="operations-insight-grid" aria-label={t("operations.businessInsights")}>
      <InsightCard value={`${insights?.retention.rate ?? 0}%`} label={t("operations.retention")} detail={t("operations.retentionDetail", { retained: insights?.retention.retained ?? 0, eligible: insights?.retention.eligible ?? 0 })}/>
      <InsightCard value={`${insights?.renewal.conversionRate ?? 0}%`} label={t("operations.renewalConversion")} detail={t("operations.renewalDetail", { renewed: insights?.renewal.renewed ?? 0, lost: insights?.renewal.lost ?? 0, overdue: insights?.renewal.overdue ?? 0 })}/>
      <InsightCard value={`${insights?.forecast.accuracy ?? 0}%`} label={t("operations.forecastAccuracy")} detail={t("operations.forecastDetail", { forecast: insights?.forecast.forecast ?? 0, actual: insights?.forecast.actual ?? 0 })}/>
      <InsightCard value={`${insights?.queueSla.attainment ?? 0}%`} label={t("operations.queueAttainment")} detail={t("operations.queueDetail", { pending: insights?.queueSla.pending ?? 0, breached: insights?.queueSla.breached ?? 0 })}/>
      <InsightCard value={`${insights?.nextBestAction.adoptionRate ?? 0}%`} label={t("operations.nbaAdoption")} detail={t("operations.nbaDetail", { accepted: insights?.nextBestAction.accepted ?? 0, rejected: insights?.nextBestAction.rejected ?? 0, completed: insights?.nextBestAction.completed ?? 0 })}/>
    </section>

    <section className="surface operations-section">
      <div className="surface-heading"><div><p className="eyebrow">{t("operations.queueEyebrow")}</p><h2>{t("operations.queues")}</h2></div><Database size={20}/></div>
      <div className="operations-queue-grid">{snapshot?.queues.map((queue) => <article key={queue.key}>
        <span className={queue.failed || queue.breached || queue.stuck ? "red" : queue.pending ? "amber" : "green"}>{queue.failed || queue.breached || queue.stuck ? <TriangleAlert size={19}/> : <Activity size={19}/>}</span>
        <div><b>{t(`operations.key.${queue.key}`)}</b><small>{queue.oldest ? t("operations.oldest", { date: formatDate(queue.oldest) }) : t("operations.emptyQueue")}</small><small>{t("operations.queueSla", { minutes: queue.slaMinutes, stuck: queue.stuck, breached: queue.breached })}</small></div>
        <strong>{t("operations.pending", { count: queue.pending })}</strong>
        <StatusBadge tone={queue.failed || queue.breached ? "red" : "green"}>{t("operations.failed", { count: queue.failed })}</StatusBadge>
      </article>)}</div>
    </section>

    <div className="operations-two-column">
      <section className="surface operations-section">
        <div className="surface-heading"><div><p className="eyebrow">{t("operations.workerEyebrow")}</p><h2>{t("operations.workers")}</h2></div><Activity size={20}/></div>
        <div className="worker-list">{snapshot?.workers.map((worker) => <article key={worker.key}>
          <span className={worker.stale || worker.consecutiveFailures ? "red" : "green"}>{worker.stale ? <TriangleAlert size={17}/> : <Check size={17}/>}</span>
          <div><b>{t(`operations.key.${worker.key}`)}</b><small>{formatDate(worker.lastSeenAt)} · {t("operations.failures", { count: worker.consecutiveFailures })}</small>{worker.lastError && <small className="error-text">{worker.lastError}</small>}</div>
          <StatusBadge tone={worker.stale || worker.consecutiveFailures ? "red" : "green"}>{t(worker.stale ? "operations.workerStale" : "operations.workerHealthy")}</StatusBadge>
        </article>)}
        {!snapshot?.workers.length && <div className="empty-state"><span>{t("operations.neverRun")}</span></div>}</div>
      </section>

      <section className="surface operations-section">
        <div className="surface-heading"><div><p className="eyebrow">{t("operations.recoveryEyebrow")}</p><h2>{t("operations.retryable")}</h2></div><RotateCcw size={20}/></div>
        <div className="retry-list">{retryableJobs.map((job) => <article key={`${job.type}:${job.id}`}>
          <div><b>{job.label}</b><small>{t(`operations.key.${job.type}`)} · {formatDate(job.updatedAt)}</small><small className="error-text">{job.error || t(`operations.jobStatus.${job.status}`)}</small></div>
          <button className="secondary-button" type="button" onClick={() => void retry(job)}><RotateCcw size={15}/>{t("operations.retry")}</button>
        </article>)}
        {!retryableJobs.length && <div className="empty-state"><span>{t("operations.noRetryable")}</span></div>}</div>
        <Pagination
          page={retryPage}
          totalPages={Math.max(1, Math.ceil(retryTotal / retryPageSize))}
          total={retryTotal}
          pageSize={retryPageSize}
          onPage={(value) => void loadRetryablePage(value, retryPageSize)}
          onPageSize={(value) => void loadRetryablePage(1, value)}
        />
      </section>
    </div>

    <section className="surface operations-section">
      <div className="surface-heading"><div><p className="eyebrow">{t("operations.providerEyebrow")}</p><h2>{t("operations.integrations")}</h2><p>{t("operations.integrationHelp")}</p></div><CloudCog size={20}/></div>
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
          <label className="field"><span>{t("common.status")}</span><select value={draft.status} onChange={(event) => setIntegrationDrafts((current) => ({ ...current, [integration.provider]: { ...draft, status: event.target.value as IntegrationConnection["status"] } }))}>{(integration.status === "CONNECTED" || integration.status === "DEGRADED" ? ["DISCONNECTED","CONNECTING","CONNECTED","DEGRADED","ACTION_REQUIRED"] : ["DISCONNECTED","CONNECTING","ACTION_REQUIRED"]).map((value) => <option key={value} value={value}>{t(`operations.status.${value}`)}</option>)}</select></label>
          <label className="field"><span>{t("operations.syncDirection")}</span><select value={draft.syncDirection} onChange={(event) => setIntegrationDrafts((current) => ({ ...current, [integration.provider]: { ...draft, syncDirection: event.target.value as IntegrationConnection["syncDirection"] } }))}>{["NONE","IMPORT_ONLY","EXPORT_ONLY","BIDIRECTIONAL"].map((value) => <option key={value} value={value}>{t(`operations.sync.${value}`)}</option>)}</select></label>
          <label className="field"><span>{t("operations.accountLabel")}</span><input value={draft.accountLabel} maxLength={160} onChange={(event) => setIntegrationDrafts((current) => ({ ...current, [integration.provider]: { ...draft, accountLabel: event.target.value } }))}/></label>
          <div className="integration-buttons"><button className="secondary-button" type="button" disabled={integrationPending === integration.provider} onClick={() => void configure(integration.provider)}>{t("common.save")}</button><button className="primary-button" type="button" disabled={integrationPending === integration.provider || integration.status !== "CONNECTED" || integration.syncDirection === "NONE"} onClick={() => void sync(integration.provider)}><RefreshCw size={15}/>{t("operations.syncNow")}</button></div>
        </div></details>
      </article>})}</div>
    </section>

    <section className="surface operations-section">
      <div className="surface-heading"><div><p className="eyebrow">{t("operations.rulesEyebrow")}</p><h2>{t("operations.nextActions")}</h2><p>{t("operations.nextActionsHelp")}</p></div><button className="secondary-button" type="button" disabled={loading} onClick={() => void generate()}><Lightbulb size={16}/>{t("operations.generate")}</button></div>
      <InlineMessage type="info">{t(aiProviderConfigured?"ai.providerConfigured":"ai.providerDisabled")}</InlineMessage>
      <div className="next-action-grid">{nextActions.map((item) => <article key={item.id}>
        <div className="next-action-heading"><span className={item.priority.toLowerCase()}><Lightbulb size={18}/></span><div><b>{locale === "zh-CN" ? item.titleZh : item.titleEn}</b><small>{locale === "zh-CN" ? item.organizationNameZh : item.organizationNameEn}</small></div><StatusBadge tone={item.priority === "HIGH" ? "red" : "amber"}>{t(`modules.priority.${item.priority.toLowerCase()}`)}</StatusBadge></div>
        <p>{locale === "zh-CN" ? item.rationaleZh : item.rationaleEn}</p>
        <small>{t("operations.ruleEvidence", { rule: `${item.ruleKey}/${item.ruleVersion}`, confidence: Math.round(item.confidence * 100) })}</small>
        <small>{t("operations.validUntil", { date: formatDate(item.validUntil) })}</small>
        {rejecting === item.id ? <div className="reject-row"><input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder={t("operations.rejectReason")} maxLength={500}/><button type="button" disabled={!rejectReason.trim()} onClick={() => void decide(item, "REJECTED")}><Check size={15}/></button><button type="button" onClick={() => setRejecting("")}><X size={15}/></button></div> : <div className="next-action-buttons"><button className="primary-button" type="button" onClick={() => void decide(item, "ACCEPTED")}><Check size={15}/>{t("operations.accept")}</button><button className="secondary-button" type="button" onClick={() => setRejecting(item.id)}><X size={15}/>{t("operations.reject")}</button></div>}
      </article>)}
      {!nextActions.length && <div className="empty-state"><span>{t("operations.noActions")}</span></div>}</div>
      <Pagination
        page={actionPage}
        totalPages={Math.max(1, Math.ceil(actionTotal / actionPageSize))}
        total={actionTotal}
        pageSize={actionPageSize}
        onPage={(value) => void loadNextActionsPage(value, actionPageSize)}
        onPageSize={(value) => void loadNextActionsPage(1, value)}
      />
    </section>

    <section className="surface operations-section permission-explainer">
      <div className="surface-heading"><div><p className="eyebrow">{t("operations.authorizationEyebrow")}</p><h2>{t("operations.permission")}</h2><p>{t("operations.permissionHelp")}</p></div><ShieldQuestion size={20}/></div>
      <form onSubmit={explain}><label className="field"><span>{t("operations.resourceType")}</span><select name="resourceType">{["ORGANIZATION","CONTACT","OPPORTUNITY","CONTRACT","APPOINTMENT","TASK","QUOTE"].map((value) => <option key={value} value={value}>{t(`operations.resource.${value}`)}</option>)}</select></label><label className="field"><span>{t("operations.resourceId")}</span><input name="resourceId" type="text" pattern="[0-9a-fA-F-]{36}" required/></label><label className="field"><span>{t("operations.action")}</span><select name="action">{["READ","EDIT","DELETE","APPROVE","RETRY"].map((value) => <option key={value} value={value}>{t(`operations.action.${value}`)}</option>)}</select></label><button className="primary-button" type="submit">{t("operations.explain")}</button></form>
      {permission && <InlineMessage type={permission.allowed ? "success" : "warning"}><b>{t(permission.allowed ? "operations.allowed" : "operations.denied")}</b> · {t("operations.reason", { reason: permission.reason ?? "UNKNOWN" })} · {t("operations.mfa", { level: permission.mfaLevel ?? "unknown" })}</InlineMessage>}
    </section>
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

function InsightCard({ value, label, detail }: { value: string; label: string; detail: string }) {
  return <article className="surface operations-insight-card"><strong>{value}</strong><b>{label}</b><small>{detail}</small></article>;
}
