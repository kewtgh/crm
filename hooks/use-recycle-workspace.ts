"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {ApiClientError,apiFetch} from "@/lib/api-client";
import {createReceiptAttempt} from "@/lib/receipt-attempt";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {presentApiError} from "@/lib/api-error-presenter";
import {recyclePageSchema,recycleRestoreSchema,recycleRestoredSchema,type RecyclePage,type RecycleQuery,type RecycleScope,type RecycleBinItem} from "@/lib/recycle-contract";
import {useI18n} from "@/components/i18n-provider";

export function useRecycleWorkspace(initial:RecyclePage|null,initialQuery:RecycleQuery,query:RecycleQuery,scope:RecycleScope,correctQuery:(query:RecycleQuery)=>void){
 const {t}=useI18n(),key=JSON.stringify(query);
 const [data,setData]=useState<RecyclePage>(initial??{scope,items:[],total:0,page:initialQuery.page,pageSize:initialQuery.pageSize});
 const [loadedKey,setLoadedKey]=useState<string|null>(initial?JSON.stringify(initialQuery):null);
 const [loading,setLoading]=useState(false),[readError,setReadError]=useState(initial?"":t("recovery.readFailed"));
 const [error,setError]=useState(""),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[refreshOnly,setRefreshOnly]=useState(false),[toast,setToast]=useState("");
 const sequence=useRef(0),controller=useRef<AbortController|null>(null),busy=useRef(false),body=useRef<string|null>(null),attempt=useRef(createReceiptAttempt());
 const cancelRead=useCallback(()=>{sequence.current++;controller.current?.abort();},[]);
 const load=useCallback(async(force=false)=>{
  if(!force&&(busy.current||body.current))return false;
  const current=++sequence.current;controller.current?.abort();const active=new AbortController();controller.current=active;
  setLoading(true);setReadError("");
  const next:RecycleQuery=JSON.parse(key);
  const fetchPage=async()=>{
   const value=await apiFetch<unknown>(`/api/recycle-bin?${new URLSearchParams({scope,...Object.fromEntries(Object.entries(next).map(([field,value])=>[field,String(value)]))})}`,{signal:active.signal});
   const result=recyclePageSchema.safeParse(value);
   if(!result.success||result.data.scope!==scope||result.data.page!==next.page||result.data.pageSize!==next.pageSize)throw new ApiClientError("INVALID_RECYCLE_RESPONSE",502);
   return result.data;
  };
  try{
   let result=await fetchPage();if(current!==sequence.current||active.signal.aborted)return false;
   const last=Math.max(1,Math.ceil(result.total/next.pageSize));
   if(next.page>last){next.page=last;result=await fetchPage();if(current!==sequence.current||active.signal.aborted)return false;}
   setData(result);setLoadedKey(JSON.stringify(next));setReadError("");setRefreshOnly(false);setError("");setLoading(false);
   if(JSON.stringify(next)!==key)correctQuery(next);
   return true;
  }catch{if(current===sequence.current&&!active.signal.aborted)setReadError(t("recovery.readFailed"));return false;}
  finally{if(current===sequence.current&&!active.signal.aborted)setLoading(false);}
 },[key,scope,t,correctQuery]);
 const current=loadedKey===key&&data.scope===scope;
 useEffect(()=>{if(current)return;const timer=window.setTimeout(()=>void load(),query.q?250:0);return()=>{window.clearTimeout(timer);cancelRead();};},[current,load,query.q,cancelRead]);
 useEffect(()=>()=>cancelRead(),[cancelRead]);
 const locked=pending||uncertain||refreshOnly||loading||!current||Boolean(readError);
 const restore=async(item?:RecycleBinItem)=>{
  if(busy.current||item&&locked)return null;
  if(!body.current){
   if(!item)return null;
   const original=attempt.current.prepare({scope,kind:item.kind,id:item.id,expectedDeletedAt:item.deletedAt});
   if(!recycleRestoreSchema.safeParse(JSON.parse(original)).success){attempt.current.clear();setError(t("recovery.reload"));return null;}
   body.current=original;
  }
  const original=body.current,command=recycleRestoreSchema.parse(JSON.parse(original));
  busy.current=true;cancelRead();setLoading(false);setPending(true);setError("");setToast("");
  let restored;
  try{
   const value=await apiFetch<unknown>("/api/recycle-bin",{method:"POST",headers:{"content-type":"application/json"},body:original});
   const result=recycleRestoredSchema.safeParse(value);
   if(!result.success||result.data.id!==command.id||result.data.kind!==command.kind)throw new ApiClientError("INVALID_RECYCLE_RESPONSE",502);
   restored=result.data;body.current=null;attempt.current.clear();setUncertain(false);
  }catch(caught){
   if(isDefinitiveMutationFailure(caught)){body.current=null;attempt.current.clear();setUncertain(false);setError(presentApiError(caught,t,"recycle.restoreFailed").message);setReadError(t("recovery.reload"));}
   else {setUncertain(true);setError(t("recovery.uncertain"));}
   busy.current=false;setPending(false);return null;
  }
  setData(previous=>({...previous,items:previous.items.filter(item=>item.id!==command.id||item.kind!==command.kind)}));
  if(await load(true))setToast(t("recycle.restored"));else setRefreshOnly(true);
  busy.current=false;setPending(false);return restored;
 };
 return {data,current,loading,readError,error,pending,uncertain,refreshOnly,toast,setToast,locked,restore,refresh:()=>load()};
}
