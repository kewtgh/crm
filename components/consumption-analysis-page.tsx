"use client";

import { useState } from "react";
import { ChartNoAxesCombined, CircleDollarSign, ReceiptText, RefreshCcw, ShoppingBag, TrendingUp, Users } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { ProgressBar, StatusBadge } from "@/components/ui";

type Period = "month" | "quarter" | "year";
const periodData = {
  month: { labelKey: "consumption.label.month", total: 1_280_000, orders: 46, average: 27_826, renewal: 72, compare: 12.4, trend: [["consumption.week1",220_000],["consumption.week2",310_000],["consumption.week3",390_000],["consumption.week4",360_000]] as [string,number][] },
  quarter: { labelKey: "consumption.label.quarter", total: 3_420_000, orders: 124, average: 27_581, renewal: 68, compare: 8.6, trend: [["consumption.july",1_280_000],["consumption.august",1_160_000],["consumption.september",980_000]] as [string,number][] },
  year: { labelKey: "consumption.label.year", total: 10_800_000, orders: 352, average: 30_682, renewal: 74, compare: 18.2, trend: [["consumption.q1",3_420_000],["consumption.q2",3_960_000],["consumption.q3",3_420_000],["consumption.q4",0]] as [string,number][] },
};
const productMix = [
  ["products.default.admissions",4_620_000,68,"green"], ["products.default.foundation",2_160_000,18,"purple"], ["products.default.competition",1_620_000,42,"blue"], ["products.default.summerCamp",1_280_000,36,"amber"], ["products.default.summerSchool",1_120_000,31,"coral"],
] as const;
const topCustomers = [
  { zh:"台北欧洲学校", en:"Taipei European School", type:"consumption.schoolCustomer", products:["products.default.admissions","products.default.summerSchool"], amount:920_000, change:"+18%" },
  { zh:"吴氏家庭", en:"Wu Household", type:"consumption.familyCustomer", products:["products.default.admissions","products.default.competition"], amount:480_000, change:"+32%" },
  { zh:"上海惠灵顿", en:"Wellington College Shanghai", type:"consumption.schoolCustomer", products:["products.default.admissions"], amount:430_000, change:"+8%" },
  { zh:"陈氏家庭", en:"Chen Household", type:"consumption.familyCustomer", products:["products.default.foundation"], amount:360_000, change:"consumption.new" },
  { zh:"新加坡美国学校", en:"Singapore American School", type:"consumption.schoolCustomer", products:["products.default.summerCamp"], amount:310_000, change:"+12%" },
];
const money = (value:number) => value >= 1_000_000 ? `¥ ${(value/1_000_000).toFixed(2)}M` : `¥ ${(value/1_000).toFixed(1)}K`;

