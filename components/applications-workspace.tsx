"use client";
import {useCallback,useEffect,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";
import {applicationStatuses,applicationDecisions} from "@/lib/application-input";
import type {ApplicationPage,ApplicationRecord} from "@/lib/application-repository";
import type {EnrollmentRecord} from "@/lib/enrollment-repository";
import {useCapability} from "./app-user-context";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {InlineMessage,Pagination,SearchField} from "./ui";
import {DateInput} from "./structured-inputs";
import {EnrollmentRelation,type EnrollmentRelationType} from "./enrollment-relation";
import {ApplicationEditor} from "./application-editor";
import {ApplicationDetail,ApplicationStatus} from "./application-detail";
export function ApplicationsWorkspace({initial,initialDetail=null,enrollment=null,initialEnrollmentId="",create=false}:{initial:ApplicationPage|null;initialDetail?:ApplicationRecord|null;enrollment?:EnrollmentRecord|null;initialEnrollmentId?:string;create?:boolean}){
 const {t,locale}=useI18n(),{formatDate}=useUserPreferences(),canManage=useCapability("education.manage");
 const [data,setData]=useState<ApplicationPage>(initial??{items:[],page:1,pageSize:20,total:0}),[filters,setFilters]=useState<Record<string,string>>({enrollmentId:initialEnrollmentId}),[query,setQuery]=useState(""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(20),[loading,setLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [detail,setDetail]=useState(initialDetail),[editor,setEditor]=useState<{record?:ApplicationRecord}|null>(create&&enrollment?.can_edit&&canManage?{}:null);
 const load=useCallback(async(signal?:AbortSignal)=>{setLoading(true);setError("");const params=new URLSearchParams({page:String(page),pageSize:String(pageSize)});for(const [key,value] of Object.entries(filters))if(value)params.set(key,value);try{const result=await apiFetch<ApplicationPage>(`/api/applications?${params}`,{signal});if(!signal?.aborted)setData(result);}catch(error){if(!signal?.aborted)setError(presentApiError(error,t,"applications.loadFailed").message);}finally{if(!signal?.aborted)setLoading(false);}},[page,pageSize,filters,t]);
 useEffect(()=>{const controller=new AbortController(),timer=setTimeout(()=>void load(controller.signal),0);return()=>{clearTimeout(timer);controller.abort();};},[load]);
 const filter=(key:string,value:string)=>{setFilters(previous=>({...previous,[key]:value}));setPage(1);};
 const open=async(id:string)=>{try{const result=await apiFetch<{item:ApplicationRecord}>(`/api/applications?id=${id}`);setDetail(result.item);}catch(error){setError(presentApiError(error,t,"applications.loadFailed").message);}};
 const saved=async(id:string)=>{setEditor(null);setNotice(t("applications.saved"));try{const result=await apiFetch<{item:ApplicationRecord}>(`/api/applications?id=${id}`);setDetail(result.item);await load();}catch{setNotice(t("enrollments.savedRefreshFailed"));}};
 const label=(zh?:string|null,en?:string|null)=>(locale==="en"?en:zh)||zh||en||"—";
 const relations:Array<[string,EnrollmentRelationType,string]>=[["studentId","STUDENT","enrollments.student"],["productId","PRODUCT","products.product"],["cohortId","COHORT","enrollments.cohort"],["ownerId","USER","applications.owner"],["targetOrganizationId","ORGANIZATION","applications.target"]];
 return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">{t("education.eyebrow")}</p><h1>{t("applications.title")}</h1><p>{t("applications.description")}</p></div>{canManage&&<button className="primary-button" type="button" onClick={()=>{setEditor({});setNotice("");}}>{t("applications.create")}</button>}</section>
 {notice&&<InlineMessage type="success">{notice}</InlineMessage>}
 <section className="surface"><div className="table-toolbar"><SearchField value={query} onChange={setQuery} placeholder={t("applications.search")}/><button type="button" className="secondary-button" onClick={()=>filter("query",query)}>{t("common.search")}</button></div>
 <div className="form-grid two-column enrollment-filters">{relations.map(([key,type,title])=><EnrollmentRelation key={key} type={type} label={t(title)} value={filters[key]??""} onChange={value=>filter(key,value)}/>)}
 <label className="field"><span>{t("common.status")}</span><select name="statusFilter" value={filters.status??""} onChange={event=>filter("status",event.target.value)}><option value="">{t("common.all")}</option>{applicationStatuses.map(value=><option value={value} key={value}>{t(`applications.status.${value}`)}</option>)}</select></label>
 <label className="field"><span>{t("applications.decision")}</span><select name="decisionFilter" value={filters.decision??""} onChange={event=>filter("decision",event.target.value)}><option value="">{t("common.all")}</option>{applicationDecisions.map(value=><option value={value} key={value}>{t(`applications.decision.${value}`)}</option>)}</select></label>
 {(["deadlineFrom","deadlineTo"] as const).map(key=><label className="field" key={key}><span>{t(`applications.${key}`)}</span><DateInput name={key} value={filters[key]??""} onChange={event=>filter(key,event.target.value)}/></label>)}
 </div>{initialEnrollmentId&&<p className="field-help">{t("applications.enrollment")}: {enrollment?`${label(enrollment.student_name_zh,enrollment.student_name_en)} · ${label(enrollment.cohort_name_zh,enrollment.cohort_name_en)}`:t("applications.notFound")}</p>}
 {error&&<InlineMessage type="error">{error}<button type="button" className="secondary-button" onClick={()=>void load()}>{t("common.retry")}</button></InlineMessage>}{loading&&<p role="status">{t("common.loading")}</p>}{!error&&!loading&&!data.items.length&&<p className="detail-empty">{t("applications.empty")}</p>}
 <div className="detail-record-list enrollment-records">{!error&&data.items.map(row=><article key={row.id}><div><b>{label(row.student_name_zh,row.student_name_en)} · {label(row.target_name_zh,row.target_name_en)}</b><small>{label(row.product_name_zh,row.product_name_en)} · {label(row.cohort_name_zh,row.cohort_name_en)}</small><small>{t("applications.deadline")}: {row.deadline_on?formatDate(row.deadline_on):"—"} · {t("applications.owner")}: {label(row.owner_name_zh,row.owner_name_en)}</small><small>{t("applications.decision")}: {row.decision?t(`applications.decision.${row.decision}`):"—"}</small></div><div className="detail-actions"><ApplicationStatus status={row.status}/><button type="button" className="secondary-button" onClick={()=>void open(row.id)}>{t("common.details")}</button></div></article>)}</div>
 <Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={setPage} onPageSize={value=>{setPageSize(value);setPage(1);}}/></section>
 {detail&&!editor&&<ApplicationDetail key={detail.id} record={detail} onClose={()=>setDetail(null)} onEdit={()=>setEditor({record:detail})}/>}{editor&&<ApplicationEditor record={editor.record} enrollment={editor.record?undefined:enrollment} onClose={()=>setEditor(null)} onSaved={saved}/>}</div>;
}
