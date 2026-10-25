"use client";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import {BadgeCheck,FileCheck2,RefreshCw,ShieldCheck,X} from "lucide-react";
import {WorkspaceHeading} from "./workspace-heading";
import {AccessibleDrawer,InlineMessage,Pagination,SearchField,StatusBadge} from "./ui";
import {useAppUser,useCapability} from "./app-user-context";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {useApprovalWorkspace} from "@/hooks/use-approval-workspace";
import {approvalDefaults,approvalDisplayStatus,approvalStatuses,approvalTypes,readApprovalQuery,writeApprovalQuery,type ApprovalPage,type ApprovalQuery,type ApprovalRecord} from "@/lib/approval-contract";

export function ApprovalCenterPage({initialPage,initialQuery=approvalDefaults}:{initialPage:ApprovalPage|null;initialQuery?:ApprovalQuery}){
 const {t}=useI18n(),{formatDate}=useUserPreferences(),user=useAppUser(),canOpenRevenue=useCapability("revenue.recognition.view");
 const router=useRouter(),pathname=usePathname(),params=useSearchParams(),search=params.toString();
 const query=useMemo(()=>readApprovalQuery(new URLSearchParams(search)),[search]);
 const location=useRef({pathname,search,query});useLayoutEffect(()=>{location.current={pathname,search,query};},[pathname,search,query]);
 const navigate=useCallback((next:ApprovalQuery,replace=false)=>{
  const here=location.current,value=writeApprovalQuery(new URLSearchParams(here.search),next).toString();
  (replace?router.replace:router.push)(here.pathname+(value?"?"+value:""),{scroll:false});
 },[router]);
 const correctQuery=useCallback((next:ApprovalQuery)=>navigate(next,true),[navigate]);
 const state=useApprovalWorkspace(initialPage,initialQuery,query,user,correctQuery);
 const [selected,setSelected]=useState<ApprovalRecord|null>(null),[comment,setComment]=useState(""),[now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[]);
 const change=(patch:Partial<ApprovalQuery>,replace=false)=>{if(state.pending||state.uncertain)return;navigate({...query,...patch},replace);setSelected(null);setComment("");};
 const decide=async(decision?:"APPROVED"|"REJECTED")=>{
  const result=await state.decide(decision?selected??undefined:undefined,decision,comment);
  if(result){setSelected(null);setComment("");}
 };
 const filterFailed=()=>change({...approvalDefaults,status:"all",execution:"FAILED",pageSize:query.pageSize});
 const filtered=query.q||query.type!=="all"||query.status!=="pending"||query.scope!=="all"||query.execution!=="all";
 const pages=Math.max(1,Math.ceil(state.data.total/query.pageSize)),selectedCurrent=selected&&state.canDecide(selected);
 const metric=(key:"pending"|"approved"|"rejected"|"expired"|"cancelled"|"failedExecution",label:string)=><div key={key}><b>{state.current?state.data.summary[key]:"—"}</b><small>{t(label)}</small></div>;
 return <div className="page-stack approval-workspace" aria-busy={state.loading||state.pending} data-approval-current={state.current}>
  <section className="page-heading-row"><div><p className="eyebrow">{t("approval.eyebrow")}</p><WorkspaceHeading>{t(["ADMIN","SUPER_ADMIN"].includes(user.role)?"approval.title":"nav.personalApprovals")}</WorkspaceHeading><p>{t("approvalReview.description")}</p></div><button className="secondary-button" type="button" disabled={state.loading||state.pending||state.uncertain} onClick={state.refresh}><RefreshCw size={16}/>{t("approvalReview.refresh")}</button></section>
  <InlineMessage type="info"><ShieldCheck size={17}/>{t("approvalReview.policy")}</InlineMessage>
  <section className="surface approval-metrics" aria-label={t("approvalReview.summary")}>{metric("pending","approval.pending")}{metric("approved","approval.approved")}{metric("rejected","approval.rejected")}{metric("expired","approvalReview.status.expired")}{metric("cancelled","approvalReview.status.cancelled")}<button type="button" disabled={state.pending||state.uncertain} onClick={filterFailed}>{metric("failedExecution","approvalReview.failedActions")}</button></section>
  <p className="approval-snapshot-help">{t("approvalReview.summaryHelp")}{state.current?` · ${t("approvalReview.asOf",{date:formatDate(state.data.asOf,{includeTime:true})})}`:""}</p>
  {state.readError&&<InlineMessage type="error">{state.readError}</InlineMessage>}
  {state.error&&!selected&&<InlineMessage type={state.uncertain?"warning":"error"}>{state.uncertain?t("approvalReview.uncertain"):state.error}</InlineMessage>}
  {state.accepted&&<InlineMessage type={state.accepted.executionStatus==="FAILED"?"warning":"info"}>{t(state.accepted.executionStatus==="FAILED"?"approvalReview.executionFailed":state.accepted.status==="approved"?"approvalReview.approved":"approvalReview.rejected")}</InlineMessage>}
  {state.accepted?.executionStatus==="FAILED"&&<button className="secondary-button approval-history-link" type="button" onClick={filterFailed}>{t("approvalReview.openFailures")}</button>}
  {state.refreshOnly&&<InlineMessage type="warning">{t("approvalReview.refreshOnly")}</InlineMessage>}
  <section className="surface approval-list">
   <fieldset className="approval-filters" disabled={state.pending||state.uncertain}>
    <SearchField value={query.q} onChange={value=>change({q:value.slice(0,100),page:1},true)} placeholder={t("approval.search")}/>
    <label className="field"><span>{t("approval.type")}</span><select value={query.type} onChange={event=>change({type:event.target.value as ApprovalQuery["type"],page:1})}><option value="all">{t("common.all")}</option>{approvalTypes.map(type=><option value={type} key={type}>{t(`approval.type.${type}`)}</option>)}</select></label>
    <label className="field"><span>{t("common.status")}</span><select value={query.status} onChange={event=>change({status:event.target.value as ApprovalQuery["status"],page:1})}><option value="all">{t("common.all")}</option>{approvalStatuses.map(status=><option key={status} value={status}>{t(status==="cancelled"||status==="expired"?`approvalReview.status.${status}`:`approval.status.${status}`)}</option>)}</select></label>
    <label className="field"><span>{t("approvalReview.scope")}</span><select value={query.scope} onChange={event=>change({scope:event.target.value as ApprovalQuery["scope"],page:1})}>{["all","mine","reviewable"].map(scope=><option value={scope} key={scope}>{t(`approvalReview.scope.${scope}`)}</option>)}</select></label>
    <label className="field"><span>{t("approvalReview.execution")}</span><select value={query.execution} onChange={event=>change({execution:event.target.value as ApprovalQuery["execution"],page:1})}><option value="all">{t("common.all")}</option>{["NOT_STARTED","SUCCEEDED","FAILED"].map(value=><option key={value} value={value}>{t(`approvalReview.execution.${value}`)}</option>)}</select></label>
    {filtered&&<button className="secondary-button" type="button" onClick={()=>change({...approvalDefaults,pageSize:query.pageSize})}>{t("approvalReview.reset")}</button>}
   </fieldset>
   {(state.loading||!state.current)&&!state.readError&&<p role="status">{t("common.loading")}</p>}
   <div className="approval-records">{state.data.items.map(item=>{
    const status=approvalDisplayStatus(item,now),domain=item.requestType.startsWith("REVENUE_"),canReview=state.canDecide(item);
    return <article className="approval-record" key={item.id} data-approval-id={item.id}>
     <div className="approval-record-main"><h2><FileCheck2 size={19}/>{t(`approval.type.${item.type}`)}</h2><b>{item.requestNumber}</b><small>{item.object}</small>{item.type==="other"&&<small>{item.requestType}</small>}<p>{item.reason}</p>{item.decisionReason&&<p className="approval-decision-note">{t("approvalReview.decisionNote")}: {item.decisionReason}</p>}</div>
     <dl className="approval-metadata"><div><dt>{t("approval.requester")}</dt><dd>{item.requester}</dd></div><div><dt>{t("approvalReview.submitted")}</dt><dd>{formatDate(item.submitted,{includeTime:true})}</dd></div><div><dt>{t("approvalReview.expires")}</dt><dd>{formatDate(item.expiresAt,{includeTime:true})}</dd></div><div><dt>{t("approval.level")}</dt><dd>{t(`approval.level.${item.level}`)}</dd></div>{item.decidedAt&&<div><dt>{t("approvalReview.decidedAt")}</dt><dd>{formatDate(item.decidedAt,{includeTime:true})}</dd></div>}</dl>
     <div className="approval-record-actions"><StatusBadge tone={status==="pending"?"amber":status==="approved"?"green":status==="rejected"?"red":"gray"}>{t(status==="cancelled"||status==="expired"?`approvalReview.status.${status}`:`approval.status.${status}`)}</StatusBadge>{status!=="pending"&&<StatusBadge tone={item.executionStatus==="FAILED"?"red":"gray"}>{t(`approvalReview.execution.${item.executionStatus}`)}</StatusBadge>}
      {item.canDecide&&<button type="button" className="secondary-button" disabled={!canReview} onClick={()=>{state.clearFeedback();setSelected({...item});setComment("");}}>{t("approval.review")}</button>}
      {domain&&<><small>{t("approvalReview.domainHelp")}</small>{canOpenRevenue&&<Link className="secondary-button" href="/finance/revenue">{t("approvalReview.openRevenue")}</Link>}</>}
     </div>
    </article>;
   })}</div>
   {!state.data.items.length&&state.current&&!state.loading&&!state.readError&&<div className="empty-state"><span>{t("approval.empty")}</span></div>}
   {state.current&&<fieldset className="approval-pagination" disabled={state.loading||state.pending||state.uncertain}><Pagination page={Math.min(state.data.page,pages)} totalPages={pages} total={state.data.total} pageSize={query.pageSize} onPage={page=>change({page})} onPageSize={pageSize=>change({pageSize,page:1})}/></fieldset>}
  </section>
  {selected&&<AccessibleDrawer pending={state.pending||state.uncertain} guardChanges dirty={state.pending||state.uncertain||Boolean(comment)} title={t("approval.review")} description={selected.requestNumber} onClose={()=>setSelected(null)}>
   <div className="approval-review-context"><b>{t(`approval.type.${selected.type}`)}</b><p>{selected.object}</p><p>{selected.reason}</p><small>{t("approvalReview.expires")}: {formatDate(selected.expiresAt,{includeTime:true})}</small></div>
   <label className="field"><span>{t("approvalReview.comment")}</span><textarea name="comment" rows={4} maxLength={1000} value={comment} disabled={state.pending||state.uncertain||!selectedCurrent} onChange={event=>setComment(event.target.value)} placeholder={t("approval.rejectPlaceholder")}/></label>
   {state.error&&<InlineMessage type={state.uncertain?"warning":"error"}>{state.uncertain?t("approvalReview.uncertain"):state.error}</InlineMessage>}
   {!selectedCurrent&&!state.pending&&!state.uncertain&&<InlineMessage type="warning">{t("approvalReview.reload")}</InlineMessage>}
   {state.readError&&<button className="secondary-button" type="button" disabled={state.loading} onClick={state.refresh}>{t("approvalReview.refresh")}</button>}
   <div className="drawer-actions"><button type="button" className="secondary-button" data-drawer-dismiss disabled={state.pending||state.uncertain}>{t("common.cancel")}</button>{state.uncertain?<button className="primary-button" type="button" disabled={state.pending} onClick={()=>void decide()}>{t("approvalReview.confirmOriginal")}</button>:<><button className="danger-button" type="button" disabled={!selectedCurrent} onClick={()=>void decide("REJECTED")}><X size={16}/>{t("approval.reject")}</button><button className="primary-button" type="button" disabled={!selectedCurrent} onClick={()=>void decide("APPROVED")}><BadgeCheck size={16}/>{t("approval.approve")}</button></>}</div>
  </AccessibleDrawer>}
 </div>;
}
