"use client";
import {useRef,useState} from "react";
import {apiFetch,ApiClientError} from "@/lib/api-client";
import {useI18n} from "./i18n-provider";
// A response loss retains the exact request and receipt identity for an explicit retry.
export function useCommissionMutation(onSaved:()=>Promise<unknown>){
 const {t}=useI18n(),attempt=useRef<{url:string;body:unknown}|null>(null);
 const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
 const send=async(url?:string,body?:unknown)=>{if(pending)return false;if(!attempt.current&&url)attempt.current={url,body};if(!attempt.current)return false;setPending(true);setError("");let ok=false;
 try{await apiFetch(attempt.current.url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(attempt.current.body)});attempt.current=null;setUncertain(false);ok=true;}
 catch(e){if(e instanceof ApiClientError&&e.status<500){attempt.current=null;setUncertain(false);setError(t(e.status===403?"commission.forbidden":e.status===409?"commission.conflict":"commission.invalid"));}else{setUncertain(true);setError(t("commission.uncertain"));}}
 if(ok)try{await onSaved();}catch{setError(t("commission.loadFailed"));}setPending(false);return ok;};
 return {send,pending,uncertain,error,reset:()=>{if(!uncertain){setError("");attempt.current=null;}}};
}
