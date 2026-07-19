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
}:{
  resource:PersistentResource;
  id:string;
  initial?:CrmRecordDetail;
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
  const [ownerOptions,setOwnerOptions]=useState<Array<{value:string;label:string;detail?:string}>>([]);
  const ownerSearch=useRef<AbortController|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const result=await apiFetch<CrmRecordDetail>(`/api/crm/${resource}/${id}`);
      setDetail(result);setOwner(result.ownerId??"");
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
    }else if(resource==="people"){
      patch.email=String(form.get("email")??"").trim();
      patch.phone=String(form.get("phone")??"").trim();
      patch.title=String(form.get("title")??"").trim();
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
    {open&&<AccessibleDrawer title={detail?`${detail.nameZh} / ${detail.nameEn}`:t("crm.edit")} eyebrow={t("crm.editEyebrow")} description={t("crm.editHelp")} onClose={()=>setOpen(false)}>
      {loading&&!detail&&<p role="status">{t("common.loading")}</p>}
      {detail&&<form onSubmit={save}>
        <div className="form-grid two-column">
          <label className="field"><span>{t("products.nameZh")} *</span><input name="nameZh" defaultValue={detail.nameZh} required maxLength={120}/></label>
          <label className="field"><span>{t("products.nameEn")} *</span><input name="nameEn" defaultValue={detail.nameEn} required maxLength={160}/></label>
        </div>
        {resource==="schools"&&<div className="form-grid two-column">
          <label className="field"><span>{t("modules.city")} *</span><input name="city" defaultValue={detail.city} required maxLength={80}/></label>
          <label className="field"><span>{t("modules.curriculum")} *</span><input name="curriculum" defaultValue={detail.curriculum} required maxLength={120}/></label>
        </div>}
        {resource==="people"&&<>
          <label className="field"><span>{t("modules.title")}</span><input name="title" defaultValue={detail.title} maxLength={120}/></label>
          <div className="form-grid two-column">
            <label className="field"><span>{t("modules.email")}</span><input name="email" type="email" defaultValue={detail.email}/></label>
            <label className="field"><span>{t("modules.phone")}</span><input name="phone" defaultValue={detail.phone} maxLength={40}/></label>
          </div>
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
          <button className="secondary-button" type="button" onClick={()=>setOpen(false)}>{t("common.cancel")}</button>
          <button className="primary-button" type="submit" disabled={pending}><Save size={16}/>{pending?t("common.saving"):t("common.save")}</button>
        </div>
      </form>}
      {detail&&<section className="record-history">
        <div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.auditTrail")}</p><h3>{t("crm.history")}</h3></div><History size={19}/></div>
        {detail.history.map((item,index)=><article key={`${item.changedAt}-${index}`}><StatusBadge tone="blue">{t(`crm.audit.${item.action}`)}</StatusBadge><span><b>{item.actorName}</b><small>{formatDate(item.changedAt,{includeTime:true})}</small></span></article>)}
        {!detail.history.length&&<p className="select-empty">{t("crm.historyEmpty")}</p>}
      </section>}
    </AccessibleDrawer>}
    {archiveOpen&&<AccessibleDrawer title={t("common.confirmAction")} description={t("crm.archiveConfirm")} onClose={()=>setArchiveOpen(false)}>
      <InlineMessage type="warning">{t("common.actionCannotUndo")}</InlineMessage>
      {error&&<InlineMessage type="error">{error}</InlineMessage>}
      <div className="drawer-actions"><button className="secondary-button" type="button" onClick={()=>setArchiveOpen(false)}>{t("common.cancel")}</button><button className="danger-button" type="button" disabled={pending} onClick={()=>void archive()}>{pending?t("common.processing"):t("crm.archive")}</button></div>
    </AccessibleDrawer>}
    {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
  </>;
}
