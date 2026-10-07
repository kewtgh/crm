"use client";
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { deletionResources, type DeletionItem, type DeletionKind } from "@/lib/record-deletion-contract";
import { AccessibleDrawer, InlineMessage } from "./ui";
import { useI18n } from "./i18n-provider";

export function RecordDeleteAction({kind,id,label,onDeleted}:{kind:DeletionKind;id:string;label?:string;onDeleted:()=>void|Promise<unknown>}) {
  const {t}=useI18n();
  const [open,setOpen]=useState(false),[item,setItem]=useState<DeletionItem|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(""),[uncertain,setUncertain]=useState(false),[saved,setSaved]=useState(false);
  const attempt=useRef<Record<string,unknown>|null>(null);
  const begin=async()=>{setOpen(true);setPending(true);setItem(null);setError("");setSaved(false);try{const result=await apiFetch<{items:DeletionItem[]}>(`/api/record-deletions?kind=${kind}&q=${id}`);const record=result.items.find(row=>row.id===id);if(!record)throw new Error("Unavailable");setItem(record);}catch{setError(t("repair.deleteLoadFailed"));}finally{setPending(false);}};
  const remove=async()=>{if(!item||pending||saved)return;attempt.current??={kind,id,expectedRevision:item.revision,expectedUpdatedAt:item.updatedAt,requestKey:crypto.randomUUID()};setPending(true);setError("");try{await apiFetch("/api/record-deletions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(attempt.current)});}catch(caught){if(caught instanceof ApiClientError&&caught.status<500){attempt.current=null;setUncertain(false);setError(t(caught.status===409?"crm.conflict":caught.status===422?"repair.deleteReferenced":"repair.deleteForbidden"));}else{setUncertain(true);setError(t("pool.uncertain"));}setPending(false);return;}
    setSaved(true);setUncertain(false);attempt.current=null;
    try{await onDeleted();setOpen(false);}catch{setError(t("audit.savedRefreshFailed"));}finally{setPending(false);}
  };
  return <><button type="button" className="text-button destructive-action" aria-label={`${t("repair.delete")} ${label || t(deletionResources.find(resource=>resource.kind===kind)!.label)}`} onClick={()=>void begin()}><Trash2 size={15}/>{t("repair.delete")}</button>{open&&<AccessibleDrawer title={t("repair.delete")} pending={pending||uncertain} onClose={()=>setOpen(false)}>{item&&<p><b>{item.label}</b></p>}<p>{t("repair.recoverable")}</p>{item?.blockedReason&&<InlineMessage type="warning">{t(item.blockedReason==="PROTECTED_STATE"?"repair.deleteProtected":"repair.deleteReferenced")}</InlineMessage>}{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" disabled={pending||uncertain} onClick={()=>setOpen(false)}>{t("common.cancel")}</button>{!saved&&item?.canDelete&&!item.blockedReason&&<button type="button" className="danger-button" disabled={pending} onClick={()=>void remove()}>{t(uncertain?"business.retrySame":"repair.delete")}</button>}</div></AccessibleDrawer>}</>;
}
