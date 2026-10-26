"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {z} from "zod";
import {apiFetch,ApiClientError} from "@/lib/api-client";
import {sessionRevocationSchema,trustedDevicesSchema,type TrustedDeviceView} from "@/lib/settings-contract";

type Notice={kind:"accepted"|"device"|"partial"|"unknown"|"missing";sessions?:boolean;devices?:boolean};
export function useTrustedDevices(){
 const [items,setItems]=useState<TrustedDeviceView[]|null>(null),[loading,setLoading]=useState(true),[stale,setStale]=useState(true),[failed,setFailed]=useState(false),[writing,setWriting]=useState(false),[notice,setNotice]=useState<Notice|null>(null);
 const controller=useRef<AbortController|null>(null),generation=useRef(0),busy=useRef(false),mounted=useRef(true);
 const cancel=useCallback(()=>{generation.current++;controller.current?.abort();},[]);
 const refresh=useCallback(async()=>{
  if(busy.current)return;
  cancel();const sequence=generation.current,read=new AbortController();controller.current=read;setLoading(true);
  try{
   const result=trustedDevicesSchema.parse(await apiFetch<unknown>("/api/settings/trusted-devices",{signal:read.signal}));
   if(!mounted.current||read.signal.aborted||sequence!==generation.current)return;
   setItems(result.devices);setStale(false);setFailed(false);
  }catch{if(mounted.current&&!read.signal.aborted&&sequence===generation.current){setStale(true);setFailed(true);}}
  finally{if(mounted.current&&!read.signal.aborted&&sequence===generation.current)setLoading(false);}
 },[cancel]);
 useEffect(()=>{mounted.current=true;const timer=setTimeout(()=>void refresh(),0);return()=>{clearTimeout(timer);mounted.current=false;cancel();};},[cancel,refresh]);
 const revoke=async(id?:string)=>{
  if(busy.current||id&&(loading||stale||!items?.some(item=>item.id===id)))return;
  busy.current=true;cancel();setLoading(false);setWriting(true);setStale(true);setNotice(null);
  let accepted=false;
  try{
   if(id){z.object({ok:z.literal(true)}).parse(await apiFetch<unknown>("/api/settings/trusted-devices",{method:"DELETE",body:JSON.stringify({scope:"device",id})}));if(mounted.current)setNotice({kind:"device"});accepted=true;}
   else{const result=sessionRevocationSchema.parse(await apiFetch<unknown>("/api/settings/sessions",{method:"DELETE"}));accepted=result.sessionsRevoked||result.trustedDevicesRevoked;if(mounted.current)setNotice(result.ok?{kind:"accepted"}:accepted?{kind:"partial",sessions:result.sessionsRevoked,devices:result.trustedDevicesRevoked}:{kind:"unknown"});}
  }catch(error){if(mounted.current)setNotice({kind:error instanceof ApiClientError&&error.code==="TRUSTED_DEVICE_NOT_FOUND"?"missing":"unknown"});}
  finally{busy.current=false;if(mounted.current)setWriting(false);}
  if(mounted.current&&accepted)await refresh();
 };
 return{items,loading,stale,failed,writing,notice,refresh,revoke};
}
