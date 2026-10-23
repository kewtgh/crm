"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {ApiClientError,apiFetch} from "@/lib/api-client";
import {createReceiptAttempt} from "@/lib/receipt-attempt";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {presentApiError} from "@/lib/api-error-presenter";
import {qualityCommandSchema,type QualityFilters} from "@/lib/quality-contract";
import type {QualityWorkspace} from "@/lib/quality-workspace-repository";
import {useI18n} from "@/components/i18n-provider";

export function useQualityWorkspace(initial:QualityWorkspace,filters:QualityFilters){
 const {t}=useI18n(),key=JSON.stringify(filters);
 const [data,setData]=useState(initial),[loadedKey,setLoadedKey]=useState(JSON.stringify({q:"",status:"active",severity:"all",assignment:"all"})),[loadedPage,setLoadedPage]=useState(1);
 const [paging,setPaging]=useState({key,page:1,pageSize:10}),page=paging.key===key?paging.page:1,pageSize=paging.pageSize;
 const [loading,setLoading]=useState(false),[readError,setReadError]=useState(""),[error,setError]=useState(""),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[refreshOnly,setRefreshOnly]=useState(false),[toast,setToast]=useState("");
 const sequence=useRef(0),controller=useRef<AbortController|null>(null),busy=useRef(false),attempt=useRef(createReceiptAttempt()),body=useRef<string|null>(null);
 const cancelRead=useCallback(()=>{sequence.current++;controller.current?.abort();},[]);
 const load=useCallback(async(nextPage:number,force=false)=>{
  if(!force&&(busy.current||body.current))return false;
  const current=++sequence.current;controller.current?.abort();const active=new AbortController();controller.current=active;
  setLoading(true);setReadError("");
  const fetchPage=async(value:number)=>{const result=await apiFetch<QualityWorkspace>(`/api/data-quality?${new URLSearchParams({...JSON.parse(key),page:String(value),pageSize:String(pageSize)})}`,{signal:active.signal});if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.total<0)throw new ApiClientError("INVALID_API_RESPONSE",502);return result;};
  try{
   let result=await fetchPage(nextPage);if(current!==sequence.current||active.signal.aborted)return false;
   const last=Math.max(1,Math.ceil(result.total/pageSize));if(nextPage>last){nextPage=last;result=await fetchPage(nextPage);if(current!==sequence.current||active.signal.aborted)return false;}
   setData(result);setLoadedKey(key);setLoadedPage(nextPage);setPaging({key,page:nextPage,pageSize});setRefreshOnly(false);setError("");return true;
  }catch{if(current===sequence.current&&!active.signal.aborted)setReadError(t("qualityTriage.readFailed"));return false;}
  finally{if(current===sequence.current&&!active.signal.aborted)setLoading(false);}
 },[key,pageSize,t]);
 const current=loadedKey===key&&loadedPage===page&&data.pageSize===pageSize;
 useEffect(()=>{if(current)return;const timer=window.setTimeout(()=>void load(page),filters.q?250:0);return()=>{window.clearTimeout(timer);cancelRead();};},[cancelRead,current,filters.q,load,page]);
 useEffect(()=>()=>cancelRead(),[cancelRead]);
 const dispatch=async(payload?:Record<string,unknown>)=>{
  if(busy.current)return false;
  if(!body.current){const next=attempt.current.prepare(payload??{});const parsed=qualityCommandSchema.safeParse(JSON.parse(next));if(!parsed.success){attempt.current.clear();setError(t("qualityTriage.reload"));return false;}body.current=next;}
  const original=body.current;busy.current=true;cancelRead();setLoading(false);setPending(true);setError("");
  try{
   await apiFetch("/api/data-quality",{method:"POST",headers:{"content-type":"application/json"},body:original});
   body.current=null;attempt.current.clear();setUncertain(false);
  }catch(caught){
   if(isDefinitiveMutationFailure(caught)){body.current=null;attempt.current.clear();setUncertain(false);setError(presentApiError(caught,t,"quality.operationFailed").message);if(caught.code==="QUALITY_VERSION_CONFLICT"||caught.code==="QUALITY_REQUEST_CONFLICT")setReadError(t("qualityTriage.reload"));}
   else {setUncertain(true);setError(t("qualityTriage.uncertain"));}
   busy.current=false;setPending(false);return false;
  }
  const refreshed=await load(JSON.parse(original).operation==="run"?1:page,true);
  if(refreshed)setToast(t("qualityTriage.confirmed"));else setRefreshOnly(true);
  busy.current=false;setPending(false);return true;
 };
 return {data,page,pageSize,current,loading,readError,error,pending,uncertain,refreshOnly,toast,setToast,send:dispatch,retry:()=>dispatch(),refresh:()=>load(page),setPage:(value:number)=>setPaging({key,page:value,pageSize}),setPageSize:(value:number)=>setPaging({key,page:1,pageSize:value}),locked:pending||uncertain||refreshOnly||loading||!current||Boolean(readError)};
}
