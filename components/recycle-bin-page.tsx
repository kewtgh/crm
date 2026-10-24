"use client";

import Link from "next/link";
import {useCallback,useState} from "react";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import {ArchiveRestore,Clock3,RefreshCw,Trash2} from "lucide-react";
import {WorkspaceHeading} from "./workspace-heading";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {AccessibleDrawer,InlineMessage,Pagination,SearchField,Toast} from "./ui";
import {deletionResources} from "@/lib/record-deletion-contract";
import {readRecycleQuery,writeRecycleQuery,recycleDefaults,restoredRecordHref,type RecyclePage,type RecycleQuery,type RecycleBinItem,type RecycleRestored} from "@/lib/recycle-contract";
import {useRecycleWorkspace} from "@/hooks/use-recycle-workspace";

export function RecycleBinPage({initial,initialQuery=recycleDefaults,personal=false}:{initial:RecyclePage|null;initialQuery?:RecycleQuery;personal?:boolean}){
 const {locale,t}=useI18n(),{formatDate}=useUserPreferences();
 const router=useRouter(),pathname=usePathname(),params=useSearchParams();
 const query=readRecycleQuery(new URLSearchParams(params.toString()));
 const correctQuery=useCallback((next:RecycleQuery)=>{
  const search=writeRecycleQuery(new URLSearchParams(window.location.search),next).toString();
  router.replace(search?pathname+"?"+search:pathname,{scroll:false});
 },[router,pathname]);
 const state=useRecycleWorkspace(initial,initialQuery,query,personal?"personal":"workspace",correctQuery);
 const [selected,setSelected]=useState<RecycleBinItem|null>(null),[restored,setRestored]=useState<RecycleRestored|null>(null);
 const change=(patch:Partial<RecycleQuery>,replace=false)=>{
  if(state.pending||state.uncertain)return;
  const next=writeRecycleQuery(new URLSearchParams(params.toString()),{...query,...patch}).toString();
  (replace?router.replace:router.push)(next?pathname+"?"+next:pathname,{scroll:false});setSelected(null);
 };
 const restore=async(retry=false)=>{const result=await state.restore(retry?undefined:selected??undefined);if(result){setSelected(null);setRestored(result);}};
 const filtered=Boolean(query.q||query.kind!=="all"||query.retention!=="all"),pages=Math.max(1,Math.ceil(state.data.total/query.pageSize));
 const href=restored?restoredRecordHref(restored):null;
 return <div className="page-stack recovery-page">
  <section className="page-heading-row"><div><p className="eyebrow">{t("recycle.eyebrow")}</p><WorkspaceHeading>{t(personal?"nav.personalRecycle":"recycle.title")}</WorkspaceHeading><p>{t("recovery.description")}</p></div><button type="button" className="secondary-button" disabled={state.loading||state.pending||state.uncertain} onClick={()=>void state.refresh()}><RefreshCw size={16}/>{t("recovery.refresh")}</button></section>
  <InlineMessage type="info"><Clock3 size={17}/>{t("recovery.retentionHelp")}</InlineMessage>
  {state.readError&&<InlineMessage type="error">{state.readError}</InlineMessage>}
  {state.error&&!selected&&<InlineMessage type="error">{state.error}</InlineMessage>}
  {state.refreshOnly&&<InlineMessage type="warning">{t("recovery.refreshOnly")}</InlineMessage>}
  {href&&<Link className="secondary-button recovery-record-link" href={href}>{t("recovery.openRecord")}</Link>}
  <section className="surface recycle-bin" aria-busy={state.loading||state.pending} data-recovery-current={state.current}>
   <div className="surface-heading"><div><p className="eyebrow">{t("recycle.itemsEyebrow")}</p><h2>{state.current?t("recovery.matches",{count:state.data.total}):t("recovery.unavailable")}</h2></div><Trash2 size={21}/></div>
   <fieldset className="recovery-filters" disabled={state.pending||state.uncertain}>
    <SearchField value={query.q} onChange={value=>change({q:value.slice(0,100),page:1},true)} placeholder={t("recovery.search")}/>
    <label className="field"><span>{t("recovery.kind")}</span><select value={query.kind} onChange={event=>change({kind:event.target.value as RecycleQuery["kind"],page:1})}><option value="all">{t("common.all")}</option>{deletionResources.map(resource=><option key={resource.kind} value={resource.kind}>{t(resource.label)}</option>)}</select></label>
    <label className="field"><span>{t("recovery.retention")}</span><select value={query.retention} onChange={event=>change({retention:event.target.value as RecycleQuery["retention"],page:1})}>{(["all","eligible","retained"] as const).map(value=><option key={value} value={value}>{t("recovery.retention."+value)}</option>)}</select></label>
    {filtered&&<button type="button" className="secondary-button" onClick={()=>change({...recycleDefaults,pageSize:query.pageSize})}>{t("recovery.reset")}</button>}
   </fieldset>
   {(state.loading||!state.current)&&!state.readError&&<p role="status">{t("recovery.reading")}</p>}
   <div className="recycle-list">{state.data.items.map(item=><article key={item.kind+":"+item.id} data-recycle-id={item.id}>
    <div><b>{locale==="zh-CN"?item.labelZh:item.labelEn}</b><small>{t(deletionResources.find(resource=>resource.kind===item.kind)!.label)} · {t("recycle.removedAt",{date:formatDate(item.deletedAt,{includeTime:true})})}</small><small>{item.purgeEligibleAt?t("recovery.eligibleAt",{date:formatDate(item.purgeEligibleAt,{includeTime:true})}):t("recovery.retained")}</small></div>
    <button type="button" className="secondary-button" disabled={state.locked} onClick={()=>{state.setToast("");setRestored(null);setSelected({...item});}}><ArchiveRestore size={16}/>{t("recycle.restore")}</button>
   </article>)}</div>
   {!state.data.items.length&&state.current&&!state.loading&&!state.readError&&<div className="empty-state"><ArchiveRestore size={25}/><span>{t(filtered?"recovery.emptyFiltered":"recycle.empty")}</span></div>}
   {state.current&&<Pagination page={Math.min(state.data.page,pages)} totalPages={pages} total={state.data.total} pageSize={query.pageSize} onPage={page=>{if(!state.loading&&!state.pending&&!state.uncertain)change({page});}} onPageSize={pageSize=>change({pageSize,page:1})}/>}
  </section>
  {selected&&<AccessibleDrawer pending={state.pending||state.uncertain} title={t("recycle.restoreTitle")} description={t("recycle.restoreConfirm",{name:locale==="zh-CN"?selected.labelZh:selected.labelEn})} onClose={()=>setSelected(null)}>
   <p>{t("recycle.removedAt",{date:formatDate(selected.deletedAt,{includeTime:true})})}</p>
   {state.error&&<InlineMessage type="error">{state.error}</InlineMessage>}
   <div className="drawer-actions"><button className="secondary-button" type="button" disabled={state.pending||state.uncertain} onClick={()=>setSelected(null)}>{t("common.cancel")}</button><button className="primary-button" type="button" disabled={state.uncertain?state.pending:state.locked} onClick={()=>void restore(state.uncertain)}><ArchiveRestore size={16}/>{t(state.uncertain?"business.retrySame":"recycle.restore")}</button></div>
  </AccessibleDrawer>}
  {state.toast&&<Toast message={state.toast} onClose={()=>state.setToast("")}/>}
 </div>;
}
