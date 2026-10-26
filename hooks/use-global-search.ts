"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {globalSearchQuerySchema,globalSearchResultSchema,type GlobalSearchResult,type GlobalSearchScope} from "@/lib/global-search-contract";

export function useGlobalSearch(context:string){
 const [query,setQueryState]=useState(""),[scope,setScopeState]=useState<GlobalSearchScope>("all"),[retryKey,setRetryKey]=useState(0);
 const [outcome,setOutcome]=useState<{key:string;result?:GlobalSearchResult;failed?:boolean}|null>(null);
 const active=useRef<AbortController|null>(null),generation=useRef(0);
 const queryRef=useRef(""),scopeRef=useRef<GlobalSearchScope>("all");
 const cancel=useCallback(()=>{generation.current++;active.current?.abort();},[]);
 const setQuery=useCallback((value:string)=>{const next=value.slice(0,80);if(next===queryRef.current)return;if(next.trim()!==queryRef.current.trim()){cancel();setOutcome(null);}queryRef.current=next;setQueryState(next);},[cancel]);
 const setScope=useCallback((value:GlobalSearchScope)=>{if(value===scopeRef.current)return;scopeRef.current=value;cancel();setOutcome(null);setScopeState(value);},[cancel]);
 const parsed=globalSearchQuerySchema.safeParse({q:query,type:scope}),valid=parsed.success;
 const normalized=valid?parsed.data.q:"",key=JSON.stringify([normalized,scope,context,retryKey]);
 useEffect(()=>{
  if(!valid||scope==="pages")return;
  const controller=new AbortController(),sequence=++generation.current;active.current=controller;
  const timer=window.setTimeout(async()=>{
   try{
    const params=new URLSearchParams({q:normalized,type:scope});
    const result=globalSearchResultSchema.parse(await apiFetch<unknown>(`/api/search/global?${params}`,{signal:controller.signal}));
    if(result.query!==normalized||result.scope!==scope)throw new Error("GLOBAL_SEARCH_CONTEXT_INVALID");
    if(!controller.signal.aborted&&generation.current===sequence)setOutcome({key,result});
   }catch{if(!controller.signal.aborted&&generation.current===sequence)setOutcome({key,failed:true});}
  },200);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[context,key,normalized,scope,valid]);
 useEffect(()=>()=>cancel(),[cancel]);
 const current=outcome?.key===key?outcome:null;
 return{query,setQuery,scope,setScope,result:current?.result,failed:current?.failed===true,loading:valid&&scope!=="pages"&&!current,valid,retry:()=>{cancel();setRetryKey(value=>value+1);}};
}
