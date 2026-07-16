"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { InlineMessage, Pagination, ProgressBar, SearchField, StatusBadge, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import type { ContractRecord } from "@/lib/contract-repository";

type Contract = ContractRecord;

const fallbackContracts: Contract[] = [
  { id: "c1", customer: "台北欧洲学校", english: "Taipei European School", start: "2025-08-04", end: "2026-08-03", days: 18, value: 680_000, owner: "Olivia Chen", status: "NEGOTIATING", relationLevel: 4 },
  { id: "c2", customer: "上海惠灵顿", english: "Wellington College Shanghai", start: "2025-09-15", end: "2026-09-14", days: 60, value: 920_000, owner: "Ethan Wang", status: "RENEWAL_PREP", relationLevel: 3 },
  { id: "c3", customer: "新加坡美国学校", english: "Singapore American School", start: "2025-10-12", end: "2026-10-11", days: 87, value: 760_000, owner: "Sophia Lin", status: "RENEWAL_PREP", relationLevel: 2 },
  { id: "c4", customer: "苏州新加坡学校", english: "Suzhou Singapore International School", start: "2025-07-31", end: "2026-07-30", days: 14, value: 430_000, owner: "Jason Wu", status: "RISK", relationLevel: 1 },
  { id: "c5", customer: "北京鼎石学校", english: "Keystone Academy", start: "2026-01-01", end: "2026-12-31", days: 168, value: 550_000, owner: "Jason Wu", status: "ACTIVE", relationLevel: 2 },
  { id: "c6", customer: "香港汉基国际学校", english: "Chinese International School", start: "2026-02-01", end: "2027-01-31", days: 199, value: 610_000, owner: "Olivia Chen", status: "ACTIVE", relationLevel: 3 },
  { id: "c7", customer: "杭州国际学校", english: "Hangzhou International School", start: "2026-03-01", end: "2027-02-28", days: 227, value: 390_000, owner: "Sophia Lin", status: "ACTIVE", relationLevel: 2 },
  { id: "c8", customer: "广州美国人国际学校", english: "American International School Guangzhou", start: "2026-04-15", end: "2027-04-14", days: 272, value: 480_000, owner: "Ethan Wang", status: "ACTIVE", relationLevel: 1 },
  { id: "c9", customer: "深圳国际交流书院", english: "Shenzhen College of International Education", start: "2026-06-01", end: "2027-05-31", days: 319, value: 840_000, owner: "Olivia Chen", status: "ACTIVE", relationLevel: 3 },
  { id: "c10", customer: "南京国际学校", english: "Nanjing International School", start: "2026-07-01", end: "2027-06-30", days: 349, value: 360_000, owner: "Jason Wu", status: "ACTIVE", relationLevel: 2 },
];

const money = (value: number) => `¥ ${(value / 1_000).toFixed(0)}K`;
const statusTone = (status: Contract["status"]) => status === "RISK" ? "red" : status === "NEGOTIATING" ? "purple" : status === "RENEWAL_PREP" ? "amber" : status === "ACTIVE" ? "green" : "gray";
const relationshipKeys = ["", "sales.relationship.contact", "sales.relationship.meal", "sales.relationship.family", "sales.relationship.advocacy"];
const statusKeys: Record<Contract["status"],string> = { DRAFT:"contracts.status.draft", PENDING_APPROVAL:"contracts.status.pending", ACTIVE:"contracts.status.active", RENEWAL_PREP:"contracts.status.preparing", NEGOTIATING:"contracts.status.negotiating", EXPIRED:"contracts.status.expired", CANCELLED:"contracts.status.cancelled", RISK:"contracts.status.risk" };

