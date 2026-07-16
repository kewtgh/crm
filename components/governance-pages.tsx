"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, CircleDollarSign, FileCheck2, Plus, Send, ShieldCheck, TimerReset, UserRoundCheck, X } from "lucide-react";
import { InlineMessage, Pagination, ProgressBar, SearchableSelect, SearchField, StatusBadge, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import { useAppUser } from "@/components/app-user-context";
import type { ApprovalRecord, PerformanceWorkspace } from "@/lib/governance-repository";
import { roleMessageKey } from "@/lib/roles";

type ApprovalStatus = "pending" | "approved" | "rejected";
type Approval = ApprovalRecord;

const approvalSeed: Approval[] = [
  { id: "demo-1", requestNumber:"APR-DEMO-001", type: "contractSign", object: "台北欧洲学校 / Taipei European School", requester: "吴俊杰 / Jason Wu", submitted: "10:42", level: "admin", reason: "客户已确认最终条款，申请进入签署流程。", status: "pending" },
];

export function RoleHierarchyNote() {
  const { t } = useI18n();
  return <InlineMessage type="warning">{t("admin.hierarchyNote")}</InlineMessage>;
}

export function ApprovalCenterPage({ initialRequests=approvalSeed, persistent=false }: { initialRequests?:Approval[]; persistent?:boolean }) {
  const { t } = useI18n();
  const user = useAppUser();
  const [requests, setRequests] = useState(initialRequests);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | Approval["type"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ApprovalStatus>("pending");
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const pageSize = 4;
  const filtered = useMemo(() => requests.filter((item) => `${item.requestNumber} ${item.requester} ${item.object} ${t(`approval.type.${item.type}`)}`.toLowerCase().includes(query.toLowerCase()) && (typeFilter === "all" || item.type === typeFilter) && (statusFilter === "all" || item.status === statusFilter)), [query, requests, statusFilter, t, typeFilter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const decide = async (request: Approval, status: ApprovalStatus) => {
    if (status === "rejected" && !rejectReason.trim()) { setError(t("approval.rejectRequired")); return; }
    if (persistent) { const response=await fetch(`/api/approvals/${request.id}/decision`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision:status.toUpperCase(),comment:rejectReason})}); if(!response.ok){setError(t("approval.saveFailed"));return;} }
    setRequests((items) => items.map((item) => item.id === request.id ? { ...item, status } : item));
    setToast(t(status === "approved" ? "approval.approvedMessage" : "approval.rejectedMessage", { id: request.requestNumber }));
    setReviewing(null); setRejectReason(""); setError("");
  };
  return <div className="page-stack governance-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("approval.eyebrow")}</p><h1>{t("approval.title")}</h1><p>{t("approval.description")}</p></div><StatusBadge tone="purple"><ShieldCheck size={14} />{t("approval.auditNote")}</StatusBadge></section>
    <section className="quick-summary"><span><b>{requests.filter((item) => item.status === "pending").length}</b><small>{t("approval.pending")}</small></span><span><b>{requests.filter((item) => item.status === "pending").length}</b><small>{t("approval.dueSoon")}</small></span><span><b>{requests.filter((item) => item.status === "approved").length}</b><small>{t("approval.approvedToday")}</small></span><span><b>{requests.filter((item) => item.level === "superAdmin" && item.status === "pending").length}</b><small>{t("approval.highPrivilege")}</small></span></section>
    <section className="surface governance-list"><div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("approval.search")} /><div className="filter-chips"><button type="button" onClick={() => { setTypeFilter((value) => value === "all" ? "contractSign" : value === "contractSign" ? "contractExport" : value === "contractExport" ? "performanceSummary" : value === "performanceSummary" ? "performanceAllocation" : "all"); setPage(1); }}>{t("approval.type")} <span>{typeFilter === "all" ? t("common.all") : t(`approval.type.${typeFilter}`)}</span></button><button type="button" onClick={() => { setStatusFilter((value) => value === "pending" ? "all" : "pending"); setPage(1); }}>{t("common.status")} <span>{statusFilter === "all" ? t("common.all") : t(`approval.status.${statusFilter}`)}</span></button></div></div>
      <div className="governance-table-head"><span>{t("approval.type")}</span><span>{t("approval.requester")}</span><span>{t("approval.reason")}</span><span>{t("approval.level")}</span><span>{t("common.status")}</span><span>{t("common.actions")}</span></div>
      {visible.map((request) => { const canDecide = request.level === "admin" || user.role === "SUPER_ADMIN"; return <div className="approval-item" key={request.id}><div className="governance-row"><span className={`workflow-icon ${request.type}`}><FileCheck2 size={18} /></span><div><b>{t(`approval.type.${request.type}`)}</b><small>{request.requestNumber} · {request.object}</small></div><span><b>{request.requester}</b><small>{t("approval.submitted")} · {request.submitted}</small></span><span><b>{request.reason}</b><small>{t(`approval.level.${request.level}`)}</small></span><StatusBadge tone={request.level === "superAdmin" ? "purple" : "blue"}>{t(`approval.level.${request.level}`)}</StatusBadge><StatusBadge tone={request.status === "pending" ? "amber" : request.status === "approved" ? "green" : "red"}>{t(`approval.status.${request.status}`)}</StatusBadge><button className="secondary-button" type="button" title={!canDecide ? t("approval.requiresSuperAdmin") : undefined} disabled={request.status !== "pending" || !canDecide} onClick={() => { setReviewing(request.id); setError(""); }}>{t("approval.review")}</button></div>
        {reviewing === request.id && <div className="approval-review" aria-label={t("approval.review")}><div><b>{request.object}</b><p>{request.reason}</p></div><label className="field"><span>{t("approval.rejectReason")}</span><textarea rows={2} value={rejectReason} onChange={(event) => { setRejectReason(event.target.value); setError(""); }} placeholder={t("approval.rejectPlaceholder")} />{error && <InlineMessage type="error">{error}</InlineMessage>}</label><div className="approval-actions"><button className="ghost-button" type="button" onClick={() => { setReviewing(null); setError(""); }}>{t("approval.cancelReview")}</button><button className="danger-button" type="button" onClick={() => decide(request, "rejected")}><X size={16} />{t("approval.reject")}</button><button className="primary-button" type="button" onClick={() => decide(request, "approved")}><BadgeCheck size={16} />{t("approval.approve")}</button></div></div>}
      </div>})}
      <Pagination page={safePage} totalPages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} />
    </section>{toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

type Allocation = { id: string; name: string; role: "specialist" | "support"; amount: number; actual: number; rule: "direct" | "assisted" };
const memberOptions = [
  { value: "alex", label: "郑宇翔 / Alex Cheng", role: "specialist" },
  { value: "hannah", label: "陈芷涵 / Hannah Chen", role: "support" },
  { value: "grace", label: "刘思妤 / Grace Liu", role: "specialist" },
  { value: "leo", label: "周子轩 / Leo Zhou", role: "specialist" },
  { value: "mia", label: "何雨乔 / Mia Ho", role: "support" },
  { value: "noah", label: "林俊佑 / Noah Lin", role: "specialist" },
];
const initialAllocations: Allocation[] = [
  { id: "alex", name: "郑宇翔 / Alex Cheng", role: "specialist", amount: 680000, actual: 512000, rule: "direct" },
  { id: "hannah", name: "陈芷涵 / Hannah Chen", role: "support", amount: 220000, actual: 173000, rule: "assisted" },
  { id: "grace", name: "刘思妤 / Grace Liu", role: "specialist", amount: 560000, actual: 438000, rule: "direct" },
  { id: "leo", name: "周子轩 / Leo Zhou", role: "specialist", amount: 410000, actual: 291000, rule: "direct" },
];

export function PerformanceAllocationPage({ workspace, persistent=false }: { workspace?:PerformanceWorkspace; persistent?:boolean }) {
  const { locale, t } = useI18n();
  const appUser=useAppUser();
  const effectiveMembers=workspace?.members.map((item)=>({value:item.id,label:item.name,role:item.role,team:item.team}))??memberOptions;
  const [targetId,setTargetId]=useState(workspace?.targetId??null); const [manager, setManager] = useState(workspace?.managerId??"ethan"); const [period, setPeriod] = useState("july"); const [allocations, setAllocations] = useState<Allocation[]>(workspace?workspace.allocations.map((item)=>({id:item.memberId,name:item.name,role:item.role,amount:item.amount,actual:item.actual,rule:item.rule})):initialAllocations); const [query, setQuery] = useState(""); const [page, setPage] = useState(1); const [adding, setAdding] = useState(false); const [member, setMember] = useState(""); const [amount, setAmount] = useState(""); const [error, setError] = useState(""); const [toast, setToast] = useState(""); const [pending,setPending]=useState(false);
  const target = workspace?.target??2400000; const allocated = allocations.reduce((sum, item) => sum + item.amount, 0); const remaining = target - allocated; const money = (value: number) => new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { style: "currency", currency: workspace?.currency??"CNY", maximumFractionDigits: 0 }).format(value);
  const localizedMemberOptions = effectiveMembers.map((item) => ({ value: item.value, label: item.label, detail: `${"team" in item?item.team:t("allocation.team.shanghai")} · ${t(`allocation.${item.role}`)}` }));
  const filtered = allocations.filter((item) => `${item.name} ${item.role}`.toLowerCase().includes(query.toLowerCase())); const pageSize = 4; const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); const safePage = Math.min(page, pages); const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const addMember = () => { const selected = effectiveMembers.find((item) => item.value === member); const parsed = Number(amount); if (!selected) { setError(t("allocation.memberSelect")); return; } if (allocations.some((item) => item.id === member)) { setError(t("allocation.duplicate")); return; } if (!Number.isFinite(parsed) || parsed <= 0 || parsed > remaining) { setError(t("allocation.invalidAmount")); return; } const support = selected.role === "support"; setAllocations((items) => [...items, { id: member, name: selected.label, role: selected.role as Allocation["role"], amount: parsed, actual: 0, rule: support ? "assisted" : "direct" }]); setAdding(false); setMember(""); setAmount(""); setError(""); setToast(t("allocation.added", { name: selected.label })); };
  const remove = (item: Allocation) => { setAllocations((items) => items.filter((entry) => entry.id !== item.id)); setToast(t("allocation.removed", { name: item.name })); };
  const persistPlan=async(submit:boolean)=>{if(!persistent){setToast(t(submit?"allocation.submitted":"allocation.saved"));return;}setPending(true);setError("");const dates=period==="q3"?{periodStart:"2026-07-01",periodEnd:"2026-09-30"}:{periodStart:workspace?.periodStart??"2026-07-01",periodEnd:workspace?.periodEnd??"2026-07-31"};const saved=await fetch("/api/performance/plans",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"save",targetId,managerId:manager,target,...dates,currency:workspace?.currency??"CNY",allocations:allocations.map((item)=>({memberId:item.id,amount:item.amount,rule:item.rule}))})});const result=await saved.json() as {item?:{id?:string};code?:string};if(!saved.ok||!result.item?.id){setError(t("allocation.saveFailed"));setPending(false);return;}setTargetId(result.item.id);if(submit){const response=await fetch("/api/performance/plans",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"submit",targetId:result.item.id,reason:t("allocation.submitReason")})});if(!response.ok){setError(t("allocation.submitFailed"));setPending(false);return;}}setToast(t(submit?"allocation.submitted":"allocation.saved"));setPending(false);};
  return <div className="page-stack governance-page"><section className="page-heading-row"><div><p className="eyebrow">{t("allocation.eyebrow")}</p><h1>{t("allocation.title")}</h1><p>{t("allocation.description")}</p></div><div className="page-actions"><button className="secondary-button" type="button" disabled={pending} onClick={() => persistPlan(false)}>{t("allocation.save")}</button><button className="primary-button" type="button" disabled={pending} onClick={() => persistPlan(true)}><Send size={16} />{t("allocation.submit")}</button></div></section>{error&&<InlineMessage type="error">{error}</InlineMessage>}
    <section className="surface allocation-context"><SearchableSelect label={t("allocation.manager")} value={manager} onChange={setManager} options={persistent?[{value:workspace?.managerId??appUser.id,label:`${appUser.displayNameZh} / ${appUser.displayName}`,detail:t(roleMessageKey[appUser.role])}]:[{ value: "ethan", label: t("allocation.manager.ethan"), detail: t("allocation.team.shanghai") }, { value: "jason", label: t("allocation.manager.jason"), detail: t("allocation.team.taipei") }]} /><SearchableSelect label={t("allocation.period")} value={period} onChange={setPeriod} options={[{ value: "july", label: t("allocation.period.july") }, { value: "q3", label: t("allocation.period.q3") }]} /></section>
    <section className="allocation-summary"><article className="surface"><span><CircleDollarSign size={19} /></span><div><small>{t("allocation.target")}</small><b>{money(target)}</b></div></article><article className="surface"><span><UserRoundCheck size={19} /></span><div><small>{t("allocation.allocated")}</small><b>{money(allocated)}</b></div></article><article className="surface"><span><TimerReset size={19} /></span><div><small>{t("allocation.remaining")}</small><b>{money(remaining)}</b></div></article><article className="surface allocation-progress"><div><small>{t("allocation.coverage")}</small><b>{Math.round(allocated / target * 100)}%</b></div><ProgressBar value={allocated / target * 100} label={`${Math.round(allocated / target * 100)}%`} /></article></section>
    <InlineMessage type="warning">{t("allocation.noDoubleCount")}</InlineMessage>
    <section className="surface governance-list"><div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("allocation.search")} /><button className="secondary-button" type="button" onClick={() => { setAdding(true); setError(""); }}><Plus size={16} />{t("allocation.add")}</button></div>
      {adding && <div className="allocation-add"><div><b>{t("allocation.addTitle")}</b><small>{t("allocation.remaining")}: {money(remaining)}</small></div><SearchableSelect label={t("allocation.memberSelect")} options={localizedMemberOptions} value={member} onChange={(value) => { setMember(value); setError(""); }} /><label className="field"><span>{t("allocation.amountInput")}</span><input type="number" min="1" max={remaining} step="10000" value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} />{error && <InlineMessage type="error">{error}</InlineMessage>}</label><div className="approval-actions"><button className="ghost-button" type="button" onClick={() => setAdding(false)}>{t("common.cancel")}</button><button className="primary-button" type="button" onClick={addMember}>{t("common.create")}</button></div></div>}
      <div className="allocation-table-head"><span>{t("allocation.member")}</span><span>{t("allocation.branch")}</span><span>{t("allocation.amount")}</span><span>{t("allocation.share")}</span><span>{t("allocation.actual")}</span><span>{t("allocation.contribution")}</span><span>{t("common.actions")}</span></div>
      {visible.map((item) => <div className="allocation-row" key={item.id}><div><span className="record-avatar">{item.name.split(" / ")[1].split(" ").map((part) => part[0]).join("")}</span><b>{item.name}</b></div><StatusBadge tone={item.role === "support" ? "green" : "blue"}>{t(`allocation.${item.role}`)}</StatusBadge><b>{money(item.amount)}</b><ProgressBar value={item.amount / target * 100} label={`${Math.round(item.amount / target * 100)}%`} /><b>{money(item.actual)}</b><StatusBadge tone={item.rule === "direct" ? "purple" : "amber"}>{t(`allocation.${item.rule}`)}</StatusBadge><button className="ghost-button" type="button" onClick={() => remove(item)}>{t("allocation.remove")}</button></div>)}
      <Pagination page={safePage} totalPages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} /><InlineMessage type="warning">{t("allocation.audit")}</InlineMessage>
    </section>{toast && <Toast message={toast} onClose={() => setToast("")} />}</div>;
}
