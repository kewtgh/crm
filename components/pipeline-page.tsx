"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CircleDollarSign, Plus, RefreshCcw, Sparkles, UserRound } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { useI18n } from "@/components/i18n-provider";
import {
  AccessibleDrawer,
  InlineMessage,
  Pagination,
  SearchableSelect,
  SearchField,
  StatusBadge,
  Toast,
} from "@/components/ui";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import {
  activeOpportunityStages,
  createOpportunitySchema,
  opportunityStageProbability,
  opportunityStages,
  transitionOpportunitySchema,
  type OpportunityStage,
} from "@/lib/opportunity-schema";
import type { FunnelMetric, OpportunityRecord } from "@/lib/sales-repository";
import { useUserPreferences } from "@/components/user-preferences-context";

const stageTone: Record<OpportunityStage, string> = {
  DISCOVERY: "blue",
  EVALUATION: "purple",
  HESITATION: "amber",
  PAYMENT: "green",
  WON: "green",
  LOST: "gray",
};

type ProductOption = { id: string; nameZh: string; nameEn: string; active: boolean };
type OpportunityPage = { items: OpportunityRecord[]; total: number; funnel: FunnelMetric[] };
type TransitionState = { item: OpportunityRecord; stage: OpportunityStage };

export function PipelinePage({
  initialItems,
  initialTotal,
  initialFunnel,
  persistent = true,
}: {
  initialItems: OpportunityRecord[];
  initialTotal: number;
  initialFunnel: FunnelMetric[];
  persistent?: boolean;
}) {
  const { locale, t } = useI18n();
  const { formatDate } = useUserPreferences();
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [funnel, setFunnel] = useState(initialFunnel);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [drawerError, setDrawerError] = useState("");
  const [toast, setToast] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [transition, setTransition] = useState<TransitionState | null>(null);
  const [organization, setOrganization] = useState("");
  const [organizationOptions, setOrganizationOptions] = useState<Array<{ value: string; label: string; detail: string }>>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [product, setProduct] = useState("");
  const [productOptions, setProductOptions] = useState<Array<{ value: string; label: string }>>([]);
  const pageSize = 24;

  const funnelMap = useMemo(() => new Map(funnel.map((item) => [item.stage, item])), [funnel]);
  const currency = items[0]?.currency ?? "CNY";
  const money = (value: number, currencyCode = currency) => new Intl.NumberFormat(
    locale === "zh-CN" ? "zh-CN" : "en-US",
    {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
      notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    },
  ).format(value);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const groups = useMemo(
    () => opportunityStages.map((stage) => ({ stage, items: items.filter((item) => item.stage === stage) })),
    [items],
  );

  const describeError = useCallback((caught: unknown, fallbackKey: string) => {
    if (!(caught instanceof ApiClientError)) return t(fallbackKey);
    if (caught.code === "NEXT_ACTION_REQUIRED") return t("pipeline.transition.nextRequired");
    if (caught.code === "WON_EVIDENCE_REQUIRED") return t("pipeline.transition.evidenceRequired");
    if (caught.code === "LOST_REASON_REQUIRED") return t("pipeline.transition.reasonRequired");
    return `${t(fallbackKey)}${caught.requestId ? ` · ${t("common.requestId")}: ${caught.requestId}` : ""}`;
  }, [t]);

  const load = useCallback(async (nextPage: number, nextQuery: string) => {
    if (!persistent) return;
    setLoading(true);
    setError("");
    try {
      const result = await apiFetch<OpportunityPage>(
        `/api/opportunities?page=${nextPage}&pageSize=${pageSize}&query=${encodeURIComponent(nextQuery)}`,
      );
      const nextPages = Math.max(1, Math.ceil(result.total / pageSize));
      if (nextPage > nextPages) {
        setPage(nextPages);
        return;
      }
      setItems(result.items);
      setTotal(result.total);
      setFunnel(result.funnel);
    } catch (caught) {
      setError(describeError(caught, "pipeline.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [describeError, persistent]);

  useEffect(() => {
    if (page === 1 && !query) return;
    const timer = window.setTimeout(() => void load(page, query), 250);
    return () => window.clearTimeout(timer);
  }, [load, page, query]);

  useEffect(() => {
    if (!createOpen || productOptions.length) return;
    void apiFetch<{ items: ProductOption[] }>("/api/products")
      .then((result) => setProductOptions(
        result.items
          .filter((item) => item.active)
          .map((item) => ({ value: item.id, label: locale === "zh-CN" ? item.nameZh : item.nameEn })),
      ))
      .catch((caught) => setDrawerError(describeError(caught, "pipeline.productsLoadFailed")));
  }, [createOpen, describeError, locale, productOptions.length]);

  const searchOrganizations = useCallback(async (value: string) => {
    setRelatedLoading(true);
    try {
      const result = await apiFetch<{ items: Array<{ value: string; labelZh: string; labelEn: string; type: string }> }>(
        `/api/search/related?q=${encodeURIComponent(value)}`,
      );
      setOrganizationOptions(result.items
        .filter((item) => item.type === "ORGANIZATION")
        .map((item) => ({
          value: item.value.split(":")[1],
          label: locale === "zh-CN" ? item.labelZh : item.labelEn,
          detail: t("pipeline.organization"),
        })));
    } catch (caught) {
      setDrawerError(describeError(caught, "pipeline.loadFailed"));
    } finally {
      setRelatedLoading(false);
    }
  }, [describeError, locale, t]);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDrawerError("");
    const form = new FormData(event.currentTarget);
    const stage = String(form.get("stage")) as OpportunityStage;
    const parsed = createOpportunitySchema.safeParse({
      organizationId: organization,
      productId: product || null,
      titleZh: String(form.get("titleZh") ?? ""),
      titleEn: String(form.get("titleEn") ?? ""),
      stage,
      amount: Number(form.get("amount")),
      currency: String(form.get("currency") ?? "").toUpperCase(),
      probability: opportunityStageProbability[stage],
      expectedCloseDate: String(form.get("expectedCloseDate") ?? ""),
      nextActionZh: String(form.get("nextActionZh") ?? ""),
      nextActionEn: String(form.get("nextActionEn") ?? ""),
    });
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? t("pipeline.form"));
      setDrawerError(t("pipeline.createFailed", { field }));
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/api/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      setCreateOpen(false);
      setOrganization("");
      setProduct("");
      setPage(1);
      await load(1, query);
      setToast(t("pipeline.created"));
    } catch (caught) {
      setDrawerError(describeError(caught, "pipeline.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitTransition = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!transition) return;
    setDrawerError("");
    const form = new FormData(event.currentTarget);
    const isTerminal = transition.stage === "WON" || transition.stage === "LOST";
    const parsed = transitionOpportunitySchema.safeParse({
      stage: transition.stage,
      probability: opportunityStageProbability[transition.stage],
      expectedCloseDate: isTerminal
        ? transition.item.expectedCloseDate
        : String(form.get("expectedCloseDate") ?? ""),
      nextActionZh: isTerminal
        ? transition.item.nextActionZh
        : String(form.get("nextActionZh") ?? ""),
      nextActionEn: isTerminal
        ? transition.item.nextActionEn
        : String(form.get("nextActionEn") ?? ""),
      reason: String(form.get("reason") ?? ""),
      evidence: String(form.get("evidence") ?? ""),
    });
    if (!parsed.success) {
      setDrawerError(describeError(new ApiClientError(parsed.error.issues[0]?.message ?? "INVALID_INPUT", 400), "pipeline.stageFailed"));
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/opportunities/${transition.item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      setTransition(null);
      await load(page, query);
      setToast(t("pipeline.stageUpdated"));
    } catch (caught) {
      setDrawerError(describeError(caught, "pipeline.stageFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const activeFunnel = funnel.filter((item) => item.stage !== "WON" && item.stage !== "LOST");
  const activeCount = activeFunnel.reduce((sum, item) => sum + item.count, 0);
  const totalAmount = activeFunnel.reduce((sum, item) => sum + item.amount, 0);
  const weighted = activeFunnel.reduce((sum, item) => sum + item.weighted, 0);
  const paymentAmount = funnelMap.get("PAYMENT")?.amount ?? 0;

  return <div className="page-stack pipeline-page">
    <section className="page-heading-row">
      <div>
        <p className="eyebrow">{t("eyebrow.revenueMomentum")}</p>
        <h1>{t("pipeline.title")}</h1>
        <p>{t("pipeline.description")}</p>
      </div>
      <div className="page-actions">
        <button className="primary-button" type="button" onClick={() => { setCreateOpen(true); setDrawerError(""); }}>
          <Plus size={17}/>{t("pipeline.new")}
        </button>
      </div>
    </section>
    {error && <InlineMessage type="error">{error}</InlineMessage>}
    <section className="pipeline-summary">
      <span><CircleDollarSign size={19}/><div><small>{t("pipeline.total")}</small><b>{money(totalAmount)}</b></div></span>
      <span><Sparkles size={19}/><div><small>{t("pipeline.weighted")}</small><b>{money(weighted)}</b></div></span>
      <span><CalendarDays size={19}/><div><small>{t("pipeline.paymentStage")}</small><b>{money(paymentAmount)}</b></div></span>
      <span><UserRound size={19}/><div><small>{t("pipeline.active")}</small><b>{activeCount}</b></div></span>
    </section>
    <section className="surface table-toolbar">
      <SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("pipeline.search")}/>
      <button className="icon-button" type="button" disabled={loading} aria-label={t("common.retry")} onClick={() => load(page, query)}>
        <RefreshCcw className={loading ? "spin" : ""} size={16}/>
      </button>
    </section>
    {items.length
      ? <div className="kanban-scroll">
        <section className="kanban-board">
          {groups.map((group) => <div className="kanban-column" key={group.stage}>
            <div className="kanban-heading">
              <span><i className={stageTone[group.stage]}/><b>{t(`sales.stage.${group.stage.toLowerCase()}`)}</b><small>{funnelMap.get(group.stage)?.count ?? group.items.length}</small></span>
              <b>{money(funnelMap.get(group.stage)?.amount ?? 0)}</b>
            </div>
            <div className="kanban-cards">
              {group.items.map((card) => <article className="opportunity-card" key={card.id}>
                <span className="opportunity-top">
                  <StatusBadge tone={stageTone[card.stage]}>{t(`sales.stage.${card.stage.toLowerCase()}`)}</StatusBadge>
                  <select
                    aria-label={t("pipeline.changeStage", { title: locale === "zh-CN" ? card.titleZh : card.titleEn })}
                    value={card.stage}
                    onChange={(event) => {
                      const stage = event.target.value as OpportunityStage;
                      if (stage !== card.stage) {
                        setDrawerError("");
                        setTransition({ item: card, stage });
                      }
                    }}
                  >
                    {opportunityStages.map((stage) => <option value={stage} key={stage}>{t(`sales.stage.${stage.toLowerCase()}`)}</option>)}
                  </select>
                </span>
                <b>{locale === "zh-CN" ? card.titleZh : card.titleEn}</b>
                <small>{locale === "zh-CN" ? card.organizationZh : card.organizationEn}</small>
                <div className="opportunity-meta">
                  <b>{money(card.amount, card.currency)}</b>
                  <span><CalendarDays size={13}/>{card.expectedCloseDate
                    ? formatDate(card.expectedCloseDate, { dateOnly: true })
                    : t("common.notSet")}</span>
                </div>
                <div className="opportunity-footer">
                  <span className="mini-avatar">{card.ownerEn.split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || "—"}</span>
                  <span className="next-action">{locale === "zh-CN" ? card.nextActionZh : card.nextActionEn || t("pipeline.nextNeeded")}</span>
                </div>
              </article>)}
            </div>
            <button className="add-kanban" type="button" onClick={() => setCreateOpen(true)}><Plus size={15}/>{t("pipeline.add")}</button>
          </div>)}
        </section>
      </div>
      : <EmptyState messageKey="pipeline.empty"/>}
    <Pagination page={Math.min(page, pages)} totalPages={pages} total={total} pageSize={pageSize} onPage={setPage}/>
    <p className="kanban-note">{t("pipeline.note")}</p>

    {createOpen && <AccessibleDrawer
      title={t("pipeline.new")}
      eyebrow={t("eyebrow.revenueMomentum")}
      description={t("pipeline.createHelp")}
      onClose={() => setCreateOpen(false)}
    >
      <form onSubmit={create}>
        <SearchableSelect label={`${t("pipeline.organization")} *`} options={organizationOptions} value={organization} onChange={setOrganization} onSearch={searchOrganizations} loading={relatedLoading}/>
        <SearchableSelect label={t("products.title")} options={productOptions} value={product} onChange={setProduct}/>
        <div className="form-grid two-column">
          <label className="field"><span>{t("products.nameZh")} *</span><input name="titleZh" required maxLength={160}/></label>
          <label className="field"><span>{t("products.nameEn")} *</span><input name="titleEn" required maxLength={180}/></label>
        </div>
        <div className="form-grid two-column">
          <label className="field"><span>{t("common.status")} *</span><select name="stage" defaultValue="DISCOVERY">{activeOpportunityStages.map((stage) => <option value={stage} key={stage}>{t(`sales.stage.${stage.toLowerCase()}`)}</option>)}</select></label>
          <label className="field"><span>{t("pipeline.expectedClose")} *</span><input name="expectedCloseDate" type="date" required/></label>
        </div>
        <div className="form-grid two-column">
          <label className="field"><span>{t("pipeline.amount")} *</span><input name="amount" type="number" min="0" step="100" required/></label>
          <label className="field"><span>{t("pipeline.currency")} *</span><input name="currency" defaultValue="CNY" pattern="[A-Za-z]{3}" required/></label>
        </div>
        <div className="form-grid two-column">
          <label className="field"><span>{t("pipeline.nextActionZh")} *</span><textarea name="nextActionZh" rows={3} maxLength={300} required/></label>
          <label className="field"><span>{t("pipeline.nextActionEn")} *</span><textarea name="nextActionEn" rows={3} maxLength={300} required/></label>
        </div>
        {drawerError && <InlineMessage type="error">{drawerError}</InlineMessage>}
        <div className="drawer-actions">
          <button className="secondary-button" type="button" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</button>
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? t("common.saving") : t("common.create")}</button>
        </div>
      </form>
    </AccessibleDrawer>}

    {transition && <AccessibleDrawer
      title={t("pipeline.transition.title")}
      eyebrow={t("pipeline.transition.eyebrow")}
      description={t("pipeline.transition.description")}
      onClose={() => setTransition(null)}
    >
      <form onSubmit={submitTransition}>
        <div className="transition-summary">
          <span><small>{t("pipeline.transition.opportunity")}</small><b>{locale === "zh-CN" ? transition.item.titleZh : transition.item.titleEn}</b></span>
          <span><small>{t("pipeline.transition.target")}</small><StatusBadge tone={stageTone[transition.stage]}>{t(`sales.stage.${transition.stage.toLowerCase()}`)}</StatusBadge></span>
        </div>
        {transition.stage !== "WON" && transition.stage !== "LOST" && <>
          <label className="field"><span>{t("pipeline.expectedClose")} *</span><input name="expectedCloseDate" type="date" defaultValue={transition.item.expectedCloseDate ?? ""} required/></label>
          <div className="form-grid two-column">
            <label className="field"><span>{t("pipeline.nextActionZh")} *</span><textarea name="nextActionZh" rows={4} defaultValue={transition.item.nextActionZh} maxLength={300} required/></label>
            <label className="field"><span>{t("pipeline.nextActionEn")} *</span><textarea name="nextActionEn" rows={4} defaultValue={transition.item.nextActionEn} maxLength={300} required/></label>
          </div>
        </>}
        {transition.stage === "WON" && <label className="field"><span>{t("pipeline.transition.evidence")} *</span><textarea name="evidence" rows={5} maxLength={1000} required placeholder={t("pipeline.transition.evidenceHelp")}/></label>}
        {transition.stage === "LOST" && <label className="field"><span>{t("pipeline.transition.reason")} *</span><textarea name="reason" rows={5} maxLength={500} required placeholder={t("pipeline.transition.reasonHelp")}/></label>}
        {drawerError && <InlineMessage type="error">{drawerError}</InlineMessage>}
        <div className="drawer-actions">
          <button className="secondary-button" type="button" onClick={() => setTransition(null)}>{t("common.cancel")}</button>
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? t("common.saving") : t("pipeline.transition.confirm")}</button>
        </div>
      </form>
    </AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}
