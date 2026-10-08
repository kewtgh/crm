"use client";
import {WorkspaceHeading} from "./workspace-heading";

import Link from "next/link";
import {useEffect,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {attentionDomains,attentionReasons,attentionFiltersSchema,type AttentionFilters,type AttentionPage,type AttentionRow} from "@/lib/management-attention-contract";
import {formatChannelCommissionAmount} from "@/lib/channel-analytics-input";
import {useI18n} from "./i18n-provider";
import {EnrollmentRelation} from "./enrollment-relation";
import {InlineMessage,Pagination} from "./ui";
const domainKey=(domain:string)=>domain==="STUDENT_SUCCESS"?"studentSuccess":domain==="DATA_QUALITY"?"quality":domain.toLowerCase();
export function ManagementAttentionWorkspace({initialFilters={}}:{initialFilters?:AttentionFilters}){
 const {t,locale}=useI18n(),[filters,setFilters]=useState(()=>attentionFiltersSchema.parse(initialFilters)),[stored,setStored]=useState<{query:string;data:AttentionPage}|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const query=new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])).toString(),data=stored?.query===query?stored.data:null;
 useEffect(()=>{const controller=new AbortController();void apiFetch<AttentionPage>(`/api/management/attention?${query}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setStored({query,data:result});setFailed(false);}}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});return()=>controller.abort();},[query,retry]);
 const change=(patch:Partial<typeof filters>)=>setFilters(old=>({...old,...patch,page:1}));
 const value=(item:AttentionRow,key:string,v:unknown)=>{
  if(v===null)return key==="lastCheckinAt"?t("management.queue.noCheckin"):"—";
  if(key==="health")return t(`success.health.${v}`);
  if(key==="milestoneType")return t(`milestones.type.${v}`);
  if(key==="riskType")return t(`successOps.riskType.${v}`);
  if(key==="sourceSeverity")return t(`quality.severity.${String(v).toLowerCase()}`);
  if(key==="status"){const prefix=item.context.kind==="RISK"?"successOps.riskStatus":item.context.kind==="CASE"?"success.status":item.context.kind==="MILESTONE"?"milestones.status":item.context.kind==="WORKFLOW"?"workflow.status":item.context.kind==="QUALITY"?"management.queue.qualityStatus":"management.status";return t(`${prefix}.${v}`);}
  return String(v);
 };
 return <div className="page-stack"><header className="page-heading-row"><div><WorkspaceHeading>{t("management.queue.title")}</WorkspaceHeading><p>{t("management.queue.help")}</p></div><Link href="/reports/executive">{t("management.queue.overview")}</Link></header>
 <section className="surface page-stack"><div className="detail-actions" style={{display:"flex",flexWrap:"wrap",gap:8}}>{[undefined,...attentionDomains].map(domain=><button className={filters.domain===domain?"primary-button":"secondary-button"} key={domain??"ALL"} onClick={()=>change({domain,reason:undefined})}>{domain?t(`management.section.${domainKey(domain)}`):t("common.all")}</button>)}</div><div className="form-grid two-column">
 <label className="field"><span>{t("management.queue.reason")}</span><select value={filters.reason??""} onChange={e=>change({reason:e.target.value?e.target.value as typeof filters.reason:undefined})}><option value="">{t("common.all")}</option>{attentionReasons.map(reason=><option key={reason} value={reason}>{t(`management.reason.${reason}`)}</option>)}</select></label>
 <label className="field"><span>{t("management.queue.severity")}</span><select value={filters.presentationSeverity??""} onChange={e=>change({presentationSeverity:e.target.value?e.target.value as typeof filters.presentationSeverity:undefined})}><option value="">{t("common.all")}</option>{["ATTENTION","CRITICAL"].map(v=><option key={v} value={v}>{t(`management.severity.${v}`)}</option>)}</select></label>
 <label className="field"><span>{t("management.queue.sort")}</span><select value={filters.sort} onChange={e=>change({sort:e.target.value as typeof filters.sort})}>{["PRIORITY","OLDEST","NEWEST"].map(v=><option key={v} value={v}>{t(`management.queue.sort.${v}`)}</option>)}</select></label>
 <EnrollmentRelation type="PRODUCT" value={filters.productId??""} label={t("products.product")} onChange={v=>change({productId:v||undefined,cohortId:undefined})}/><EnrollmentRelation type="COHORT" value={filters.cohortId??""} label={t("enrollments.cohort")} onChange={v=>change({cohortId:v||undefined})}/></div><p>{t("management.queue.filterHelp")}</p></section>
 {failed?<InlineMessage type="error">{t("management.queue.failed")} <button className="secondary-button" onClick={()=>setRetry(n=>n+1)}>{t("common.retry")}</button></InlineMessage>:!data?<p role="status">{t("common.loading")}</p>:<><section className="surface page-stack"><p>{t("management.current")} · {data.asOf} · {data.timezone}</p><dl className="customer-profile"><div><dt>{t("management.queue.total")}</dt><dd data-attention-total>{data.total}</dd></div>{["CRITICAL","ATTENTION"].map(v=><div key={v}><dt>{t(`management.severity.${v}`)}</dt><dd>{data.summary.bySeverity[v]??0}</dd></div>)}{Object.entries(data.summary.byDomain).map(([domain,n])=><div key={domain}><dt>{t(`management.section.${domainKey(domain)}`)}</dt><dd>{n}</dd></div>)}{Object.entries(data.summary.byReason).map(([reason,n])=><div key={reason}><dt>{t(`management.reason.${reason}`)}</dt><dd>{n}</dd></div>)}</dl></section>
 <div className="page-stack">{data.items.map(item=><article className="surface page-stack" key={item.attentionKey} data-attention-key={item.attentionKey} style={{overflowWrap:"anywhere"}}><div><b>{t(`management.severity.${item.presentationSeverity}`)} · {t(`management.reason.${item.reasonCode}`)}</b><p>{t(`management.section.${domainKey(item.sourceDomain)}`)} · {item.canonicalReference}</p></div><dl className="customer-profile"><div><dt>{t("management.queue.sourceDate")}</dt><dd>{item.sourceDate??"—"}</dd></div>{item.dueDate&&<div><dt>{t("management.queue.dueDate")}</dt><dd>{item.dueDate}</dd></div>}{Object.entries(item.context).filter(([key])=>!["kind","currency","moneyVisible","outstandingAmount"].includes(key)).map(([key,v])=><div key={key}><dt>{t(`management.context.${key}`)}</dt><dd>{value(item,key,v)}</dd></div>)}{item.context.kind==="FINANCE"&&<div><dt>{t("management.context.outstandingAmount")}</dt><dd>{item.context.moneyVisible&&item.context.currency&&item.context.outstandingAmount!==null?`${item.context.currency} ${formatChannelCommissionAmount(item.context.outstandingAmount,locale)}`:t("management.restricted")}</dd></div>}</dl><Link href={item.canonicalRoute} data-open-source={item.reasonCode}>{t("management.openSource")}</Link></article>)}</div>
 {!data.items.length&&<p className="surface">{t("management.queue.empty")}</p>}<Pagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} onPage={page=>setFilters(old=>({...old,page}))} onPageSize={pageSize=>change({pageSize})}/></>}
 </div>;
}
