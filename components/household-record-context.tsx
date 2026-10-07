"use client";
import Link from "next/link";
import { useScopeQuery } from "@/hooks/use-scope-query";
import type { CustomerOperationsSnapshot } from "@/lib/customer-operations-repository";
import type { StudentDetail } from "@/lib/v200-repository";
import { useCallback, useState } from "react";
import { useI18n } from "./i18n-provider";
import { RecordIdentity } from "./record-header";
import { InlineMessage, Pagination } from "./ui";
import { SectionHeader } from "./responsive-detail-layout";
function response(value: unknown): CustomerOperationsSnapshot {
  const result = value as CustomerOperationsSnapshot;
  if (result?.subject !== "HOUSEHOLD" || !Array.isArray(result.students)) throw new Error("RECORD_RESPONSE_INVALID");
  return result;
}
export function HouseholdContext({ id }: { id: string }) {
  const { t } = useI18n();
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(10);
  const query = useScopeQuery("/api/customer-operations", new URLSearchParams({ subject: "HOUSEHOLD", id }).toString(), response);
  return <section className="detail-section"><SectionHeader title={t("ux.record.students")}/>
    {query.loading && <p role="status">{t("common.loading")}</p>}{query.failure && <InlineMessage type="error">{t("education.loadFailed")}<button className="text-button" onClick={query.retry}>{t("common.retry")}</button></InlineMessage>}
    {query.data && <><div className="detail-record-list">{query.data.students.slice((page-1)*pageSize,page*pageSize).map(student => <article key={student.id}><Link href={`/students?focus=${student.id}&returnTo=${encodeURIComponent(`/households?tab=families&focus=${id}`)}`}><RecordIdentity nameZh={student.name_zh} nameEn={student.name_en}/></Link><HouseholdStudentContext id={student.id}/></article>)}</div>{!query.data.students.length && <p>{t("education.studentsEmpty")}</p>}{query.data.students.length>pageSize&&<Pagination page={page} totalPages={Math.ceil(query.data.students.length/pageSize)} total={query.data.students.length} pageSize={pageSize} onPage={setPage} onPageSize={value=>{setPageSize(value);setPage(1);}}/>}{query.data.limited && <p>{t("customerOps.limited")}</p>}</>}
  </section>;
}
function studentResponse(value:unknown):{item:StudentDetail}{const result=value as {item:StudentDetail};if(!result?.item?.id||typeof result.item.grade!=="string"||typeof result.item.academicYear!=="string")throw new Error("RECORD_RESPONSE_INVALID");return result;}
function HouseholdStudentContext({id}:{id:string}){
 const {t}=useI18n();const validate=useCallback((value:unknown)=>{const result=studentResponse(value);if(result.item.id!==id)throw new Error("RECORD_RESPONSE_INVALID");return result;},[id]);const query=useScopeQuery("/api/education",new URLSearchParams({resource:"studentDetail",id}).toString(),validate);
 return <div>{query.loading&&<small role="status">{t("common.loading")}</small>}{query.failure&&<small>{t("education.loadFailed")} <button className="text-button" onClick={query.retry}>{t("common.retry")}</button></small>}{query.data&&query.data.item.id===id&&<small>{query.data.item.grade} · {query.data.item.academicYear}</small>}</div>;
}
