"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {apiFetch} from "@/lib/api-client";
import type {EnrollmentPage} from "@/lib/enrollment-repository";
import {useI18n} from "./i18n-provider";
import {InlineMessage,Pagination} from "./ui";
import {EnrollmentStatus} from "./enrollment-detail";
export function CohortParticipants({cohortId}:{cohortId:string}){
 const {t,locale}=useI18n(),[open,setOpen]=useState(false),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10),[data,setData]=useState<EnrollmentPage|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!open)return;const c=new AbortController();void apiFetch<EnrollmentPage>(`/api/enrollments?cohortId=${cohortId}&page=${page}&pageSize=${pageSize}`,{signal:c.signal}).then(value=>{if(!c.signal.aborted){setData(value);setError(false);}}).catch(()=>{if(!c.signal.aborted)setError(true);});return()=>c.abort();},[cohortId,open,page,pageSize,retry]);
 return <section><button type="button" className="secondary-button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{t("experience.participants")}</button>{open&&<div>{error?<InlineMessage type="error">{t("enrollments.loadFailed")}<button onClick={()=>setRetry(v=>v+1)}>{t("common.retry")}</button></InlineMessage>:!data?<p role="status">{t("common.loading")}</p>:<><div className="detail-record-list">{data.items.map(row=><article key={row.id}><Link href={`/households?tab=students&focus=${row.student_id}`}>{locale==="en"?row.student_name_en:row.student_name_zh}</Link><EnrollmentStatus status={row.status}/></article>)}</div>{!data.items.length&&<p>{t("enrollments.empty")}</p>}<Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/pageSize))} total={data.total} pageSize={pageSize} onPage={setPage} onPageSize={value=>{setPageSize(value);setPage(1);}}/></>}</div>}</section>;
}
