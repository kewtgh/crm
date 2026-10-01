"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { followUpProgress, type CustomerSubject } from "@/lib/customer-operations";
import type { CustomerOperationsSnapshot } from "@/lib/customer-operations-repository";
import { useAppUser } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { DateInput } from "./structured-inputs";
import { InlineMessage, ProgressBar, SearchableSelect } from "./ui";
import { MarkdownContent } from "./markdown-content";

export function CustomerOperationsPanel({subject,id,extra}:{subject:CustomerSubject;id:string;extra?:React.ReactNode}) {
  const {t,locale}=useI18n();const user=useAppUser();
  const {formatDate,localDateTimeInput,localDateTimeToIso}=useUserPreferences();
  const [data,setData]=useState<CustomerOperationsSnapshot|null>(null),[error,setError]=useState(""),[pending,setPending]=useState(false),[tab,setTab]=useState("overview");
  const [contract,setContract]=useState(""),[options,setOptions]=useState<Array<{value:string;label:string}>>([]);
  const request=useRef<{key:string;occurredAt:string}|null>(null);
  const load=useCallback(async(signal?:AbortSignal)=>{try{const result=await apiFetch<CustomerOperationsSnapshot>(`/api/customer-operations?subject=${subject}&id=${id}`,{signal});setData(result);setError("");}catch(caught){if(!signal?.aborted)setError(presentApiError(caught,t,"modules.loadFailed").message);}},[subject,id,t]);
  useEffect(()=>{const controller=new AbortController();const timer=window.setTimeout(()=>void load(controller.signal),0);return()=>{window.clearTimeout(timer);controller.abort();};},[load]);
  const canManage=subject==="HOUSEHOLD"?["SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER","SALES_SPECIALIST","SALES_SUPPORT"].includes(user.role):["SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER","SALES_SPECIALIST"].includes(user.role);
  const save=async(event:React.FormEvent<HTMLFormElement>,operation:string)=>{
    event.preventDefault();const formElement=event.currentTarget,form=new FormData(formElement);
    const details:Record<string,unknown>=Object.fromEntries(form);
    if(operation==="plan"){details.targetLevel=Number(details.targetLevel);details.targetCount=Number(details.targetCount);}
    if(operation==="entry"){
      let occurredAt:string;try{occurredAt=localDateTimeToIso(String(form.get("occurredAt")));}catch{setError(t("error.invalidLocalTime"));return;}
      request.current??={key:crypto.randomUUID(),occurredAt};details.requestKey=request.current.key;details.occurredAt=request.current.occurredAt;
    }
    if(operation==="contract")details.contractId=contract;
    setPending(true);setError("");
    try{await apiFetch("/api/customer-operations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subject,id,operation,...details})});if(operation==="entry"){request.current=null;formElement.reset();}if(operation==="contract")setContract("");await load();}
    catch(caught){setError(presentApiError(caught,t,"crm.saveFailed").message);}finally{setPending(false);}
  };
  const searchContracts=async(query:string)=>{try{const result=await apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string}>}>(`/api/search/related?types=CONTRACT&q=${encodeURIComponent(query)}`);setOptions(result.items.map(item=>({value:item.value.split(":")[1],label:locale==="en"?item.labelEn:item.labelZh})));}catch(caught){setError(presentApiError(caught,t,"modules.relatedSearchFailed").message);}};
  const name=(item:{name_zh?:string;name_en?:string;title_zh?:string;title_en?:string;contract_number?:string;id:string})=>item.contract_number||(locale==="en"?item.name_en||item.title_en:item.name_zh||item.title_zh)||item.name_zh||item.name_en||item.id;
  if(!data)return <section className="surface">{error?<><InlineMessage type="error">{error}</InlineMessage><button className="secondary-button" onClick={()=>void load()}>{t("common.retry")}</button></>:<p role="status">{t("common.loading")}</p>}</section>;
  const progress=followUpProgress(data.plan,data.entries,data.level,new Date().toISOString().slice(0,10),data.completed);
  const tabs=["overview","followUp","business","people",...(extra?["privacy"]:[])];
  return <section className="surface customer-operations-panel">
    <div className="page-tabs" role="tablist" aria-label={t("customerOps.title")}>{tabs.map(key=><button key={key} id={`${id}-tab-${key}`} role="tab" type="button" aria-selected={tab===key} aria-controls={`${id}-panel`} onClick={()=>setTab(key)}>{t(`customerOps.tab.${key}`)}</button>)}</div>
    {error&&<InlineMessage type="error">{error}</InlineMessage>}
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>
    {tab==="overview"&&<div className="page-stack"><div className="quick-summary"><span><b>{data.shortName||data.nameZh||data.nameEn}</b><small>{t("customerOps.shortName")}</small></span><span><b>{data.ownerName}</b><small>{t("crm.owner")}</small></span><span><b>{t(`contact.communication.level${data.level}`)}</b><small>{t("contact.communicationLevel")}</small></span><span><b>{data.entryTotal}</b><small>{t("customerOps.entries")}</small></span></div>
      <dl className="customer-profile">{["city","curriculum","website","email","phone","title","preferred_language","next_follow_up_at"].filter(key=>data.profile[key]).map(key=><div key={key}><dt>{t(`customerOps.field.${key}`)}</dt><dd>{String(data.profile[key])}</dd></div>)}</dl>
      <MarkdownContent value={String(data.profile.organization_overview_markdown??data.profile.notes_markdown??data.profile.education_expectations_markdown??"")} empty={t("common.noData")}/>
      {subject==="CONTACT"&&<Link className="secondary-button" href={`/messages?tab=templates&contact=${id}`}>{t("customerOps.email")}</Link>}
    </div>}
    {tab==="followUp"&&<div className="page-stack">
      <InlineMessage type="info">{t(progress.suggestionKey)} {t("customerOps.evidenceHelp")}</InlineMessage>
      {progress.overdue&&<InlineMessage type="warning">{t("customerOps.overdue")}</InlineMessage>}
      {data.plan&&<div><h3>{data.plan.title}</h3><p>{formatDate(data.plan.start_date,{dateOnly:true})} — {formatDate(data.plan.due_date,{dateOnly:true})}</p><ProgressBar value={progress.contactProgress} label={`${progress.completed} / ${data.plan.target_count} · ${t("customerOps.entries")}`}/><ProgressBar value={progress.levelProgress} label={`${data.level} / ${data.plan.target_level} · ${t("contact.communicationLevel")}`}/></div>}
      {canManage&&<details><summary>{t("customerOps.editPlan")}</summary><form key={data.plan?.updated_at??"new"} onSubmit={event=>void save(event,"plan")} className="page-stack"><label className="field"><span>{t("customerOps.goal")}</span><input name="title" required maxLength={200} defaultValue={data.plan?.title}/></label><div className="form-grid two-column"><label className="field"><span>{t("customerOps.targetLevel")}</span><select required name="targetLevel" defaultValue={data.plan?.target_level??progress.nextLevel}>{[1,2,3,4].map(level=><option key={level} value={level}>{t(`contact.communication.level${level}`)}</option>)}</select></label><label className="field"><span>{t("customerOps.targetCount")}</span><input name="targetCount" type="number" min={1} max={1000} required defaultValue={data.plan?.target_count??3}/></label><label className="field"><span>{t("customerOps.startDate")}</span><DateInput name="startDate" required defaultValue={data.plan?.start_date??new Date().toISOString().slice(0,10)}/></label><label className="field"><span>{t("customerOps.dueDate")}</span><DateInput name="dueDate" required defaultValue={data.plan?.due_date}/></label></div><button className="primary-button" disabled={pending}>{t("common.save")}</button></form></details>}
      {canManage&&<details><summary>{t("customerOps.record")}</summary><form onSubmit={event=>void save(event,"entry")} onChange={()=>{request.current=null;}} className="page-stack"><div className="form-grid two-column"><label className="field"><span>{t("customer360.activityKind")}</span><select required name="kind">{["CALL","EMAIL","MEETING","VISIT","NOTE"].map(kind=><option key={kind}>{kind}</option>)}</select></label><label className="field"><span>{t("customer360.occurredAt")}</span><DateInput name="occurredAt" type="datetime-local" max={localDateTimeInput()} defaultValue={localDateTimeInput()} required/></label></div><label className="field"><span>{t("customerOps.summary")}</span><textarea name="summary" rows={3} maxLength={2000} required/></label><label className="field"><span>{t("customerOps.nextStep")}</span><textarea name="nextStep" rows={2} maxLength={1000} required/></label><button className="primary-button" disabled={pending}>{t("common.save")}</button></form></details>}
      {subject==="ORGANIZATION"&&<Link href="/sales/performance" className="secondary-button">{t("customerOps.relationshipEvidence")}</Link>}
      <p>{t("customerOps.recent",{count:50,total:data.entryTotal})}</p>{data.entries.map(entry=><article className="follow-up-entry" key={entry.id}><b>{t(`activity.kind.${entry.kind}`)} · {formatDate(entry.occurred_at,{includeTime:true})}</b><p>{entry.summary}</p><small>{entry.next_step}</small></article>)}
    </div>}
    {tab==="business"&&<div className="page-stack"><h3>{t("nav.contracts")}</h3>{data.contracts.map(item=><p key={item.id}><Link href={`/contracts?query=${encodeURIComponent(item.contract_number??"")}&focus=${item.id}`}>{name(item)}</Link> · {item.status} · {t("crm.owner")}: {item.owner_name||"—"}</p>)}{!data.contracts.length&&<p>{t("common.noData")}</p>}
      {subject!=="ORGANIZATION"&&canManage&&<form onSubmit={event=>void save(event,"contract")}><SearchableSelect label={t("customerOps.linkContract")} required value={contract} options={options} onChange={setContract} onSearch={searchContracts}/><button className="secondary-button" disabled={pending||!contract}>{t("common.save")}</button></form>}
      <h3>{t("nav.products")}</h3>{data.products.map(item=><p key={item.id}><Link href="/products">{name(item)}</Link></p>)}<h3>{t("nav.opportunities")}</h3>{data.opportunities.map(item=><p key={item.id}><Link href={`/opportunities?focus=${item.id}`}>{name(item)}</Link> · {item.stage}</p>)}{data.limited&&<InlineMessage type="warning">{t("customerOps.limited")}</InlineMessage>}
    </div>}
    {tab==="people"&&<div className="page-stack"><h3>{t("nav.people")}</h3>{data.contacts.map(item=><p key={item.id}><Link href={`/people/${item.id}`}>{name(item)}</Link>{item.member_role?` · ${t(`education.memberRole.${item.member_role.toLowerCase()}`)}`:""} · {t(`contact.communication.level${item.communication_level??1}`)} · {item.owner_name||"—"}{item.next_follow_up_at?` · ${formatDate(item.next_follow_up_at,{includeTime:true})}`:""}</p>)}<h3>{t("nav.students")}</h3>{data.students.map(item=><p key={item.id}><Link href={`/households?tab=students&focus=${item.id}`}>{name(item)}</Link></p>)}{!data.contacts.length&&!data.students.length&&<p>{t("common.noData")}</p>}</div>}
    {tab==="privacy"&&extra}
    </div>
  </section>;
}
