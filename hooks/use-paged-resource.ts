"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { parsePagedSearchParams, type PagedQueryState } from "@/lib/paged-query";
import { assertPagedResult, noDirectoryFilters, parseDirectoryFilters, writeDirectoryFilters } from "@/lib/directory-filter-query";

type PageResult<T,M>={items:T[];total:number;metrics:M};

export function usePagedResource<T,M>({
  endpoint,enabled,initialItems,initialTotal,refreshKey=0,onMetrics,errorMessage,requestIdLabel,filterDefaults=noDirectoryFilters,
}:{
  endpoint:string;
  enabled:boolean;
  initialItems:T[];
  initialTotal:number;
  refreshKey?:number;
  onMetrics?:(metrics:M)=>void;
  errorMessage:string;
  requestIdLabel:string;
  filterDefaults?:Record<string,string>;
}){
  const router=useRouter();
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const searchParamsKey=searchParams.toString();
  const lastSeenSearch=useRef(searchParamsKey);
  const lastSeenPath=useRef(pathname);
  const syncingFromHistory=useRef(false);
  const [initialQuery]=useState(()=>parsePagedSearchParams(searchParams));
  const [filters,setFiltersState]=useState(()=>parseDirectoryFilters(searchParams,filterDefaults));
  const [query,setQueryState]=useState(initialQuery.query);
  const [page,setPageState]=useState(initialQuery.page);
  const [pageSize,setPageSizeState]=useState(initialQuery.pageSize);
  const [status,setStatusState]=useState(initialQuery.status);
  const [sort,setSortState]=useState<PagedQueryState["sort"]>(initialQuery.sort);
  const [direction,setDirectionState]=useState<PagedQueryState["direction"]>(initialQuery.direction);
  const [items,setItems]=useState(initialItems);
  const [total,setTotal]=useState(initialTotal);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [resolvedRequest,setResolvedRequest]=useState<string|null>(null);
  const [failedRequest,setFailedRequest]=useState<string|null>(null);
  const [retryKey,setRetryKey]=useState(0);
  const navigationMode=useRef<"replace"|"push">("replace");
  const setQuery:React.Dispatch<React.SetStateAction<string>>=(value)=>{
    navigationMode.current="replace";
    setQueryState(value);
    setPageState(1);
  };
  const withHistory=<Value,>(setter:React.Dispatch<React.SetStateAction<Value>>):React.Dispatch<React.SetStateAction<Value>>=>(value)=>{
    navigationMode.current="push";
    setter(value);
  };
  const setPage=withHistory(setPageState);
  const setPageSize=withHistory(setPageSizeState);
  const setStatus=withHistory(setStatusState);
  const setSort=withHistory(setSortState);
  const setDirection=withHistory(setDirectionState);
  const setFilters=withHistory(setFiltersState);
  const requestParams=new URLSearchParams({...Object.fromEntries(Object.entries(filters).filter(([,value])=>value)),q:query,page:String(page),pageSize:String(pageSize),status,sort,direction});
  const requestUrl=`${endpoint}${endpoint.includes("?")?"&":"?"}${requestParams}`;

  useEffect(()=>{
    if(!enabled||(searchParamsKey===lastSeenSearch.current&&pathname===lastSeenPath.current))return;
    lastSeenSearch.current=searchParamsKey;
    lastSeenPath.current=pathname;
    syncingFromHistory.current=true;
    // A route can change while the normalized query remains identical. Schedule the
    // replacement read after restoration, even when requestUrl itself will not change again.
    setRetryKey(value=>value+1);
    const restored=parsePagedSearchParams(new URLSearchParams(searchParamsKey));
    setFiltersState(parseDirectoryFilters(new URLSearchParams(searchParamsKey),filterDefaults));
    setQueryState(restored.query);
    setPageState(restored.page);
    setPageSizeState(restored.pageSize);
    setStatusState(restored.status);
    setSortState(restored.sort);
    setDirectionState(restored.direction);
  },[enabled,searchParamsKey,filterDefaults,pathname]);

  useEffect(()=>{
    if(!enabled||syncingFromHistory.current)return;
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setLoading(true);
      setError("");
      try{
        const result=await apiFetch<PageResult<T,M>>(requestUrl,{signal:controller.signal});
        if(controller.signal.aborted)return;
        assertPagedResult<T,M>(result);
        const pages=Math.max(1,Math.ceil(result.total/pageSize));
        if(page>pages){setPageState(pages);return;}
        setItems(result.items);
        setTotal(result.total);
        setResolvedRequest(requestUrl);
        onMetrics?.(result.metrics);
      }catch(cause){
        if(!controller.signal.aborted){
          const requestId=cause instanceof ApiClientError?cause.requestId:undefined;
          setError(`${errorMessage}${requestId?` · ${requestIdLabel}: ${requestId}`:""}`);
          setFailedRequest(requestUrl);
        }
      }finally{
        if(!controller.signal.aborted)setLoading(false);
      }
    },query?250:0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[enabled,errorMessage,onMetrics,page,pageSize,query,refreshKey,requestIdLabel,retryKey,requestUrl]);

  useEffect(()=>{
    if(!enabled)return;
    if(syncingFromHistory.current){
      syncingFromHistory.current=false;
      return;
    }
    const params=writeDirectoryFilters(new URLSearchParams(searchParams.toString()),filters);
    if(query)params.set("q",query);else params.delete("q");
    if(page>1)params.set("page",String(page));else params.delete("page");
    if(pageSize!==10)params.set("pageSize",String(pageSize));else params.delete("pageSize");
    if(status!=="all")params.set("status",status);else params.delete("status");
    if(sort!=="primary")params.set("sort",sort);else params.delete("sort");
    if(direction!=="asc")params.set("direction",direction);else params.delete("direction");
    const next=params.toString();
    if(next!==searchParams.toString()){
      lastSeenSearch.current=next;
      const shouldPush=navigationMode.current==="push";
      navigationMode.current="replace";
      const href=next?`${pathname}?${next}`:pathname;
      if(shouldPush)router.push(href,{scroll:false});
      else router.replace(href,{scroll:false});
    }
  },[direction,enabled,page,pageSize,pathname,query,router,searchParams,sort,status,filters]);

  return {
    query,setQuery,page,setPage,pageSize,setPageSize,status,setStatus,sort,setSort,
    direction,setDirection,filters,setFilters,
    items:enabled&&resolvedRequest!==requestUrl?[]:items,setItems,
    total:enabled&&resolvedRequest!==requestUrl?0:total,
    loading:loading||(enabled&&resolvedRequest!==requestUrl&&failedRequest!==requestUrl),
    error:failedRequest===requestUrl?error:"",
    retry:()=>setRetryKey(value=>value+1),
  };
}
