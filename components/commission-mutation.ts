"use client";
import {useRef,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {isDefinitiveMutationFailure,settleMutation} from "@/lib/mutation-outcome";
import {useI18n} from "./i18n-provider";
// A response loss retains the exact request and receipt identity for an explicit retry.
export function useCommissionMutation(onSaved:()=>Promise<unknown>){
 const {t}=useI18n(),attempt=useRef<{url:string;body:unknown}|null>(null),busy=useRef(false);
 const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
 const send=async(url?:string,body?:unknown)=>{
  if(busy.current)return false;if(!attempt.current&&url)attempt.current={url,body};if(!attempt.current)return false;
  busy.current=true;setPending(true);setError("");const request=attempt.current;
  const outcome=await settleMutation(async()=>{
   await apiFetch(request.url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request.body)});
   attempt.current=null;setUncertain(false);
  },onSaved);
  if(outcome.state==="failed"){
   const e=outcome.error;
   if(isDefinitiveMutationFailure(e)){attempt.current=null;setUncertain(false);setError(t(e.status===403?"commission.forbidden":e.status===409?"commission.conflict":"commission.invalid"));}
   else{setUncertain(true);setError(t("commission.uncertain"));}
  }else if(outcome.state==="saved-refresh-failed")setError(t("audit.savedRefreshFailed"));
  busy.current=false;setPending(false);return outcome.state!=="failed";
 };
 return {send,pending,uncertain,error,reset:()=>{if(!busy.current&&!uncertain){setError("");attempt.current=null;}}};
}
