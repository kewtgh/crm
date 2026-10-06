"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {apiFetch} from "@/lib/api-client";
import type {EnrollmentPage} from "@/lib/enrollment-repository";
import {useI18n} from "./i18n-provider";
import {InlineMessage,Pagination} from "./ui";
import {EnrollmentStatus} from "./enrollment-detail";
import {EnrollmentEditor} from "./enrollment-editor";
import {useCapability} from "./app-user-context";
export function CohortParticipants({cohortId,cohortLabel}:{cohortId:string;cohortLabel?:string}){
 const {t,locale}=useI18n(),canManage=useCapability("education.manage");
 const [open,setOpen]=useState(false),[creating,setCreating]=useState(false),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10);
 const [data,setData]=useState<EnrollmentPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!open)return;const c=new AbortController();const timer=setTimeout(()=>{setLoading(true);setError(false);void apiFetch<EnrollmentPage>(`/api/enrollments?cohortId=${encodeURIComponent(cohortId)}&page=${page}&pageSize=${pageSize}`,{signal:c.signal}).then(value=>{if(!c.signal.aborted)setData(value);}).catch(()=>{if(!c.signal.aborted)setError(true);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});},0);return()=>{clearTimeout(timer);c.abort();};},[cohortId,open,page,pageSize,retry]);
 return <section><div className="page-actions"><button type="button" className="secondary-button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{t("experience.participants")}</button>{canManage&&<button type="button" className="primary-button" onClick={()=>setCreating(true)}>{t("flow.addEnrollment")}</button>}</div>
 {open&&<div aria-busy={loading}>{loading?<p role="status">{t("common.loading")}</p>:error?<InlineMessage type="error">{t("enrollments.loadFailed")}<button onClick={()=>setRetry(v=>v+1)}>{t("common.retry")}</button></InlineMessage>:data&&<><div className="detail-record-list">{data.items.map(row=><article key={row.id}><Link href={`/households?tab=students&focus=${row.student_id}`}>{(locale==="en"?row.student_name_en:row.student_name_zh)||row.student_name_zh||row.student_name_en}</Link><EnrollmentStatus status={row.status}/></article>)}</div>{!data.items.length&&<p>{t("enrollments.empty")}</p>}<Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/pageSize))} total={data.total} pageSize={pageSize} onPage={setPage} onPageSize={value=>{setPageSize(value);setPage(1);}}/></>}</div>}
 {creating&&<EnrollmentEditor cohortId={cohortId} cohortLabel={cohortLabel} onClose={()=>setCreating(false)} onSaved={async()=>{setCreating(false);setOpen(true);setRetry(v=>v+1);}}/>}</section>;
}
