"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
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

export function DashboardPage() {
  const [toast, setToast] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const complete = (id: string) => { setCompleted((items) => [...items, id]); setToast("任务已完成，时间线已同步更新"); };
  return <div className="page-stack dashboard-page">
    <section className="welcome-strip">
      <div><p className="eyebrow">THURSDAY · 16 JULY</p><h1>早上好，雅雯 <span>👋</span></h1><p>今天有 <b>5 项重点工作</b>，其中 2 项即将到期。关系健康度较上周提升 3.2%。</p></div>
      <div className="welcome-actions"><button className="secondary-button" type="button"><CalendarDays size={17} />查看日程</button><button className="primary-button" type="button"><UserRoundPlus size={17} />快速新建</button></div>
    </section>

    <section className="metric-grid">
      <MetricCard icon={ListTodo} tone="coral" label="今日任务" value="12" change="2 项即将到期" detail="查看我的任务" href="/tasks" />
      <MetricCard icon={CircleDollarSign} tone="mint" label="Pipeline 预计金额" value="¥ 3.84M" change="↑ 12.4% 本月" detail="查看商机" href="/opportunities" />
      <MetricCard icon={School} tone="blue" label="重点学校" value="28" change="4 所需关注" detail="关系健康度" href="/schools" />
      <MetricCard icon={GraduationCap} tone="purple" label="关键期学生" value="16" change="6 项本周节点" detail="查看学生" href="/students" />
    </section>

    <section className="dashboard-main-grid">
      <article className="surface task-focus-card">
        <div className="surface-heading"><div><p className="eyebrow">TODAY&apos;S FOCUS</p><h2>今日重点</h2></div><Link href="/tasks">全部任务 <ArrowRight size={15} /></Link></div>
        <div className="focus-list">
          <FocusTask id="f1" done={completed.includes("f1")} onDone={complete} tone="red" time="10:30" title="台北欧洲学校续约回访" meta="学校 · Olivia Chen" tag="高优先" />
          <FocusTask id="f2" done={completed.includes("f2")} onDone={complete} tone="amber" time="14:00" title="确认 Theo 的 UCAS 推荐信终稿" meta="学生 · Sophia Lin" tag="今天到期" />
          <FocusTask id="f3" done={completed.includes("f3")} onDone={complete} tone="blue" time="16:30" title="赵氏家庭首次需求访谈" meta="家庭 · Jason Wu" tag="线上会议" />
          <FocusTask id="f4" done={completed.includes("f4")} onDone={complete} tone="purple" time="18:00" title="审核监护人验证资料" meta="管理 · 6 份待审核" tag="需复核" />
        </div>
      </article>

      <article className="surface pipeline-card">
        <div className="surface-heading"><div><p className="eyebrow">PIPELINE PULSE</p><h2>销售进展</h2></div><select aria-label="Pipeline 类型"><option>全部 Pipeline</option><option>学校销售</option><option>家庭销售</option></select></div>
        <div className="pipeline-total"><div><small>加权预计金额</small><b>¥ 2.71M</b></div><span><TrendingUp size={15} /> 8.6%</span></div>
        <div className="pipeline-bars">
          <PipelineBar label="需求确认" value="¥ 860K" count={12} width={76} color="var(--blue)" />
          <PipelineBar label="方案沟通" value="¥ 720K" count={8} width={64} color="var(--purple)" />
          <PipelineBar label="报价" value="¥ 580K" count={5} width={52} color="var(--amber)" />
          <PipelineBar label="合同审批" value="¥ 550K" count={3} width={49} color="var(--green)" />
        </div>
        <Link className="card-link" href="/opportunities">打开 Pipeline 看板 <ArrowUpRight size={15} /></Link>
      </article>
    </section>

    <section className="dashboard-bottom-grid">
      <article className="surface attention-card"><div className="surface-heading"><div><p className="eyebrow">ATTENTION NEEDED</p><h2>需要关注</h2></div><span className="count-pill">8 项</span></div>
        <AttentionRow icon={AlertTriangle} tone="red" title="3 个商机超过 14 天无活动" meta="合计 ¥ 420K · 最高停滞 23 天" href="/opportunities" />
        <AttentionRow icon={School} tone="amber" title="4 所重点学校缺少决策人" meta="苏州新加坡学校风险最高" href="/schools" />
        <AttentionRow icon={GraduationCap} tone="purple" title="1 名学生升级规则不完整" meta="何雨乔 · IB Year 1" href="/progression" />
      </article>
      <article className="surface relationship-card"><div className="surface-heading"><div><p className="eyebrow">RELATIONSHIP HEALTH</p><h2>关系健康</h2></div><Link href="/reports">报告</Link></div>
        <div className="health-donut" style={{ "--score": "87%" } as React.CSSProperties}><div><b>87</b><small>整体健康度</small></div></div>
        <div className="health-legend"><span><i className="green" />健康 <b>68%</b></span><span><i className="amber" />需关注 <b>24%</b></span><span><i className="red" />风险 <b>8%</b></span></div>
      </article>
      <article className="surface ai-card"><div className="ai-glow" /><div className="surface-heading"><span className="ai-icon"><Sparkles size={19} /></span><StatusBadge tone="purple">AI 建议</StatusBadge></div><h2>优先联系台北欧洲学校</h2><p>续约窗口将在 18 天后关闭，且校方本周刚确认预算。建议今天与升学指导主任 Rachel Wang 安排 30 分钟方案回顾。</p><div className="ai-evidence"><b>依据</b><span>最近活动</span><span>合同日期</span><span>关系强度</span></div><div className="ai-actions"><button type="button" onClick={() => setToast("已创建跟进任务，截止时间为明天 17:00")}><Check size={15} />转为任务</button><Link href="/schools">查看学校 <ChevronRight size={14} /></Link></div></article>
    </section>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

function MetricCard({ icon: Icon, tone, label, value, change, detail, href }: { icon: React.ElementType; tone: string; label: string; value: string; change: string; detail: string; href: string }) {
  return <Link href={href} className="metric-card"><span className={`metric-icon ${tone}`}><Icon size={21} /></span><div><span className="metric-label">{label}</span><b>{value}</b><small>{change}</small></div><span className="metric-detail">{detail} <ChevronRight size={14} /></span></Link>;
}

function FocusTask({ id, done, onDone, time, title, meta, tag, tone }: { id: string; done: boolean; onDone: (id: string) => void; time: string; title: string; meta: string; tag: string; tone: string }) {
  return <div className={`focus-task ${done ? "done" : ""}`}><button className="task-check" type="button" onClick={() => onDone(id)} aria-label={`完成 ${title}`}>{done ? <Check size={15} /> : null}</button><time>{time}</time><div><b>{title}</b><small>{meta}</small></div><StatusBadge tone={tone}>{done ? "已完成" : tag}</StatusBadge><ChevronRight size={16} /></div>;
}

function PipelineBar({ label, value, count, width, color }: { label: string; value: string; count: number; width: number; color: string }) { return <div className="pipeline-row"><span><b>{label}</b><small>{count} 个商机</small></span><div><i style={{ width: `${width}%`, background: color }} /></div><b>{value}</b></div>; }

function AttentionRow({ icon: Icon, tone, title, meta, href }: { icon: React.ElementType; tone: string; title: string; meta: string; href: string }) { return <Link className="attention-row" href={href}><span className={tone}><Icon size={17} /></span><span><b>{title}</b><small>{meta}</small></span><ChevronRight size={16} /></Link>; }
