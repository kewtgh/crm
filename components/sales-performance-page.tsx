"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  BadgeDollarSign,
  ChartNoAxesCombined,
  CircleGauge,
  Goal,
  HeartHandshake,
  Megaphone,
  MessageCircle,
  Phone,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Utensils,
  Users,
  X,
} from "lucide-react";
import { InlineMessage, ProgressBar, SearchableSelect, StatusBadge, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";

const members = [
  { name: "Olivia Chen", team: "taipei", target: 1_500_000, actual: 1_280_000, forecast: 1_560_000, annualTarget: 5_500_000, annualActual: 4_100_000, annualForecast: 5_600_000, deals: 8 },
  { name: "Jason Wu", team: "taipei", target: 1_200_000, actual: 760_000, forecast: 1_030_000, annualTarget: 4_400_000, annualActual: 2_400_000, annualForecast: 4_100_000, deals: 6 },
  { name: "Sophia Lin", team: "singapore", target: 1_100_000, actual: 890_000, forecast: 1_120_000, annualTarget: 4_100_000, annualActual: 2_700_000, annualForecast: 4_300_000, deals: 7 },
  { name: "Ethan Wang", team: "shanghai", target: 1_000_000, actual: 490_000, forecast: 650_000, annualTarget: 3_700_000, annualActual: 1_600_000, annualForecast: 3_200_000, deals: 4 },
];

const quarterlyMonths = [
  { label: "consumption.july", target: 1_400_000, actual: 1_260_000 },
  { label: "consumption.august", target: 1_600_000, actual: 1_180_000 },
  { label: "consumption.september", target: 1_800_000, actual: 980_000 },
];

const yearlyMonths = [
  { label: "Q1", target: 3_600_000, actual: 3_420_000 },
  { label: "Q2", target: 4_100_000, actual: 3_960_000 },
  { label: "Q3", target: 4_800_000, actual: 3_420_000 },
  { label: "Q4", target: 5_200_000, actual: 0 },
];

const funnel = [
  { label: "sales.funnel.leads", count: 186, value: "¥ 9.8M", conversion: "100%", width: 100 },
  { label: "sales.funnel.qualified", count: 92, value: "¥ 6.7M", conversion: "49%", width: 78 },
  { label: "sales.funnel.proposal", count: 48, value: "¥ 4.9M", conversion: "52%", width: 60 },
  { label: "sales.funnel.negotiation", count: 27, value: "¥ 3.84M", conversion: "56%", width: 46 },
  { label: "sales.funnel.closed", count: 16, value: "¥ 3.42M", conversion: "59%", width: 34 },
];

const money = (value: number) => `¥ ${(value / 1_000_000).toFixed(2)}M`;

const relationshipGoals = [
  { key: "contact", icon: Phone, titleKey: "sales.relationship.contact", descriptionKey: "sales.relationship.contactHelp", actual: 88, tone: "blue" },
  { key: "meal", icon: Utensils, titleKey: "sales.relationship.meal", descriptionKey: "sales.relationship.mealHelp", actual: 62, tone: "green" },
  { key: "family", icon: MessageCircle, titleKey: "sales.relationship.family", descriptionKey: "sales.relationship.familyHelp", actual: 41, tone: "purple" },
  { key: "advocacy", icon: Megaphone, titleKey: "sales.relationship.advocacy", descriptionKey: "sales.relationship.advocacyHelp", actual: 18, tone: "amber" },
] as const;

const relationshipAccounts = [
  { nameZh: "台北欧洲学校", nameEn: "Taipei European School", owner: "Olivia", contact: true, meal: true, family: true, advocacy: true },
  { nameZh: "上海惠灵顿", nameEn: "Wellington College Shanghai", owner: "Ethan", contact: true, meal: true, family: true, advocacy: false },
  { nameZh: "新加坡美国学校", nameEn: "Singapore American School", owner: "Sophia", contact: true, meal: true, family: false, advocacy: false },
  { nameZh: "北京鼎石学校", nameEn: "Keystone Academy", owner: "Jason", contact: true, meal: false, family: false, advocacy: false },
  { nameZh: "苏州新加坡学校", nameEn: "Suzhou Singapore International School", owner: "Jason", contact: false, meal: false, family: false, advocacy: false },
];

const relationshipPlaybook = [
  { stage:"contact", icon:Phone, tone:"blue", suggestions:["verifyChannel","shareValue","askPreference","setNextStep"] },
  { stage:"meal", icon:Utensils, tone:"green", suggestions:["inviteMeal","chooseContext","listenMore","followUp"] },
  { stage:"family", icon:MessageCircle, tone:"purple", suggestions:["startEveryday","rememberBoundaries","connectNeeds","respectPrivacy"] },
  { stage:"advocacy", icon:Megaphone, tone:"amber", suggestions:["confirmValue","offerMaterial","makeEasy","askPermission"] },
] as const;
const closingPlaybook = [
  { stage:"discovery", suggestions:["clarifyNeed","mapDecision","confirmBudget","agreeNext"] },
  { stage:"evaluation", suggestions:["tailorProposal","showEvidence","compareOptions","reviewTogether"] },
  { stage:"hesitation", suggestions:["surfaceConcern","reduceRisk","bringDecisionMaker","setDecisionDate"] },
  { stage:"payment", suggestions:["confirmTerms","simplifyPayment","sendChecklist","confirmKickoff"] },
] as const;

export function SalesPerformancePage() {
  const { locale, t } = useI18n();
  const teamOptions = [{ value: "all", label: t("sales.team.all"), detail: t("sales.team.allDetail") }, { value: "taipei", label: t("sales.team.taipei"), detail: "Olivia · Jason" }, { value: "shanghai", label: t("sales.team.shanghai"), detail: "Ethan" }, { value: "singapore", label: t("sales.team.singapore"), detail: "Sophia" }];
  const [period, setPeriod] = useState<"quarter" | "year">("quarter");
  const [team, setTeam] = useState("all");
  const [targets, setTargets] = useState({ quarter: 4_800_000, year: 17_700_000 });
  const [relationshipTargets, setRelationshipTargets] = useState({ contact: 95, meal: 70, family: 50, advocacy: 25 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [relationshipDrawerOpen, setRelationshipDrawerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const relationshipCloseRef = useRef<HTMLButtonElement>(null);

  const visibleMembers = useMemo(() => members.filter((member) => {
    if (team === "all") return true;
    return member.team === team;
  }), [team]);
  const actual = visibleMembers.reduce((sum, member) => sum + (period === "quarter" ? member.actual : member.annualActual), 0);
  const forecast = visibleMembers.reduce((sum, member) => sum + (period === "quarter" ? member.forecast : member.annualForecast), 0);
  const visibleTarget = team === "all" ? targets[period] : visibleMembers.reduce((sum, member) => sum + (period === "quarter" ? member.target : member.annualTarget), 0);
  const attainment = Math.round(actual / visibleTarget * 100);
  const forecastAttainment = Math.round(forecast / visibleTarget * 100);
  const months = period === "quarter" ? quarterlyMonths : yearlyMonths;
  const maxMonth = Math.max(...months.flatMap((item) => [item.target, item.actual]));

  const submitTarget = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = Number(new FormData(event.currentTarget).get("target"));
    if (Number.isFinite(next) && next > 0) setTargets((current) => ({ ...current, [period]: next }));
    setDrawerOpen(false);
    setToast(t("sales.targetUpdated"));
  };

  const submitRelationshipTargets = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setRelationshipTargets({
      contact: Number(form.get("contact")),
      meal: Number(form.get("meal")),
      family: Number(form.get("family")),
      advocacy: Number(form.get("advocacy")),
    });
    setRelationshipDrawerOpen(false);
    setToast(t("sales.relationshipUpdated"));
  };

  useEffect(() => {
    if (!drawerOpen && !relationshipDrawerOpen) return;
    (drawerOpen ? closeRef : relationshipCloseRef).current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setDrawerOpen(false); setRelationshipDrawerOpen(false); } };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen, relationshipDrawerOpen]);

  return <div className="page-stack sales-performance-page">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t("sales.eyebrow")}</p><h1>{t("sales.title")}</h1><p>{t("sales.description")}</p></div>
      <div className="page-actions"><button className="secondary-button" type="button">{t("sales.export")}</button><button className="primary-button" type="button" onClick={() => setDrawerOpen(true)}><Goal size={17} />{t("sales.setTarget")}</button></div>
    </section>
    <InlineMessage type="warning">{t("sales.prototypeWarning")}</InlineMessage>

    <section className="sales-filterbar surface">
      <div className="period-switch" aria-label={t("sales.analysisPeriod")}><button type="button" className={period === "quarter" ? "active" : ""} onClick={() => setPeriod("quarter")}>2026 Q3</button><button type="button" className={period === "year" ? "active" : ""} onClick={() => setPeriod("year")}>{t("sales.fullYear")}</button></div>
      <SearchableSelect label={t("sales.teamScope")} options={teamOptions} value={team} onChange={setTeam} />
      <span>{t("sales.updatedAt")}</span>
    </section>

    <section className="sales-kpi-grid">
      <SalesKpi icon={Goal} tone="green" label={t("sales.target")} value={money(visibleTarget)} detail={t(team === "all" ? "sales.publishedTarget" : "sales.selectedTarget")} />
      <SalesKpi icon={BadgeDollarSign} tone="blue" label={t("sales.actualPerformance")} value={money(actual)} detail={t("sales.attainment", { value: attainment })} />
      <SalesKpi icon={TrendingUp} tone="purple" label={t("sales.forecast")} value={money(forecast)} detail={t("sales.forecastAttainment", { value: forecastAttainment })} />
      <SalesKpi icon={CircleGauge} tone={forecast >= visibleTarget ? "green" : "amber"} label={t("sales.forecastGap")} value={money(forecast - visibleTarget)} detail={t(forecast >= visibleTarget ? "sales.exceedTarget" : "sales.needPipeline")} />
    </section>

    <section className="sales-main-grid">
      <article className="surface sales-trend-card">
        <div className="surface-heading"><div><p className="eyebrow">TARGET VS ACTUAL</p><h2>{t("sales.targetTrend")}</h2></div><div className="chart-legend"><span><i className="target" />{t("sales.target")}</span><span><i className="actual" />{t("sales.actual")}</span></div></div>
        <div className="sales-bar-chart" role="img" aria-label={t("sales.trendChart")}>
          {months.map((item) => <div className="sales-bar-group" key={item.label}><div><span className="target" style={{ height: `${Math.max(3, item.target / maxMonth * 100)}%` }} title={`${t("sales.target")} ${money(item.target)}`} /><span className="actual" style={{ height: `${Math.max(item.actual ? 3 : 0, item.actual / maxMonth * 100)}%` }} title={`${t("sales.actual")} ${money(item.actual)}`} /></div><b>{item.label.startsWith("consumption.") ? t(item.label) : item.label}</b><small>{item.actual ? `${Math.round(item.actual / item.target * 100)}%` : t("common.notStarted")}</small></div>)}
        </div>
      </article>
      <article className="surface forecast-card">
        <div className="surface-heading"><div><p className="eyebrow">FORECAST HEALTH</p><h2>{t("sales.forecastHealth")}</h2></div><StatusBadge tone={forecastAttainment >= 95 ? "green" : "amber"}>{t(forecastAttainment >= 95 ? "sales.nearTarget" : "sales.hasGap")}</StatusBadge></div>
        <div className="forecast-score"><div className="health-donut small" style={{ "--score": `${Math.min(forecastAttainment, 100)}%` } as React.CSSProperties}><div><b>{forecastAttainment}%</b><small>{t("sales.forecastAchieved")}</small></div></div><div><span><b>{money(actual)}</b><small>{t("sales.closed")}</small></span><span><b>{money(forecast - actual)}</b><small>{t("sales.weightedIncrease")}</small></span></div></div>
        <div className="forecast-alert"><TriangleAlert size={18} /><div><b>{t("sales.alert.shanghai")}</b><p>{t("sales.alert.shanghaiHelp")}</p></div></div>
        <div className="forecast-alert good"><Sparkles size={18} /><div><b>{t("sales.alert.olivia")}</b><p>{t("sales.alert.oliviaHelp")}</p></div></div>
      </article>
    </section>

    <section className="surface team-performance-card">
      <div className="surface-heading"><div><p className="eyebrow">TEAM CONTRIBUTION</p><h2>{t("sales.teamProgress")}</h2></div><StatusBadge tone="blue">{t("sales.memberCount", { count: visibleMembers.length })}</StatusBadge></div>
      <div className="sales-team-head"><span>{t("sales.member")}</span><span>{t("sales.targetActual")}</span><span>{t("sales.attainmentLabel")}</span><span>{t("sales.forecast")}</span><span>{t("sales.opportunities")}</span></div>
      {visibleMembers.map((member) => { const memberTarget = period === "quarter" ? member.target : member.annualTarget; const memberActual = period === "quarter" ? member.actual : member.annualActual; const memberForecast = period === "quarter" ? member.forecast : member.annualForecast; const percent = Math.round(memberActual / memberTarget * 100); return <div className="sales-member-row" key={member.name}><div><span className="record-avatar">{member.name.split(" ").map((part) => part[0]).join("")}</span><span><b>{member.name}</b><small>{t("sales.teamSuffix", { team: t(`sales.team.${member.team}`).replace(/团队| team/i, "") })}</small></span></div><span><b>{money(memberActual)}</b><small>{t("sales.targetValue", { value: money(memberTarget) })}</small></span><ProgressBar value={percent} label={`${percent}%`} /><span><b>{money(memberForecast)}</b><small>{t("sales.forecastValue", { value: Math.round(memberForecast / memberTarget * 100) })}</small></span><span><b>{member.deals}</b><small>{t("sales.openDeals")}</small></span></div>; })}
    </section>

    <section className="surface relationship-goals-card">
      <div className="surface-heading"><div><p className="eyebrow">RELATIONSHIP GOALS</p><h2>{t("sales.relationshipTitle")}</h2><p>{t("sales.relationshipDescription")}</p></div><button className="secondary-button" type="button" onClick={() => setRelationshipDrawerOpen(true)}><Goal size={16} />{t("sales.manageRelationship")}</button></div>
      <div className="relationship-goal-grid">{relationshipGoals.map(({ key, icon: Icon, titleKey, descriptionKey, actual, tone }, index) => { const goal = relationshipTargets[key]; return <article key={key}><span className={tone}><Icon size={19} /></span><div><small>{t("sales.relationshipLevel",{level:index+1})}</small><b>{t(titleKey)}</b><p>{t(descriptionKey)}</p></div><strong>{actual}% <small>/ {t("sales.target")} {goal}%</small></strong><ProgressBar value={actual} label={actual >= goal ? t("sales.achieved") : t("sales.pointsGap",{value:goal-actual})} /></article>; })}</div>
      <div className="relationship-matrix-wrap"><div className="relationship-matrix-head"><span>{t("sales.keyAccounts")}</span><span>{t("common.owner")}</span><span>{t("sales.matrix.contact")}</span><span>{t("sales.matrix.meal")}</span><span>{t("sales.matrix.family")}</span><span>{t("sales.matrix.advocacy")}</span></div>{relationshipAccounts.map((account) => <div className="relationship-matrix-row" key={account.nameEn}><b>{locale === "zh-CN" ? account.nameZh : account.nameEn}</b><span>{account.owner}</span>{(["contact", "meal", "family", "advocacy"] as const).map((key) => <span className={account[key] ? "achieved" : "pending"} key={key}>{t(account[key]?"sales.achieved":"sales.pendingAdvance")}</span>)}</div>)}</div>
    </section>

    <section className="surface sales-playbook-card"><div className="surface-heading"><div><p className="eyebrow">RELATIONSHIP PLAYBOOK</p><h2>{t("sales.relationshipPlaybook.title")}</h2><p>{t("sales.relationshipPlaybook.description")}</p></div><HeartHandshake size={20}/></div><div className="sales-playbook-grid">{relationshipPlaybook.map(({stage,icon:Icon,tone,suggestions},index)=><article key={stage}><span className={tone}><Icon size={18}/></span><div><small>{t("sales.relationshipLevel",{level:index+1})}</small><h3>{t(`sales.relationship.${stage}`)}</h3><ol>{suggestions.map(item=><li key={item}>{t(`sales.relationshipPlaybook.${stage}.${item}`)}</li>)}</ol></div></article>)}</div></section>

    <section className="surface sales-playbook-card closing"><div className="surface-heading"><div><p className="eyebrow">CLOSING PLAYBOOK</p><h2>{t("sales.closingPlaybook.title")}</h2><p>{t("sales.closingPlaybook.description")}</p></div><BadgeDollarSign size={20}/></div><div className="sales-playbook-grid">{closingPlaybook.map(({stage,suggestions},index)=><article key={stage}><span className={`stage-${index+1}`}><BadgeDollarSign size={18}/></span><div><small>{t("sales.closingStage",{stage:index+1})}</small><h3>{t(`sales.closingPlaybook.${stage}.title`)}</h3><ol>{suggestions.map(item=><li key={item}>{t(`sales.closingPlaybook.${stage}.${item}`)}</li>)}</ol></div></article>)}</div><InlineMessage type="warning">{t("sales.closingPlaybook.ethics")}</InlineMessage></section>

    <section className="sales-bottom-grid">
      <article className="surface funnel-card"><div className="surface-heading"><div><p className="eyebrow">CONVERSION FUNNEL</p><h2>{t("sales.funnel")}</h2></div><ChartNoAxesCombined size={20} /></div><div className="sales-funnel">{funnel.map((stage) => <div key={stage.label}><span style={{ width: `${stage.width}%` }}><b>{t(stage.label)}</b><small>{t("sales.funnelItems", { count: stage.count })} · {stage.value}</small></span><em>{stage.conversion}</em></div>)}</div></article>
      <article className="surface insight-card"><div className="surface-heading"><div><p className="eyebrow">ACTIONABLE INSIGHTS</p><h2>{t("sales.insights")}</h2></div><Sparkles size={20} /></div><Insight tone="green" title={t("sales.insight.renewal")} detail={t("sales.insight.renewalHelp")} /><Insight tone="amber" title={t("sales.insight.proposal")} detail={t("sales.insight.proposalHelp")} /><Insight tone="blue" title={t("sales.insight.referral")} detail={t("sales.insight.referralHelp")} /></article>
    </section>

    {drawerOpen && <>
      <button className="drawer-overlay" type="button" aria-label={t("sales.closeTargetForm")} onClick={() => setDrawerOpen(false)} />
      <aside className="record-drawer" role="dialog" aria-modal="true" aria-label={t("sales.targetDialog")}>
        <div className="drawer-heading"><div><p className="eyebrow">SALES TARGET</p><h2>{t("sales.targetDialogTitle", { period: period === "quarter" ? "Q3" : t("sales.annual") })}</h2><p>{t("sales.targetDialogHelp")}</p></div><button ref={closeRef} className="icon-button" type="button" aria-label={t("common.close")} onClick={() => setDrawerOpen(false)}><X size={20} /></button></div>
        <form onSubmit={submitTarget}><label className="field"><span>{t("sales.targetAmount", { period: t(period === "quarter" ? "sales.quarter" : "sales.annual") })}</span><input name="target" type="number" min="1" step="10000" defaultValue={targets[period]} required /></label><label className="field"><span>{t("sales.targetNote")}</span><textarea rows={4} defaultValue={t("sales.targetNoteDefault", { period: period === "quarter" ? "Q3" : t("sales.fullYear") })} /></label><InlineMessage type="warning">{t("sales.targetAuditWarning")}</InlineMessage><div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setDrawerOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit"><Goal size={17} />{t("sales.updateTarget")}</button></div></form>
      </aside>
    </>}
    {relationshipDrawerOpen && <>
      <button className="drawer-overlay" type="button" aria-label={t("sales.closeRelationshipForm")} onClick={() => setRelationshipDrawerOpen(false)} />
      <aside className="record-drawer" role="dialog" aria-modal="true" aria-label={t("sales.relationshipDialog")}>
        <div className="drawer-heading"><div><p className="eyebrow">RELATIONSHIP TARGETS</p><h2>{t("sales.relationshipDialog")}</h2><p>{t("sales.relationshipDialogHelp")}</p></div><button ref={relationshipCloseRef} className="icon-button" type="button" aria-label={t("common.close")} onClick={() => setRelationshipDrawerOpen(false)}><X size={20} /></button></div>
        <form onSubmit={submitRelationshipTargets}>{relationshipGoals.map(({ key, titleKey }) => <label className="field" key={key}><span>{t("sales.relationshipCoverage",{name:t(titleKey)})}</span><input name={key} type="number" min="0" max="100" defaultValue={relationshipTargets[key]} required /></label>)}<InlineMessage type="warning">{t("sales.relationship.privacy")}</InlineMessage><div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setRelationshipDrawerOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit"><Goal size={17} />{t("sales.saveRelationship")}</button></div></form>
      </aside>
    </>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

function SalesKpi({ icon: Icon, tone, label, value, detail }: { icon: React.ElementType; tone: string; label: string; value: string; detail: string }) {
  return <article className="surface sales-kpi"><span className={tone}><Icon size={21} /></span><div><small>{label}</small><b>{value}</b><em>{detail}</em></div><ArrowUpRight size={17} /></article>;
}

function Insight({ tone, title, detail }: { tone: string; title: string; detail: string }) {
  return <div className="sales-insight"><span className={tone}><Users size={17} /></span><div><b>{title}</b><p>{detail}</p></div></div>;
}
