"use client";

import {useRef,useState} from "react";
import {ApiClientError,apiFetch} from "@/lib/api-client";
import {createReceiptAttempt} from "@/lib/receipt-attempt";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {presentApiError} from "@/lib/api-error-presenter";
import {confirmedTaskCompletion,taskCompletionSchema,type TaskCompletionDraft} from "@/lib/task-completion";
import {useI18n} from "@/components/i18n-provider";

/** One frozen intention until acceptance or an authoritative rejection. Never auto-retry a write. */
export function useTaskCompletion(){
  const {t}=useI18n();
  const attempt=useRef(createReceiptAttempt()),body=useRef<string|null>(null),busy=useRef(false);
  const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
  const send=async(draft?:TaskCompletionDraft)=>{
    if(busy.current)return null;
    if(!body.current){
      const next=attempt.current.prepare(draft??{});
      if(!taskCompletionSchema.safeParse(JSON.parse(next)).success){attempt.current.clear();setError(t("taskQueue.reload"));return null;}
      body.current=next;
    }
    const original=body.current,command=taskCompletionSchema.parse(JSON.parse(original));
    busy.current=true;setPending(true);setError("");
    try{
      const single=command.operation==="complete";
      const value=await apiFetch<unknown>(single?`/api/tasks/${command.tasks[0].id}`:"/api/tasks",{method:single?"PATCH":"POST",headers:{"content-type":"application/json"},body:original});
      const result=confirmedTaskCompletion(value,command);
      if(!result)throw new ApiClientError("INVALID_TASK_COMPLETION_RESULT",502);
      body.current=null;attempt.current.clear();setUncertain(false);return result;
    }catch(caught){
      if(isDefinitiveMutationFailure(caught)){body.current=null;attempt.current.clear();setUncertain(false);setError(presentApiError(caught,t,"dashboard.taskCompleteFailed").message);}
      else {setUncertain(true);setError(t("taskQueue.uncertain"));}
      return null;
    }finally{busy.current=false;setPending(false);}
  };
  return {send,pending,uncertain,error};
}
