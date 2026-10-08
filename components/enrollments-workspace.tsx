"use client";
import {WorkspaceHeading} from "./workspace-heading";

import { FilterBar } from "./filter-bar";
import { RecordDeleteAction } from "./record-delete-action";
import {ReportScopeNotice} from "./report-scope-notice";
import type {ReportFilter} from "@/lib/management-trend-contract";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { enrollmentStatuses } from "@/lib/enrollment-input";
import type { EnrollmentRecord, EnrollmentPage } from "@/lib/enrollment-repository";
import { useCapability } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { InlineMessage, Pagination } from "./ui";
import { EnrollmentEditor } from "./enrollment-editor";
import { EnrollmentDetail, EnrollmentStatus } from "./enrollment-detail";
import { EnrollmentRelation } from "./enrollment-relation";

export function EnrollmentsWorkspace({initial, initialDetail = null, initialStudentId = "",initialReportFilter={},initialDetailTab="overview"}: {initialDetailTab?:string;initialReportFilter?:ReportFilter;initial: EnrollmentPage | null; initialDetail?: EnrollmentRecord | null; initialStudentId?: string}) {
  const {t, locale} = useI18n(), {formatDate} = useUserPreferences(), canManage = useCapability("education.manage");
  const [data, setData] = useState<EnrollmentPage>(initial ?? {items:[],page:1,pageSize:20,total:0});
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [studentId, setStudentId] = useState(initialStudentId);
  const [cohortId, setCohortId] = useState(""), [status, setStatus] = useState(""), [ownerId, setOwnerId] = useState("");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [detail, setDetail] = useState<EnrollmentRecord | null>(initialDetail), [editor, setEditor] = useState<{record?: EnrollmentRecord} | null>(null), [notice, setNotice] = useState("");
  const reportQuery=new URLSearchParams(Object.entries(initialReportFilter).filter(([,v])=>v!==undefined) as [string,string][]).toString();
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    const params = new URLSearchParams(reportQuery);params.set("page",String(page));params.set("pageSize",String(pageSize));
    for (const [key, value] of [["query",search],["studentId",studentId],["cohortId",cohortId],["status",status],["ownerId",ownerId]]) if (value) params.set(key,value);
    try {const result = await apiFetch<EnrollmentPage>(`/api/enrollments?${params}`, {signal}); if (!signal?.aborted) setData(result);}
    catch (error) {if (!signal?.aborted) {setError(presentApiError(error,t,"enrollments.loadFailed").message); throw error;}}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [page,pageSize,search,studentId,cohortId,status,ownerId,t,reportQuery]);
  useEffect(() => {const controller = new AbortController(); const timer = setTimeout(() => void load(controller.signal).catch(() => {}),0); return () => {clearTimeout(timer);controller.abort();};}, [load]);
  const openDetail = async (id: string) => {setError(""); try {const result = await apiFetch<{item:EnrollmentRecord}>(`/api/enrollments?id=${id}`);setDetail(result.item);} catch (error) {setError(presentApiError(error,t,"enrollments.loadFailed").message);}};
  const refreshDetail = async () => {if (!detail) return; const result = await apiFetch<{item:EnrollmentRecord}>(`/api/enrollments?id=${detail.id}`);setDetail(result.item);};
  const saved = async (id: string) => {
    setEditor(null); setNotice(t("enrollments.saved"));
    try {await load(); const result = await apiFetch<{item:EnrollmentRecord}>(`/api/enrollments?id=${id}`);setDetail(result.item);}
    catch {setNotice(t("enrollments.savedRefreshFailed"));}
  };
  const label = (zh?: string | null, en?: string | null) => (locale === "en" ? en : zh) || zh || en || "—";
  return <div className="page-stack"><ReportScopeNotice filter={initialReportFilter}/>
    <section className="page-heading-row"><div><p className="eyebrow">{t("education.eyebrow")}</p><WorkspaceHeading>{t("enrollments.title")}</WorkspaceHeading><p>{t("enrollments.description")}</p></div>{canManage && <button className="primary-button" type="button" onClick={() => {setEditor({});setNotice("");}}>{t("enrollments.create")}</button>}</section>
    {notice && <InlineMessage type="success">{notice}</InlineMessage>}
    <section className="surface">
      <FilterBar search={query} onSearchChange={setQuery} onSearch={()=>{setSearch(query);setPage(1);}} placeholder={t("enrollments.search")} applied={{cohortId,ownerId}} defaults={{cohortId:"",ownerId:""}} advancedCount={Number(Boolean(cohortId))+Number(Boolean(ownerId))} activeCount={Number(Boolean(search))+Number(Boolean(studentId))+Number(Boolean(status))+Number(Boolean(cohortId))+Number(Boolean(ownerId))} onReset={()=>{setQuery("");setSearch("");setStatus("");setStudentId(initialStudentId);setCohortId("");setOwnerId("");setPage(1);}} onApply={next=>{setCohortId(next.cohortId);setOwnerId(next.ownerId);setPage(1);}} primaryFilters={<><EnrollmentRelation type="STUDENT" label={t("enrollments.student")} value={studentId} onChange={value=>{setStudentId(value);setPage(1);}}/><label className="field"><span>{t("common.status")}</span><select name="statusFilter" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{t("common.all")}</option>{enrollmentStatuses.map(value=><option key={value} value={value}>{t(`enrollments.status.${value}`)}</option>)}</select></label></>} renderAdvanced={(draft,onChange)=><div className="form-grid two-column"><EnrollmentRelation type="COHORT" label={t("enrollments.cohort")} value={draft.cohortId} onChange={value=>onChange({...draft,cohortId:value})}/><EnrollmentRelation type="USER" label={t("enrollments.owner")} value={draft.ownerId} onChange={value=>onChange({...draft,ownerId:value})}/></div>}/>
      {error && <InlineMessage type="error">{error}<button type="button" className="secondary-button" onClick={() => void load().catch(() => {})}>{t("common.retry")}</button></InlineMessage>}
      {loading && <p role="status">{t("common.loading")}</p>}
      {!loading && !error && !data.items.length && <p className="detail-empty">{t("enrollments.empty")}</p>}
      <div className="detail-record-list enrollment-records">{!error && data.items.map(row => <article key={row.id}><div><b>{label(row.student_name_zh,row.student_name_en)}</b><small>{label(row.product_name_zh,row.product_name_en)} · {label(row.cohort_name_zh,row.cohort_name_en)}</small><small>{t("enrollments.owner")}: {label(row.owner_name_zh,row.owner_name_en)} · {formatDate(row.updated_at,{includeTime:true})}</small></div><div className="detail-actions"><EnrollmentStatus status={row.status}/>{canManage&&row.can_edit&&<RecordDeleteAction kind="ENROLLMENT" id={row.id} onDeleted={()=>load()}/>}<button className="secondary-button" type="button" onClick={() => void openDetail(row.id)}>{t("common.details")}</button></div></article>)}</div>
      <Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={setPage} onPageSize={value => {setPageSize(value);setPage(1);}}/>
    </section>
    {detail && !editor && <EnrollmentDetail initialTab={initialDetailTab} key={detail.id} record={detail} onClose={() => setDetail(null)} onEdit={() => setEditor({record:detail})} onRefresh={refreshDetail}/>}
    {editor && <EnrollmentEditor record={editor.record} studentId={studentId} onClose={() => setEditor(null)} onSaved={saved}/>}
  </div>;
}
