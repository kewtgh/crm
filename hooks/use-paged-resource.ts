"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { parsePagedSearchParams, type PagedQueryState } from "@/lib/paged-query";

type PageResult<T,M>={items:T[];total:number;metrics:M};

export function usePagedResource<T,M>({
  endpoint,enabled,initialItems,initialTotal,refreshKey=0,onMetrics,errorMessage,requestIdLabel,
}:{
  endpoint:string;
  enabled:boolean;
  initialItems:T[];
  initialTotal:number;
  refreshKey?:number;
  onMetrics?:(metrics:M)=>void;
  errorMessage:string;
  requestIdLabel:string;
}){
  const router=useRouter();
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const [initialQuery]=useState(()=>parsePagedSearchParams(searchParams));
  const [query,setQuery]=useState(initialQuery.query);
  const [page,setPage]=useState(initialQuery.page);
  const [pageSize,setPageSize]=useState(initialQuery.pageSize);
  const [status,setStatus]=useState(initialQuery.status);
  const [sort,setSort]=useState<PagedQueryState["sort"]>(initialQuery.sort);
  const [direction,setDirection]=useState<PagedQueryState["direction"]>(initialQuery.direction);
  const [items,setItems]=useState(initialItems);
  const [total,setTotal]=useState(initialTotal);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [retryKey,setRetryKey]=useState(0);

  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setLoading(true);
      setError("");
      const params=new URLSearchParams({
        q:query,page:String(page),pageSize:String(pageSize),status,sort,direction,
      });
      try{
        const result=await apiFetch<PageResult<T,M>>(`${endpoint}?${params}`,{signal:controller.signal});
        const pages=Math.max(1,Math.ceil(result.total/pageSize));
        if(page>pages){setPage(pages);return;}
        setItems(result.items);
        setTotal(result.total);
        onMetrics?.(result.metrics);
      }catch(cause){
        if(!controller.signal.aborted){
          const requestId=cause instanceof ApiClientError?cause.requestId:undefined;
          setError(`${errorMessage}${requestId?` · ${requestIdLabel}: ${requestId}`:""}`);
        }
      }finally{
        if(!controller.signal.aborted)setLoading(false);
      }
    },query?250:0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[direction,enabled,endpoint,errorMessage,onMetrics,page,pageSize,query,refreshKey,requestIdLabel,retryKey,sort,status]);

  useEffect(()=>{
    if(!enabled)return;
    const params=new URLSearchParams(searchParams.toString());
    if(query)params.set("q",query);else params.delete("q");
    if(page>1)params.set("page",String(page));else params.delete("page");
    if(pageSize!==10)params.set("pageSize",String(pageSize));else params.delete("pageSize");
    if(status!=="all")params.set("status",status);else params.delete("status");
    if(sort!=="primary")params.set("sort",sort);else params.delete("sort");
    if(direction!=="asc")params.set("direction",direction);else params.delete("direction");
    const next=params.toString();
    if(next!==searchParams.toString()){
      router.replace(next?`${pathname}?${next}`:pathname,{scroll:false});
    }
  },[direction,enabled,page,pageSize,pathname,query,router,searchParams,sort,status]);

  return {
    query,setQuery,page,setPage,pageSize,setPageSize,status,setStatus,sort,setSort,
    direction,setDirection,items,setItems,total,loading,error,
    retry:()=>setRetryKey(value=>value+1),
  };
}