export function ConsumptionAnalysisPage() {
  const { locale, t } = useI18n();
  const [period,setPeriod] = useState<Period>("quarter");
  const data = periodData[period];
  const maxTrend = Math.max(...data.trend.map(([,value])=>value));
  const factor = period === "month" ? .12 : period === "quarter" ? .32 : 1;
  const displayedMix = productMix.map(([nameKey,value,customers,color])=>({nameKey,value:Math.round(value*factor),customers,color}));
  const mixTotal = displayedMix.reduce((sum,item)=>sum+item.value,0);
  return <div className="page-stack consumption-page">
    <section className="page-heading-row"><div><p className="eyebrow">{t("consumption.eyebrow")}</p><h1>{t("consumption.title")}</h1><p>{t("consumption.description")}</p></div><div className="period-switch consumption-period" aria-label={t("consumption.period")}>{(["month","quarter","year"] as Period[]).map(item=><button type="button" className={period===item?"active":""} onClick={()=>setPeriod(item)} key={item}>{t(`consumption.${item}`)}</button>)}</div></section>
    <section className="consumption-summary"><ConsumptionKpi icon={CircleDollarSign} tone="green" value={money(data.total)} label={t("consumption.confirmed")} detail={t("consumption.compared",{value:data.compare})}/><ConsumptionKpi icon={ReceiptText} tone="blue" value={String(data.orders)} label={t("consumption.orders")} detail={t(data.labelKey)}/><ConsumptionKpi icon={ShoppingBag} tone="purple" value={money(data.average)} label={t("consumption.average")} detail={t("consumption.orderBasis")}/><ConsumptionKpi icon={RefreshCcw} tone="amber" value={`${data.renewal}%`} label={t("consumption.renewal")} detail={t("consumption.rollingYear")}/></section>
    <section className="consumption-main-grid">
      <article className="surface consumption-trend"><div className="surface-heading"><div><p className="eyebrow">{t("consumption.trendEyebrow")}</p><h2>{t("consumption.trend",{period:t(data.labelKey)})}</h2></div><StatusBadge tone="green"><TrendingUp size={13}/>{t("consumption.growth",{value:data.compare})}</StatusBadge></div><div className="consumption-bars" role="img" aria-label={t("consumption.chart",{period:t(data.labelKey)})}>{data.trend.map(([labelKey,value])=><div key={labelKey}><span style={{height:`${value?Math.max(6,value/maxTrend*100):0}%`}}/><b>{t(labelKey)}</b><small>{value?money(value):t("common.notStarted")}</small></div>)}</div></article>
      <article className="surface product-mix-card"><div className="surface-heading"><div><p className="eyebrow">{t("consumption.productMixEyebrow")}</p><h2>{t("consumption.productMix")}</h2></div><ChartNoAxesCombined size={20}/></div>{displayedMix.map(item=>{const percent=Math.round(item.value/mixTotal*100);return <div className="product-mix-row" key={item.nameKey}><span className={item.color}/><div><b>{t(item.nameKey)}</b><small>{t("consumption.customerLearnerCount",{count:item.customers})}</small></div><ProgressBar value={percent} label={`${percent}%`}/><strong>{money(item.value)}</strong></div>})}</article>
    </section>
    <section className="consumption-segments"><SegmentCard icon={Users} title={t("consumption.schoolCustomer")} amount={money(Math.round(data.total*.58))} detail={t("consumption.schoolDetail")}/><SegmentCard icon={Users} title={t("consumption.familyCustomer")} amount={money(Math.round(data.total*.42))} detail={t("consumption.familyDetail")}/><SegmentCard icon={ShoppingBag} title={t("consumption.newCustomer")} amount={money(Math.round(data.total*.21))} detail={t("consumption.newDetail")}/></section>
    <section className="surface top-consumers"><div className="surface-heading"><div><p className="eyebrow">{t("consumption.topEyebrow")}</p><h2>{t("consumption.topCustomers")}</h2></div><StatusBadge tone="blue">{t("consumption.byConfirmed")}</StatusBadge></div><div className="top-consumer-head"><span>{t("consumption.customer")}</span><span>{t("consumption.customerType")}</span><span>{t("consumption.purchasedProducts")}</span><span>{t("consumption.spend")}</span><span>{t("consumption.change")}</span></div>{topCustomers.map(customer=><div className="top-consumer-row" key={customer.en}><b>{locale==="zh-CN"?customer.zh:customer.en}</b><span>{t(customer.type)}</span><span>{customer.products.map(key=>t(key)).join(" + ")}</span><strong>{money(customer.amount*factor)}</strong><em>{customer.change.startsWith("consumption.")?t(customer.change):customer.change}</em></div>)}</section>
  </div>;
}
function ConsumptionKpi({icon:Icon,tone,value,label,detail}:{icon:React.ElementType;tone:string;value:string;label:string;detail:string}){return <article className="surface consumption-kpi"><span className={tone}><Icon size={21}/></span><div><b>{value}</b><span>{label}</span><small>{detail}</small></div></article>}
function SegmentCard({icon:Icon,title,amount,detail}:{icon:React.ElementType;title:string;amount:string;detail:string}){return <article className="surface segment-card"><span><Icon size={20}/></span><div><small>{title}</small><b>{amount}</b><p>{detail}</p></div></article>}
