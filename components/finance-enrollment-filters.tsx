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
 return <form className="surface finance-filter-panel" onSubmit={event=>{event.preventDefault();onApply(Object.fromEntries(Object.entries(filters).filter(([,value])=>value)));}} aria-label={t("enrollmentFinance.filters")}><h3>{locale==="en"?"Customer & service filters":"购买方与服务筛选"}</h3><p className="field-help">{locale==="en"?"Purchaser and student are independent. A teacher buying personally is an individual purchaser; when representing an institution, select the institution. Optional student/enrollment filters restrict records to linked enrollments and exclude quotes.":"购买方与学生相互独立：老师个人购买选“个人”，代表机构购买选“机构”。学生／报名为可选服务对象筛选，启用后仅显示关联报名的财务记录，不含报价。"}</p><div className="form-grid three-column"><label className="field"><span>{locale==="en"?"Purchaser type":"购买方类型"}</span><select value={filters.buyerType??""} onChange={e=>setFilters(current=>({...current,buyerType:e.target.value,buyerId:""}))}><option value="">{t("common.all")}</option><option value="ORGANIZATION">{locale==="en"?"Organization / institution":"机构／学校"}</option><option value="HOUSEHOLD">{locale==="en"?"Household":"家庭"}</option><option value="CONTACT">{locale==="en"?"Individual (including teachers)":"个人（含老师）"}</option></select></label>{filters.buyerType&&<EnrollmentRelation key={filters.buyerType} type={filters.buyerType as "ORGANIZATION"|"HOUSEHOLD"|"CONTACT"} label={locale==="en"?"Purchaser":"购买服务方"} value={filters.buyerId??""} onChange={value=>set("buyerId",value)}/>}
  <EnrollmentRelation type="STUDENT" label={t("enrollments.student")} value={filters.studentId??""} onChange={value=>set("studentId",value)}/>
  <EnrollmentRelation type="PRODUCT" label={t("products.product")} value={filters.productId??""} onChange={value=>set("productId",value)}/>
  <EnrollmentRelation type="COHORT" label={t("enrollments.cohort")} value={filters.cohortId??""} onChange={value=>set("cohortId",value)}/>
  <div><SearchableSelect label={t("enrollments.title")} options={options} value={filters.enrollmentId??""} onSearch={search} onChange={value=>set("enrollmentId",value)}/>{filters.enrollmentId&&<button type="button" className="text-button" onClick={()=>set("enrollmentId","")}>{t("business.clear")}</button>}</div>
 </div>{failed&&<InlineMessage type="error">{t("enrollments.loadFailed")}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" onClick={()=>{setFilters({});onApply({});}}>{t("business.clear")}</button><button className="primary-button">{t("enrollmentFinance.applyFilters")}</button></div></form>;
}
