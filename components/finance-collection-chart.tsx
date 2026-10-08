"use client";
import {useId} from "react";
import {useI18n} from "./i18n-provider";
import {SectionHeader} from "./responsive-detail-layout";
import {UiIcon} from "./ui-icon";

type CollectionPoint={currency:string;month:string;scheduled:string;settled:string};
/** Amounts are server aggregates. Number conversion below is only for SVG coordinates. */
export function FinanceCollectionChart({series}:{series:CollectionPoint[]}){
 const {locale}=useI18n(),en=locale==='en',id=useId();
 const currencies=[...new Set(series.map(row=>row.currency))];
 return <section className="surface finance-section finance-collection-chart"><SectionHeader title={en?'Collection by due month':'按应收月份查看收款'} icon={<UiIcon name="metric"/>} help={en?'Last six months · scheduled receivables and their current settled amounts. Each currency is separate; these are not recognized revenue.':'近六个月 · 各月应收计划及其当前已结算金额。币种分别展示，这些金额不是已确认收入。'}/>
  {!series.length?<p className="analytics-empty">{en?'No receivable schedules in this period.':'此期间暂无应收计划。'}</p>:currencies.map(currency=>{const rows=series.filter(row=>row.currency===currency),max=Math.max(1,...rows.flatMap(row=>[Number(row.scheduled),Number(row.settled)]));return <div className="finance-currency-chart" key={currency}><h3>{currency}</h3><div className="chart-legend"><span><i className="collection-scheduled"/>{en?'Scheduled':'应收计划'}</span><span><i className="collection-settled"/>{en?'Settled':'已结算'}</span></div><svg viewBox="0 0 520 210" role="img" aria-labelledby={`${id}-${currency}`}><title id={`${id}-${currency}`}>{currency} · {en?'Scheduled and settled by due month':'按应收月份分组的应收与已结算金额'}</title>{[0,1,2,3,4].map(n=><line key={n} x1="18" x2="508" y1={170-n*37} y2={170-n*37} className="chart-grid-line"/>)}{rows.map((row,index)=>{const x=24+index*480/rows.length,w=Math.min(22,190/rows.length);return <g key={row.month}><rect className="collection-scheduled" x={x} y={170-Number(row.scheduled)/max*148} width={w} height={Number(row.scheduled)/max*148}><title>{row.month} · {en?'Scheduled':'应收'} {currency} {row.scheduled}</title></rect><rect className="collection-settled" x={x+w+4} y={170-Number(row.settled)/max*148} width={w} height={Number(row.settled)/max*148}><title>{row.month} · {en?'Settled':'已结算'} {currency} {row.settled}</title></rect><text x={x+w} y="195" textAnchor="middle">{row.month.slice(5)}</text></g>;})}</svg><details><summary>{en?'View exact amounts':'查看精确金额'}</summary><table><thead><tr><th>{en?'Due month':'应收月份'}</th><th>{en?'Scheduled':'应收计划'}</th><th>{en?'Settled':'已结算'}</th></tr></thead><tbody>{rows.map(row=><tr key={row.month}><th>{row.month}</th><td>{currency} {row.scheduled}</td><td>{currency} {row.settled}</td></tr>)}</tbody></table></details></div>;})}
 </section>;
}
