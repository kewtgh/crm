"use client";

import {useState} from "react";
import {ArchiveRestore,Clock3,Trash2} from "lucide-react";
import type {RecycleBinItem} from "@/lib/recycle-bin-repository";
import {apiFetch} from "@/lib/api-client";
import {useI18n} from "./i18n-provider";
import {ConfirmDialog,InlineMessage,Toast} from "./ui";

export function RecycleBinPage({initialItems}:{initialItems:RecycleBinItem[]}){
  const{locale,t}=useI18n();
  const[items,setItems]=useState(initialItems);
  const[selected,setSelected]=useState<RecycleBinItem|null>(null);
  const[pending,setPending]=useState(false);
  const[error,setError]=useState("");
  const[toast,setToast]=useState("");
  const restore=async()=>{if(!selected)return;setPending(true);setError("");try{await apiFetch("/api/recycle-bin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:selected.kind,id:selected.id})});setItems(value=>value.filter(item=>item.id!==selected.id||item.kind!==selected.kind));setSelected(null);setToast(t("recycle.restored"));}catch{setError(t("recycle.restoreFailed"));}finally{setPending(false);}};
  return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">{t("recycle.eyebrow")}</p><h1>{t("recycle.title")}</h1><p>{t("recycle.description")}</p></div></section><InlineMessage type="info"><Clock3 size={17}/>{t("recycle.retention")}</InlineMessage>{error&&<InlineMessage type="error">{error}</InlineMessage>}<section className="surface recycle-bin"><div className="surface-heading"><div><p className="eyebrow">{t("recycle.itemsEyebrow")}</p><h2>{t("recycle.items",{count:items.length})}</h2></div><Trash2 size={21}/></div><div className="recycle-list">{items.map(item=><article key={`${item.kind}:${item.id}`}><div><b>{locale==="zh-CN"?item.labelZh:item.labelEn}</b><small>{t(`recycle.kind.${item.kind.toLowerCase()}`)} · {t("recycle.removedAt",{date:new Date(item.deletedAt).toLocaleString(locale)})}</small><small>{t("recycle.expiresAt",{date:new Date(item.expiresAt).toLocaleDateString(locale)})}</small></div><button className="secondary-button" type="button" onClick={()=>setSelected(item)}><ArchiveRestore size={16}/>{t("recycle.restore")}</button></article>)}</div>{!items.length&&<div className="empty-state"><ArchiveRestore size={25}/><span>{t("recycle.empty")}</span></div>}</section>{selected&&<ConfirmDialog title={t("recycle.restoreTitle")} description={t("recycle.restoreConfirm",{name:locale==="zh-CN"?selected.labelZh:selected.labelEn})} confirmLabel={t("recycle.restore")} pending={pending} onClose={()=>setSelected(null)} onConfirm={()=>void restore()}/>} {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}</div>;
}
