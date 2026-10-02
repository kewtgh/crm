"use client";
import { useEffect,useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { useI18n } from "./i18n-provider";
import { InlineMessage } from "./ui";
import { RecipientFilters } from "./recipient-filters";
export type PortalRecipient={household_id:string;household_zh:string;household_en:string;contact_id:string;name_zh:string;name_en:string;email:string;city:string;tags:string[];contact_type:string};
type Results={items:PortalRecipient[];total:number;regions:string[];tags:string[];types:string[]};
export function PortalRecipientPicker({value,onChange}:{value:PortalRecipient|null;onChange:(value:PortalRecipient|null)=>void}){
  const {t,locale}=useI18n();
  const [q,setQ]=useState(""),[region,setRegion]=useState(""),[tag,setTag]=useState(""),[type,setType]=useState(""),[page,setPage]=useState(1),[attempt,setAttempt]=useState(0);
  const [result,setResult]=useState<Results>({items:[],total:0,regions:[],tags:[],types:[]}),[loading,setLoading]=useState(true),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>{const params=new URLSearchParams({q,region,tag,type,page:String(page)});void apiFetch<Results>(`/api/portal/recipients?${params}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted){setResult(data);setError("");}}).catch(caught=>{if(!controller.signal.aborted)setError(presentApiError(caught,t,"portal.failed").message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},q?120:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[q,region,tag,type,page,attempt,t]);
  const changeFilter=(next:string,current:string,setValue:(value:string)=>void)=>{if(next===current&&page===1)return;setLoading(true);setError("");onChange(null);setValue(next);setPage(1);};
  const key=(item:PortalRecipient)=>`${item.household_id}:${item.contact_id}`;
  const label=(item:PortalRecipient)=>`${locale==="en"?item.household_en||item.household_zh:item.household_zh||item.household_en} · ${locale==="en"?item.name_en||item.name_zh:item.name_zh||item.name_en} · ${item.email}`;
  const choices=value&&!result.items.some(item=>key(item)===key(value))?[value,...result.items]:result.items;
  return <section className="page-stack portal-recipient-picker">
    <p>{t("portalTemplates.recipientHelp")}</p>
    <label className="field"><span>{t("common.search")}</span><input value={q} onChange={event=>changeFilter(event.target.value,q,setQ)} placeholder={t("portalTemplates.search")}/></label>
    <RecipientFilters regions={result.regions} tags={result.tags} types={result.types} region={region} tag={tag} type={type} onRegion={next=>changeFilter(next,region,setRegion)} onTag={next=>changeFilter(next,tag,setTag)} onType={next=>changeFilter(next,type,setType)}/>
    <label className="field"><span>{t("portalTemplates.recipient")}</span><select required disabled={loading||!!error} value={value?key(value):""} onChange={event=>onChange(choices.find(item=>key(item)===event.target.value)??null)}><option value="">{t("portalTemplates.chooseRecipient")}</option>{choices.map(item=><option key={key(item)} value={key(item)}>{label(item)}</option>)}</select></label>
    <div className="email-filter-actions"><span role="status">{loading?t("common.loading"):t("ux.matching",{count:result.total})}</span><button type="button" className="secondary-button" disabled={loading||page<=1} onClick={()=>{setLoading(true);setPage(value=>value-1);}}>{t("common.previousPage")}</button><span>{page} / {Math.max(1,Math.ceil(result.total/20))}</span><button type="button" className="secondary-button" disabled={loading||page*20>=result.total} onClick={()=>{setLoading(true);setPage(value=>value+1);}}>{t("common.nextPage")}</button></div>
    {error&&<><InlineMessage type="error">{error}</InlineMessage><button className="secondary-button" type="button" onClick={()=>{setLoading(true);setAttempt(value=>value+1);}}>{t("common.retry")}</button></>}
  </section>;
}
