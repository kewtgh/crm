"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { followUpProgress, type CustomerSubject } from "@/lib/customer-operations";
import type { CustomerOperationsSnapshot } from "@/lib/customer-operations-repository";
import { useCapability } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { DateInput } from "./structured-inputs";
import { InlineMessage, ProgressBar, SearchableSelect } from "./ui";
import { MarkdownContent } from "./markdown-content";
import { DetailTabs } from "./detail-tabs";
import { customerDetailTabs } from "@/lib/customer-detail-tabs";
import { useRemoteSearch } from "@/hooks/use-remote-search";

export function CustomerOperationsPanel({subject,id,extra,history}:{subject:CustomerSubject;id:string;extra?:React.ReactNode;history?:React.ReactNode}) {
  const {t,locale}=useI18n();const canSend=useCapability("messages.manage"),canViewContracts=useCapability("contracts.view"),canManageFamily=useCapability("education.manage");
  const {formatDate,localDateTimeInput,localDateTimeToIso}=useUserPreferences();
  const [data,setData]=useState<CustomerOperationsSnapshot|null>(null),[error,setError]=useState(""),[pending,setPending]=useState(false),[tab,setTab]=useState("overview");
  const [contract,setContract]=useState(""),[options,setOptions]=useState<Array<{value:string;label:string}>>([]);
  const request=useRef<{key:string;occurredAt:string}|null>(null);
  const busy=useRef(false),[notice,setNotice]=useState("");const runContractSearch=useRemoteSearch(),runLoad=useRemoteSearch();
  const load=useCallback(async(signal?:AbortSignal)=>{const result=await runLoad(currentSignal=>apiFetch<CustomerOperationsSnapshot>(`/api/customer-operations?subject=${subject}&id=${id}`,{signal:signal?AbortSignal.any([signal,currentSignal]):currentSignal}));if(!result.current||signal?.aborted)return false;if("error" in result){setError(presentApiError(result.error,t,"modules.loadFailed").message);return false;}setData(result.value);setError("");return true;},[subject,id,t,runLoad]);
  useEffect(()=>{const controller=new AbortController();const timer=window.setTimeout(()=>void load(controller.signal),0);return()=>{window.clearTimeout(timer);controller.abort();};},[load]);
  useEffect(()=>{const refresh=(event:Event)=>{const detail=(event as CustomEvent<{resource:string;id:string}>).detail;if(detail?.id===id&&detail.resource===(subject==="ORGANIZATION"?"schools":"people")&&!busy.current)void load();};window.addEventListener("lumina:crm-record-saved",refresh);return()=>window.removeEventListener("lumina:crm-record-saved",refresh);},[subject,id,load]);
  const canManage=!!data?.canManage&&(subject!=="HOUSEHOLD"||canManageFamily);
  const save=async(event:React.FormEvent<HTMLFormElement>,operation:string)=>{
    event.preventDefault();if(busy.current)return;const formElement=event.currentTarget,form=new FormData(formElement);
    const details:Record<string,unknown>=Object.fromEntries(form);
    if(operation==="plan"){details.targetLevel=Number(details.targetLevel);details.targetCount=Number(details.targetCount);}
    if(operation==="entry"){
      let occurredAt:string;try{occurredAt=localDateTimeToIso(String(form.get("occurredAt")));}catch{setError(t("error.invalidLocalTime"));return;}
      request.current??={key:crypto.randomUUID(),occurredAt};details.requestKey=request.current.key;details.occurredAt=request.current.occurredAt;
    }
    if(operation==="contract")details.contractId=contract;
    busy.current=true;setPending(true);setError("");setNotice("");
    try{await apiFetch("/api/customer-operations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subject,id,operation,...details})});if(operation==="entry"){request.current=null;formElement.reset();}if(operation==="contract")setContract("");const refreshed=await load();setNotice(t(refreshed?"audit.saved":"audit.savedRefreshFailed"));}
    catch(caught){setError(presentApiError(caught,t,"crm.saveFailed").message);}finally{busy.current=false;setPending(false);}
  };
  const searchContracts=async(query:string)=>{const result=await runContractSearch(signal=>apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string}>}>(`/api/search/related?types=CONTRACT&q=${encodeURIComponent(query)}`,{signal}));if(!result.current)return;if("error" in result){setError(presentApiError(result.error,t,"modules.relatedSearchFailed").message);return;}setOptions(result.value.items.map(item=>({value:item.value.split(":")[1],label:locale==="en"?item.labelEn:item.labelZh})));};
  const name=(item:{name_zh?:string;name_en?:string;title_zh?:string;title_en?:string;contract_number?:string;id:string})=>item.contract_number||(locale==="en"?item.name_en||item.title_en:item.name_zh||item.title_zh)||item.name_zh||item.name_en||item.id;
  if(!data||data.id!==id||data.subject!==subject)return <section className="surface">{error?<><InlineMessage type="error">{error}</InlineMessage><button className="secondary-button" onClick={()=>void load()}>{t("common.retry")}</button></>:<p role="status">{t("common.loading")}</p>}</section>;
  const progress=followUpProgress(data.plan,data.entries,data.level,new Date().toISOString().slice(0,10),data.completed);
  const tabs=customerDetailTabs(subject,!!extra,!!history);
  const displayName=(locale==="en"?data.nameEn:data.nameZh)||data.nameZh||data.nameEn;
  const profileKeys=["city","curriculum","website","email","phone","title","preferred_language","next_follow_up_at"].filter(key=>data.profile[key]);
  return <section className="surface customer-operations-panel">
    <header className="detail-identity"><span className="detail-avatar" aria-hidden="true">{displayName.slice(0,1)}</span><div><p className="eyebrow">{t(subject==="ORGANIZATION"?"nav.schools":subject==="CONTACT"?"nav.people":"nav.households")}</p><h2>{displayName}</h2><p>{t(subject==="ORGANIZATION"?"detail.organizationHelp":subject==="HOUSEHOLD"?"detail.familyHelp":"detail.contactHelp")}</p></div></header>
    {error&&<InlineMessage type="error">{error}<button className="text-button" disabled={pending} onClick={()=>void load()}>{t("common.retry")}</button></InlineMessage>}
    {notice&&<InlineMessage type="info">{notice}</InlineMessage>}
    <DetailTabs items={tabs} active={tab} onChange={setTab} disabled={pending} label={t("customerOps.title")}>
    {tab==="overview"&&<div className="page-stack"><div className="detail-metrics">{subject==="ORGANIZATION"&&<span><b>{data.shortName||"—"}</b><small>{t("customerOps.shortName")}</small></span>}<span><b>{data.ownerName||"—"}</b><small>{t("crm.owner")}</small></span><span><b>{t(`contact.communication.level${data.level}`)}</b><small>{t("contact.communicationLevel")}</small></span><span><b>{data.entryTotal}</b><small>{t("customerOps.entries")}</small></span></div>
      <section className="detail-section"><h3>{t("detail.identity")}</h3><dl className="customer-profile">{profileKeys.map(key=><div key={key}><dt>{t(`customerOps.field.${key}`)}</dt><dd>{key==="next_follow_up_at"?formatDate(String(data.profile[key]),{includeTime:true}):String(data.profile[key])}</dd></div>)}</dl>{!profileKeys.length&&<p className="detail-empty">{t("detail.noProfile")}</p>}
      {subject==="CONTACT"&&(data.profile.organization_id?<Link className="detail-context-link" href={`/schools/${data.profile.organization_id}`}>{t("detail.organizationLink")} →</Link>:<p className="detail-empty">{t("detail.noOrganization")}</p>)}</section>
      <section className="detail-section"><h3>{t("detail.notes")}</h3><MarkdownContent value={String(data.profile.organization_overview_markdown??data.profile.notes_markdown??data.profile.education_expectations_markdown??"")} empty={t("common.noData")}/></section>
      {subject==="CONTACT"&&canSend&&<Link className="secondary-button" href={`/messages?tab=templates&contact=${id}`}>{t("customerOps.email")}</Link>}
    </div>}
    <div className="page-stack follow-up-workspace" hidden={tab!=="followUp"}>
      <InlineMessage type="info">{t(progress.suggestionKey)} {t("customerOps.evidenceHelp")}</InlineMessage>
      {progress.overdue&&<InlineMessage type="warning">{t("customerOps.overdue")}</InlineMessage>}
      {data.plan&&<div className="detail-metrics" aria-live="polite"><span><b>{progress.remaining}</b><small>{t("audit.remaining")}</small></span><span><b>{progress.daysRemaining!<0?t("audit.pastDue",{days:-progress.daysRemaining!}):t("audit.daysLeft",{days:progress.daysRemaining!})}</b><small>{t("audit.deadlineUTC")}</small></span><span><b>{t(progress.achieved?"audit.achieved":"audit.inProgress")}</b><small>{t("customerOps.goal")}</small></span></div>}
      {data.plan?<div className="detail-section"><h3>{data.plan.title}</h3><p>{formatDate(data.plan.start_date,{dateOnly:true})} — {formatDate(data.plan.due_date,{dateOnly:true})}</p><ProgressBar value={progress.contactProgress} label={`${progress.completed} / ${data.plan.target_count} · ${t("customerOps.entries")}`}/><ProgressBar value={progress.levelProgress} label={`${data.level} / ${data.plan.target_level} · ${t("contact.communicationLevel")}`}/></div>:<p className="detail-empty">{t("detail.noPlan")}</p>}
      {canManage&&<details><summary>{t("customerOps.editPlan")}</summary><form key={data.plan?.updated_at??"new"} onSubmit={event=>void save(event,"plan")} className="page-stack"><fieldset className="follow-up-fields" disabled={pending}><label className="field"><span>{t("customerOps.goal")}</span><input name="title" required maxLength={200} defaultValue={data.plan?.title}/></label><div className="form-grid two-column"><label className="field"><span>{t("customerOps.targetLevel")}</span><select required name="targetLevel" defaultValue={data.plan?.target_level??progress.nextLevel}>{[1,2,3,4].map(level=><option key={level} value={level}>{t(`contact.communication.level${level}`)}</option>)}</select></label><label className="field"><span>{t("customerOps.targetCount")}</span><input name="targetCount" type="number" min={1} max={1000} required defaultValue={data.plan?.target_count??3}/></label><label className="field"><span>{t("customerOps.startDate")}</span><DateInput name="startDate" required defaultValue={data.plan?.start_date??new Date().toISOString().slice(0,10)}/></label><label className="field"><span>{t("customerOps.dueDate")}</span><DateInput name="dueDate" required defaultValue={data.plan?.due_date}/></label></div><button className="primary-button" disabled={pending}>{t("common.save")}</button></fieldset></form></details>}
      {canManage&&<details><summary>{t("customerOps.record")}</summary><form onSubmit={event=>void save(event,"entry")} onChange={()=>{request.current=null;}} className="page-stack"><fieldset className="follow-up-fields" disabled={pending}><div className="form-grid two-column"><label className="field"><span>{t("customer360.activityKind")}</span><select required name="kind">{["CALL","EMAIL","MEETING","VISIT","NOTE"].map(kind=><option key={kind} value={kind}>{t(`activity.kind.${kind}`)}</option>)}</select></label><label className="field"><span>{t("customer360.occurredAt")}</span><DateInput name="occurredAt" type="datetime-local" max={localDateTimeInput()} defaultValue={localDateTimeInput()} required/></label></div><label className="field"><span>{t("customerOps.summary")}</span><textarea name="summary" rows={3} maxLength={2000} required/></label><label className="field"><span>{t("customerOps.nextStep")}</span><textarea name="nextStep" rows={2} maxLength={1000} required/></label><button className="primary-button" disabled={pending}>{t("common.save")}</button></fieldset></form></details>}
      {subject==="ORGANIZATION"&&<Link href="/sales/performance" className="secondary-button">{t("customerOps.relationshipEvidence")}</Link>}
      <p className="detail-list-caption">{t("customerOps.recent",{count:data.entries.length,total:data.entryTotal})}</p>{!data.entries.length&&<p className="detail-empty">{t("detail.noFollowUps")}</p>}{data.entries.map(entry=><article className="follow-up-entry" key={entry.id}><b>{t(`activity.kind.${entry.kind}`)} · {formatDate(entry.occurred_at,{includeTime:true})}</b><p>{entry.summary}</p><small>{t("customerOps.nextStep")}: {entry.next_step||"—"}</small></article>)}
    </div>
    {tab==="business"&&<div className="page-stack"><section className="detail-section"><h3>{t("nav.contracts")} <small>{data.contracts.length}</small></h3><div className="detail-record-list">{data.contracts.map(item=><article key={item.id}><div><Link href={`/contracts?query=${encodeURIComponent(item.contract_number??"")}&focus=${item.id}`}>{name(item)}</Link><small>{t("crm.owner")}: {item.owner_name||"—"}</small></div><span>{t(`contracts.status.${item.status?.toLowerCase()==="pending_approval"?"pending":item.status?.toLowerCase()}`)}</span></article>)}</div>{!data.contracts.length&&<p className="detail-empty">{t("detail.noBusiness")}</p>}
      {subject!=="ORGANIZATION"&&canManage&&canViewContracts&&<form onSubmit={event=>void save(event,"contract")}><fieldset className="follow-up-fields" disabled={pending}><SearchableSelect label={t("customerOps.linkContract")} required value={contract} options={options} onChange={setContract} onSearch={searchContracts}/><button className="secondary-button" disabled={pending||!contract}>{t("common.save")}</button></fieldset></form>}
      </section><div className="detail-section-grid"><section className="detail-section"><h3>{t("nav.products")}</h3>{data.products.map(item=><p key={item.id}><Link href="/products">{name(item)}</Link></p>)}{!data.products.length&&<p className="detail-empty">{t("detail.noBusiness")}</p>}</section><section className="detail-section"><h3>{t("nav.opportunities")}</h3>{data.opportunities.map(item=><p key={item.id}><Link href={`/opportunities?focus=${item.id}`}>{name(item)}</Link> · {t(`sales.stage.${item.stage?.toLowerCase()}`)}</p>)}{!data.opportunities.length&&<p className="detail-empty">{t(subject==="CONTACT"?"audit.contactBusinessScope":"detail.noBusiness")}</p>}</section></div>{data.limited&&<InlineMessage type="warning">{t("customerOps.limited")}</InlineMessage>}
    </div>}
    {tab==="people"&&<div className="page-stack"><section className="detail-section"><h3>{t(subject==="ORGANIZATION"?"detail.organizationContacts":"detail.familyMembers")}</h3><div className="detail-record-list">{data.contacts.map(item=><article key={item.id}><div><Link href={`/people/${item.id}`}>{name(item)}</Link><small>{subject==="HOUSEHOLD"&&item.member_role?`${t(`education.memberRole.${item.member_role.toLowerCase()}`)} · `:""}{t("crm.owner")}: {item.owner_name||"—"}</small>{item.next_follow_up_at&&<small>{t("customerOps.field.next_follow_up_at")}: {formatDate(item.next_follow_up_at,{includeTime:true})}</small>}</div><span>{t(`contact.communication.level${item.communication_level??1}`)}</span></article>)}</div></section>{subject==="HOUSEHOLD"&&<section className="detail-section"><h3>{t("nav.students")}</h3><div className="detail-record-list">{data.students.map(item=><article key={item.id}><Link href={`/households?tab=students&focus=${item.id}`}>{name(item)}</Link></article>)}</div></section>}{!data.contacts.length&&(subject!=="HOUSEHOLD"||!data.students.length)&&<p className="detail-empty">{t(subject==="ORGANIZATION"?"detail.noContacts":"detail.noMembers")}</p>}{data.limited&&<InlineMessage type="warning">{t("customerOps.limited")}</InlineMessage>}</div>}
    {tab==="privacy"&&extra}
    {tab==="history"&&history}
    </DetailTabs>
  </section>;
}
