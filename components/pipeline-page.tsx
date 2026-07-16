"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, CircleDollarSign, MoreHorizontal, Plus, Sparkles, UserRound } from "lucide-react";
import { StatusBadge, Toast } from "@/components/ui";

const stages = [
  { name: "需求确认", tone: "blue", total: "¥ 860K", cards: [
    { id: "o1", title: "台北欧洲学校 2026 续约", account: "Taipei European School", value: "¥ 320K", date: "8 月 3 日", owner: "OC", risk: "8 天无活动" },
    { id: "o2", title: "成都双语学校升学项目", account: "Chengdu Bilingual School", value: "¥ 280K", date: "8 月 15 日", owner: "JW", risk: "" },
    { id: "o3", title: "赵氏家庭 IB 学术规划", account: "Zhao Household", value: "¥ 46K", date: "7 月 28 日", owner: "SL", risk: "" },
  ]},
  { name: "方案沟通", tone: "purple", total: "¥ 720K", cards: [
    { id: "o4", title: "上海惠灵顿顾问项目", account: "Wellington College Shanghai", value: "¥ 410K", date: "8 月 8 日", owner: "OC", risk: "" },
    { id: "o5", title: "吴天乐本科申请服务", account: "Wu Household", value: "¥ 88K", date: "7 月 25 日", owner: "SL", risk: "材料待补" },
  ]},
  { name: "报价", tone: "amber", total: "¥ 580K", cards: [
    { id: "o6", title: "深圳国际交流升学合作", account: "SCIE", value: "¥ 360K", date: "7 月 30 日", owner: "JW", risk: "" },
    { id: "o7", title: "陈氏家庭双生子规划", account: "Chen Household", value: "¥ 118K", date: "8 月 2 日", owner: "EW", risk: "决策人未确认" },
  ]},
  { name: "合同审批", tone: "green", total: "¥ 550K", cards: [
    { id: "o8", title: "新加坡美国学校年度合作", account: "Singapore American School", value: "¥ 480K", date: "7 月 22 日", owner: "OC", risk: "" },
    { id: "o9", title: "周宇恒本科申请", account: "Chou Household", value: "¥ 70K", date: "7 月 20 日", owner: "SL", risk: "" },
  ]},
];

export function PipelinePage() {
  const [toast, setToast] = useState("");
  return <div className="page-stack pipeline-page"><section className="page-heading-row"><div><p className="eyebrow">REVENUE MOMENTUM</p><h1>商机 Pipeline</h1><p>阶段规则、关键角色与下一步都在同一看板中。</p></div><div className="page-actions"><button className="secondary-button" type="button">学校销售 <ChevronDown size={15} /></button><button className="primary-button" type="button"><Plus size={17} />新建商机</button></div></section>
    <section className="pipeline-summary"><span><CircleDollarSign size={19} /><div><small>Pipeline 总额</small><b>¥ 3.84M</b></div></span><span><Sparkles size={19} /><div><small>加权预计</small><b>¥ 2.71M</b></div></span><span><CalendarDays size={19} /><div><small>本月预计成交</small><b>¥ 930K</b></div></span><span><UserRound size={19} /><div><small>活跃商机</small><b>28</b></div></span></section>
    <div className="kanban-scroll"><section className="kanban-board">{stages.map((stage) => <div className="kanban-column" key={stage.name}><div className="kanban-heading"><span><i className={stage.tone} /><b>{stage.name}</b><small>{stage.cards.length}</small></span><b>{stage.total}</b></div><div className="kanban-cards">{stage.cards.map((card) => <button type="button" className="opportunity-card" key={card.id} onClick={() => setToast(`已打开「${card.title}」详情`)}><span className="opportunity-top"><StatusBadge tone={stage.tone}>{stage.name}</StatusBadge><MoreHorizontal size={16} /></span><b>{card.title}</b><small>{card.account}</small><div className="opportunity-meta"><b>{card.value}</b><span><CalendarDays size={13} />{card.date}</span></div><div className="opportunity-footer"><span className="mini-avatar">{card.owner}</span>{card.risk ? <em>{card.risk}</em> : <span className="next-action">下一步已安排</span>}</div></button>)}</div><button className="add-kanban" type="button"><Plus size={15} />添加商机</button></div>)}</section></div>
    <p className="kanban-note">阶段变更会先校验金额、产品、关键角色和下一步；失败时卡片保持原位置并显示原因。</p>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}
