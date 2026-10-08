"use client";
import {useId} from "react";
import type {SuccessAnalytics} from "@/lib/student-success-analytics-repository";
import {useI18n} from "./i18n-provider";
import {SectionHeader} from "./responsive-detail-layout";
import {UiIcon} from "./ui-icon";

/** Count-only visualization of the authorized server snapshot; no invented comparisons. */
export function SupportAnalyticsCharts({data}:{data:SuccessAnalytics}){
 const {t,locale,enumLabel}=useI18n(),id=useId(),en=locale==='en';
 const series=['checkins','risksObserved','outcomes'] as const;
 const max=Math.ceil(Math.max(4,...data.trends.flatMap(r=>series.map(k=>r.counts[k]??0)))/4)*4;
 const health=Object.entries(data.snapshot.distributions.health??{}),total=health.reduce((n,[,v])=>n+v,0);
 let start=0;
 return <div className="support-chart-grid">
  <section className="analytics-chart-card" data-tone="teal"><SectionHeader title={t('successAnalytics.trends')} icon={<UiIcon name="metric"/>} help={`${data.period.from} — ${data.period.to} · ${data.period.timezone}`}/>
   <div className="chart-legend">{series.map((k,i)=><span key={k}><i className={`chart-series-${i}`}/>{t(`successAnalytics.trend.${k}`)}</span>)}</div>
   {!data.trends.length?<p className="analytics-empty">{t('common.noData')}</p>:<svg className="support-line-chart" viewBox="0 0 640 240" role="img" aria-labelledby={`${id}-trend`}><title id={`${id}-trend`}>{t('successAnalytics.trends')}</title>
    {[0,1,2,3,4].map(n=><g key={n}><line x1="42" x2="612" y1={194-n*40} y2={194-n*40}/><text x="34" y={198-n*40} textAnchor="end">{Math.ceil(max*n/4)}</text></g>)}
    {series.map((key,index)=><g className={`chart-series-${index}`} key={key}><polyline fill="none" strokeWidth="2.5" points={data.trends.map((r,i)=>`${42+i*570/Math.max(1,data.trends.length-1)},${194-(r.counts[key]??0)/max*160}`).join(' ')}/>{data.trends.map((r,i)=><circle key={r.month} cx={42+i*570/Math.max(1,data.trends.length-1)} cy={194-(r.counts[key]??0)/max*160} r="3"><title>{r.month} · {t(`successAnalytics.trend.${key}`)}: {r.counts[key]??0}</title></circle>)}</g>)}
    {data.trends.filter((_,i)=>i===0||i===data.trends.length-1||i===Math.floor(data.trends.length/2)).map(r=><text key={r.month} x={42+data.trends.indexOf(r)*570/Math.max(1,data.trends.length-1)} y="224" textAnchor={r===data.trends[0]?'start':r===data.trends.at(-1)?'end':'middle'}>{r.month}</text>)}
   </svg>}
   <details><summary>{en?'View chart values':'查看图表数值'}</summary><div className="analytics-table-scroll"><table><thead><tr><th>{en?'Month':'月份'}</th>{series.map(k=><th key={k}>{t(`successAnalytics.trend.${k}`)}</th>)}</tr></thead><tbody>{data.trends.map(r=><tr key={r.month}><th>{r.month}</th>{series.map(k=><td key={k}>{r.counts[k]??0}</td>)}</tr>)}</tbody></table></div></details>
  </section>
  <section className="analytics-chart-card" data-tone="blue"><SectionHeader title={t('successAnalytics.distribution.health')} icon={<UiIcon name="support"/>} help={t('ux.metric.snapshot')+' · '+data.snapshot.asOf}/><div className="support-health-chart">
   <svg viewBox="0 0 180 180" role="img" aria-labelledby={`${id}-health`}><title id={`${id}-health`}>{t('successAnalytics.distribution.health')}: {total}</title><circle cx="90" cy="90" r="66" fill="none" stroke="var(--line)" strokeWidth="22"/>{health.map(([key,value])=>{const length=total?value/total*100:0,offset=start;start+=length;return <circle key={key} className={`health-series-${key.toLowerCase()}`} cx="90" cy="90" r="66" pathLength="100" fill="none" strokeWidth="22" strokeDasharray={`${length} ${100-length}`} strokeDashoffset={-offset} transform="rotate(-90 90 90)"><title>{enumLabel(`success.health.${key}`).label}: {value}</title></circle>;})}<text x="90" y="94" textAnchor="middle" className="chart-total">{total}</text><text x="90" y="116" textAnchor="middle">{en?'Cases':'个案'}</text></svg>
   <dl>{health.map(([key,value])=><div key={key}><dt>{enumLabel(`success.health.${key}`).label}</dt><dd>{value}</dd></div>)}{!total&&<p>{t('common.noData')}</p>}</dl>
  </div></section>
 </div>;
}
