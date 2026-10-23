"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {Download,FileSpreadsheet,RefreshCw} from "lucide-react";
import {WorkspaceHeading} from "./workspace-heading";
import {EmptyState} from "./data-state";
import {useI18n} from "./i18n-provider";
import {InlineMessage,Pagination,SearchField,StatusBadge} from "./ui";
import {useUserPreferences} from "./user-preferences-context";
import type {GeneratedJob,GeneratedJobPage} from "@/lib/generated-jobs-repository";
import {apiFetch} from "@/lib/api-client";
import {canDownloadExport,effectiveExportStatus,exportStatuses} from "@/lib/export-job-state";

const tones:Record<GeneratedJob["status"],string>={QUEUED:"amber",PROCESSING:"blue",READY:"green",FAILED:"red",EXPIRED:"gray"};
export function ExportsPage({initialPage}:{initialPage:GeneratedJobPage}){
 const {t}=useI18n(),{formatDate}=useUserPreferences();
 const [result,setResult]=useState(initialPage),[page,setPage]=useState(initialPage.page),[pageSize,setPageSize]=useState(initialPage.pageSize),[query,setQuery]=useState(""),[status,setStatus]=useState("all");
 const [loadedKey,setLoadedKey]=useState(`all||${initialPage.page}|${initialPage.pageSize}`),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const [now,setNow]=useState(()=>Date.now()),sequence=useRef(0),controller=useRef<AbortController|null>(null);
 const cancelRead=useCallback(()=>{sequence.current++;controller.current?.abort();},[]);
 const desiredKey=`${status}|${query}|${page}|${pageSize}`,current=desiredKey===loadedKey;
 const load=useCallback(async(nextPage:number)=>{
  const id=++sequence.current;controller.current?.abort();const active=new AbortController();controller.current=active;setLoading(true);setError("");
  const fetchPage=(value:number)=>apiFetch<GeneratedJobPage>(`/api/exports?${new URLSearchParams({q:query,status,page:String(value),pageSize:String(pageSize)})}`,{signal:active.signal});
  try{
   let data=await fetchPage(nextPage);if(id!==sequence.current||active.signal.aborted)return;
   const last=Math.max(1,Math.ceil(data.total/pageSize));
   if(nextPage>last){nextPage=last;data=await fetchPage(nextPage);if(id!==sequence.current||active.signal.aborted)return;}
   setResult(data);setPage(nextPage);setLoadedKey(`${status}|${query}|${nextPage}|${pageSize}`);setNow(Date.now());
  }catch{if(id===sequence.current&&!active.signal.aborted)setError(t("exportRecovery.stale"));}
  finally{if(id===sequence.current&&!active.signal.aborted)setLoading(false);}
 },[pageSize,query,status,t]);
 useEffect(()=>{if(current)return;const timer=window.setTimeout(()=>void load(page),query?250:0);return()=>{window.clearTimeout(timer);cancelRead();};},[cancelRead,current,load,page,query]);
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[]);
 const pages=Math.max(1,Math.ceil(result.total/pageSize));
 return <div className="page-stack exports-page"><section className="page-heading-row"><div><p className="eyebrow">{t("exports.eyebrow")}</p><WorkspaceHeading>{t("exports.title")}</WorkspaceHeading><p>{t("exports.description")}</p></div><button className="secondary-button" type="button" disabled={loading} onClick={()=>void load(page)}><RefreshCw size={16}/>{t("exportRecovery.refresh")}</button></section>
  <section className="surface export-list" aria-busy={loading||!current&&!error}><div className="table-toolbar"><SearchField value={query} onChange={value=>{setQuery(value);setPage(1);}} placeholder={t("exports.search")}/><label className="compact-select"><span>{t("common.status")}</span><select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="all">{t("common.all")}</option>{exportStatuses.map(value=><option value={value} key={value}>{t(`exports.status.${value.toLowerCase()}`)}</option>)}</select></label></div>
   {error&&<InlineMessage type="error">{error}</InlineMessage>}{(loading||!current)&&!error&&<p role="status">{t("exportRecovery.loading")}</p>}
   {result.items.length?<div className="export-job-list">{result.items.map(item=>{const effective=effectiveExportStatus(item,now),download=canDownloadExport(item,now)&&current&&!loading&&!error;return <article key={item.id}><span className="product-icon"><FileSpreadsheet size={19}/></span><div><b>{t(`exports.type.${item.type.toLowerCase()}`)}</b><small>{item.format} · {item.id.slice(0,8)} · {t("exports.requestedAt",{date:formatDate(item.createdAt,{includeTime:true})})}</small>{item.expiresAt&&<small>{t("exports.expiresAt",{date:formatDate(item.expiresAt,{includeTime:true})})}</small>}{item.errorMessage&&<small className="field-error">{t("exports.failedHelp")}</small>}</div><StatusBadge tone={tones[effective]}>{t(`exports.status.${effective.toLowerCase()}`)}</StatusBadge>{download?<a className="secondary-button" href={`/api/exports/${item.id}`}><Download size={16}/>{t("exports.download")}</a>:<button className="secondary-button" type="button" disabled>{t(effective==="EXPIRED"?"exports.status.expired":"exports.notReady")}</button>}</article>;})}</div>:!loading&&!error&&current?<EmptyState messageKey={query||status!=="all"?"exportRecovery.emptyFiltered":"exports.empty"}/>:null}
   <Pagination page={Math.min(page,pages)} totalPages={pages} total={result.total} pageSize={pageSize} onPage={value=>{if(!loading)setPage(value);}} onPageSize={value=>{if(!loading){setPageSize(value);setPage(1);}}}/>
  </section><InlineMessage type="warning">{t("exports.securityNote")}</InlineMessage>
 </div>;
}
