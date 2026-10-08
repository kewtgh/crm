"use client";
import {WorkspaceHeading} from "./workspace-heading";

import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { CUSTOMER_EMAIL_TEMPLATES,renderCustomerEmail,type CustomerEmailTemplate,type SavedEmailTemplate,type CustomEmailContent } from "@/lib/customer-email-templates";
import { customerEmailBatchPayload,freezeCustomerEmailBatch,type EmailBatchPreview,type EmailBatchResult } from "@/lib/customer-email-batch";
import { useI18n } from "./i18n-provider";
import { ConfirmDialog,InlineMessage,SearchableSelect,StatusBadge } from "./ui";
import { EmailRecipientPicker } from "./email-recipient-picker";
import { EmailTemplateEditor } from "./email-template-editor";
import { useAppUser } from "./app-user-context";
export function CustomerEmailPanel(){
  const {t,locale}=useI18n(),params=useSearchParams();const initial=params.get("contact");
  const user=useAppUser(),canPublish=["SUPER_ADMIN","ADMIN"].includes(user.role);
  const [ids,setIds]=useState<string[]>(initial&&/^[a-f0-9-]{36}$/i.test(initial)?[initial]:[]),[template,setTemplate]=useState<CustomerEmailTemplate>("FOLLOW_UP");
  const [options,setOptions]=useState<Array<{value:string;label:string}>>([]),[labels,setLabels]=useState<Record<string,string>>({}),[preview,setPreview]=useState<EmailBatchPreview|null>(null),[error,setError]=useState(""),[pending,setPending]=useState(false),[result,setResult]=useState<EmailBatchResult|null>(null);
  const token=useRef<string|null>(null),search=useRef<AbortController|null>(null);
  const busy=useRef(false);
  const queuePayload=useRef<ReturnType<typeof freezeCustomerEmailBatch>|null>(null);
  const [queueAttempt,setQueueAttempt]=useState(false),[queueUnknown,setQueueUnknown]=useState(false);
  const draftLocked=pending||queueAttempt;
  const [sendingLocale,setSendingLocale]=useState<"zh-CN"|"en">(locale);
  const [savedTemplates,setSavedTemplates]=useState<SavedEmailTemplate[]>([]),[selectedTemplate,setSelectedTemplate]=useState(""),[editor,setEditor]=useState(false),[templateError,setTemplateError]=useState(""),[templateAttempt,setTemplateAttempt]=useState(0);
  const [archiveTarget,setArchiveTarget]=useState<SavedEmailTemplate|null>(null),[archiveError,setArchiveError]=useState("");
  const savedTemplate=savedTemplates.find(item=>item.id===selectedTemplate);
  const canManageTemplate=!!savedTemplate&&(savedTemplate.visibility==="PERSONAL"||canPublish);
  const customTemplate:CustomEmailContent|undefined=savedTemplate?{subjectZh:savedTemplate.subjectZh,subjectEn:savedTemplate.subjectEn,bodyZh:savedTemplate.bodyZh,bodyEn:savedTemplate.bodyEn,purpose:savedTemplate.purpose}:undefined;
  const templateSample=template==="CUSTOM"&&!customTemplate?null:renderCustomerEmail(template,sendingLocale,"{{name}}","{{owner}}",customTemplate);
  useEffect(()=>{const controller=new AbortController();void apiFetch<{items:SavedEmailTemplate[]}>("/api/customer-email/templates",{signal:controller.signal}).then(data=>{if(!controller.signal.aborted){setSavedTemplates(data.items);setTemplateError("");}}).catch(caught=>{if(!controller.signal.aborted)setTemplateError(presentApiError(caught,t,"ux.templateLoadFailed").message);});return()=>controller.abort();},[templateAttempt,t]);
  useEffect(()=>()=>search.current?.abort(),[]);
  const searchContacts=async(query:string)=>{search.current?.abort();const controller=new AbortController();search.current=controller;try{const data=await apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string}>}>(`/api/search/related?types=CONTACT&q=${encodeURIComponent(query)}`,{signal:controller.signal});if(controller.signal.aborted)return;const items=data.items.map(item=>({value:item.value.split(":")[1],label:locale==="en"?item.labelEn:item.labelZh}));setOptions(items);setLabels(old=>({...old,...Object.fromEntries(items.map(item=>[item.value,item.label]))}));}catch(caught){if(!controller.signal.aborted)setError(presentApiError(caught,t,"modules.relatedSearchFailed").message);}};
  const change=(newBatch=false)=>{if(busy.current||queuePayload.current&&!newBatch)return false;setPreview(null);setResult(null);setQueueAttempt(false);setQueueUnknown(false);queuePayload.current=null;token.current=null;return true;};
  const failureLabel=(code?:string)=>{const key=`customerOps.delivery.${code}`,value=t(key);return value===key?`${t("customerOps.delivery.COMMUNICATION_QUEUE_FAILED")} (${code??"UNKNOWN"})`:value;};
  const run=async(operation:"preview"|"queue")=>{
    if(busy.current||!ids.length||operation==="queue"&&!preview)return;
    if(operation==="preview"&&queuePayload.current)return;
    busy.current=true;token.current??=crypto.randomUUID();setPending(true);setError("");
    try{
      if(operation==="queue"){queuePayload.current??=freezeCustomerEmailBatch(ids,template,sendingLocale,token.current,preview!,customTemplate);setQueueAttempt(true);setQueueUnknown(false);setResult(null);}
      const payload=operation==="queue"?queuePayload.current!:customerEmailBatchPayload(operation,ids,template,sendingLocale,token.current,preview,customTemplate);
      const response=await apiFetch<EmailBatchPreview|EmailBatchResult>("/api/customer-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      if(operation==="preview")setPreview({...response as EmailBatchPreview,locale:sendingLocale,template,customTemplate});else setResult(response as EmailBatchResult);
    }catch(caught){if(operation==="queue")setQueueUnknown(true);setError(presentApiError(caught,t,"communications.failed").message);}finally{busy.current=false;setPending(false);}
  };
  const archiveTemplate=async()=>{
    if(busy.current||queuePayload.current||!archiveTarget)return;
    busy.current=true;setPending(true);setArchiveError("");
    try{
      await apiFetch("/api/customer-email/templates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"archive",id:archiveTarget.id,expectedRevision:archiveTarget.revision})});
      setSavedTemplates(items=>items.filter(item=>item.id!==archiveTarget.id));setSelectedTemplate("");setTemplate("FOLLOW_UP");setPreview(null);setResult(null);token.current=null;setArchiveTarget(null);
    }catch(caught){setArchiveError(presentApiError(caught,t,"ux.templateArchiveFailed").message);}finally{busy.current=false;setPending(false);}
  };
  return <section className="page-stack customer-email-panel">
    <header className="email-compose-heading"><WorkspaceHeading>{t("customerOps.templates")}</WorkspaceHeading><p>{t("customerOps.bulkHelp")}</p></header>
    <div className="detail-metrics" aria-live="polite"><span><b>{ids.length} / 50</b><small>{t("audit.recipients")}</small></span><span><b>{preview?.items.filter(item=>item.blocked).length??"—"}</b><small>{t("audit.blocked")}</small></span><span><b>{result?.queued??0}</b><small>{t("audit.queued")}</small></span></div>
    {preview&&preview.locale!==locale&&<InlineMessage type="info">{t("audit.previewLanguage",{language:preview.locale==="en"?"English":"中文"})}</InlineMessage>}
    <div className="email-compose-grid">
    <section className="surface email-compose-section email-compose-template" aria-labelledby="email-template-heading">
    <header className="email-section-heading"><span className="email-step" aria-hidden="true">01</span><div><h2 id="email-template-heading">{t("emailCompose.templateTitle")}</h2><p>{t("emailCompose.templateHelp")}</p></div></header>
    {templateError&&<><InlineMessage type="error">{templateError}</InlineMessage><button type="button" className="secondary-button" onClick={()=>setTemplateAttempt(value=>value+1)}>{t("common.retry")}</button></>}
    <fieldset disabled={draftLocked} className="email-compose-fields"><label className="field"><span>{t("customerOps.template")} <span className="required-indicator">*</span></span><select required value={template==="CUSTOM"?`saved:${selectedTemplate}`:template} onChange={event=>{if(!change())return;const value=event.target.value;if(value.startsWith("saved:")){setTemplate("CUSTOM");setSelectedTemplate(value.slice(6));}else{setTemplate(value as CustomerEmailTemplate);setSelectedTemplate("");}}}><optgroup label={t("ux.systemTemplates")}>{CUSTOMER_EMAIL_TEMPLATES.map(value=><option key={value} value={value}>{t(`customerOps.template.${value}`)}</option>)}</optgroup>{(["WORKSPACE","PERSONAL"] as const).map(visibility=><optgroup key={visibility} label={t(visibility==="WORKSPACE"?"ux.publicTemplates":"ux.personalTemplates")}>{savedTemplates.filter(item=>item.visibility===visibility).map(item=><option key={item.id} value={`saved:${item.id}`}>{item.name}</option>)}</optgroup>)}</select></label>
    <label className="field"><span>{t("ux.sendLanguage")} <span className="required-indicator">*</span></span><select required value={sendingLocale} onChange={event=>{if(!change())return;setSendingLocale(event.target.value as "zh-CN"|"en");}}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
    {templateSample&&<div className="email-template-purpose"><StatusBadge tone={templateSample.purpose==="MARKETING"?"amber":"blue"}>{t(templateSample.purpose==="MARKETING"?"ux.marketing":"ux.service")}</StatusBadge></div>}
    <div className="email-filter-actions"><button type="button" className="secondary-button" onClick={()=>setEditor(true)}>{t(savedTemplate?canManageTemplate?"ux.editTemplate":"ux.copyTemplate":"ux.createTemplate")}</button><button type="button" className="text-button" onClick={()=>{if(!change())return;setTemplateAttempt(value=>value+1);}}>{t("ux.reloadTemplates")}</button>{canManageTemplate&&<button type="button" className="text-button danger" onClick={()=>{setArchiveError("");setArchiveTarget(savedTemplate!);}}>{t("ux.archiveTemplate")}</button>}</div>
    </fieldset><p className="email-section-note">{t("ux.templateScopeHelp")}</p>
    {templateSample&&<details className="email-template-sample"><summary>{t("emailCompose.sample")}</summary><p className="email-section-note">{t("emailCompose.sampleHelp")}</p><h3>{templateSample.subject}</h3><pre className="email-preview">{templateSample.body}</pre></details>}
    </section>
    <section className="surface email-compose-section email-compose-recipients" aria-labelledby="email-recipients-heading">
    <header className="email-section-heading"><span className="email-step" aria-hidden="true">02</span><div><h2 id="email-recipients-heading">{t("emailCompose.recipientsTitle")}</h2><p>{t("emailCompose.recipientsHelp")}</p></div></header>
    <fieldset disabled={draftLocked} className="email-compose-fields">
    <SearchableSelect label={t("customerOps.recipients")} required options={options.filter(item=>!ids.includes(item.value))} onSearch={searchContacts} onChange={value=>{if(!value||ids.length>=50||ids.includes(value)||!change())return;setIds(values=>[...values,value]);}}/>
    <div className="email-selected-recipients"><h3>{t("emailCompose.selected",{count:ids.length})}</h3>{!ids.length&&<p className="email-section-note">{t("emailCompose.noneSelected")}</p>}<div className="tag-values">{ids.map(id=><span key={id}>{preview?.items.find(item=>item.id===id)?.name||labels[id]||id}<button type="button" aria-label={t("input.removeTag")} onClick={()=>{if(!change())return;setIds(values=>values.filter(value=>value!==id));}}>×</button></span>)}</div></div></fieldset>
    <EmailRecipientPicker ids={ids} disabled={draftLocked} onChange={(next,names)=>{if(!change())return;setIds(next);setLabels(old=>({...old,...names}));}}/>
    </section>
    </div>
    {editor&&<EmailTemplateEditor template={template} source={savedTemplate} onClose={()=>setEditor(false)} onSaved={item=>{change();setSavedTemplates(old=>[...old.filter(value=>value.id!==item.id),item]);setSelectedTemplate(item.id);setTemplate("CUSTOM");}}/>}
    {archiveTarget&&<ConfirmDialog title={t("ux.archiveTemplate")} description={archiveError||t("ux.archiveTemplateConfirm",{name:archiveTarget.name})} confirmLabel={t("ux.archiveTemplate")} pending={pending} onClose={()=>setArchiveTarget(null)} onConfirm={()=>void archiveTemplate()}/>}
    <section className="surface email-compose-section email-compose-review" aria-labelledby="email-review-heading">
    <header className="email-section-heading"><span className="email-step" aria-hidden="true">03</span><div><h2 id="email-review-heading">{t("emailCompose.reviewTitle")}</h2><p>{t("emailCompose.reviewHelp")}</p></div></header>
    {error&&<InlineMessage type="error">{error}</InlineMessage>}
    {queueUnknown&&<><InlineMessage type="warning">{t("ux.queueUnknown")}</InlineMessage><button className="secondary-button" disabled={pending} onClick={()=>void run("queue")}>{t("customerOps.retryBatch")}</button></>}
    <button className="secondary-button" disabled={!ids.length||draftLocked} onClick={()=>void run("preview")}>{t("customerOps.preview")}</button>
    {preview&&<div className="page-stack email-personalized-previews">{preview.items.map(item=><details key={item.id}><summary>{item.name} · {item.email||"—"}{item.blocked?` · ${item.blockedReason?failureLabel(item.blockedReason):t("customerOps.blocked")}`:""}</summary><h3>{item.subject}</h3><pre className="email-preview">{item.body}</pre></details>)}<InlineMessage type="warning">{t("customerOps.sendConfirm")}</InlineMessage><button className="primary-button" disabled={draftLocked||preview.items.every(item=>item.blocked)} onClick={()=>void run("queue")}>{t("customerOps.queue",{count:preview.items.filter(item=>!item.blocked).length})}</button></div>}
    {result&&<div className="email-batch-results page-stack"><h3>{t("emailCompose.deliveryResults")}</h3><InlineMessage type={result.failed?"warning":"success"}>{t("customerOps.queuedResult",{queued:result.queued,failed:result.failed})}</InlineMessage>{result.results.map(item=><p key={item.id}>{preview?.items.find(row=>row.id===item.id)?.name} · {item.queued?<Link href={`/messages?thread=${item.threadId}`}>{t("customerOps.queued")}</Link>:failureLabel(item.code)}</p>)}<div className="email-filter-actions">{result.failed>0&&<button className="secondary-button" disabled={pending} onClick={()=>void run("queue")}>{t("customerOps.retryBatch")}</button>}<button className="secondary-button" disabled={pending} onClick={()=>{if(busy.current)return;change(true);setIds([]);}}>{t("customerOps.newBatch")}</button></div></div>}
    </section>
  </section>;
}
