"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, useRef } from "react";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import type { EnrollmentPage } from "@/lib/enrollment-repository";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { InlineMessage, Pagination } from "./ui";
import {EnrollmentEditor} from "./enrollment-editor";
import {useCapability} from "./app-user-context";
import { EnrollmentStatus } from "./enrollment-detail";
import { RecordIdentity } from "./record-header";
import { SectionHeader } from "./responsive-detail-layout";
import { UiIcon } from "./ui-icon";

export type StudentRelatedCount=number|"loading"|"restricted"|"unavailable";
export function StudentEnrollmentsSection({studentId,studentLabel,compact=false,onTotal}: {studentId: string;studentLabel?:string;compact?:boolean;onTotal?:(total:StudentRelatedCount)=>void}) {
  const canManage=useCapability("education.manage"),[creating,setCreating]=useState(false);
  const {t,locale} = useI18n(), {formatDate} = useUserPreferences();
  const [data,setData] = useState<EnrollmentPage>({items:[],total:0,page:1,pageSize:10}), [page,setPage] = useState(1), [pageSize,setPageSize] = useState(10), [error,setError] = useState(""), [loading,setLoading] = useState(true);
  const totalCallback=useRef(onTotal);
  useEffect(()=>{totalCallback.current=onTotal;},[onTotal]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);setError("");totalCallback.current?.("loading");
    try {const result = await apiFetch<EnrollmentPage>(`/api/enrollments?studentId=${studentId}&page=${page}&pageSize=${pageSize}`,{signal});if(!Array.isArray(result?.items)||typeof result.total!=="number"||result.items.some(row=>!row.id||!row.status))throw new Error("RECORD_RESPONSE_INVALID");if (!signal?.aborted){setData(result);totalCallback.current?.(result.total);}}
    catch (error) {if (!signal?.aborted){setError(presentApiError(error,t,"enrollments.loadFailed").message);totalCallback.current?.(error instanceof ApiClientError&&error.status===403?"restricted":"unavailable");}}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [studentId,page,pageSize,t]);
  useEffect(() => {const controller = new AbortController();const timer = setTimeout(() => void load(controller.signal),0);return () => {clearTimeout(timer);controller.abort();};}, [load]);
  const label = (zh?: string | null,en?: string | null) => (locale === "en" ? en : zh) || zh || en || "—";
  const actions=<>{canManage&&<button className="secondary-button" onClick={()=>setCreating(true)}>{t("flow.addEnrollment")}</button>}<Link className="text-button" href={`/enrollments?studentId=${studentId}`}>{t("enrollments.viewAll")}</Link></>;
  return <section className={compact?"detail-section workspace-participations":"settings-subform"} aria-label={t("enrollments.title")}>{compact?<SectionHeader icon={<UiIcon name="program"/>} title={t("enrollments.title")} action={actions}/>:<div className="surface-heading"><h3>{t("enrollments.title")}</h3>{actions}</div>}
    {error && <InlineMessage type="error">{error}<button type="button" className="secondary-button" onClick={() => void load()}>{t("common.retry")}</button></InlineMessage>}
    {loading && <p role="status">{t("common.loading")}</p>}
    {!loading && !error && !data.items.length && <p className="detail-empty">{t("enrollments.empty")}</p>}
    {compact?<table className="workspace-record-table"><thead><tr><th scope="col">{t("workspace.programCohort")}</th><th scope="col">{t("common.status")}</th><th scope="col">{t("enrollments.owner")}</th><th scope="col">{t("enrollments.updatedAt")}</th><th scope="col">{t("common.details")}</th></tr></thead><tbody>{!error&&data.items.slice(0,3).map(row=><tr key={row.id}><td><Link href={`/enrollments?focus=${row.id}`}><RecordIdentity nameZh={row.product_name_zh} nameEn={row.product_name_en}/></Link><small>{label(row.cohort_name_zh,row.cohort_name_en)}</small></td><td data-label={t("common.status")}><EnrollmentStatus status={row.status}/></td><td data-label={t("enrollments.owner")}>{label(row.owner_name_zh,row.owner_name_en)}</td><td data-label={t("enrollments.updatedAt")}>{formatDate(row.updated_at,{dateOnly:true})}</td><td><Link className="text-button" href={`/enrollments?focus=${row.id}`}>{t("common.details")} →</Link></td></tr>)}</tbody></table>:<div className="detail-record-list enrollment-records">{!error && data.items.map(row => <article key={row.id}><div><Link href={`/enrollments?focus=${row.id}`}><b>{label(row.product_name_zh,row.product_name_en)} · {label(row.cohort_name_zh,row.cohort_name_en)}</b></Link><small>{t("enrollments.owner")}: {label(row.owner_name_zh,row.owner_name_en)} · {formatDate(row.updated_at,{includeTime:true})}</small><Link className="text-button" href={`/student-success?enrollmentId=${row.id}`}>{t("success.title")}</Link></div><EnrollmentStatus status={row.status}/></article>)}</div>}
    {creating&&<EnrollmentEditor studentId={studentId} studentLabel={studentLabel} onClose={()=>setCreating(false)} onSaved={async()=>{setCreating(false);await load();}}/>}
    {!compact&&<Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={setPage} onPageSize={value => {setPageSize(value);setPage(1);}}/>}
  </section>;
}