export function ContractsPage({ initialContracts = fallbackContracts, initialTotal = fallbackContracts.length, persistent = false }: { initialContracts?: Contract[]; initialTotal?: number; persistent?: boolean }) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [records,setRecords]=useState(initialContracts);const [total,setTotal]=useState(initialTotal);const [loading,setLoading]=useState(false);
  const [handled, setHandled] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [flowError, setFlowError] = useState("");
  const pageSize = 5;
  const filtered = useMemo(() => records.filter((contract) => {
    const matchesQuery = `${contract.customer} ${contract.english} ${contract.owner}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || contract.status === status);
  }), [query, records, status]);
  const totalPages = Math.max(1, Math.ceil((persistent?total:filtered.length) / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = persistent?records:filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const renewals = records.filter((contract) => contract.days <= 90 && !handled.includes(contract.id)).sort((a, b) => a.days - b.days);
  const renewalValue = records.filter((contract) => contract.days <= 90).reduce((sum, contract) => sum + contract.value, 0);
  useEffect(()=>{if(!persistent)return;const timer=setTimeout(()=>{setLoading(true);fetch(`/api/contracts?page=${page}&pageSize=${pageSize}&status=${encodeURIComponent(status)}&query=${encodeURIComponent(query)}`).then(async(response)=>{const result=await response.json() as {items?:Contract[];total?:number};if(!response.ok||!result.items)throw new Error();setRecords(result.items);setTotal(result.total??result.items.length);}).catch(()=>setFlowError(t("contracts.loadFailed"))).finally(()=>setLoading(false));},250);return()=>clearTimeout(timer);},[page,persistent,query,status,t]);
  const requestApproval=async(type:"CONTRACT_SIGN"|"CONTRACT_EXPORT")=>{setFlowError("");const response=await fetch("/api/approvals",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type,objectType:type==="CONTRACT_SIGN"?"CONTRACT":"CONTRACT_EXPORT",objectId:type==="CONTRACT_SIGN"?records[0]?.id??"NO-CONTRACT":"ACTIVE-CONTRACTS",reason:t(type==="CONTRACT_SIGN"?"approval.reason.sign":"approval.reason.export")})});if(response.ok)setToast(t("flow.approvalRequested"));else setFlowError(t("flow.approvalFailed"));};

  return <div className="page-stack contracts-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("contracts.eyebrow")}</p><h1>{t("contracts.title")}</h1><p>{t("contracts.description")}</p></div><div className="page-actions"><button className="secondary-button" type="button" onClick={() => requestApproval("CONTRACT_EXPORT")}><FileDown size={17} />{t("flow.requestExportApproval")}</button><button className="primary-button" type="button" onClick={() => requestApproval("CONTRACT_SIGN")}><Signature size={17} />{t("flow.requestSignApproval")}</button></div></section>
    {flowError&&<InlineMessage type="error">{flowError}</InlineMessage>}
    {loading&&<InlineMessage type="warning">{t("contracts.loading")}</InlineMessage>}

    <section className="contract-kpis">
      <ContractKpi icon={FileCheck2} tone="green" value={String(persistent?total:records.length)} label={t("contracts.valid")} detail={t("contracts.validDetail")} />
      <ContractKpi icon={CalendarClock} tone="amber" value={String(records.filter(item=>item.days<=90).length)} label={t("contracts.in90Days")} detail={t("contracts.under30Days")} />
      <ContractKpi icon={CircleDollarSign} tone="blue" value={money(renewalValue)} label={t("contracts.renewalAmount")} detail={t("contracts.quarterWindow")} />
      <ContractKpi icon={ShieldAlert} tone="red" value={String(records.filter(item=>item.status==="RISK").length)} label={t("contracts.highRisk")} detail={t("contracts.highRiskDetail")} />
    </section>

    <section className="surface contract-cycle-card">
      <div className="surface-heading"><div><p className="eyebrow">{t("contracts.lifecycleEyebrow")}</p><h2>{t("contracts.lifecycle")}</h2></div><StatusBadge tone="blue">2026 Q3</StatusBadge></div>
      <div className="contract-cycle"><CycleStep label={t("contracts.cycle.signed")} count={String(records.filter(item=>item.status==="PENDING_APPROVAL"||item.status==="DRAFT").length)} detail={t("contracts.cycle.signedDetail")} tone="blue" /><CycleStep label={t("contracts.cycle.active")} count={String(records.filter(item=>item.status==="ACTIVE").length)} detail={t("contracts.cycle.activeDetail")} tone="green" /><CycleStep label={t("contracts.cycle.preparing")} count={String(records.filter(item=>item.status==="RENEWAL_PREP").length)} detail={t("contracts.cycle.preparingDetail")} tone="amber" /><CycleStep label={t("contracts.cycle.negotiating")} count={String(records.filter(item=>item.status==="NEGOTIATING").length)} detail={t("contracts.cycle.negotiatingDetail")} tone="purple" /><CycleStep label={t("contracts.cycle.risk")} count={String(records.filter(item=>item.status==="RISK").length)} detail={t("contracts.cycle.riskDetail")} tone="red" /></div>
    </section>

    <section className="contracts-main-grid">
      <div className="surface contract-table-card">
        <div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("contracts.search")} /><div className="filter-chips"><button type="button" className={status === "all" ? "active" : ""} onClick={() => { setStatus("all"); setPage(1); }}>{t("common.all")}</button>{(["RENEWAL_PREP", "NEGOTIATING", "RISK"] as Contract["status"][]).map((item) => <button type="button" className={status === item ? "active" : ""} onClick={() => { setStatus(item); setPage(1); }} key={item}>{t(statusKeys[item])}</button>)}</div></div>
        <div className="table-scroll"><table className="contract-table"><thead><tr><th>{t("contracts.customer")}</th><th>{t("contracts.period")}</th><th>{t("contracts.expiry")}</th><th>{t("contracts.renewalValue")}</th><th>{t("contracts.relationshipGoal")}</th><th>{t("common.owner")}</th><th>{t("common.status")}</th></tr></thead><tbody>{visible.map((contract) => <tr key={contract.id}><td><b>{locale==="zh-CN"?contract.customer:contract.english}</b></td><td><span>{contract.start}</span><small>{t("contracts.to",{date:contract.end})}</small></td><td><b className={contract.days <= 30 ? "danger-text" : contract.days <= 90 ? "warn-text" : ""}>{t("contracts.days",{days:contract.days})}</b><small>{t(contract.days<=30?"contracts.renewNow":contract.days<=90?"contracts.prepareRenewal":"contracts.status.active")}</small></td><td><b>{money(contract.value)}</b><small>{t("contracts.annual")}</small></td><td><b>{t("contracts.relationshipLevelShort",{level:contract.relationLevel})}</b><small>{t(relationshipKeys[contract.relationLevel])}</small></td><td>{contract.owner}</td><td><StatusBadge tone={statusTone(contract.status)}>{t(statusKeys[contract.status])}</StatusBadge></td></tr>)}</tbody></table></div>
        <Pagination page={safePage} totalPages={totalPages} total={persistent?total:filtered.length} pageSize={pageSize} onPage={setPage} />
      </div>

      <aside className="surface renewal-reminder-panel"><div className="surface-heading"><div><p className="eyebrow">{t("contracts.renewalEyebrow")}</p><h2>{t("contracts.renewalAlerts")}</h2></div><span className="count-pill">{renewals.length}</span></div>{renewals.map((contract) => { const name=locale==="zh-CN"?contract.customer:contract.english; return <article className="renewal-reminder" key={contract.id}><span className={contract.days <= 30 ? "red" : "amber"}><RefreshCcw size={17} /></span><div><b>{name}</b><small>{t("contracts.daysRemaining",{days:contract.days})} · {money(contract.value)}</small><small>{t("contracts.relationshipLevel",{level:contract.relationLevel})} · {contract.owner}</small><ProgressBar value={Math.max(5, 100 - contract.days)} label={t(statusKeys[contract.status])} /></div><button type="button" aria-label={t("contracts.completeReminder",{name})} onClick={() => { setHandled((current) => [...current, contract.id]); setToast(t("contracts.reminderDone",{name})); }}><Check size={16} /></button></article>})}{!renewals.length && <div className="empty-state"><span>{t("contracts.allHandled")}</span><p>{t("contracts.newReminderHelp")}</p></div>}<Link className="card-link" href="/calendar">{t("contracts.calendar")} <ChevronRight size={15} /></Link></aside>
    </section>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

function ContractKpi({ icon: Icon, tone, value, label, detail }: { icon: React.ElementType; tone: string; value: string; label: string; detail: string }) {
  return <article className="surface contract-kpi"><span className={tone}><Icon size={21} /></span><div><b>{value}</b><span>{label}</span><small>{detail}</small></div></article>;
}

function CycleStep({ label, count, detail, tone }: { label: string; count: string; detail: string; tone: string }) {
  return <article><span className={tone}>{count}</span><div><b>{label}</b><small>{detail}</small></div><ChevronRight size={16} /></article>;
}
