"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BellRing,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";
import { InlineMessage, Pagination, ProgressBar, SearchField, StatusBadge, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";

type Contract = {
  id: string;
  customer: string;
  english: string;
  start: string;
  end: string;
  days: number;
  value: number;
  owner: string;
  status: "续约准备" | "谈判中" | "履约中" | "风险";
  relationLevel: 1 | 2 | 3 | 4;
};

const contracts: Contract[] = [
  { id: "c1", customer: "台北欧洲学校", english: "Taipei European School", start: "2025-08-04", end: "2026-08-03", days: 18, value: 680_000, owner: "Olivia Chen", status: "谈判中", relationLevel: 4 },
  { id: "c2", customer: "上海惠灵顿", english: "Wellington College Shanghai", start: "2025-09-15", end: "2026-09-14", days: 60, value: 920_000, owner: "Ethan Wang", status: "续约准备", relationLevel: 3 },
  { id: "c3", customer: "新加坡美国学校", english: "Singapore American School", start: "2025-10-12", end: "2026-10-11", days: 87, value: 760_000, owner: "Sophia Lin", status: "续约准备", relationLevel: 2 },
  { id: "c4", customer: "苏州新加坡学校", english: "Suzhou Singapore International School", start: "2025-07-31", end: "2026-07-30", days: 14, value: 430_000, owner: "Jason Wu", status: "风险", relationLevel: 1 },
  { id: "c5", customer: "北京鼎石学校", english: "Keystone Academy", start: "2026-01-01", end: "2026-12-31", days: 168, value: 550_000, owner: "Jason Wu", status: "履约中", relationLevel: 2 },
  { id: "c6", customer: "香港汉基国际学校", english: "Chinese International School", start: "2026-02-01", end: "2027-01-31", days: 199, value: 610_000, owner: "Olivia Chen", status: "履约中", relationLevel: 3 },
  { id: "c7", customer: "杭州国际学校", english: "Hangzhou International School", start: "2026-03-01", end: "2027-02-28", days: 227, value: 390_000, owner: "Sophia Lin", status: "履约中", relationLevel: 2 },
  { id: "c8", customer: "广州美国人国际学校", english: "American International School Guangzhou", start: "2026-04-15", end: "2027-04-14", days: 272, value: 480_000, owner: "Ethan Wang", status: "履约中", relationLevel: 1 },
  { id: "c9", customer: "深圳国际交流书院", english: "Shenzhen College of International Education", start: "2026-06-01", end: "2027-05-31", days: 319, value: 840_000, owner: "Olivia Chen", status: "履约中", relationLevel: 3 },
  { id: "c10", customer: "南京国际学校", english: "Nanjing International School", start: "2026-07-01", end: "2027-06-30", days: 349, value: 360_000, owner: "Jason Wu", status: "履约中", relationLevel: 2 },
];

const money = (value: number) => `¥ ${(value / 1_000).toFixed(0)}K`;
const statusTone = (status: Contract["status"]) => status === "风险" ? "red" : status === "谈判中" ? "purple" : status === "续约准备" ? "amber" : "green";
const relationshipKeys = ["", "sales.relationship.contact", "sales.relationship.meal", "sales.relationship.family", "sales.relationship.advocacy"];
const statusKeys: Record<Contract["status"],string> = { "续约准备":"contracts.status.preparing", "谈判中":"contracts.status.negotiating", "履约中":"contracts.status.active", "风险":"contracts.status.risk" };

export function ContractsPage() {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [handled, setHandled] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const pageSize = 5;
  const filtered = useMemo(() => contracts.filter((contract) => {
    const matchesQuery = `${contract.customer} ${contract.english} ${contract.owner}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || contract.status === status);
  }), [query, status]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const renewals = contracts.filter((contract) => contract.days <= 90 && !handled.includes(contract.id)).sort((a, b) => a.days - b.days);
  const renewalValue = contracts.filter((contract) => contract.days <= 90).reduce((sum, contract) => sum + contract.value, 0);

  return <div className="page-stack contracts-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("contracts.eyebrow")}</p><h1>{t("contracts.title")}</h1><p>{t("contracts.description")}</p></div><div className="page-actions"><Link className="secondary-button" href="/calendar"><CalendarClock size={17} />{t("contracts.viewSchedule")}</Link><Link className="primary-button" href="/calendar"><BellRing size={17} />{t("contracts.scheduleMeeting")}</Link></div></section>
    <InlineMessage type="warning">{t("contracts.prototypeWarning")}</InlineMessage>

    <section className="contract-kpis">
      <ContractKpi icon={FileCheck2} tone="green" value="10" label={t("contracts.valid")} detail={t("contracts.validDetail")} />
      <ContractKpi icon={CalendarClock} tone="amber" value="4" label="90 天内到期" detail="2 份少于 30 天" />
      <ContractKpi icon={CircleDollarSign} tone="blue" value={money(renewalValue)} label={t("contracts.renewalAmount")} detail={t("contracts.quarterWindow")} />
      <ContractKpi icon={ShieldAlert} tone="red" value="1" label={t("contracts.highRisk")} detail={t("contracts.highRiskDetail")} />
    </section>

    <section className="surface contract-cycle-card">
      <div className="surface-heading"><div><p className="eyebrow">LIFECYCLE OVERVIEW</p><h2>{t("contracts.lifecycle")}</h2></div><StatusBadge tone="blue">2026 Q3</StatusBadge></div>
      <div className="contract-cycle"><CycleStep label={t("contracts.cycle.signed")} count="2" detail={t("contracts.cycle.signedDetail")} tone="blue" /><CycleStep label={t("contracts.cycle.active")} count="6" detail={t("contracts.cycle.activeDetail")} tone="green" /><CycleStep label={t("contracts.cycle.preparing")} count="2" detail={t("contracts.cycle.preparingDetail")} tone="amber" /><CycleStep label={t("contracts.cycle.negotiating")} count="1" detail={t("contracts.cycle.negotiatingDetail")} tone="purple" /><CycleStep label={t("contracts.cycle.risk")} count="1" detail={t("contracts.cycle.riskDetail")} tone="red" /></div>
    </section>

    <section className="contracts-main-grid">
      <div className="surface contract-table-card">
        <div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={t("contracts.search")} /><div className="filter-chips"><button type="button" className={status === "all" ? "active" : ""} onClick={() => { setStatus("all"); setPage(1); }}>{t("common.all")}</button>{(["续约准备", "谈判中", "风险"] as Contract["status"][]).map((item) => <button type="button" className={status === item ? "active" : ""} onClick={() => { setStatus(item); setPage(1); }} key={item}>{t(statusKeys[item])}</button>)}</div></div>
        <div className="table-scroll"><table className="contract-table"><thead><tr><th>{t("contracts.customer")}</th><th>{t("contracts.period")}</th><th>{t("contracts.expiry")}</th><th>{t("contracts.renewalValue")}</th><th>{t("contracts.relationshipGoal")}</th><th>{t("common.owner")}</th><th>{t("common.status")}</th></tr></thead><tbody>{visible.map((contract) => <tr key={contract.id}><td><b>{locale==="zh-CN"?contract.customer:contract.english}</b></td><td><span>{contract.start}</span><small>{t("contracts.to",{date:contract.end})}</small></td><td><b className={contract.days <= 30 ? "danger-text" : contract.days <= 90 ? "warn-text" : ""}>{t("contracts.days",{days:contract.days})}</b><small>{t(contract.days<=30?"contracts.renewNow":contract.days<=90?"contracts.prepareRenewal":"contracts.status.active")}</small></td><td><b>{money(contract.value)}</b><small>{t("contracts.annual")}</small></td><td><b>Level {contract.relationLevel}</b><small>{t(relationshipKeys[contract.relationLevel])}</small></td><td>{contract.owner}</td><td><StatusBadge tone={statusTone(contract.status)}>{t(statusKeys[contract.status])}</StatusBadge></td></tr>)}</tbody></table></div>
        <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} />
      </div>

      <aside className="surface renewal-reminder-panel"><div className="surface-heading"><div><p className="eyebrow">RENEWAL ALERTS</p><h2>{t("contracts.renewalAlerts")}</h2></div><span className="count-pill">{renewals.length}</span></div>{renewals.map((contract) => { const name=locale==="zh-CN"?contract.customer:contract.english; return <article className="renewal-reminder" key={contract.id}><span className={contract.days <= 30 ? "red" : "amber"}><RefreshCcw size={17} /></span><div><b>{name}</b><small>{t("contracts.daysRemaining",{days:contract.days})} · {money(contract.value)}</small><small>{t("contracts.relationshipLevel",{level:contract.relationLevel})} · {contract.owner}</small><ProgressBar value={Math.max(5, 100 - contract.days)} label={t(statusKeys[contract.status])} /></div><button type="button" aria-label={t("contracts.completeReminder",{name})} onClick={() => { setHandled((current) => [...current, contract.id]); setToast(t("contracts.reminderDone",{name})); }}><Check size={16} /></button></article>})}{!renewals.length && <div className="empty-state"><span>{t("contracts.allHandled")}</span><p>{t("contracts.newReminderHelp")}</p></div>}<Link className="card-link" href="/calendar">{t("contracts.calendar")} <ChevronRight size={15} /></Link></aside>
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
