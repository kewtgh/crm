"use client";
import { useEffect,useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { useI18n } from "./i18n-provider";
import { InlineMessage } from "./ui";
import { RecipientFilters } from "./recipient-filters";
type Recipient={id:string;name_zh:string;name_en:string;email:string|null;city:string;contact_type:string;tags:string[];blocked:boolean};
type Results={items:Recipient[];total:number;regions:string[];tags:string[];types:string[]};
export function EmailRecipientPicker({ids,disabled,onChange}:{ids:string[];disabled:boolean;onChange:(ids:string[],labels:Record<string,string>)=>void}){
  const {t,locale}=useI18n();
  const [q,setQ]=useState(""),[region,setRegion]=useState(""),[tag,setTag]=useState(""),[type,setType]=useState(""),[page,setPage]=useState(1);
  const [result,setResult]=useState<Results>({items:[],total:0,regions:[],tags:[],types:[]}),[error,setError]=useState(""),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{setLoading(true);setError("");const params=new URLSearchParams({q,region,tag,type,page:String(page)});void apiFetch<Results>(`/api/customer-email/recipients?${params}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setResult(data);}).catch(caught=>{if(!controller.signal.aborted)setError(presentApiError(caught,t,"communications.failed").message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},q?120:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[q,region,tag,type,page,attempt,t]);
  const name=(item:Recipient)=>locale==="en"?item.name_en||item.name_zh:item.name_zh||item.name_en;
  const update=(next:string[])=>onChange(next,Object.fromEntries(result.items.map(item=>[item.id,name(item)])));
  const valid=!loading&&!error;
  const changeFilter=(value:string,current:string,setValue:(value:string)=>void)=>{
    if(value===current&&page===1)return;
    setLoading(true);setValue(value);setPage(1);
  };
  return <section className="page-stack" aria-label={t("ux.recipientFilters")}>
    <h3>{t("ux.recipientFilters")}</h3><p>{t("ux.regionHelp")}</p>
    <fieldset disabled={disabled}>
      <label className="field"><span>{t("common.search")}</span><input value={q} onChange={event=>{setLoading(true);setQ(event.target.value);setPage(1);}}/></label>
      <RecipientFilters regions={result.regions} tags={result.tags} types={result.types} region={region} tag={tag} type={type} onRegion={value=>changeFilter(value,region,setRegion)} onTag={value=>changeFilter(value,tag,setTag)} onType={value=>changeFilter(value,type,setType)}/>
      <div className="email-filter-actions"><span role="status">{t("ux.matching",{count:result.total})}</span><button type="button" className="secondary-button" disabled={!valid||ids.length>=50||!result.items.some(item=>!item.blocked&&!ids.includes(item.id))} onClick={()=>update([...new Set([...ids,...result.items.filter(item=>!item.blocked).map(item=>item.id)])].slice(0,50))}>{t("ux.selectPage")}</button><button type="button" className="secondary-button" disabled={!valid} onClick={()=>update(ids.filter(id=>!result.items.some(item=>item.id===id)))}>{t("ux.clearPage")}</button></div>
      {loading&&<p role="status">{t("common.loading")}</p>}
      {error&&<><InlineMessage type="error">{error}</InlineMessage><button type="button" className="secondary-button" onClick={()=>setAttempt(value=>value+1)}>{t("common.retry")}</button></>}
      <div className="email-recipient-list">{valid&&result.items.map(item=><label key={item.id}><input type="checkbox" checked={ids.includes(item.id)} disabled={item.blocked||!ids.includes(item.id)&&ids.length>=50} onChange={event=>update(event.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/><span><b>{name(item)}</b><small>{item.email||"—"} · {item.city||"—"} · {t(`contact.type.${item.contact_type.toLowerCase()}`)}</small>{item.blocked&&<small>{t("customerOps.blocked")}</small>}</span></label>)}{valid&&!result.items.length&&<p>{t("common.noOptions")}</p>}</div>
      <div className="email-filter-actions"><button type="button" className="secondary-button" disabled={loading||page<=1} onClick={()=>{setLoading(true);setPage(value=>value-1);}}>{t("common.previousPage")}</button><span>{page} / {Math.max(1,Math.ceil(result.total/20))}</span><button type="button" className="secondary-button" disabled={loading||page*20>=result.total} onClick={()=>{setLoading(true);setPage(value=>value+1);}}>{t("common.nextPage")}</button></div>
    </fieldset>
  </section>;
}
