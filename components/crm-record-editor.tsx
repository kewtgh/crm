"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, History, Pencil, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import type { CrmRecordDetail, PersistentResource } from "@/lib/crm-repository";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { useI18n } from "@/components/i18n-provider";
import { useUserPreferences } from "@/components/user-preferences-context";
import { AccessibleDrawer, InlineMessage, SearchableSelect, StatusBadge, Toast } from "@/components/ui";

const statusOptions:Record<PersistentResource,string[]>={
  schools:["HEALTHY","ATTENTION","DEVELOPING","RISK","UNVERIFIED"],
  people:["ACTIVE","FOLLOW_UP","VERIFIED","PROTECTED","UNVERIFIED"],
  tasks:["TODO","IN_PROGRESS","WAITING_APPROVAL","DONE","OVERDUE"],
};
type RelatedSearchItem={value:string;labelZh:string;labelEn:string;type:string};

export function CrmRecordEditor({
  resource,
  id,
  initial,
  onSaved,
}:{
  resource:PersistentResource;
  id:string;
  initial?:CrmRecordDetail;
  onSaved?:(item:CrmRecordDetail)=>void;
}){
  const {t}=useI18n();
  const {formatDate,localDateTimeInput,localDateTimeToIso}=useUserPreferences();
  const router=useRouter();
  const [detail,setDetail]=useState(initial??null);
  const [open,setOpen]=useState(false);
  const [archiveOpen,setArchiveOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const [toast,setToast]=useState("");
  const [owner,setOwner]=useState(initial?.ownerId??"");
  const [parentOrganization,setParentOrganization]=useState(initial?.parentOrganizationId??"");
  const [parentOptions,setParentOptions]=useState<Array<{value:string;label:string;detail?:string}>>([]);
  const [ownerOptions,setOwnerOptions]=useState<Array<{value:string;label:string;detail?:string}>>([]);
  const ownerSearch=useRef<AbortController|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const result=await apiFetch<CrmRecordDetail>(`/api/crm/${resource}/${id}`);
      setDetail(result);setOwner(result.ownerId??"");setParentOrganization(result.parentOrganizationId??"");
    }catch(caught){
      const requestId=caught instanceof ApiClientError?caught.requestId:undefined;
      setError(`${t("modules.loadFailed")}${requestId?` · ${t("common.requestId")}: ${requestId}`:""}`);
    }finally{setLoading(false);}
  },[id,resource,t]);
  useEffect(()=>()=>ownerSearch.current?.abort(),[]);

  const begin=async()=>{setOpen(true);if(!detail)await load();};
  const searchOwners=useCallback(async(query:string)=>{
    ownerSearch.current?.abort();
    const controller=new AbortController();ownerSearch.current=controller;
    try{
      const result=await apiFetch<{items:RelatedSearchItem[]}>(`/api/search/related?q=${encodeURIComponent(query)}`,{signal:controller.signal});
      setOwnerOptions(result.items.filter(item=>item.type==="USER").map(item=>({
        value:item.value.split(":")[1]??"",
        label:item.labelZh&&item.labelEn?`${item.labelZh} / ${item.labelEn}`:item.labelZh||item.labelEn,
      })));
    }catch{if(!controller.signal.aborted)setError(t("modules.relatedSearchFailed"));}
  },[t]);
  const searchParents=useCallback(async(query:string)=>{
    try{const result=await apiFetch<{items:RelatedSearchItem[]}>(`/api/search/related?q=${encodeURIComponent(query)}`);setParentOptions(result.items.filter(item=>item.type==="ORGANIZATION"&&item.value.split(":")[1]!==id).map(item=>({value:item.value.split(":")[1]??"",label:`${item.labelZh} / ${item.labelEn}`})));}catch{setError(t("modules.relatedSearchFailed"));}
  },[id,t]);

  const save=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!detail)return;
    const form=new FormData(event.currentTarget);
    const patch:Record<string,unknown>={
      nameZh:String(form.get("nameZh")??"").trim(),
      nameEn:String(form.get("nameEn")??"").trim(),
      status:String(form.get("status")??detail.status),
    };
    if(resource==="schools"){
      patch.city=String(form.get("city")??"").trim();
      patch.curriculum=String(form.get("curriculum")??"").trim();
      patch.courseCategories=String(form.get("courseCategories")??"").split(/[,，]/).map(value=>value.trim()).filter(Boolean);
      patch.affiliationType=String(form.get("affiliationType")??"INDEPENDENT");patch.parentOrganizationId=parentOrganization||null;
      patch.organizationOverviewMarkdown=String(form.get("organizationOverviewMarkdown")??"");patch.structureOverviewMarkdown=String(form.get("structureOverviewMarkdown")??"");
      patch.website=String(form.get("website")??"").trim();
      for(const field of ["foundedYear","studentCount","facultyCount","campusCount"] as const){const value=String(form.get(field)??"");patch[field]=value?Number(value):null;}
    }else if(resource==="people"){
      patch.email=String(form.get("email")??"").trim();
      patch.phone=String(form.get("phone")??"").trim();
      patch.title=String(form.get("title")??"").trim();
      patch.contactType=String(form.get("contactType")??detail.contactType??"CONTACT");
      patch.contactStatus=String(form.get("contactStatus")??detail.contactStatus??"NEW");
      patch.communicationLevel=Number(form.get("communicationLevel")??detail.communicationLevel??1);
      patch.notesMarkdown=String(form.get("notesMarkdown")??"");
      patch.ownerId=owner||detail.ownerId;
      patch.preferredContactMethod=String(form.get("preferredContactMethod")??detail.preferredContactMethod??"EMAIL");
      patch.preferredLanguage=String(form.get("preferredLanguage")??"").trim();
      patch.acquisitionSource=String(form.get("acquisitionSource")??"").trim();
      patch.decisionRole=String(form.get("decisionRole")??detail.decisionRole??"UNKNOWN");
      patch.tags=String(form.get("tags")??"").split(/[,，]/).map(value=>value.trim()).filter(Boolean);
      const nextFollowUpAt=String(form.get("nextFollowUpAt")??"");
      patch.nextFollowUpAt=nextFollowUpAt?localDateTimeToIso(nextFollowUpAt):null;
    }else{
      patch.priority=String(form.get("priority")??detail.priority);
      patch.ownerId=owner||detail.ownerId;
      const dueAt=String(form.get("dueAt")??"");
      if(dueAt)patch.dueAt=localDateTimeToIso(dueAt);
    }
    setPending(true);setError("");
    try{
      const result=await apiFetch<{item:CrmRecordDetail}>(`/api/crm/${resource}/${id}`,{
        method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({expectedUpdatedAt:detail.updatedAt,patch}),
      });
      setDetail(result.item);setOwner(result.item.ownerId??"");setOpen(false);
      onSaved?.(result.item);
      setToast(t("crm.saved"));router.refresh();
    }catch(caught){
      setError(t(caught instanceof ApiClientError&&caught.code==="CRM_VERSION_CONFLICT"?"crm.conflict":"crm.saveFailed"));
      if(caught instanceof ApiClientError&&caught.code==="CRM_VERSION_CONFLICT")await load();
    }finally{setPending(false);}
  };

  const archive=async()=>{
    if(!detail)return;setPending(true);setError("");
    try{
      await apiFetch(`/api/crm/${resource}/${id}`,{
        method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({expectedUpdatedAt:detail.updatedAt,patch:{archived:true}}),
      });
      setArchiveOpen(false);setOpen(false);setToast(t("crm.archived"));
      router.push(resource==="schools"?"/schools":resource==="people"?"/people":"/tasks");
      router.refresh();
    }catch(caught){
      setError(t(caught instanceof ApiClientError&&caught.code==="CRM_VERSION_CONFLICT"?"crm.conflict":"crm.saveFailed"));
    }finally{setPending(false);}
  };

  return <>
    <button className="secondary-button" type="button" onClick={()=>void begin()}><Pencil size={16}/>{t("crm.edit")}</button>
    {open&&<AccessibleDrawer pending={pending} title={detail?`${detail.nameZh} / ${detail.nameEn}`:t("crm.edit")} eyebrow={t("crm.editEyebrow")} description={t("crm.editHelp")} onClose={()=>setOpen(false)}>
      {loading&&!detail&&<p role="status">{t("common.loading")}</p>}
      {detail&&<form onSubmit={save}>
        <div className="form-grid two-column">
          <label className="field"><span>{t("products.nameZh")} *</span><input name="nameZh" defaultValue={detail.nameZh} required maxLength={120}/></label>
          <label className="field"><span>{t("products.nameEn")} *</span><input name="nameEn" defaultValue={detail.nameEn} required maxLength={160}/></label>
        </div>
        {resource==="schools"&&<>
          <div className="form-grid two-column"><label className="field"><span>{t("modules.city")} *</span><input name="city" defaultValue={detail.city} required maxLength={80}/></label><label className="field"><span>{t("modules.curriculum")} *</span><input name="curriculum" defaultValue={detail.curriculum} required maxLength={120}/></label></div>
          <label className="field"><span>{t("education.courseCategories")}</span><input name="courseCategories" defaultValue={detail.courseCategories?.join(", ")}/></label>
          <div className="form-grid two-column"><label className="field"><span>{t("education.affiliationType")}</span><select name="affiliationType" defaultValue={detail.affiliationType}>{["INDEPENDENT","EDUCATION_GROUP","GOVERNMENT","UNIVERSITY","RELIGIOUS","OTHER"].map(value=><option key={value} value={value}>{t(`education.affiliation.${value.toLowerCase()}`)}</option>)}</select></label><SearchableSelect label={t("education.parentOrganization")} options={parentOptions} value={parentOrganization} onChange={setParentOrganization} onSearch={searchParents}/></div>
          <label className="field"><span>{t("education.website")}</span><input name="website" type="url" defaultValue={detail.website}/></label>
          <div className="form-grid two-column"><label className="field"><span>{t("education.foundedYear")}</span><input name="foundedYear" type="number" min="1000" max="9999" defaultValue={detail.foundedYear??""}/></label><label className="field"><span>{t("education.campusCount")}</span><input name="campusCount" type="number" min="0" defaultValue={detail.campusCount??""}/></label></div>
          <div className="form-grid two-column"><label className="field"><span>{t("education.studentCount")}</span><input name="studentCount" type="number" min="0" defaultValue={detail.studentCount??""}/></label><label className="field"><span>{t("education.facultyCount")}</span><input name="facultyCount" type="number" min="0" defaultValue={detail.facultyCount??""}/></label></div>
          <label className="field"><span>{t("education.organizationOverview")}</span><textarea name="organizationOverviewMarkdown" rows={4} defaultValue={detail.organizationOverviewMarkdown} data-markdown="true"/><small>{t("common.markdownSupported")}</small></label><label className="field"><span>{t("education.structureOverview")}</span><textarea name="structureOverviewMarkdown" rows={4} defaultValue={detail.structureOverviewMarkdown} data-markdown="true"/><small>{t("common.markdownSupported")}</small></label>
        </>}
        {resource==="people"&&<>
          <SearchableSelect label={t("crm.owner")} options={ownerOptions} value={owner} placeholder={detail.ownerName} onChange={setOwner} onSearch={searchOwners}/>
          <label className="field"><span>{t("modules.title")}</span><input name="title" defaultValue={detail.title} maxLength={120}/></label>
          <div className="form-grid two-column">
            <label className="field"><span>{t("modules.email")}</span><input name="email" type="email" defaultValue={detail.email}/></label>
            <label className="field"><span>{t("modules.phone")}</span><input name="phone" defaultValue={detail.phone} maxLength={40}/></label>
          </div>
          <div className="form-grid two-column"><label className="field"><span>{t("contact.type")}</span><select name="contactType" defaultValue={detail.contactType??"CONTACT"}>{["CONTACT","PARENT","STUDENT","SCHOOL_STAFF","PAYER"].map(value=><option value={value} key={value}>{t(`contact.type.${value.toLowerCase()}`)}</option>)}</select></label><label className="field"><span>{t("contact.contactStatus")}</span><select name="contactStatus" defaultValue={detail.contactStatus??"NEW"}>{["NEW","ATTEMPTING","CONNECTED","FOLLOW_UP","DORMANT"].map(value=><option value={value} key={value}>{t(`contact.status.${value.toLowerCase()}`)}</option>)}</select></label></div>
          <label className="field"><span>{t("contact.communicationLevel")}</span><select name="communicationLevel" defaultValue={detail.communicationLevel??1}>{[1,2,3,4].map(value=><option value={value} key={value}>{t(`contact.communication.level${value}`)}</option>)}</select></label>
          <div className="form-grid two-column"><label className="field"><span>{t("contact.preferredContactMethod")}</span><select name="preferredContactMethod" defaultValue={detail.preferredContactMethod??"EMAIL"}>{["EMAIL","PHONE","SMS","WECHAT","WHATSAPP","IN_PERSON"].map(value=><option value={value} key={value}>{t(`contact.method.${value.toLowerCase()}`)}</option>)}</select></label><label className="field"><span>{t("contact.preferredLanguage")}</span><input name="preferredLanguage" defaultValue={detail.preferredLanguage} maxLength={80}/></label></div>
          <div className="form-grid two-column"><label className="field"><span>{t("contact.acquisitionSource")}</span><input name="acquisitionSource" defaultValue={detail.acquisitionSource} maxLength={160}/></label><label className="field"><span>{t("contact.decisionRole")}</span><select name="decisionRole" defaultValue={detail.decisionRole??"UNKNOWN"}>{["UNKNOWN","DECISION_MAKER","INFLUENCER","USER","GATEKEEPER","OTHER"].map(value=><option value={value} key={value}>{t(`contact.decisionRole.${value.toLowerCase()}`)}</option>)}</select></label></div>
          <div className="form-grid two-column"><label className="field"><span>{t("contact.tags")}</span><input name="tags" defaultValue={detail.tags?.join(", ")} placeholder={t("contact.tagsHelp")}/></label><label className="field"><span>{t("contact.nextFollowUp")}</span><input name="nextFollowUpAt" type="datetime-local" defaultValue={detail.nextFollowUpAt?localDateTimeInput(detail.nextFollowUpAt):""}/></label></div>
          <label className="field"><span>{t("contact.notes")}</span><textarea name="notesMarkdown" rows={5} maxLength={20000} defaultValue={detail.notesMarkdown} data-markdown="true"/><small>{t("common.markdownSupported")}</small></label>
          <section className="record-households"><h3>{t("contact.households")}</h3>{detail.households?.map(household=><p key={household.id}><b>{household.nameZh} / {household.nameEn}</b><small>{t(`education.memberRole.${household.role.toLowerCase()}`)}{household.primary?` · ${t("education.primaryContact")}`:""}</small></p>)}{!detail.households?.length&&<p className="select-empty">{t("contact.noHouseholds")}</p>}</section>
        </>}
        {resource==="tasks"&&<>
          <SearchableSelect label={t("crm.owner")} options={ownerOptions} value={owner} placeholder={detail.ownerName} onChange={setOwner} onSearch={searchOwners}/>
          <div className="form-grid two-column">
            <label className="field"><span>{t("modules.priority")}</span><select name="priority" defaultValue={detail.priority}>{["LOW","NORMAL","HIGH","URGENT"].map(value=><option value={value} key={value}>{t(`modules.priority.${value.toLowerCase()}`)}</option>)}</select></label>
            <label className="field"><span>{t("modules.dueAt")}</span><input name="dueAt" type="datetime-local" defaultValue={detail.dueAt?localDateTimeInput(detail.dueAt):""} required/></label>
          </div>
        </>}
        <label className="field"><span>{t("crm.status")}</span><select name="status" defaultValue={detail.status}>{statusOptions[resource].map(value=><option value={value} key={value}>{t(`crm.status.${value}`)}</option>)}</select></label>
        {error&&<InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions">
          <button className="danger-button" type="button" disabled={pending} onClick={()=>setArchiveOpen(true)}><Archive size={16}/>{t("crm.archive")}</button>
          <button className="secondary-button" type="button" disabled={pending} onClick={()=>setOpen(false)}>{t("common.cancel")}</button>
          <button className="primary-button" type="submit" disabled={pending}><Save size={16}/>{pending?t("common.saving"):t("common.save")}</button>
        </div>
      </form>}
      {detail&&<section className="record-history">
        <div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.auditTrail")}</p><h3>{t("crm.history")}</h3></div><History size={19}/></div>
        {detail.history.map((item,index)=><article key={`${item.changedAt}-${index}`}><StatusBadge tone="blue">{t(`crm.audit.${item.action}`)}</StatusBadge><span><b>{item.actorName}</b><small>{formatDate(item.changedAt,{includeTime:true})}</small></span></article>)}
        {!detail.history.length&&<p className="select-empty">{t("crm.historyEmpty")}</p>}
      </section>}
    </AccessibleDrawer>}
    {archiveOpen&&<AccessibleDrawer pending={pending} title={t("common.confirmAction")} description={t("crm.archiveConfirm")} onClose={()=>setArchiveOpen(false)}>
      <InlineMessage type="warning">{t("common.actionCannotUndo")}</InlineMessage>
      {error&&<InlineMessage type="error">{error}</InlineMessage>}
      <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={()=>setArchiveOpen(false)}>{t("common.cancel")}</button><button className="danger-button" type="button" disabled={pending} onClick={()=>void archive()}>{pending?t("common.processing"):t("crm.archive")}</button></div>
    </AccessibleDrawer>}
    {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
  </>;
}
