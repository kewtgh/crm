"use client";
import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { CUSTOMER_EMAIL_TEMPLATES,type CustomerEmailTemplate,type SavedEmailTemplate,type CustomEmailContent } from "@/lib/customer-email-templates";
import { customerEmailBatchPayload,type EmailBatchPreview,type EmailBatchResult } from "@/lib/customer-email-batch";
import { useI18n } from "./i18n-provider";
import { InlineMessage,SearchableSelect } from "./ui";
import { EmailRecipientPicker } from "./email-recipient-picker";
import { EmailTemplateEditor } from "./email-template-editor";
export function CustomerEmailPanel(){
  const {t,locale}=useI18n(),params=useSearchParams();const initial=params.get("contact");
  const [ids,setIds]=useState<string[]>(initial&&/^[a-f0-9-]{36}$/i.test(initial)?[initial]:[]),[template,setTemplate]=useState<CustomerEmailTemplate>("FOLLOW_UP");
  const [options,setOptions]=useState<Array<{value:string;label:string}>>([]),[labels,setLabels]=useState<Record<string,string>>({}),[preview,setPreview]=useState<EmailBatchPreview|null>(null),[error,setError]=useState(""),[pending,setPending]=useState(false),[result,setResult]=useState<EmailBatchResult|null>(null);
  const token=useRef<string|null>(null),search=useRef<AbortController|null>(null);
  const busy=useRef(false);
  const [sendingLocale,setSendingLocale]=useState<"zh-CN"|"en">(locale);
  const [savedTemplates,setSavedTemplates]=useState<SavedEmailTemplate[]>([]),[selectedTemplate,setSelectedTemplate]=useState(""),[editor,setEditor]=useState(false),[templateError,setTemplateError]=useState(""),[templateAttempt,setTemplateAttempt]=useState(0);
  const savedTemplate=savedTemplates.find(item=>item.id===selectedTemplate);
  const customTemplate:CustomEmailContent|undefined=savedTemplate?{subjectZh:savedTemplate.subjectZh,subjectEn:savedTemplate.subjectEn,bodyZh:savedTemplate.bodyZh,bodyEn:savedTemplate.bodyEn,purpose:savedTemplate.purpose}:undefined;
  useEffect(()=>{const controller=new AbortController();void apiFetch<{items:SavedEmailTemplate[]}>("/api/customer-email/templates",{signal:controller.signal}).then(data=>{if(!controller.signal.aborted){setSavedTemplates(data.items);setTemplateError("");}}).catch(caught=>{if(!controller.signal.aborted)setTemplateError(presentApiError(caught,t,"ux.templateLoadFailed").message);});return()=>controller.abort();},[templateAttempt,t]);
  useEffect(()=>()=>search.current?.abort(),[]);
  const searchContacts=async(query:string)=>{search.current?.abort();const controller=new AbortController();search.current=controller;try{const data=await apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string}>}>(`/api/search/related?types=CONTACT&q=${encodeURIComponent(query)}`,{signal:controller.signal});const items=data.items.map(item=>({value:item.value.split(":")[1],label:locale==="en"?item.labelEn:item.labelZh}));setOptions(items);setLabels(old=>({...old,...Object.fromEntries(items.map(item=>[item.value,item.label]))}));}catch(caught){if(!controller.signal.aborted)setError(presentApiError(caught,t,"modules.relatedSearchFailed").message);}};
  const change=()=>{if(busy.current)return;setPreview(null);setResult(null);token.current=null;};
  const failureLabel=(code?:string)=>{const key=`customerOps.delivery.${code}`,value=t(key);return value===key?`${t("customerOps.delivery.COMMUNICATION_QUEUE_FAILED")} (${code??"UNKNOWN"})`:value;};
  const run=async(operation:"preview"|"queue")=>{
    if(busy.current||!ids.length||operation==="queue"&&!preview)return;
    busy.current=true;token.current??=crypto.randomUUID();setPending(true);setError("");
    try{const payload=customerEmailBatchPayload(operation,ids,template,sendingLocale,token.current,preview,customTemplate);const response=await apiFetch<EmailBatchPreview|EmailBatchResult>("/api/customer-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});if(operation==="preview")setPreview({...response as EmailBatchPreview,locale:sendingLocale,template,customTemplate});else setResult(response as EmailBatchResult);}
    catch(caught){setError(presentApiError(caught,t,"communications.failed").message);}finally{busy.current=false;setPending(false);}
  };
  return <section className="surface page-stack customer-email-panel"><h1>{t("customerOps.templates")}</h1><InlineMessage type="info">{t("customerOps.bulkHelp")}</InlineMessage>
    <div className="detail-metrics" aria-live="polite"><span><b>{ids.length} / 50</b><small>{t("audit.recipients")}</small></span><span><b>{preview?.items.filter(item=>item.blocked).length??"—"}</b><small>{t("audit.blocked")}</small></span><span><b>{result?.queued??0}</b><small>{t("audit.queued")}</small></span></div>
    {preview&&preview.locale!==locale&&<InlineMessage type="info">{t("audit.previewLanguage",{language:preview.locale==="en"?"English":"中文"})}</InlineMessage>}
    {templateError&&<><InlineMessage type="error">{templateError}</InlineMessage><button type="button" className="secondary-button" onClick={()=>setTemplateAttempt(value=>value+1)}>{t("common.retry")}</button></>}
    <fieldset disabled={pending||!!result?.queued}><label className="field"><span>{t("customerOps.template")} <span className="required-indicator">*</span></span><select required value={template==="CUSTOM"?`saved:${selectedTemplate}`:template} onChange={event=>{change();const value=event.target.value;if(value.startsWith("saved:")){setTemplate("CUSTOM");setSelectedTemplate(value.slice(6));}else{setTemplate(value as CustomerEmailTemplate);setSelectedTemplate("");}}}><optgroup label={t("ux.systemTemplates")}>{CUSTOMER_EMAIL_TEMPLATES.map(value=><option key={value} value={value}>{t(`customerOps.template.${value}`)}</option>)}</optgroup><optgroup label={t("ux.savedTemplates")}>{savedTemplates.map(item=><option key={item.id} value={`saved:${item.id}`}>{item.name}</option>)}</optgroup></select></label>
    <div className="email-filter-actions"><button type="button" className="secondary-button" onClick={()=>setEditor(true)}>{t(savedTemplate?"ux.editTemplate":"ux.createTemplate")}</button><span>{t("ux.presetHelp")}</span></div>
    <label className="field"><span>{t("ux.sendLanguage")} <span className="required-indicator">*</span></span><select required value={sendingLocale} onChange={event=>{change();setSendingLocale(event.target.value as "zh-CN"|"en");}}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
    <SearchableSelect label={t("customerOps.recipients")} required options={options.filter(item=>!ids.includes(item.value))} onSearch={searchContacts} onChange={value=>{if(!value||ids.length>=50)return;change();setIds(values=>[...values,value]);}}/>
    <div className="tag-values">{ids.map(id=><span key={id}>{preview?.items.find(item=>item.id===id)?.name||labels[id]||id}<button type="button" aria-label={t("input.removeTag")} onClick={()=>{change();setIds(values=>values.filter(value=>value!==id));}}>×</button></span>)}</div></fieldset>
    <EmailRecipientPicker ids={ids} disabled={pending||!!result?.queued} onChange={(next,names)=>{if(busy.current)return;change();setIds(next);setLabels(old=>({...old,...names}));}}/>
    {editor&&<EmailTemplateEditor template={template} source={savedTemplate} onClose={()=>setEditor(false)} onSaved={item=>{change();setSavedTemplates(old=>[...old.filter(value=>value.id!==item.id),item]);setSelectedTemplate(item.id);setTemplate("CUSTOM");}}/>}
    {error&&<InlineMessage type="error">{error}</InlineMessage>}
    <button className="secondary-button" disabled={!ids.length||pending||!!result?.queued} onClick={()=>void run("preview")}>{t("customerOps.preview")}</button>
    {preview&&<div className="page-stack">{preview.items.map(item=><details key={item.id}><summary>{item.name} · {item.email||"—"}{item.blocked?` · ${item.blockedReason?failureLabel(item.blockedReason):t("customerOps.blocked")}`:""}</summary><h3>{item.subject}</h3><pre className="email-preview">{item.body}</pre></details>)}<InlineMessage type="warning">{t("customerOps.sendConfirm")}</InlineMessage><button className="primary-button" disabled={pending||preview.items.every(item=>item.blocked)||!!result?.queued} onClick={()=>void run("queue")}>{t("customerOps.queue",{count:preview.items.filter(item=>!item.blocked).length})}</button></div>}
    {result&&<><InlineMessage type={result.failed?"warning":"success"}>{t("customerOps.queuedResult",{queued:result.queued,failed:result.failed})}</InlineMessage>{result.results.map(item=><p key={item.id}>{preview?.items.find(row=>row.id===item.id)?.name} · {item.queued?<Link href={`/messages?thread=${item.threadId}`}>{t("customerOps.queued")}</Link>:failureLabel(item.code)}</p>)}{result.failed>0&&<button className="secondary-button" disabled={pending} onClick={()=>void run("queue")}>{t("customerOps.retryBatch")}</button>}<button className="secondary-button" disabled={pending} onClick={()=>{if(busy.current)return;change();setIds([]);}}>{t("customerOps.newBatch")}</button></>}
    <p>{t("customerOps.providerHelp")}</p>
  </section>;
}
