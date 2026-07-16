"use client";

import { useState } from "react";
import { ChartNoAxesCombined, CircleDollarSign, ReceiptText, RefreshCcw, ShoppingBag, TrendingUp, Users } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { InlineMessage, ProgressBar, StatusBadge } from "@/components/ui";
import type { ConsumptionPeriod as Period, ConsumptionResult } from "@/lib/consumption-repository";

const fallback: Record<Period, ConsumptionResult> = {
  month: { period: "month", label: "2026-07", total: 1_280_000, orders: 46, average: 27_826, renewal: 72, compare: 12.4, trend: [["W1",220_000],["W2",310_000],["W3",390_000],["W4",360_000]], productMix: [], topCustomers: [] },
  quarter: { period: "quarter", label: "2026 Q3", total: 3_420_000, orders: 124, average: 27_581, renewal: 68, compare: 8.6, trend: [["Jul",1_280_000],["Aug",1_160_000],["Sep",980_000]], productMix: [], topCustomers: [] },
  year: { period: "year", label: "2026", total: 10_800_000, orders: 352, average: 30_682, renewal: 74, compare: 18.2, trend: [["Q1",3_420_000],["Q2",3_960_000],["Q3",3_420_000],["Q4",0]], productMix: [], topCustomers: [] },
};
const fallbackMix = [
  { nameZh:"升学",nameEn:"Admissions Planning",value:4_620_000,customers:68,color:"green" }, { nameZh:"预科",nameEn:"Foundation Program",value:2_160_000,customers:18,color:"purple" }, { nameZh:"竞赛",nameEn:"Competition Program",value:1_620_000,customers:42,color:"blue" }, { nameZh:"夏令营",nameEn:"Summer Camp",value:1_280_000,customers:36,color:"amber" }, { nameZh:"夏校",nameEn:"Summer School",value:1_120_000,customers:31,color:"coral" },
];
const fallbackCustomers = [
  { nameZh:"台北欧洲学校",nameEn:"Taipei European School",customerType:"school" as const,productsZh:["升学","夏校"],productsEn:["Admissions Planning","Summer School"],amount:920_000 },
  { nameZh:"吴氏家庭",nameEn:"Wu Household",customerType:"family" as const,productsZh:["升学","竞赛"],productsEn:["Admissions Planning","Competition Program"],amount:480_000 },
];
const money = (value:number) => value >= 1_000_000 ? `¥ ${(value/1_000_000).toFixed(2)}M` : `¥ ${(value/1_000).toFixed(1)}K`;

