"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileDown,
  FileCheck2,
  RefreshCcw,
  ShieldAlert,
  Signature,
  Plus,
} from "lucide-react";
import { AccessibleDrawer, InlineMessage, Pagination, ProgressBar, SearchableSelect, SearchField, StatusBadge, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import type { ContractRecord, ContractSummary } from "@/lib/contract-repository";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { useUserPreferences } from "@/components/user-preferences-context";
import { useRemoteSearch } from "@/hooks/use-remote-search";
import { useCapability } from "@/components/app-user-context";

type Contract = ContractRecord;
type RenewalPlaybookContext = {
  daysRemaining: number;
  healthScore: number;
  overdue: boolean;
  existing: null | { id:string;stage:string;risk:string;actionZh:string;actionEn:string;dueAt:string;outcome:string;healthScore:number;windowDays:number };
  suggestion: { stage:string;risk:string;actionZh:string;actionEn:string;dueAt:string;healthScore:number;windowDays:number };
};

const statusTone = (status: Contract["status"]) => status === "RISK" ? "red" : status === "NEGOTIATING" ? "purple" : status === "RENEWAL_PREP" ? "amber" : status === "ACTIVE" ? "green" : "gray";
const relationshipKeys = ["", "sales.relationship.contact", "sales.relationship.meal", "sales.relationship.family", "sales.relationship.advocacy"];
const statusKeys: Record<Contract["status"],string> = { DRAFT:"contracts.status.draft", PENDING_APPROVAL:"contracts.status.pending", ACTIVE:"contracts.status.active", RENEWAL_PREP:"contracts.status.preparing", NEGOTIATING:"contracts.status.negotiating", EXPIRED:"contracts.status.expired", CANCELLED:"contracts.status.cancelled", RISK:"contracts.status.risk" };

export function ContractsPage({ initialContracts = [], initialTotal = 0, initialSummary, persistent = false }: { initialContracts?: Contract[]; initialTotal?: number; initialSummary:ContractSummary; persistent?: boolean }) {
  const { locale, t } = useI18n();
  const canManage=useCapability("contracts.manage");
  const canRequestExport=useCapability("exports.request");
  const { formatDate, localDateTimeInput, localDateTimeToIso, todayKey } = useUserPreferences();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize,setPageSize]=useState(10);
  const [renewalPage,setRenewalPage]=useState(1);
  const [renewalPageSize,setRenewalPageSize]=useState(10);
  const [records,setRecords]=useState(initialContracts);const [total,setTotal]=useState(initialTotal);const [loading,setLoading]=useState(false);
  const [summary,setSummary]=useState(initialSummary);
  const [toast, setToast] = useState("");
  const [flowError, setFlowError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [approvalPending, setApprovalPending] = useState(false);
  const [createOpen,setCreateOpen]=useState(false);const [organization,setOrganization]=useState("");const [organizationOptions,setOrganizationOptions]=useState<Array<{value:string;label:string;detail:string}>>([]);const [organizationLoading,setOrganizationLoading]=useState(false);const [product,setProduct]=useState("");const [productOptions,setProductOptions]=useState<Array<{value:string;label:string}>>([]);const [formError,setFormError]=useState("");const [renewalPending,setRenewalPending]=useState("");
  const [playbookOpen,setPlaybookOpen]=useState(false);const [playbookSaving,setPlaybookSaving]=useState(false);const [playbookLoading,setPlaybookLoading]=useState(false);const [playbookContext,setPlaybookContext]=useState<RenewalPlaybookContext|null>(null);
  const runOrganizationSearch=useRemoteSearch();
  const runContractLoad=useRemoteSearch();
  const filtered = useMemo(() => records.filter((contract) => {
    const matchesQuery = `${contract.customer} ${contract.english} ${contract.owner}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || contract.status === status);
  }), [query, records, status]);
  const totalPages = Math.max(1, Math.ceil((persistent?total:filtered.length) / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = persistent?records:filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const renewals = summary.renewalAlerts;
  const renewalPages=Math.max(1,Math.ceil(renewals.length/renewalPageSize));
  const safeRenewalPage=Math.min(renewalPage,renewalPages);
  const visibleRenewals=renewals.slice((safeRenewalPage-1)*renewalPageSize,safeRenewalPage*renewalPageSize);
  const load=useCallback(async(nextPage:number)=>{setLoading(true);const result=await runContractLoad(signal=>apiFetch<{items:Contract[];total?:number;summary:ContractSummary}>(`/api/contracts?page=${nextPage}&pageSize=${pageSize}&status=${encodeURIComponent(status)}&query=${encodeURIComponent(query)}`,{signal}));if(!result.current)return;setLoading(false);if("error" in result){setFlowError(presentApiError(result.error,t,"contracts.loadFailed").message);return;}setRecords(result.value.items);setTotal(result.value.total??result.value.items.length);setSummary(result.value.summary);},[pageSize,query,runContractLoad,status,t]);
  useEffect(()=>{if(!persistent)return;const timer=setTimeout(()=>void load(page),250);return()=>clearTimeout(timer);},[load,page,persistent]);
  useEffect(()=>{if(!createOpen)return;void apiFetch<{items?:Array<{id:string;nameZh:string;nameEn:string;active:boolean}>}>("/api/products").then(result=>setProductOptions((result.items??[]).filter(item=>item.active).map(item=>({value:item.id,label:locale==="zh-CN"?item.nameZh:item.nameEn})))).catch(caught=>setFormError(presentApiError(caught,t,"contracts.productsLoadFailed").message));},[createOpen,locale,t]);
  const money = (value:number,currency="CNY") => new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en", { style:"currency",currency,maximumFractionDigits:0,notation:value>=1_000_000?"compact":"standard" }).format(value);
  const renewalAmount=Object.entries(summary.renewalByCurrency).map(([currency,value])=>money(value,currency)).join(" · ")||money(0);
  const requestApproval=async(type:"CONTRACT_SIGN"|"CONTRACT_EXPORT")=>{setFlowError("");if(!selectedId){setFlowError(t("flow.selectContract"));return;}setApprovalPending(true);try{await apiFetch("/api/approvals",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type,objectType:"CONTRACT",objectId:selectedId,reason:t(type==="CONTRACT_SIGN"?"approval.reason.sign":"approval.reason.export")})});setToast(t("flow.approvalRequested"));}catch(caught){setFlowError(presentApiError(caught,t,"flow.approvalFailed").message);}finally{setApprovalPending(false);}};
  const searchOrganizations=async(value:string)=>{setOrganizationLoading(true);const result=await runOrganizationSearch(signal=>apiFetch<{items?:Array<{value:string;labelZh:string;labelEn:string;type:string}>}>(`/api/search/related?q=${encodeURIComponent(value)}`,{signal}));if(!result.current)return;setOrganizationLoading(false);if("error" in result){setFormError(t("contracts.organizationRequired"));return;}setOrganizationOptions((result.value.items??[]).filter(item=>item.type==="ORGANIZATION").map(item=>({value:item.value.split(":")[1],label:locale==="zh-CN"?item.labelZh:item.labelEn,detail:t("contracts.customer")})));};
  const createContract=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();setFormError("");if(!organization){setFormError(t("contracts.organizationRequired"));return;}const form=new FormData(event.currentTarget);try{await apiFetch("/api/contracts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"create",contractNumber:String(form.get("contractNumber")),organizationId:organization,productId:product||null,startDate:String(form.get("startDate")),endDate:String(form.get("endDate")),currency:String(form.get("currency")).toUpperCase(),value:Number(form.get("value")),relationshipLevel:Number(form.get("relationshipLevel"))})});}catch(caught){setFormError(presentApiError(caught,t,"contracts.createFailed").message);return;}setCreateOpen(false);await load(1);setToast(t("contracts.created"));};
  const prepareRenewal=async(contract:Contract)=>{if(!canManage)return;setRenewalPending(contract.id);setFlowError("");try{await apiFetch("/api/contracts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"renewal",id:contract.id})});}catch(caught){setFlowError(presentApiError(caught,t,"contracts.renewalFailed").message);setRenewalPending("");return;}setRenewalPending("");await load(page);setToast(t("contracts.renewalCreated",{name:locale==="zh-CN"?contract.customer:contract.english}));};
  const openPlaybook=async()=>{if(!selectedId){setFlowError(t("contracts.playbookSelect"));return;}setPlaybookLoading(true);setFormError("");try{const result=await apiFetch<{context:RenewalPlaybookContext}>(`/api/contracts/${selectedId}/renewal-playbook`);setPlaybookContext(result.context);setPlaybookOpen(true);}catch(caught){setFlowError(presentApiError(caught,t,"contracts.playbookLoadFailed").message);}finally{setPlaybookLoading(false);}};
  const savePlaybook=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!selectedId)return;setPlaybookSaving(true);setFormError("");const form=new FormData(event.currentTarget);try{await apiFetch(`/api/contracts/${selectedId}/renewal-playbook`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({stage:form.get("stage"),risk:form.get("risk"),actionZh:form.get("actionZh"),actionEn:form.get("actionEn"),dueAt:localDateTimeToIso(String(form.get("dueAt"))),outcome:form.get("outcome")})});setPlaybookOpen(false);setToast(t("contracts.playbookSaved"));}catch(caught){setFormError(presentApiError(caught,t,"contracts.playbookFailed").message);}finally{setPlaybookSaving(false);}};
  const playbook=playbookContext?.existing??playbookContext?.suggestion;
  const quarterDate=todayKey();
  const quarter=Number(quarterDate.slice(5,7));

  return <div className="page-stack contracts-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("contracts.eyebrow")}</p><h1>{t("contracts.title")}</h1><p>{t("contracts.description")}</p></div><div className="page-actions">{canManage&&<button className="secondary-button" type="button" onClick={()=>{setCreateOpen(true);setFormError("");}}><Plus size={17}/>{t("contracts.new")}</button>}{canManage&&<button className="secondary-button" type="button" disabled={!selectedId||playbookLoading} onClick={()=>void openPlaybook()}><RefreshCcw className={playbookLoading?"spin":""} size={17}/>{t("contracts.playbook")}</button>}{canRequestExport&&<button className="secondary-button" type="button" disabled={approvalPending} onClick={() => requestApproval("CONTRACT_EXPORT")}><FileDown size={17} />{t("flow.requestExportApproval")}</button>}{canManage&&<button className="primary-button" type="button" disabled={approvalPending} onClick={() => requestApproval("CONTRACT_SIGN")}><Signature size={17} />{t("flow.requestSignApproval")}</button>}</div></section>
    {flowError&&<InlineMessage type="error">{flowError}</InlineMessage>}
    {loading&&<InlineMessage type="warning">{t("contracts.loading")}</InlineMessage>}

    <section className="contract-kpis">
      <ContractKpi icon={FileCheck2} tone="green" value={String(summary.validCount)} label={t("contracts.valid")} detail={t("contracts.validDetailCount",{count:summary.validCount})} />
      <ContractKpi icon={CalendarClock} tone="amber" value={String(summary.renewalCount)} label={t("contracts.in90Days")} detail={t("contracts.under30DaysCount",{count:summary.under30Count})} />
      <ContractKpi icon={CircleDollarSign} tone="blue" value={renewalAmount} label={t("contracts.renewalAmount")} detail={t("contracts.quarterWindow")} />
      <ContractKpi icon={ShieldAlert} tone="red" value={String(summary.riskCount)} label={t("contracts.highRisk")} detail={t("contracts.highRiskDetail")} />
    </section>

    <section className="surface contract-cycle-card">
      <div className="surface-heading"><div><p className="eyebrow">{t("contracts.lifecycleEyebrow")}</p><h2>{t("contracts.lifecycle")}</h2></div><StatusBadge tone="blue">{quarterDate.slice(0,4)} Q{Math.floor((quarter-1)/3)+1}</StatusBadge></div>
      <div className="contract-cycle"><CycleStep label={t("contracts.cycle.signed")} count={String(summary.lifecycle.draft)} detail={t("contracts.cycle.signedDetail")} tone="blue" /><CycleStep label={t("contracts.cycle.active")} count={String(summary.lifecycle.active)} detail={t("contracts.cycle.activeDetail")} tone="green" /><CycleStep label={t("contracts.cycle.preparing")} count={String(summary.lifecycle.preparing)} detail={t("contracts.cycle.preparingDetail")} tone="amber" /><CycleStep label={t("contracts.cycle.negotiating")} count={String(summary.lifecycle.negotiating)} detail={t("contracts.cycle.negotiatingDetail")} tone="purple" /><CycleStep label={t("contracts.cycle.risk")} count={String(summary.lifecycle.risk)} detail={t("contracts.cycle.riskDetail")} tone="red" /></div>
    </section>

    <section className="contracts-main-grid">
      <div className="surface contract-table-card">
        <div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("contracts.search")} /><div className="filter-chips"><button type="button" className={status === "all" ? "active" : ""} onClick={() => { setStatus("all"); setPage(1); }}>{t("common.all")}</button>{(["RENEWAL_PREP", "NEGOTIATING", "RISK"] as Contract["status"][]).map((item) => <button type="button" className={status === item ? "active" : ""} onClick={() => { setStatus(item); setPage(1); }} key={item}>{t(statusKeys[item])}</button>)}</div></div>
        <div className="table-scroll"><table className="contract-table"><thead><tr><th>{t("contracts.select")}</th><th>{t("contracts.customer")}</th><th>{t("contracts.period")}</th><th>{t("contracts.expiry")}</th><th>{t("contracts.renewalValue")}</th><th>{t("contracts.relationshipGoal")}</th><th>{t("common.owner")}</th><th>{t("common.status")}</th></tr></thead><tbody>{visible.map((contract) => <tr className={selectedId===contract.id?"selected":""} key={contract.id}><td><input type="radio" name="selectedContract" checked={selectedId===contract.id} onChange={()=>setSelectedId(contract.id)} aria-label={t("contracts.selectContract",{name:locale==="zh-CN"?contract.customer:contract.english})}/></td><td><b>{locale==="zh-CN"?contract.customer:contract.english}</b></td><td><span>{formatDate(contract.start,{dateOnly:true})}</span><small>{t("contracts.to",{date:formatDate(contract.end,{dateOnly:true})})}</small></td><td><b className={contract.days <= 30 ? "danger-text" : contract.days <= 90 ? "warn-text" : ""}>{t("contracts.days",{days:contract.days})}</b><small>{t(contract.days<=30?"contracts.renewNow":contract.days<=90?"contracts.prepareRenewal":"contracts.status.active")}</small></td><td><b>{money(contract.value,contract.currency)}</b><small>{t("contracts.annual")}</small></td><td><b>{t("contracts.relationshipLevelShort",{level:contract.relationLevel})}</b><small>{t(relationshipKeys[contract.relationLevel])}</small></td><td>{contract.owner}</td><td><StatusBadge tone={statusTone(contract.status)}>{t(statusKeys[contract.status])}</StatusBadge></td></tr>)}</tbody></table></div>
        <Pagination page={safePage} totalPages={totalPages} total={persistent?total:filtered.length} pageSize={pageSize} onPage={setPage} onPageSize={(value)=>{setPageSize(value);setPage(1);}} />
      </div>

      <aside className="surface renewal-reminder-panel"><div className="surface-heading"><div><p className="eyebrow">{t("contracts.renewalEyebrow")}</p><h2>{t("contracts.renewalAlerts")}</h2></div><span className="count-pill">{renewals.length}</span></div>{visibleRenewals.map((contract) => { const name=locale==="zh-CN"?contract.customer:contract.english; return <article className="renewal-reminder" key={contract.id}><span className={contract.days <= 30 ? "red" : "amber"}><RefreshCcw size={17} /></span><div><b>{name}</b><small>{t("contracts.daysRemaining",{days:contract.days})} · {money(contract.value,contract.currency)}</small><small>{t("contracts.relationshipLevel",{level:contract.relationLevel})} · {contract.owner}</small><ProgressBar value={Math.max(5, 100 - contract.days)} label={t(statusKeys[contract.status])} /></div><button type="button" disabled={!canManage||renewalPending===contract.id||contract.status==="RENEWAL_PREP"} aria-label={t("contracts.prepareRenewalFor",{name})} onClick={()=>prepareRenewal(contract)}><Check size={16} /></button></article>})}{!renewals.length && <div className="empty-state"><span>{t("contracts.allHandled")}</span><p>{t("contracts.newReminderHelp")}</p></div>}<Pagination page={safeRenewalPage} totalPages={renewalPages} total={renewals.length} pageSize={renewalPageSize} onPage={setRenewalPage} onPageSize={(value)=>{setRenewalPageSize(value);setRenewalPage(1);}}/><Link className="card-link" href="/calendar">{t("contracts.calendar")} <ChevronRight size={15} /></Link></aside>
    </section>
    {createOpen&&<AccessibleDrawer title={t("contracts.new")} eyebrow={t("contracts.eyebrow")} description={t("contracts.createHelp")} onClose={()=>setCreateOpen(false)}><form onSubmit={createContract}><SearchableSelect label={t("contracts.customer")} options={organizationOptions} value={organization} onChange={setOrganization} onSearch={searchOrganizations} loading={organizationLoading}/><SearchableSelect label={t("products.title")} options={productOptions} value={product} onChange={setProduct}/><label className="field"><span>{t("contracts.number")}</span><input name="contractNumber" required maxLength={80}/></label><div className="form-grid two-column"><label className="field"><span>{t("contracts.startDate")}</span><input name="startDate" type="date" required/></label><label className="field"><span>{t("contracts.endDate")}</span><input name="endDate" type="date" required/></label></div><div className="form-grid two-column"><label className="field"><span>{t("contracts.value")}</span><input name="value" type="number" min="0" step="100" required/></label><label className="field"><span>{t("contracts.currency")}</span><input name="currency" defaultValue="CNY" pattern="[A-Za-z]{3}" required/></label></div><label className="field"><span>{t("contracts.relationshipGoal")}</span><select name="relationshipLevel" defaultValue="1">{[1,2,3,4].map(level=><option value={level} key={level}>{t(relationshipKeys[level])}</option>)}</select></label>{formError&&<InlineMessage type="error">{formError}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" onClick={()=>setCreateOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit">{t("common.create")}</button></div></form></AccessibleDrawer>}
    {playbookOpen&&playbook&&<AccessibleDrawer title={t("contracts.playbook")} eyebrow={t("contracts.renewalEyebrow")} description={t("contracts.playbookHelp")} onClose={()=>setPlaybookOpen(false)}><div className="quick-summary"><span><b>{playbookContext?.daysRemaining}</b><small>{t("contracts.daysRemainingShort")}</small></span><span><b>{playbookContext?.healthScore}%</b><small>{t("contracts.healthScore")}</small></span><span><b>{playbook.windowDays}</b><small>{t("contracts.windowDays")}</small></span><span><b>{playbookContext?.overdue?t("common.yes"):t("common.no")}</b><small>{t("contracts.slaOverdue")}</small></span></div><form onSubmit={savePlaybook} key={`${selectedId}:${playbookContext?.existing?.id??"suggested"}`}><div className="form-grid two-column"><label className="field"><span>{t("contracts.playbookStage")}</span><select name="stage" defaultValue={playbook.stage}>{["NOT_STARTED","DISCOVERY","PROPOSAL","NEGOTIATION","COMMITTED","RENEWED","LOST"].map(item=><option value={item} key={item}>{t(`contracts.stage.${item}`)}</option>)}</select></label><label className="field"><span>{t("contracts.playbookRisk")}</span><select name="risk" defaultValue={playbook.risk}>{["LOW","MEDIUM","HIGH"].map(item=><option value={item} key={item}>{t(`contracts.risk.${item}`)}</option>)}</select></label></div><label className="field"><span>{t("contracts.playbookDue")}</span><input name="dueAt" type="datetime-local" defaultValue={localDateTimeInput(playbook.dueAt)} required/></label><label className="field"><span>{t("contracts.playbookActionZh")}</span><textarea name="actionZh" rows={3} minLength={2} maxLength={1000} defaultValue={playbook.actionZh} required/></label><label className="field"><span>{t("contracts.playbookActionEn")}</span><textarea name="actionEn" rows={3} minLength={2} maxLength={1000} defaultValue={playbook.actionEn} required/></label><label className="field"><span>{t("contracts.playbookOutcome")}</span><textarea name="outcome" rows={2} maxLength={1000} defaultValue={playbookContext?.existing?.outcome??""}/></label>{formError&&<InlineMessage type="error">{formError}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" onClick={()=>setPlaybookOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={playbookSaving}>{playbookSaving?t("common.saving"):t("common.save")}</button></div></form></AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

function ContractKpi({ icon: Icon, tone, value, label, detail }: { icon: React.ElementType; tone: string; value: string; label: string; detail: string }) {
  return <article className="surface contract-kpi"><span className={tone}><Icon size={21} /></span><div><b>{value}</b><span>{label}</span><small>{detail}</small></div></article>;
}

function CycleStep({ label, count, detail, tone }: { label: string; count: string; detail: string; tone: string }) {
  return <article><span className={tone}>{count}</span><div><b>{label}</b><small>{detail}</small></div><ChevronRight size={16} /></article>;
}
