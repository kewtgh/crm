"use client";
import {useState} from "react";
import {apiFetch} from "@/lib/api-client";
import type {EnrollmentPage} from "@/lib/enrollment-repository";
import {useRemoteSearch} from "@/hooks/use-remote-search";
import {EnrollmentRelation} from "./enrollment-relation";
import {SearchableSelect,InlineMessage} from "./ui";
import {useI18n} from "./i18n-provider";
export function FinanceEnrollmentFilters({onApply}:{onApply:(filters:Record<string,string>)=>void}) {
 const {t,locale}=useI18n(),[filters,setFilters]=useState<Record<string,string>>({}),[options,setOptions]=useState<Array<{value:string;label:string}>>([]),[failed,setFailed]=useState(false),latest=useRemoteSearch();
 const set=(key:string,value:string)=>setFilters(current=>({...current,[key]:value}));
 const search=async(query:string)=>{const result=await latest(signal=>apiFetch<EnrollmentPage>(`/api/enrollments?query=${encodeURIComponent(query)}`,{signal}));if(!result.current)return;if("error" in result){setFailed(true);return;}setFailed(false);setOptions(result.value.items.map(item=>({value:item.id,label:`${locale==="en"?item.student_name_en:item.student_name_zh} · ${locale==="en"?item.cohort_name_en:item.cohort_name_zh}`})));};
 return <form className="surface" onSubmit={event=>{event.preventDefault();onApply(Object.fromEntries(Object.entries(filters).filter(([,value])=>value)));}} aria-label={t("enrollmentFinance.filters")}><h3>{t("enrollmentFinance.filters")}</h3><p className="field-help">{t("enrollmentFinance.filterScope")}</p><div className="form-grid two-column">
  <EnrollmentRelation type="STUDENT" label={t("enrollments.student")} value={filters.studentId??""} onChange={value=>set("studentId",value)}/>
  <EnrollmentRelation type="PRODUCT" label={t("products.product")} value={filters.productId??""} onChange={value=>set("productId",value)}/>
  <EnrollmentRelation type="COHORT" label={t("enrollments.cohort")} value={filters.cohortId??""} onChange={value=>set("cohortId",value)}/>
  <div><SearchableSelect label={t("enrollments.title")} options={options} value={filters.enrollmentId??""} onSearch={search} onChange={value=>set("enrollmentId",value)}/>{filters.enrollmentId&&<button type="button" className="text-button" onClick={()=>set("enrollmentId","")}>{t("business.clear")}</button>}</div>
 </div>{failed&&<InlineMessage type="error">{t("enrollments.loadFailed")}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" onClick={()=>{setFilters({});onApply({});}}>{t("business.clear")}</button><button className="primary-button">{t("enrollmentFinance.applyFilters")}</button></div></form>;
}
