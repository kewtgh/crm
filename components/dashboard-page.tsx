"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CircleDollarSign,
  GraduationCap,
  ListTodo,
  School,
  Sparkles,
  TrendingUp,
  UserRoundPlus,
} from "lucide-react";
import { StatusBadge, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";

export function DashboardPage() {
  const { t } = useI18n();
  const [toast, setToast] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const complete = (id: string) => { setCompleted((items) => [...items, id]); setToast(t("dashboard.taskCompleted")); };
  return <div className="page-stack dashboard-page">
    <section className="welcome-strip">
      <div><p className="eyebrow">{t("dashboard.date")}</p><h1>{t("dashboard.greeting",{name:"雅雯 / Olivia"})} <span>👋</span></h1><p>{t("dashboard.summary")}</p></div>
      <div className="welcome-actions"><Link className="secondary-button" href="/calendar"><CalendarDays size={17} />{t("dashboard.viewCalendar")}</Link><button className="primary-button" type="button"><UserRoundPlus size={17} />{t("dashboard.quickCreate")}</button></div>
    </section>

    <section className="metric-grid">
      <MetricCard icon={ListTodo} tone="coral" label={t("dashboard.todayTasks")} value="12" change={t("dashboard.tasksDue")} detail={t("dashboard.myTasks")} href="/tasks" />
      <MetricCard icon={CircleDollarSign} tone="mint" label={t("dashboard.pipelineExpected")} value="¥ 3.84M" change={t("dashboard.monthGrowth")} detail={t("dashboard.viewOpportunities")} href="/opportunities" />
      <MetricCard icon={School} tone="blue" label={t("dashboard.keySchools")} value="28" change={t("dashboard.schoolsAttention")} detail={t("dashboard.relationshipHealth")} href="/schools" />
      <MetricCard icon={GraduationCap} tone="purple" label={t("dashboard.criticalStudents")} value="16" change={t("dashboard.weekMilestones")} detail={t("dashboard.viewStudents")} href="/students" />
    </section>

    <section className="surface consumption-dashboard-card">
      <div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.consumptionPulse")}</p><h2>{t("dashboard.consumptionTitle")}</h2></div><Link href="/analytics/consumption">{t("dashboard.viewAnalysis")} <ArrowRight size={15} /></Link></div>
      <div className="consumption-dashboard-body"><div className="consumption-board-metric"><span><ChartNoAxesCombined size={20} /></span><div><small>{t("dashboard.monthConfirmed")}</small><b>¥ 1.28M</b><em>{t("dashboard.monthChange")}</em></div></div><div className="consumption-mini-trend" aria-label={t("dashboard.sixMonthTrend")}>{[48,62,55,76,68,88].map((value,index)=><span style={{height:`${value}%`}} key={index} />)}</div><div className="consumption-board-mix"><span><b>{t("products.default.admissions")}</b><small>43%</small></span><span><b>{t("products.default.foundation")}</b><small>20%</small></span><span><b>{t("products.default.competition")}</b><small>15%</small></span><span><b>{t("products.default.summerCamp")} / {t("products.default.summerSchool")}</b><small>22%</small></span></div><Link className="card-link" href="/products">{t("dashboard.manageProducts")} <ChevronRight size={15} /></Link></div>
    </section>

    <section className="dashboard-main-grid">
      <article className="surface task-focus-card">
        <div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.todayFocus")}</p><h2>{t("dashboard.focus")}</h2></div><Link href="/tasks">{t("dashboard.allTasks")} <ArrowRight size={15} /></Link></div>
        <div className="focus-list">
          <FocusTask id="f1" done={completed.includes("f1")} onDone={complete} tone="red" time="10:30" title={t("dashboard.focus.renewal")} meta={t("dashboard.focus.schoolMeta")} tag={t("dashboard.highPriority")} />
          <FocusTask id="f2" done={completed.includes("f2")} onDone={complete} tone="amber" time="14:00" title={t("dashboard.focus.ucas")} meta={t("dashboard.focus.studentMeta")} tag={t("dashboard.dueToday")} />
          <FocusTask id="f3" done={completed.includes("f3")} onDone={complete} tone="blue" time="16:30" title={t("dashboard.focus.household")} meta={t("dashboard.focus.householdMeta")} tag={t("dashboard.onlineMeeting")} />
          <FocusTask id="f4" done={completed.includes("f4")} onDone={complete} tone="purple" time="18:00" title={t("dashboard.focus.guardian")} meta={t("dashboard.focus.adminMeta")} tag={t("dashboard.needsReview")} />
        </div>
      </article>

      <article className="surface pipeline-card">
        <div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.pipelinePulse")}</p><h2>{t("dashboard.salesProgress")}</h2></div><select aria-label={t("dashboard.pipelineType")}><option>{t("dashboard.allPipeline")}</option><option>{t("dashboard.schoolSales")}</option><option>{t("dashboard.familySales")}</option></select></div>
        <div className="pipeline-total"><div><small>{t("dashboard.weightedAmount")}</small><b>¥ 2.71M</b></div><span><TrendingUp size={15} /> 8.6%</span></div>
        <div className="pipeline-bars">
          <PipelineBar label={t("dashboard.needsConfirmed")} value="¥ 860K" count={12} width={76} color="var(--blue)" />
          <PipelineBar label={t("dashboard.proposal")} value="¥ 720K" count={8} width={64} color="var(--purple)" />
          <PipelineBar label={t("dashboard.quote")} value="¥ 580K" count={5} width={52} color="var(--amber)" />
          <PipelineBar label={t("dashboard.contractApproval")} value="¥ 550K" count={3} width={49} color="var(--green)" />
        </div>
        <Link className="card-link" href="/sales/performance">{t("dashboard.viewSalesAnalysis")} <ArrowUpRight size={15} /></Link>
      </article>
    </section>

    <section className="dashboard-bottom-grid">
      <article className="surface attention-card"><div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.attention")}</p><h2>{t("dashboard.attention")}</h2></div><span className="count-pill">{t("admin.items", { count: 8 })}</span></div>
        <AttentionRow icon={AlertTriangle} tone="red" title={t("dashboard.attention.stale")} meta={t("dashboard.attention.staleMeta")} href="/opportunities" />
        <AttentionRow icon={School} tone="amber" title={t("dashboard.attention.schools")} meta={t("dashboard.attention.schoolsMeta")} href="/schools" />
        <AttentionRow icon={GraduationCap} tone="purple" title={t("dashboard.attention.student")} meta={t("dashboard.attention.studentMeta")} href="/progression" />
      </article>
      <article className="surface relationship-card"><div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.relationshipHealth")}</p><h2>{t("dashboard.relationshipHealth")}</h2></div><Link href="/reports">{t("dashboard.report")}</Link></div>
        <div className="health-donut" style={{ "--score": "87%" } as React.CSSProperties}><div><b>87</b><small>{t("dashboard.overallHealth")}</small></div></div>
        <div className="health-legend"><span><i className="green" />{t("dashboard.healthy")} <b>68%</b></span><span><i className="amber" />{t("dashboard.attention")} <b>24%</b></span><span><i className="red" />{t("dashboard.risk")} <b>8%</b></span></div>
      </article>
      <article className="surface ai-card"><div className="ai-glow" /><div className="surface-heading"><span className="ai-icon"><Sparkles size={19} /></span><StatusBadge tone="purple">{t("dashboard.aiSuggestion")}</StatusBadge></div><h2>{t("dashboard.aiTitle")}</h2><p>{t("dashboard.aiBody")}</p><div className="ai-evidence"><b>{t("dashboard.evidence")}</b><span>{t("dashboard.recentActivity")}</span><span>{t("dashboard.contractDate")}</span><span>{t("dashboard.relationshipStrength")}</span></div><div className="ai-actions"><button type="button" onClick={() => setToast(t("dashboard.followupCreated"))}><Check size={15} />{t("dashboard.toTask")}</button><Link href="/schools">{t("dashboard.viewSchool")} <ChevronRight size={14} /></Link></div></article>
    </section>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

function MetricCard({ icon: Icon, tone, label, value, change, detail, href }: { icon: React.ElementType; tone: string; label: string; value: string; change: string; detail: string; href: string }) {
  return <Link href={href} className="metric-card"><span className={`metric-icon ${tone}`}><Icon size={21} /></span><div><span className="metric-label">{label}</span><b>{value}</b><small>{change}</small></div><span className="metric-detail">{detail} <ChevronRight size={14} /></span></Link>;
}

function FocusTask({ id, done, onDone, time, title, meta, tag, tone }: { id: string; done: boolean; onDone: (id: string) => void; time: string; title: string; meta: string; tag: string; tone: string }) {
  const { t } = useI18n(); return <div className={`focus-task ${done ? "done" : ""}`}><button className="task-check" type="button" onClick={() => onDone(id)} aria-label={t("dashboard.completeTask", { title })}>{done ? <Check size={15} /> : null}</button><time>{time}</time><div><b>{title}</b><small>{meta}</small></div><StatusBadge tone={tone}>{done ? t("common.completed") : tag}</StatusBadge><ChevronRight size={16} /></div>;
}

function PipelineBar({ label, value, count, width, color }: { label: string; value: string; count: number; width: number; color: string }) { const { t } = useI18n(); return <div className="pipeline-row"><span><b>{label}</b><small>{t("dashboard.opportunityCount", { count })}</small></span><div><i style={{ width: `${width}%`, background: color }} /></div><b>{value}</b></div>; }

function AttentionRow({ icon: Icon, tone, title, meta, href }: { icon: React.ElementType; tone: string; title: string; meta: string; href: string }) { return <Link className="attention-row" href={href}><span className={tone}><Icon size={17} /></span><span><b>{title}</b><small>{meta}</small></span><ChevronRight size={16} /></Link>; }
