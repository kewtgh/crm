"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import {apiFetch,ApiClientError} from "@/lib/api-client";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {privacyCommandSchema,privacyPageSchema,privacyReceiptSchema,privacyViewSearch,readPrivacyView,type PrivacyCommand,type PrivacyPage,type PrivacyReceipt,type PrivacyView} from "@/lib/privacy-request-contract";
export function usePrivacyWorkspace(initial:PrivacyPage|null,initialView?:PrivacyView){
 const params=useSearchParams(),router=useRouter(),query=params.toString(),view=useMemo(()=>readPrivacyView(Object.fromEntries(new URLSearchParams(query))),[query]),key=JSON.stringify(view);
 const [data,setData]=useState(initial),[loaded,setLoaded]=useState(initial?JSON.stringify(initialView??view):""),[loading,setLoading]=useState(false),[failed,setFailed]=useState(initial===null),[writing,setWriting]=useState(false),[uncertain,setUncertain]=useState(false),[accepted,setAccepted]=useState<PrivacyReceipt|null>(null),[error,setError]=useState<unknown>(null);
 const sequence=useRef(0),controller=useRef<AbortController|null>(null),busy=useRef(false),attempt=useRef<string|null>(null),alive=useRef(true),refreshRef=useRef<()=>Promise<boolean|undefined>>(async()=>false);
 const cancel=useCallback(()=>{sequence.current++;controller.current?.abort();},[]);
 const changeView=useCallback((patch:Partial<PrivacyView>)=>{if(busy.current||attempt.current)return;router.replace('/privacy-requests?'+privacyViewSearch({...view,...patch}));},[router,view]);
 const refresh=useCallback(async()=>{
  if(busy.current||attempt.current)return;cancel();const current=sequence.current,read=new AbortController();controller.current=read;setLoading(true);
  try{const value=privacyPageSchema.parse(await apiFetch<unknown>('/api/privacy-requests?'+privacyViewSearch(view),{signal:read.signal}));if(!alive.current||read.signal.aborted||current!==sequence.current)return false;
   const last=Math.max(1,Math.ceil(value.total/view.pageSize));if(view.page>last){changeView({page:last});return false;}setData(value);setLoaded(key);setFailed(false);return true;
  }catch{if(alive.current&&!read.signal.aborted&&current===sequence.current)setFailed(true);return false;}
  finally{if(alive.current&&!read.signal.aborted&&current===sequence.current)setLoading(false);}
 },[cancel,changeView,key,view]);
 useEffect(()=>{refreshRef.current=refresh;alive.current=true;const timer=setTimeout(()=>void refresh(),0);return()=>{clearTimeout(timer);cancel();};},[cancel,refresh]);
 useEffect(()=>()=>{alive.current=false;cancel();},[cancel]);
 const mutate=async(input?:PrivacyCommand)=>{
  if(busy.current)return false;if(!attempt.current){if(!input)return false;attempt.current=JSON.stringify(privacyCommandSchema.parse(input));setAccepted(null);}
  busy.current=true;cancel();setWriting(true);setLoading(false);setError(null);setFailed(true);
  try{const response=await apiFetch<{item:unknown}>('/api/privacy-requests',{method:'POST',body:attempt.current}),receipt=privacyReceiptSchema.parse(response.item);if(!alive.current)return false;setAccepted(receipt);attempt.current=null;setUncertain(false);busy.current=false;setWriting(false);await refreshRef.current();return true;}
  catch(caught){if(alive.current){setError(caught);if(isDefinitiveMutationFailure(caught)){attempt.current=null;setUncertain(false);if(!(caught instanceof ApiClientError)||caught.code!=='PRIVACY_SNAPSHOT_CONFLICT')setFailed(false);}else setUncertain(true);}return false;}
  finally{busy.current=false;if(alive.current)setWriting(false);}
 };
 return{view,changeView,data:loaded===key?data:null,loading,current:loaded===key&&!failed&&!loading,failed,writing,uncertain,locked:writing||uncertain,accepted,error,refresh,mutate};
}
