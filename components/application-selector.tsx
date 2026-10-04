"use client";
import {useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {useRemoteSearch} from "@/hooks/use-remote-search";
import type {ApplicationPage} from "@/lib/application-repository";
import {useI18n} from "./i18n-provider";
import {SearchableSelect,InlineMessage} from "./ui";
export function ApplicationSelector({studentId,enrollmentId,value,initialLabel,disabled,onChange}:{studentId:string;enrollmentId?:string;value:string;initialLabel?:string;disabled?:boolean;onChange:(value:string)=>void}){
 const {t,locale}=useI18n(),latest=useRemoteSearch(),[options,setOptions]=useState<Array<{value:string;label:string}>>([]),[error,setError]=useState("");
 const search=async(query:string)=>{if(!studentId)return;const result=await latest(signal=>apiFetch<ApplicationPage>(`/api/applications?studentId=${studentId}${enrollmentId?`&enrollmentId=${enrollmentId}`:""}&query=${encodeURIComponent(query)}`,{signal}));if(!result.current)return;if("error" in result){setError(t("applications.loadFailed"));return;}setError("");setOptions(result.value.items.map(row=>({value:row.id,label:[(locale==="en"?row.target_name_en:row.target_name_zh)||t("applications.title"),row.external_application_id,t(`applications.status.${row.status}`)].filter(Boolean).join(" · ")})));};
 const selected=value&&!options.some(item=>item.value===value)?[{value,label:initialLabel||t("applications.title")}]:[];
 return <fieldset className="follow-up-fields" disabled={disabled||!studentId}><SearchableSelect label={t("business.field.application_id")} value={value} options={[...selected,...options]} onChange={onChange} onSearch={search}/>{value&&<button type="button" className="text-button" onClick={()=>onChange("")}>{t("business.clear")}</button>}{error&&<InlineMessage type="error">{error}</InlineMessage>}</fieldset>;
}
