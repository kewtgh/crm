"use client";
import {WorkspaceHeading} from "./workspace-heading";

import {useCallback,useEffect,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {deletionResources,type DeletionItem,type DeletionKind} from "@/lib/record-deletion-contract";
import {hasCapability} from "@/lib/capabilities";
import {useAppUser} from "./app-user-context";
import {useI18n} from "./i18n-provider";
import {SearchFilterBar} from "./search-filter-bar";
import {InlineMessage,Pagination} from "./ui";
import {RecordDeleteAction} from "./record-delete-action";

export function RecordCleanupWorkspace(){
  const {t}=useI18n(),user=useAppUser(),resources=deletionResources.filter(resource=>hasCapability(user.role,resource.capability));
  const [kind,setKind]=useState<DeletionKind>(resources[0]?.kind??"ENROLLMENT"),[query,setQuery]=useState(""),[applied,setApplied]=useState(""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(20),[data,setData]=useState<{items:DeletionItem[];total:number}>({items:[],total:0}),[error,setError]=useState(""),[pending,setPending]=useState(false);
  const load=useCallback(async(signal?:AbortSignal)=>{await Promise.resolve();if(signal?.aborted)return;setPending(true);try{const result=await apiFetch<typeof data>(`/api/record-deletions?${new URLSearchParams({kind,q:applied,page:String(page),pageSize:String(pageSize)})}`,{signal});if(!signal?.aborted){setData(result);setError("");}}catch{if(!signal?.aborted)setError(t("repair.deleteLoadFailed"));}finally{if(!signal?.aborted)setPending(false);}},[kind,applied,page,pageSize,t]);
  useEffect(()=>{const controller=new AbortController(),timer=setTimeout(()=>void load(controller.signal),0);return()=>{clearTimeout(timer);controller.abort();};},[load]);
  return <div className="page-stack"><header className="page-heading-row"><div><WorkspaceHeading>{t("repair.cleanup")}</WorkspaceHeading><p>{t("repair.cleanupHelp")}</p></div></header><SearchFilterBar value={query} onChange={setQuery} onSearch={()=>{setApplied(query);setPage(1);}} pending={pending}><label className="field"><span>{t("repair.recordType")}</span><select value={kind} onChange={e=>{setKind(e.target.value as DeletionKind);setPage(1);setData({items:[],total:0});}}>{resources.map(resource=><option key={resource.kind} value={resource.kind}>{t(resource.label)}</option>)}</select></label></SearchFilterBar>{error&&<InlineMessage type="error">{error}<button className="secondary-button" onClick={()=>void load()}>{t("common.retry")}</button></InlineMessage>}<section className="surface" aria-busy={pending}><div className="detail-record-list">{data.items.map(item=><article key={item.id}><div><b>{item.label}</b>{item.blockedReason&&<small>{t(item.blockedReason==="PROTECTED_STATE"?"repair.deleteProtected":"repair.deleteReferenced")}</small>}</div>{item.canDelete&&<RecordDeleteAction kind={kind} id={item.id} label={item.label} onDeleted={()=>load()}/>}</article>)}</div>{!pending&&!data.items.length&&<p className="empty-state">{t("common.noData")}</p>}<Pagination page={page} totalPages={Math.max(1,Math.ceil(data.total/pageSize))} total={data.total} pageSize={pageSize} onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1);}}/></section></div>;
}