export function ConsumptionAnalysisPage({ initialData, persistent = false }: { initialData?: ConsumptionResult; persistent?: boolean }) {
  const { locale, t } = useI18n(); const [period,setPeriod] = useState<Period>(initialData?.period ?? "quarter");
  const [cache,setCache] = useState<Partial<Record<Period,ConsumptionResult>>>(initialData ? { [initialData.period]: initialData } : {}); const [error,setError] = useState(""); const [loading,setLoading] = useState(false);
  const choosePeriod=async(next:Period)=>{setPeriod(next);if(!persistent||cache[next])return;setLoading(true);setError("");try{const response=await fetch(`/api/analytics/consumption?period=${next}`);const result=await response.json() as {data?:ConsumptionResult};if(!response.ok||!result.data)throw new Error();setCache(current=>({...current,[next]:result.data}));}catch{setError(t("consumption.loadFailed"));}finally{setLoading(false);}};
  const data = cache[period] ?? fallback[period]; const usingFallback = !cache[period];
  const mix = data.productMix.length ? data.productMix : usingFallback ? fallbackMix.map((item)=>({ ...item, value: Math.round(item.value*(period==="month"?.12:period==="quarter"?.32:1)) })) : [];
  const customers = data.topCustomers.length ? data.topCustomers : usingFallback ? fallbackCustomers : [];
  const maxTrend = Math.max(1,...data.trend.map(([,value])=>value)); const mixTotal = Math.max(1,mix.reduce((sum,item)=>sum+item.value,0));
  const segmentTotals = {school:customers.filter(item=>item.customerType==="school").reduce((sum,item)=>sum+item.amount,0),family:customers.filter(item=>item.customerType==="family").reduce((sum,item)=>sum+item.amount,0)};
  return <div className="page-stack consumption-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("consumption.eyebrow")}</p><h1>{t("consumption.title")}</h1><p>{t("consumption.description")}</p></div><div className="period-switch consumption-period" aria-label={t("consumption.period")}>{(["month","quarter","year"] as Period[]).map(item=><button type="button" className={period===item?"active":""} onClick={()=>choosePeriod(item)} key={item}>{t(`consumption.${item}`)}</button>)}</div></section>
    {loading&&<InlineMessage type="warning">{t("consumption.loading")}</InlineMessage>}{error&&<InlineMessage type="error">{error}</InlineMessage>}
    <section className="consumption-summary"><ConsumptionKpi icon={CircleDollarSign} tone="green" value={money(data.total)} label={t("consumption.confirmed")} detail={t("consumption.compared",{value:data.compare})}/><ConsumptionKpi icon={ReceiptText} tone="blue" value={String(data.orders)} label={t("consumption.orders")} detail={data.label}/><ConsumptionKpi icon={ShoppingBag} tone="purple" value={money(data.average)} label={t("consumption.average")} detail={t("consumption.orderBasis")}/><ConsumptionKpi icon={RefreshCcw} tone="amber" value={`${data.renewal}%`} label={t("consumption.renewal")} detail={t("consumption.rollingYear")}/></section>
    <section className="consumption-main-grid">
      <article className="surface consumption-trend"><div className="surface-heading"><div><p className="eyebrow">{t("consumption.trendEyebrow")}</p><h2>{t("consumption.trend",{period:data.label})}</h2></div><StatusBadge tone={data.compare>=0?"green":"red"}><TrendingUp size={13}/>{t("consumption.growth",{value:data.compare})}</StatusBadge></div><div className="consumption-bars" role="img" aria-label={t("consumption.chart",{period:data.label})}>{data.trend.map(([label,value])=><div key={label}><span style={{height:`${value?Math.max(6,value/maxTrend*100):0}%`}}/><b>{label}</b><small>{value?money(value):t("common.notStarted")}</small></div>)}</div></article>
      <article className="surface product-mix-card"><div className="surface-heading"><div><p className="eyebrow">{t("consumption.productMixEyebrow")}</p><h2>{t("consumption.productMix")}</h2></div><ChartNoAxesCombined size={20}/></div>{mix.map(item=>{const percent=Math.round(item.value/mixTotal*100);return <div className="product-mix-row" key={`${item.nameEn}-${item.color}`}><span className={item.color}/><div><b>{locale==="zh-CN"?item.nameZh:item.nameEn}</b><small>{t("consumption.customerLearnerCount",{count:item.customers})}</small></div><ProgressBar value={percent} label={`${percent}%`}/><strong>{money(item.value)}</strong></div>})}{!mix.length&&<div className="empty-state"><span>{t("consumption.noData")}</span></div>}</article>
    </section>
    <section className="consumption-segments"><SegmentCard icon={Users} title={t("consumption.schoolCustomer")} amount={money(segmentTotals.school)} detail={t("consumption.schoolDetail")}/><SegmentCard icon={Users} title={t("consumption.familyCustomer")} amount={money(segmentTotals.family)} detail={t("consumption.familyDetail")}/><SegmentCard icon={ShoppingBag} title={t("consumption.newCustomer")} amount={money(Math.max(0,data.total-segmentTotals.school-segmentTotals.family))} detail={t("consumption.newDetail")}/></section>
    <section className="surface top-consumers"><div className="surface-heading"><div><p className="eyebrow">{t("consumption.topEyebrow")}</p><h2>{t("consumption.topCustomers")}</h2></div><StatusBadge tone="blue">{t("consumption.byConfirmed")}</StatusBadge></div><div className="top-consumer-head"><span>{t("consumption.customer")}</span><span>{t("consumption.customerType")}</span><span>{t("consumption.purchasedProducts")}</span><span>{t("consumption.spend")}</span><span>{t("consumption.change")}</span></div>{customers.map(customer=><div className="top-consumer-row" key={customer.nameEn}><b>{locale==="zh-CN"?customer.nameZh:customer.nameEn}</b><span>{t(customer.customerType==="school"?"consumption.schoolCustomer":customer.customerType==="family"?"consumption.familyCustomer":"common.other")}</span><span>{(locale==="zh-CN"?customer.productsZh:customer.productsEn).join(" + ")||"—"}</span><strong>{money(customer.amount)}</strong><em>—</em></div>)}{!customers.length&&<div className="empty-state"><span>{t("consumption.noData")}</span></div>}</section>
  </div>;
}
function ConsumptionKpi({icon:Icon,tone,value,label,detail}:{icon:React.ElementType;tone:string;value:string;label:string;detail:string}){return <article className="surface consumption-kpi"><span className={tone}><Icon size={21}/></span><div><b>{value}</b><span>{label}</span><small>{detail}</small></div></article>}
function SegmentCard({icon:Icon,title,amount,detail}:{icon:React.ElementType;title:string;amount:string;detail:string}){return <article className="surface segment-card"><span><Icon size={20}/></span><div><small>{title}</small><b>{amount}</b><p>{detail}</p></div></article>}
