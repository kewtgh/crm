"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, CircleDollarSign, FileCheck2, Plus, Send, ShieldCheck, TimerReset, UserRoundCheck, X } from "lucide-react";
import { InlineMessage, Pagination, ProgressBar, SearchableSelect, SearchField, StatusBadge, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import { useAppUser } from "@/components/app-shell";

type ApprovalStatus = "pending" | "approved" | "rejected";
type Approval = { id: string; type: "contractSign" | "contractExport" | "performanceSummary"; object: string; requester: string; submitted: string; level: "admin" | "superAdmin"; reason: string; status: ApprovalStatus };

const approvalSeed: Approval[] = [
  { id: "APR-260716-018", type: "contractSign", object: "taipei", requester: "吴俊杰 / Jason Wu", submitted: "10:42", level: "admin", reason: "sign", status: "pending" },
  { id: "APR-260716-017", type: "contractExport", object: "export", requester: "王以恒 / Ethan Wang", submitted: "09:18", level: "superAdmin", reason: "export", status: "pending" },
  { id: "APR-260716-016", type: "performanceSummary", object: "q2", requester: "吴俊杰 / Jason Wu", submitted: "08:55", level: "admin", reason: "summary", status: "pending" },
  { id: "APR-260715-042", type: "contractSign", object: "suzhou", requester: "郑宇翔 / Alex Cheng", submitted: "07-15 17:31", level: "admin", reason: "sign", status: "pending" },
  { id: "APR-260715-039", type: "contractExport", object: "renewal", requester: "陈芷涵 / Hannah Chen", submitted: "07-15 15:08", level: "superAdmin", reason: "export", status: "pending" },
  { id: "APR-260715-035", type: "performanceSummary", object: "manager", requester: "王以恒 / Ethan Wang", submitted: "07-15 13:22", level: "admin", reason: "summary", status: "pending" },
  { id: "APR-260714-028", type: "performanceSummary", object: "shanghai", requester: "王以恒 / Ethan Wang", submitted: "07-14 16:40", level: "admin", reason: "summary", status: "pending" },
];

export function RoleHierarchyNote() {
  const { t } = useI18n();
  return <InlineMessage type="warning">{t("admin.hierarchyNote")}</InlineMessage>;
}

export function ApprovalCenterPage() {
  const { t } = useI18n();
  const user = useAppUser();
  const [requests, setRequests] = useState(approvalSeed);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | Approval["type"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ApprovalStatus>("pending");
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const pageSize = 4;
  const filtered = useMemo(() => requests.filter((item) => `${item.id} ${item.requester} ${t(`approval.object.${item.object}`)} ${t(`approval.type.${item.type}`)}`.toLowerCase().includes(query.toLowerCase()) && (typeFilter === "all" || item.type === typeFilter) && (statusFilter === "all" || item.status === statusFilter)), [query, requests, statusFilter, t, typeFilter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const decide = (request: Approval, status: ApprovalStatus) => {
    if (status === "rejected" && !rejectReason.trim()) { setError(t("approval.rejectRequired")); return; }
    setRequests((items) => items.map((item) => item.id === request.id ? { ...item, status } : item));
    setToast(t(status === "approved" ? "approval.approvedMessage" : "approval.rejectedMessage", { id: request.id }));
    setReviewing(null); setRejectReason(""); setError("");
  };
  return <div className="page-stack governance-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("approval.eyebrow")}</p><h1>{t("approval.title")}</h1><p>{t("approval.description")}</p></div><StatusBadge tone="purple"><ShieldCheck size={14} />{t("approval.auditNote")}</StatusBadge></section>
    <section className="quick-summary"><span><b>{requests.filter((item) => item.status === "pending").length}</b><small>{t("approval.pending")}</small></span><span><b>3</b><small>{t("approval.dueSoon")}</small></span><span><b>12</b><small>{t("approval.approvedToday")}</small></span><span><b>{requests.filter((item) => item.level === "superAdmin" && item.status === "pending").length}</b><small>{t("approval.highPrivilege")}</small></span></section>
    <section className="surface governance-list"><div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("approval.search")} /><div className="filter-chips"><button type="button" onClick={() => { setTypeFilter((value) => value === "all" ? "contractSign" : value === "contractSign" ? "contractExport" : value === "contractExport" ? "performanceSummary" : "all"); setPage(1); }}>{t("approval.type")} <span>{typeFilter === "all" ? t("common.all") : t(`approval.type.${typeFilter}`)}</span></button><button type="button" onClick={() => { setStatusFilter((value) => value === "pending" ? "all" : "pending"); setPage(1); }}>{t("common.status")} <span>{statusFilter === "all" ? t("common.all") : t(`approval.status.${statusFilter}`)}</span></button></div></div>
      <div className="governance-table-head"><span>{t("approval.type")}</span><span>{t("approval.requester")}</span><span>{t("approval.reason")}</span><span>{t("approval.level")}</span><span>{t("common.status")}</span><span>{t("common.actions")}</span></div>
      {visible.map((request) => { const canDecide = request.level === "admin" || user.role === "SUPER_ADMIN"; return <div className="approval-item" key={request.id}><div className="governance-row"><span className={`workflow-icon ${request.type}`}><FileCheck2 size={18} /></span><div><b>{t(`approval.type.${request.type}`)}</b><small>{request.id} · {t(`approval.object.${request.object}`)}</small></div><span><b>{request.requester}</b><small>{t("approval.submitted")} · {request.submitted}</small></span><span><b>{t(`approval.reason.${request.reason}`)}</b><small>{t(`approval.level.${request.level}`)}</small></span><StatusBadge tone={request.level === "superAdmin" ? "purple" : "blue"}>{t(`approval.level.${request.level}`)}</StatusBadge><StatusBadge tone={request.status === "pending" ? "amber" : request.status === "approved" ? "green" : "red"}>{t(`approval.status.${request.status}`)}</StatusBadge><button className="secondary-button" type="button" title={!canDecide ? t("approval.requiresSuperAdmin") : undefined} disabled={request.status !== "pending" || !canDecide} onClick={() => { setReviewing(request.id); setError(""); }}>{t("approval.review")}</button></div>
        {reviewing === request.id && <div className="approval-review" aria-label={t("approval.review")}><div><b>{t(`approval.object.${request.object}`)}</b><p>{t(`approval.reason.${request.reason}`)}</p></div><label className="field"><span>{t("approval.rejectReason")}</span><textarea rows={2} value={rejectReason} onChange={(event) => { setRejectReason(event.target.value); setError(""); }} placeholder={t("approval.rejectPlaceholder")} />{error && <InlineMessage type="error">{error}</InlineMessage>}</label><div className="approval-actions"><button className="ghost-button" type="button" onClick={() => { setReviewing(null); setError(""); }}>{t("approval.cancelReview")}</button><button className="danger-button" type="button" onClick={() => decide(request, "rejected")}><X size={16} />{t("approval.reject")}</button><button className="primary-button" type="button" onClick={() => decide(request, "approved")}><BadgeCheck size={16} />{t("approval.approve")}</button></div></div>}
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

export function PerformanceAllocationPage() {
  const { locale, t } = useI18n();
  const [manager, setManager] = useState("ethan"); const [period, setPeriod] = useState("july"); const [allocations, setAllocations] = useState(initialAllocations); const [query, setQuery] = useState(""); const [page, setPage] = useState(1); const [adding, setAdding] = useState(false); const [member, setMember] = useState(""); const [amount, setAmount] = useState(""); const [error, setError] = useState(""); const [toast, setToast] = useState("");
  const target = 2400000; const allocated = allocations.reduce((sum, item) => sum + item.amount, 0); const remaining = target - allocated; const money = (value: number) => new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value);
  const localizedMemberOptions = memberOptions.map((item) => ({ value: item.value, label: item.label, detail: `${t("allocation.team.shanghai")} · ${t(`allocation.${item.role}`)}` }));
  const filtered = allocations.filter((item) => `${item.name} ${item.role}`.toLowerCase().includes(query.toLowerCase())); const pageSize = 4; const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); const safePage = Math.min(page, pages); const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const addMember = () => { const selected = memberOptions.find((item) => item.value === member); const parsed = Number(amount); if (!selected) { setError(t("allocation.memberSelect")); return; } if (allocations.some((item) => item.id === member)) { setError(t("allocation.duplicate")); return; } if (!Number.isFinite(parsed) || parsed <= 0 || parsed > remaining) { setError(t("allocation.invalidAmount")); return; } const support = selected.role === "support"; setAllocations((items) => [...items, { id: member, name: selected.label, role: selected.role as Allocation["role"], amount: parsed, actual: 0, rule: support ? "assisted" : "direct" }]); setAdding(false); setMember(""); setAmount(""); setError(""); setToast(t("allocation.added", { name: selected.label })); };
  const remove = (item: Allocation) => { setAllocations((items) => items.filter((entry) => entry.id !== item.id)); setToast(t("allocation.removed", { name: item.name })); };
  return <div className="page-stack governance-page"><section className="page-heading-row"><div><p className="eyebrow">{t("allocation.eyebrow")}</p><h1>{t("allocation.title")}</h1><p>{t("allocation.description")}</p></div><div className="page-actions"><button className="secondary-button" type="button" onClick={() => setToast(t("allocation.saved"))}>{t("allocation.save")}</button><button className="primary-button" type="button" onClick={() => setToast(t("allocation.submitted"))}><Send size={16} />{t("allocation.submit")}</button></div></section>
    <section className="surface allocation-context"><SearchableSelect label={t("allocation.manager")} value={manager} onChange={setManager} options={[{ value: "ethan", label: t("allocation.manager.ethan"), detail: t("allocation.team.shanghai") }, { value: "jason", label: t("allocation.manager.jason"), detail: t("allocation.team.taipei") }]} /><SearchableSelect label={t("allocation.period")} value={period} onChange={setPeriod} options={[{ value: "july", label: t("allocation.period.july") }, { value: "q3", label: t("allocation.period.q3") }]} /></section>
    <section className="allocation-summary"><article className="surface"><span><CircleDollarSign size={19} /></span><div><small>{t("allocation.target")}</small><b>{money(target)}</b></div></article><article className="surface"><span><UserRoundCheck size={19} /></span><div><small>{t("allocation.allocated")}</small><b>{money(allocated)}</b></div></article><article className="surface"><span><TimerReset size={19} /></span><div><small>{t("allocation.remaining")}</small><b>{money(remaining)}</b></div></article><article className="surface allocation-progress"><div><small>{t("allocation.coverage")}</small><b>{Math.round(allocated / target * 100)}%</b></div><ProgressBar value={allocated / target * 100} /></article></section>
    <InlineMessage type="warning">{t("allocation.noDoubleCount")}</InlineMessage>
    <section className="surface governance-list"><div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("allocation.search")} /><button className="secondary-button" type="button" onClick={() => { setAdding(true); setError(""); }}><Plus size={16} />{t("allocation.add")}</button></div>
      {adding && <div className="allocation-add"><div><b>{t("allocation.addTitle")}</b><small>{t("allocation.remaining")}: {money(remaining)}</small></div><SearchableSelect label={t("allocation.memberSelect")} options={localizedMemberOptions} value={member} onChange={(value) => { setMember(value); setError(""); }} /><label className="field"><span>{t("allocation.amountInput")}</span><input type="number" min="1" max={remaining} step="10000" value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} />{error && <InlineMessage type="error">{error}</InlineMessage>}</label><div className="approval-actions"><button className="ghost-button" type="button" onClick={() => setAdding(false)}>{t("common.cancel")}</button><button className="primary-button" type="button" onClick={addMember}>{t("common.create")}</button></div></div>}
      <div className="allocation-table-head"><span>{t("allocation.member")}</span><span>{t("allocation.branch")}</span><span>{t("allocation.amount")}</span><span>{t("allocation.share")}</span><span>{t("allocation.actual")}</span><span>{t("allocation.contribution")}</span><span>{t("common.actions")}</span></div>
      {visible.map((item) => <div className="allocation-row" key={item.id}><div><span className="record-avatar">{item.name.split(" / ")[1].split(" ").map((part) => part[0]).join("")}</span><b>{item.name}</b></div><StatusBadge tone={item.role === "support" ? "green" : "blue"}>{t(`allocation.${item.role}`)}</StatusBadge><b>{money(item.amount)}</b><ProgressBar value={item.amount / target * 100} label={`${Math.round(item.amount / target * 100)}%`} /><b>{money(item.actual)}</b><StatusBadge tone={item.rule === "direct" ? "purple" : "amber"}>{t(`allocation.${item.rule}`)}</StatusBadge><button className="ghost-button" type="button" onClick={() => remove(item)}>{t("allocation.remove")}</button></div>)}
      <Pagination page={safePage} totalPages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} /><InlineMessage type="warning">{t("allocation.audit")}</InlineMessage>
    </section>{toast && <Toast message={toast} onClose={() => setToast("")} />}</div>;
}
