"use client";
import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { CUSTOMER_EMAIL_TEMPLATES,type CustomerEmailTemplate } from "@/lib/customer-email-templates";
import type { EmailPreview } from "@/lib/customer-email-repository";
import { useI18n } from "./i18n-provider";
import { InlineMessage,SearchableSelect } from "./ui";
export function CustomerEmailPanel(){
  const {t,locale}=useI18n(),params=useSearchParams();const initial=params.get("contact");
  const [ids,setIds]=useState<string[]>(initial&&/^[a-f0-9-]{36}$/i.test(initial)?[initial]:[]),[template,setTemplate]=useState<CustomerEmailTemplate>("FOLLOW_UP");
  const [options,setOptions]=useState<Array<{value:string;label:string}>>([]),[labels,setLabels]=useState<Record<string,string>>({}),[preview,setPreview]=useState<{items:EmailPreview[];hash:string}|null>(null),[error,setError]=useState(""),[pending,setPending]=useState(false),[result,setResult]=useState<{queued:number;failed:number;results:Array<{id:string;queued:boolean;code?:string;threadId?:string}>}|null>(null);
  const token=useRef<string|null>(null),search=useRef<AbortController|null>(null);
  useEffect(()=>()=>search.current?.abort(),[]);
  const searchContacts=async(query:string)=>{search.current?.abort();const controller=new AbortController();search.current=controller;try{const data=await apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string}>}>(`/api/search/related?types=CONTACT&q=${encodeURIComponent(query)}`,{signal:controller.signal});const items=data.items.map(item=>({value:item.value.split(":")[1],label:locale==="en"?item.labelEn:item.labelZh}));setOptions(items);setLabels(old=>({...old,...Object.fromEntries(items.map(item=>[item.value,item.label]))}));}catch(caught){if(!controller.signal.aborted)setError(presentApiError(caught,t,"modules.relatedSearchFailed").message);}};
  const change=()=>{setPreview(null);setResult(null);token.current=null;};
  const failureLabel=(code?:string)=>{const key=`customerOps.delivery.${code}`,value=t(key);return value===key?`${t("customerOps.delivery.COMMUNICATION_QUEUE_FAILED")} (${code??"UNKNOWN"})`:value;};
  const run=async(operation:"preview"|"queue")=>{
    token.current??=crypto.randomUUID();setPending(true);setError("");
    try{const response=await apiFetch<typeof preview & typeof result>("/api/customer-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation,contactIds:ids,template,locale,requestKey:token.current,previewHash:preview?.hash})});if(operation==="preview")setPreview(response);else setResult(response);}
    catch(caught){setError(presentApiError(caught,t,"communications.failed").message);}finally{setPending(false);}
  };
  return <section className="surface page-stack"><h1>{t("customerOps.templates")}</h1><InlineMessage type="info">{t("customerOps.bulkHelp")}</InlineMessage>
    <fieldset disabled={pending||!!result?.queued}><label className="field"><span>{t("customerOps.template")} *</span><select value={template} onChange={event=>{change();setTemplate(event.target.value as CustomerEmailTemplate);}}>{CUSTOMER_EMAIL_TEMPLATES.map(value=><option key={value} value={value}>{t(`customerOps.template.${value}`)}</option>)}</select></label>
    <SearchableSelect label={t("customerOps.recipients")} required options={options.filter(item=>!ids.includes(item.value))} onSearch={searchContacts} onChange={value=>{if(!value||ids.length>=50)return;change();setIds(values=>[...values,value]);}}/>
    <div className="tag-values">{ids.map(id=><span key={id}>{preview?.items.find(item=>item.id===id)?.name||labels[id]||id}<button type="button" aria-label={t("input.removeTag")} onClick={()=>{change();setIds(values=>values.filter(value=>value!==id));}}>×</button></span>)}</div></fieldset>
    {error&&<InlineMessage type="error">{error}</InlineMessage>}
    <button className="secondary-button" disabled={!ids.length||pending||!!result?.queued} onClick={()=>void run("preview")}>{t("customerOps.preview")}</button>
    {preview&&<div className="page-stack">{preview.items.map(item=><details key={item.id}><summary>{item.name} · {item.email||"—"}{item.blocked?` · ${t("customerOps.blocked")}`:""}</summary><h3>{item.subject}</h3><pre className="email-preview">{item.body}</pre></details>)}<InlineMessage type="warning">{t("customerOps.sendConfirm")}</InlineMessage><button className="primary-button" disabled={pending||preview.items.every(item=>item.blocked)||!!result?.queued} onClick={()=>void run("queue")}>{t("customerOps.queue",{count:preview.items.filter(item=>!item.blocked).length})}</button></div>}
    {result&&<><InlineMessage type={result.failed?"warning":"success"}>{t("customerOps.queuedResult",{queued:result.queued,failed:result.failed})}</InlineMessage>{result.results.map(item=><p key={item.id}>{preview?.items.find(row=>row.id===item.id)?.name} · {item.queued?<Link href={`/messages?thread=${item.threadId}`}>{t("customerOps.queued")}</Link>:failureLabel(item.code)}</p>)}{result.failed>0&&<button className="secondary-button" disabled={pending} onClick={()=>void run("queue")}>{t("customerOps.retryBatch")}</button>}<button className="secondary-button" onClick={()=>{change();setIds([]);}}>{t("customerOps.newBatch")}</button></>}
    <p>{t("customerOps.providerHelp")}</p>
  </section>;
}
