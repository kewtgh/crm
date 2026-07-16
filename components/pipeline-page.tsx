"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, CircleDollarSign, MoreHorizontal, Plus, Sparkles, UserRound } from "lucide-react";
import { StatusBadge, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";

const stages = [
  { key: "needs", tone: "blue", total: "¥ 860K", cards: [
    { id: "o1", title: "台北欧洲学校 2026 续约", account: "Taipei European School", value: "¥ 320K", date: "8 月 3 日", owner: "OC", risk: "8 天无活动" },
    { id: "o2", title: "成都双语学校升学项目", account: "Chengdu Bilingual School", value: "¥ 280K", date: "8 月 15 日", owner: "JW", risk: "" },
    { id: "o3", title: "赵氏家庭 IB 学术规划", account: "Zhao Household", value: "¥ 46K", date: "7 月 28 日", owner: "SL", risk: "" },
  ]},
  { key: "proposal", tone: "purple", total: "¥ 720K", cards: [
    { id: "o4", title: "上海惠灵顿顾问项目", account: "Wellington College Shanghai", value: "¥ 410K", date: "8 月 8 日", owner: "OC", risk: "" },
    { id: "o5", title: "吴天乐本科申请服务", account: "Wu Household", value: "¥ 88K", date: "7 月 25 日", owner: "SL", risk: "材料待补" },
  ]},
  { key: "quote", tone: "amber", total: "¥ 580K", cards: [
    { id: "o6", title: "深圳国际交流升学合作", account: "SCIE", value: "¥ 360K", date: "7 月 30 日", owner: "JW", risk: "" },
    { id: "o7", title: "陈氏家庭双生子规划", account: "Chen Household", value: "¥ 118K", date: "8 月 2 日", owner: "EW", risk: "决策人未确认" },
  ]},
  { key: "approval", tone: "green", total: "¥ 550K", cards: [
    { id: "o8", title: "新加坡美国学校年度合作", account: "Singapore American School", value: "¥ 480K", date: "7 月 22 日", owner: "OC", risk: "" },
    { id: "o9", title: "周宇恒本科申请", account: "Chou Household", value: "¥ 70K", date: "7 月 20 日", owner: "SL", risk: "" },
  ]},
];

export function PipelinePage() {
  const { t } = useI18n();
  const [toast, setToast] = useState("");
  return <div className="page-stack pipeline-page"><section className="page-heading-row"><div><p className="eyebrow">REVENUE MOMENTUM</p><h1>{t("pipeline.title")}</h1><p>{t("pipeline.description")}</p></div><div className="page-actions"><button className="secondary-button" type="button">{t("pipeline.schoolSales")} <ChevronDown size={15} /></button><button className="primary-button" type="button"><Plus size={17} />{t("pipeline.new")}</button></div></section>
    <section className="pipeline-summary"><span><CircleDollarSign size={19} /><div><small>{t("pipeline.total")}</small><b>¥ 3.84M</b></div></span><span><Sparkles size={19} /><div><small>{t("pipeline.weighted")}</small><b>¥ 2.71M</b></div></span><span><CalendarDays size={19} /><div><small>{t("pipeline.monthExpected")}</small><b>¥ 930K</b></div></span><span><UserRound size={19} /><div><small>{t("pipeline.active")}</small><b>28</b></div></span></section>
    <div className="kanban-scroll"><section className="kanban-board">{stages.map((stage) => <div className="kanban-column" key={stage.key}><div className="kanban-heading"><span><i className={stage.tone} /><b>{t(`pipeline.stage.${stage.key}`)}</b><small>{stage.cards.length}</small></span><b>{stage.total}</b></div><div className="kanban-cards">{stage.cards.map((card) => <button type="button" className="opportunity-card" key={card.id} onClick={() => setToast(t("pipeline.opened",{title:card.title}))}><span className="opportunity-top"><StatusBadge tone={stage.tone}>{t(`pipeline.stage.${stage.key}`)}</StatusBadge><MoreHorizontal size={16} /></span><b>{card.title}</b><small>{card.account}</small><div className="opportunity-meta"><b>{card.value}</b><span><CalendarDays size={13} />{card.date}</span></div><div className="opportunity-footer"><span className="mini-avatar">{card.owner}</span>{card.risk ? <em>{card.risk}</em> : <span className="next-action">{t("pipeline.nextArranged")}</span>}</div></button>)}</div><button className="add-kanban" type="button"><Plus size={15} />{t("pipeline.add")}</button></div>)}</section></div>
    <p className="kanban-note">{t("pipeline.note")}</p>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}
