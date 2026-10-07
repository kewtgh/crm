"use client";
import {presentApiError} from "@/lib/api-error-presenter";
import {ReportScopeNotice} from "./report-scope-notice";
import type {ReportFilter} from "@/lib/management-trend-contract";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {apiFetch} from "@/lib/api-client";
import type {SuccessCase,SuccessPage} from "@/lib/student-success-repository";
import type {EnrollmentRecord} from "@/lib/enrollment-repository";
import {successStatuses,successHealth,successEnrollmentStatuses} from "@/lib/student-success-input";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {InlineMessage,Pagination} from "./ui";
import {DetailTabs} from "./detail-tabs";
import {DateInput} from "./structured-inputs";
import {EnrollmentRelation} from "./enrollment-relation";
import {SuccessCaseEditor} from "./student-success-editor";
import {SuccessCaseDetail} from "./student-success-detail";
import {SuccessOutcomeWorkspace} from "./student-success-outcome-workspace";
import {StudentSuccessAnalytics} from "./student-success-analytics";
function SuccessCasesWorkspace({initial,initialDetail,enrollment,create=false,initialReportFilter={}}:{initialView?:string;initialReportFilter?:ReportFilter;initial:SuccessPage|null;initialDetail?:SuccessCase|null;enrollment?:EnrollmentRecord|null;create?:boolean}){
 const {t,locale}=useI18n(),{formatDate}=useUserPreferences(),[data,setData]=useState(initial),[detail,setDetail]=useState(initialDetail??null),[editing,setEditing]=useState(create&&!!enrollment?.can_edit&&successEnrollmentStatuses.includes(enrollment.status as typeof successEnrollmentStatuses[number])),[error,setError]=useState(initial?"":t("success.loadFailed")),[loading,setLoading]=useState(false);
 const [filters,setFilters]=useState({status:"",health:"",productId:"",cohortId:"",ownerId:"",reviewFrom:"",reviewTo:"",page:1,pageSize:20});
 const params=new URLSearchParams(Object.entries({...filters,...initialReportFilter}).filter(([,value])=>value!=="").map(([key,value])=>[key,String(value)]));if(enrollment)params.set("enrollmentId",enrollment.id);const query=params.toString();
 const load=useCallback(async(signal?:AbortSignal)=>{setLoading(true);setError("");try{const result=await apiFetch<SuccessPage>(`/api/student-success?${query}`,{signal});if(!signal?.aborted)setData(result);}catch(error){if(!signal?.aborted)setError(presentApiError(error,t,"success.loadFailed").message);}finally{if(!signal?.aborted)setLoading(false);}},[query,t]);
 useEffect(()=>{const controller=new AbortController(),timer=setTimeout(()=>void load(controller.signal),0);return()=>{clearTimeout(timer);controller.abort();};},[load]);
 const open=async(id:string)=>{setError("");try{setDetail((await apiFetch<{item:SuccessCase}>(`/api/student-success/${id}`)).item);}catch(error){setError(presentApiError(error,t,"success.loadFailed").message);}};
 const saved=async(id:string)=>{setEditing(false);await load();await open(id);};
 const label=(zh?:string|null,en?:string|null)=>(locale==="en"?en:zh)||zh||en||"—";
 const filter=(key:string,value:string)=>setFilters(old=>({...old,[key]:value,page:1}));
 return <section className="page-stack"><ReportScopeNotice filter={initialReportFilter}/> <div className="surface-heading"><h1>{t("success.title")}</h1>{enrollment?.can_edit&&data?.items.length===0&&successEnrollmentStatuses.includes(enrollment.status as typeof successEnrollmentStatuses[number])&&<button className="primary-button" onClick={()=>setEditing(true)}>{t("success.start")}</button>}</div><p className="field-help">{t("success.listHelp")}</p>
 <div className="success-filters"><label className="field"><span>{t("success.caseStatus")}</span><select name="statusFilter" value={filters.status} onChange={event=>filter("status",event.target.value)}><option value="">{t("common.all")}</option>{successStatuses.map(value=><option key={value} value={value}>{t(`success.status.${value}`)}</option>)}</select></label><label className="field"><span>{t("success.health")}</span><select name="healthFilter" value={filters.health} onChange={event=>filter("health",event.target.value)}><option value="">{t("common.all")}</option>{successHealth.map(value=><option key={value} value={value}>{t(`success.health.${value}`)}</option>)}</select></label>
 <EnrollmentRelation type="PRODUCT" label={t("products.product")} value={filters.productId} onChange={value=>setFilters(old=>({...old,productId:value,cohortId:"",page:1}))}/><EnrollmentRelation type="COHORT" label={t("enrollments.cohort")} value={filters.cohortId} onChange={value=>filter("cohortId",value)}/><EnrollmentRelation type="USER" label={t("enrollments.owner")} value={filters.ownerId} onChange={value=>filter("ownerId",value)}/>
 <label className="field"><span>{t("success.reviewFrom")}</span><DateInput name="reviewFrom" value={filters.reviewFrom} onChange={event=>filter("reviewFrom",event.target.value)}/></label><label className="field"><span>{t("success.reviewTo")}</span><DateInput name="reviewTo" value={filters.reviewTo} onChange={event=>filter("reviewTo",event.target.value)}/></label></div>
 {error&&<InlineMessage type="error">{error}<button className="secondary-button" onClick={()=>void load()}>{t("common.retry")}</button></InlineMessage>}{loading&&<p role="status">{t("common.loading")}</p>}
 {!loading&&!error&&!data?.items.length&&<p className="detail-empty">{t("success.empty")}</p>}
 <div className="success-cards">{!error&&data?.items.map(item=><article className="settings-subform" key={item.id}><div className="surface-heading"><button className="text-button" onClick={()=>void open(item.id)}>{label(item.student_name_zh,item.student_name_en)}</button><span>{t(`success.status.${item.status}`)}</span></div><p>{label(item.product_name_zh,item.product_name_en)} · {label(item.cohort_name_zh,item.cohort_name_en)}</p><dl className="enrollment-summary"><div><dt>{t("success.health")}</dt><dd>{t(`success.health.${item.health_status}`)}</dd></div><div><dt>{t("enrollments.owner")}</dt><dd>{label(item.owner_name_zh,item.owner_name_en)}</dd></div><div><dt>{t("success.nextReview")}</dt><dd>{item.next_review_on?formatDate(item.next_review_on):"—"}</dd></div><div><dt>{t("success.activeGoals")}</dt><dd>{item.active_goal_count}</dd></div><div><dt>{t("success.openTasks")}</dt><dd>{item.open_task_count}</dd></div></dl></article>)}</div>
 {data&&<Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={page=>setFilters(old=>({...old,page}))} onPageSize={pageSize=>setFilters(old=>({...old,pageSize,page:1}))}/>}
 {detail&&!editing&&<SuccessCaseDetail record={detail} onClose={()=>setDetail(null)} onEdit={()=>setEditing(true)} onRefresh={()=>saved(detail.id)}/>}{editing&&(detail||enrollment)&&<SuccessCaseEditor key={detail?.id??enrollment?.id} record={detail??undefined} enrollment={enrollment??undefined} onClose={()=>setEditing(false)} onSaved={saved} onReload={()=>{setEditing(false);if(detail)void open(detail.id);}}/>}
 </section>;
}
export function EnrollmentSuccessSection({record}:{record:EnrollmentRecord}){
 const {t}=useI18n(),[data,setData]=useState<SuccessPage|null>(null),[error,setError]=useState(false),[reload,setReload]=useState(0);
 useEffect(()=>{const controller=new AbortController();void apiFetch<SuccessPage>(`/api/student-success?enrollmentId=${record.id}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setData(result);setError(false);}}).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[record.id,reload]);
 return <section className="detail-section"><h3>{t("success.title")}</h3>{error?<InlineMessage type="error">{t("success.loadFailed")}<button onClick={()=>setReload(value=>value+1)}>{t("common.retry")}</button></InlineMessage>:!data?<p role="status">{t("common.loading")}</p>:data.items[0]?<><p>{t(`success.status.${data.items[0].status}`)} · {t(`success.health.${data.items[0].health_status}`)}</p><Link className="secondary-button" href={`/student-success?focus=${data.items[0].id}`}>{t("success.viewCase")}</Link></>:<><p>{t("success.noCase")}</p>{record.can_edit&&successEnrollmentStatuses.includes(record.status as typeof successEnrollmentStatuses[number])&&<Link className="primary-button" href={`/student-success?enrollmentId=${record.id}&create=1`}>{t("success.start")}</Link>}</>}</section>;
}

export function StudentSuccessWorkspace(props:Parameters<typeof SuccessCasesWorkspace>[0]){const {t}=useI18n(),[tab,setTab]=useState(["outcomes","analytics"].includes(props.initialView??"")?props.initialView!:"cases");return <DetailTabs items={[{key:"cases",label:"ux.support.cases"},{key:"analytics",label:"successAnalytics.title"},{key:"outcomes",label:"successOutcome.title"}]} active={tab} onChange={setTab} label={t("success.title")}>{tab==="cases"?<SuccessCasesWorkspace {...props}/>:tab==="outcomes"?<SuccessOutcomeWorkspace filters={props.initialReportFilter??{}}/>:<StudentSuccessAnalytics initialFilters={props.initialReportFilter}/>}</DetailTabs>;}
