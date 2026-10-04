"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import type { EnrollmentPage } from "@/lib/enrollment-repository";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { InlineMessage, Pagination } from "./ui";
import { EnrollmentStatus } from "./enrollment-detail";

export function StudentEnrollmentsSection({studentId}: {studentId: string}) {
  const {t,locale} = useI18n(), {formatDate} = useUserPreferences();
  const [data,setData] = useState<EnrollmentPage>({items:[],total:0,page:1,pageSize:10}), [page,setPage] = useState(1), [pageSize,setPageSize] = useState(10), [error,setError] = useState(""), [loading,setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);setError("");
    try {const result = await apiFetch<EnrollmentPage>(`/api/enrollments?studentId=${studentId}&page=${page}&pageSize=${pageSize}`,{signal});if (!signal?.aborted) setData(result);}
    catch (error) {if (!signal?.aborted) setError(presentApiError(error,t,"enrollments.loadFailed").message);}
    finally {if (!signal?.aborted) setLoading(false);}
  }, [studentId,page,pageSize,t]);
  useEffect(() => {const controller = new AbortController();const timer = setTimeout(() => void load(controller.signal),0);return () => {clearTimeout(timer);controller.abort();};}, [load]);
  const label = (zh?: string | null,en?: string | null) => (locale === "en" ? en : zh) || zh || en || "—";
  return <section className="settings-subform" aria-label={t("enrollments.title")}><div className="surface-heading"><h3>{t("enrollments.title")}</h3><Link className="secondary-button" href={`/enrollments?studentId=${studentId}`}>{t("enrollments.viewAll")}</Link></div>
    {error && <InlineMessage type="error">{error}<button type="button" className="secondary-button" onClick={() => void load()}>{t("common.retry")}</button></InlineMessage>}
    {loading && <p role="status">{t("common.loading")}</p>}
    {!loading && !error && !data.items.length && <p className="detail-empty">{t("enrollments.empty")}</p>}
    <div className="detail-record-list enrollment-records">{!error && data.items.map(row => <article key={row.id}><div><Link href={`/enrollments?focus=${row.id}`}><b>{label(row.product_name_zh,row.product_name_en)} · {label(row.cohort_name_zh,row.cohort_name_en)}</b></Link><small>{t("enrollments.owner")}: {label(row.owner_name_zh,row.owner_name_en)} · {formatDate(row.updated_at,{includeTime:true})}</small><Link className="text-button" href={`/student-success?enrollmentId=${row.id}`}>{t("success.title")}</Link></div><EnrollmentStatus status={row.status}/></article>)}</div>
    <Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={setPage} onPageSize={value => {setPageSize(value);setPage(1);}}/>
  </section>;
}
