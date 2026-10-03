"use client";
import {useCallback,useEffect,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import type {ProductCohort} from "@/lib/cohort-repository";
import {useRemoteSearch} from "@/hooks/use-remote-search";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {SearchableSelect,InlineMessage} from "./ui";
export function ProductCohortSelector({productId,value,onChange,usage,disabled=false}:{productId:string;value:string;onChange:(value:string)=>void;usage:"OPPORTUNITY"|"EVENT"|"QUOTE";disabled?:boolean}){
  const {t,locale}=useI18n(),{formatDate}=useUserPreferences(),latest=useRemoteSearch();
  const [options,setOptions]=useState<ProductCohort[]>([]),[selected,setSelected]=useState<ProductCohort|null>(null),[error,setError]=useState("");
  useEffect(()=>{if(!value)return;const controller=new AbortController();void apiFetch<{item:ProductCohort}>(`/api/product-cohorts?id=${value}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setSelected(result.item);}).catch(()=>{if(!controller.signal.aborted)setError(t("commercial.loadFailed"));});return()=>controller.abort();},[value,t]);
  const search=useCallback(async(query:string)=>{if(!productId)return;const result=await latest(signal=>apiFetch<{items:ProductCohort[]}>(`/api/product-cohorts?${new URLSearchParams({productId,usage,query})}`,{signal}));if(!result.current)return;if("error" in result){setError(t("commercial.loadFailed"));return;}setOptions(result.value.items);setError("");},[productId,usage,latest,t]);
  const visible=options.filter(item=>item.productId===productId),historical=selected?.id===value?selected:null;
  const label=(item:ProductCohort)=>`${(locale==="en"?item.nameEn:item.nameZh)||item.nameZh||item.nameEn} · ${t(`cohorts.intake.${item.intakeType}`)} · ${item.startOn?formatDate(item.startOn,{dateOnly:true}):t("business.unknown")}`;
  const choices=[...(value&&!visible.some(item=>item.id===value)?[{value,label:historical?label(historical):t("business.selectedContext")}]:[]),...visible.map(item=>({value:item.id,label:label(item)}))];
  return <fieldset className="follow-up-fields" disabled={disabled}><SearchableSelect label={t("enrollments.cohort")} value={value} options={choices} onSearch={search} onChange={id=>{setSelected(visible.find(row=>row.id===id)??null);onChange(id);}}/>{value&&<button type="button" className="text-button" onClick={()=>onChange("")}>{t("commercial.clearCohort")}</button>}{value&&(!productId||historical&&historical.productId!==productId)&&<InlineMessage type="error">{t("commercial.productChanged")}</InlineMessage>}{!productId&&!value&&<p className="field-help">{t("commercial.chooseProduct")}</p>}{error&&<InlineMessage type="error">{error}</InlineMessage>}</fieldset>;
}
