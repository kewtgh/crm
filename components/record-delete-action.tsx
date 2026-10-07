"use client";
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { isDefinitiveMutationFailure, settleMutation } from "@/lib/mutation-outcome";
import { deletionResources, type DeletionItem, type DeletionKind } from "@/lib/record-deletion-contract";
import { AccessibleDrawer, InlineMessage } from "./ui";
import { useI18n } from "./i18n-provider";

export function RecordDeleteAction({kind,id,label,onDeleted,menuItem=false}:{kind:DeletionKind;id:string;label?:string;onDeleted:()=>void|Promise<unknown>;menuItem?:boolean}) {
  const {t}=useI18n();
  const [open,setOpen]=useState(false),[item,setItem]=useState<DeletionItem|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(""),[uncertain,setUncertain]=useState(false),[saved,setSaved]=useState(false),[needsReload,setNeedsReload]=useState(false);
  const attempt=useRef<Record<string,unknown>|null>(null),busy=useRef(false),accepted=useRef(false);
  const load=async()=>{
    if(busy.current||attempt.current||accepted.current)return;
    busy.current=true;setPending(true);setItem(null);setError("");setNeedsReload(false);
    try{
      const result=await apiFetch<{items:DeletionItem[]}>(`/api/record-deletions?kind=${kind}&q=${id}`);
      const record=result.items.find(row=>row.id===id);
      if(!record||typeof record.label!=="string"||typeof record.canDelete!=="boolean")throw new Error("Unavailable");
      setItem(record);
    }catch{setNeedsReload(true);setError(t("repair.deleteLoadFailed"));}
    finally{busy.current=false;setPending(false);}
  };
  const begin=()=>{if(busy.current||uncertain)return;accepted.current=false;setSaved(false);setOpen(true);void load();};
  const refresh=async()=>{await onDeleted();setOpen(false);};
  const retryRefresh=async()=>{
    if(busy.current)return;
    busy.current=true;setPending(true);
    try{await refresh();}catch{setError(t("audit.savedRefreshFailed"));}finally{busy.current=false;setPending(false);}
  };
  const remove=async()=>{
    if(!item||!item.canDelete||item.blockedReason||busy.current||accepted.current||needsReload)return;
    attempt.current??={kind,id,expectedRevision:item.revision,expectedUpdatedAt:item.updatedAt,requestKey:crypto.randomUUID()};
    busy.current=true;setPending(true);setError("");const request=attempt.current;
    const outcome=await settleMutation(async()=>{
      await apiFetch("/api/record-deletions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)});
      accepted.current=true;setSaved(true);setUncertain(false);attempt.current=null;
    },refresh);
    if(outcome.state==="failed"){
      const caught=outcome.error;
      if(isDefinitiveMutationFailure(caught)){
        attempt.current=null;setUncertain(false);setNeedsReload(true);
        setError(t(caught.status===409?"crm.conflict":caught.status===422?"repair.deleteReferenced":"repair.deleteForbidden"));
      }else{setUncertain(true);setError(t("pool.uncertain"));}
    }else if(outcome.state==="saved-refresh-failed")setError(t("audit.savedRefreshFailed"));
    busy.current=false;setPending(false);
  };
  return <><button role={menuItem?"menuitem":undefined} type="button" className="text-button destructive-action" aria-label={`${t("repair.delete")} ${label || t(deletionResources.find(resource=>resource.kind===kind)!.label)}`} onClick={begin}><Trash2 size={15}/>{t("repair.delete")}</button>{open&&<AccessibleDrawer title={t("repair.delete")} pending={pending||uncertain} onClose={()=>setOpen(false)}>{item&&<p><b>{item.label}</b></p>}<p>{t("repair.recoverable")}</p>{pending&&!item&&<p role="status">{t("common.loading")}</p>}{item?.blockedReason&&<InlineMessage type="warning">{t(item.blockedReason==="PROTECTED_STATE"?"repair.deleteProtected":"repair.deleteReferenced")}</InlineMessage>}{error&&<InlineMessage type={saved?"warning":"error"}>{error}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" disabled={pending||uncertain} onClick={()=>setOpen(false)}>{t(saved?"common.close":"common.cancel")}</button>{saved?<button type="button" className="primary-button" disabled={pending} onClick={()=>void retryRefresh()}>{t("reliability.refreshOnly")}</button>:needsReload?<button type="button" className="primary-button" disabled={pending} onClick={()=>void load()}>{t("reliability.reloadReview")}</button>:item?.canDelete&&!item.blockedReason&&<button type="button" className="danger-button" disabled={pending} onClick={()=>void remove()}>{t(uncertain?"business.retrySame":"repair.delete")}</button>}</div></AccessibleDrawer>}</>;
}
