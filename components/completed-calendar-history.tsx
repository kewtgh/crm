"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {calendarRelationKind} from "@/lib/calendar-workspace";
import type {CompletedPeriod} from "@/lib/calendar-history";
import type {CalendarRecord} from "@/lib/calendar-repository";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {InlineMessage,Pagination} from "./ui";
type History={items:CalendarRecord[];total:number;page:number;pageSize:number};
export function CompletedCalendarHistory({period,revision,disabled,onSelect}:{period:CompletedPeriod;revision:number;disabled:boolean;onSelect:(date:string)=>void}){
 const {t,locale}=useI18n(),{formatDate}=useUserPreferences(),[page,setPage]=useState(1),[data,setData]=useState<History|null>(null),[failed,setFailed]=useState(false),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),sequence=useRef(0);
 const refresh=useCallback((signal:AbortSignal)=>{const current=++sequence.current;setLoading(true);setFailed(false);setData(null);
  void apiFetch<History>(`/api/calendar?view=completed&period=${period}&page=${page}&pageSize=20`,{signal}).then(value=>{if(signal.aborted||current!==sequence.current)return;if(!Array.isArray(value.items)||!Number.isSafeInteger(value.total)||value.total<0)throw Error('INVALID_CALENDAR_HISTORY');const last=Math.max(1,Math.ceil(value.total/20));if(page>last){setPage(last);return;}setData(value);}).catch(()=>{if(!signal.aborted&&current===sequence.current)setFailed(true);}).finally(()=>{if(!signal.aborted&&current===sequence.current)setLoading(false);});
 },[page,period]);
 useEffect(()=>{const controller=new AbortController(),timer=setTimeout(()=>refresh(controller.signal),0);return()=>{clearTimeout(timer);controller.abort();};},[refresh,revision,retry]);
 return <section className="surface completed-calendar-history" aria-busy={loading}><h2>{t('calendarHistory.title')}</h2><p className="field-help">{t('calendarHistory.retained')}</p>
  {loading&&<p role="status">{t('common.loading')}</p>}{failed&&<InlineMessage type="error">{t('calendarHistory.failed')} <button type="button" className="secondary-button" onClick={()=>setRetry(value=>value+1)}>{t('common.retry')}</button></InlineMessage>}
  {data?.items.map(item=><article className="completed-calendar-row" key={item.id}><div><b>{locale==='en'?item.titleEn||item.title:item.title}</b><span className={'calendar-relation relation-'+calendarRelationKind(item)}>{t('calendarHistory.relation.'+calendarRelationKind(item))}</span><p>{item.date} · {item.time}{item.related?' · '+item.related:''}</p><small>{t('calendarHistory.completedAt',{date:item.completedAt?formatDate(item.completedAt,{includeTime:true}):'—'})}</small></div><button type="button" className="secondary-button" disabled={disabled} onClick={()=>onSelect(item.date)}>{t('calendarHistory.locate')}</button></article>)}
  {data&&!data.total&&<p className="empty-state">{t('calendarHistory.empty')}</p>}{data&&<Pagination page={page} totalPages={Math.max(1,Math.ceil(data.total/20))} total={data.total} pageSize={20} onPage={setPage}/>}
 </section>;
}
