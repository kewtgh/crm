"use client";
import {useRef,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {createReceiptAttempt} from "@/lib/receipt-attempt";
import {presentApiError} from "@/lib/api-error-presenter";
import {useI18n} from "@/components/i18n-provider";

export function useReceiptMutation(url:string) {
  const {t}=useI18n(),attempt=useRef(createReceiptAttempt()),busy=useRef(false);
  const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
  const send=async(payload:Record<string,unknown>)=>{
    if(busy.current)return false;busy.current=true;setPending(true);setError("");
    try{
      await apiFetch(url,{method:"POST",headers:{"content-type":"application/json"},body:attempt.current.prepare(payload)});
      attempt.current.clear();setUncertain(false);return true;
    }catch(caught){
      if(isDefinitiveMutationFailure(caught)){attempt.current.clear();setUncertain(false);setError(presentApiError(caught,t,"education.saveFailed").message);}
      else {setUncertain(true);setError(t("enrollments.uncertain"));}
      return false;
    }finally{busy.current=false;setPending(false);}
  };
  return {send,pending,uncertain,error};
}
