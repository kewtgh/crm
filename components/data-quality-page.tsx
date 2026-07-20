"use client";

import { useState } from "react";
import { CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { QualityIssue } from "@/lib/phase2-repository";
import type { QualityRuleConfig } from "@/lib/v220-repository";
import { useI18n } from "./i18n-provider";
import { InlineMessage, Pagination, SearchField, StatusBadge, Toast } from "./ui";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { useRemoteSearch } from "@/hooks/use-remote-search";

type QualityTrend={snapshot_date:string;open_low:number;open_medium:number;open_high:number;resolved:number;dismissed:number;captured_at:string};
export function DataQualityPage({ initialItems, initialTotal,initialTrend,initialRules }: { initialItems: QualityIssue[]; initialTotal: number;initialTrend:QualityTrend[];initialRules:QualityRuleConfig[] }) {
  const { t } = useI18n();
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [trend,setTrend]=useState(initialTrend);
  const [rules,setRules]=useState(initialRules);
  const [page, setPage] = useState(1);
  const [pageSize,setPageSize]=useState(10);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState("");
  const [action, setAction] = useState<{ id: string; dismiss: boolean } | null>(null);
  const [resolution, setResolution] = useState("");
  const runLatest = useRemoteSearch();

  const load = async (nextPage = page, nextPageSize = pageSize) => {
    const request = await runLatest((signal) => apiFetch<{ items: QualityIssue[]; total: number;trend:QualityTrend[];rules:QualityRuleConfig[] }>(`/api/data-quality?page=${nextPage}&pageSize=${nextPageSize}&q=${encodeURIComponent(query)}`, { signal }));
    if (!request.current) return;
    if ("error" in request) {
      setError(t("quality.loadFailed"));
      return;
    }
    setError("");
    setItems(request.value.items);
    setTotal(request.value.total);
    setTrend(request.value.trend);
    setRules(request.value.rules);
  };

  const runRules = async () => {
    setPending(true);
    setError("");
    try {
      await apiFetch("/api/data-quality", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "run" }) });
    } catch {
      setPending(false);
      setError(t("quality.operationFailed"));
      return;
    }
    setPending(false);
    setPage(1);
    await load(1);
    setToast(t("quality.scanComplete"));
  };

  const submitResolution = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action || !resolution.trim()) return;
    setPending(true);
    setRowError(null);
    try {
      await apiFetch("/api/data-quality", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "resolve", id: action.id, resolution: resolution.trim(), dismiss: action.dismiss }),
      });
    } catch(caught) {
      setPending(false);
      setRowError({ id: action.id, message: t(caught instanceof ApiClientError&&caught.code==="QUALITY_SOURCE_NOT_FIXED"?"quality.stillInvalid":"quality.operationFailed") });
      return;
    }
    setPending(false);
    setAction(null);
    setResolution("");
    await load(page);
    setToast(t("quality.resolved"));
  };

  const beginResolution = (id: string, dismiss: boolean) => {
    setRowError(null);
    setResolution("");
    setAction({ id, dismiss });
  };

  const configureRule=async(rule:QualityRuleConfig,change:Partial<Pick<QualityRuleConfig,"enabled"|"severity">>)=>{setPending(true);setError("");try{await apiFetch("/api/data-quality",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"configure",ruleKey:rule.ruleKey,enabled:change.enabled??rule.enabled,severity:change.severity??rule.severity})});await load(page);setToast(t("quality.ruleSaved"));}catch{setError(t("quality.operationFailed"));}finally{setPending(false);}};
  const assignToMe=async(id:string)=>{setPending(true);setError("");try{await apiFetch("/api/data-quality",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"assign",id})});await load(page);setToast(t("quality.assigned"));}catch{setError(t("quality.operationFailed"));}finally{setPending(false);}};

  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="page-stack quality-page">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t("quality.eyebrow")}</p><h1>{t("quality.title")}</h1><p>{t("quality.description")}</p></div>
      <button className="primary-button" disabled={pending} onClick={() => void runRules()}><RefreshCw size={16} />{t("quality.run")}</button>
    </section>
    {error && <InlineMessage type="error">{error}</InlineMessage>}
    <section className="quick-summary"><span><b>{total}</b><small>{t("quality.openIssues")}</small></span><span><b>{items.filter((item) => item.severity === "HIGH").length}</b><small>{t("quality.highOnPage")}</small></span><span><b>{items.filter((item) => item.status === "ASSIGNED").length}</b><small>{t("quality.assignedOnPage")}</small></span></section>
    <section className="surface quality-trend-card"><div className="surface-heading"><div><h2>{t("quality.trend")}</h2><p>{t("quality.trendHelp")}</p></div></div>{trend.length?<div className="quality-trend" role="img" aria-label={t("quality.trend")}>{trend.map(item=>{const totalOpen=item.open_low+item.open_medium+item.open_high;const max=Math.max(1,...trend.map(point=>point.open_low+point.open_medium+point.open_high));return <div key={item.snapshot_date}><span style={{height:`${Math.max(totalOpen?6:0,totalOpen/max*100)}%`}} title={`${item.snapshot_date}: ${totalOpen}`}/><small>{item.snapshot_date.slice(5)}</small></div>;})}</div>:<div className="empty-state"><span>{t("quality.trendHelp")}</span></div>}</section>
    <section className="surface quality-rules"><div className="surface-heading"><div><h2>{t("quality.rules")}</h2><p>{t("quality.rulesHelp")}</p></div></div><div className="quality-rule-grid">{rules.map(rule=><article key={rule.id}><div><b>{t(qualityRuleKey(rule.ruleKey))}</b><small>{rule.ruleKey}</small></div><label><span>{t("quality.enabled")}</span><input type="checkbox" checked={rule.enabled} disabled={pending} onChange={event=>void configureRule(rule,{enabled:event.target.checked})}/></label><label><span>{t("quality.severityLabel")}</span><select value={rule.severity} disabled={pending} onChange={event=>void configureRule(rule,{severity:event.target.value as QualityRuleConfig["severity"]})}>{["LOW","MEDIUM","HIGH"].map(value=><option value={value} key={value}>{t(`quality.severity.${value.toLowerCase()}`)}</option>)}</select></label></article>)}</div></section>
    <section className="surface quality-list">
      <div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("quality.search")} /><button className="secondary-button" onClick={() => void load(1)}>{t("common.search")}</button></div>
      {items.map((item) => <article className="quality-row" key={item.id}>
        <span className={`quality-icon ${item.severity.toLowerCase()}`}><ShieldAlert size={17} /></span>
        <div><b>{t(item.titleKey)}</b><small>{t(`search.type.${item.entityType.toLowerCase()}`)} · {item.entityId.slice(0, 8)}</small><small>{Object.values(item.details).filter(Boolean).join(" / ")}</small>{qualityHref(item)&&<Link className="text-button" href={qualityHref(item)!}>{t("quality.openRecord")}</Link>}<small>{t("quality.fixFirst")}</small></div>
        <StatusBadge tone={item.severity === "HIGH" ? "red" : item.severity === "MEDIUM" ? "amber" : "blue"}>{t(`quality.severity.${item.severity.toLowerCase()}`)}</StatusBadge>
        <div className="quality-actions">{!item.assignedTo&&<button onClick={()=>void assignToMe(item.id)} disabled={pending}>{t("quality.assignToMe")}</button>}<button onClick={() => beginResolution(item.id, false)}><CheckCircle2 size={15} />{t("quality.verifyResolve")}</button><button onClick={() => beginResolution(item.id, true)}>{t("quality.dismiss")}</button></div>
        {action?.id === item.id && <form className="quality-resolution-form" onSubmit={submitResolution}>
          <label className="field"><span>{t(action.dismiss ? "quality.dismissReason" : "quality.resolvePrompt")}</span><textarea rows={3} value={resolution} onChange={(event) => setResolution(event.target.value)} required autoFocus /></label>
          {rowError?.id === item.id && <InlineMessage type="error">{rowError.message}</InlineMessage>}
          <div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setAction(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending || !resolution.trim()}>{pending ? t("common.saving") : t("common.confirm")}</button></div>
        </form>}
      </article>)}
      {!items.length && <div className="empty-state"><span>{t("quality.empty")}</span></div>}
      <Pagination page={page} totalPages={pages} total={total} pageSize={pageSize} onPage={(next) => { setPage(next); setAction(null); void load(next); }} onPageSize={(value)=>{setPageSize(value);setPage(1);setAction(null);void load(1,value);}} />
    </section>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

function qualityRuleKey(ruleKey:string){const key=ruleKey.toLowerCase().replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());return `quality.rule.${key}`;}

function qualityHref(item:QualityIssue){
  if(item.entityType==="ORGANIZATION")return `/schools/${item.entityId}`;
  if(item.entityType==="CONTACT")return `/people/${item.entityId}`;
  if(item.entityType==="STUDENT")return `/students?focus=${item.entityId}`;
  if(item.entityType==="LEAD")return `/leads?focus=${item.entityId}`;
  if(item.entityType==="TASK")return "/tasks";
  if(item.entityType==="OPPORTUNITY")return "/opportunities";
  if(item.entityType==="CONTRACT")return "/contracts";
  return null;
}
