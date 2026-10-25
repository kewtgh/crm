"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {ApiClientError,apiFetch} from "@/lib/api-client";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {presentApiError} from "@/lib/api-error-presenter";
import {approvalPageSchema,approvalDecisionSchema,approvalDecisionResultSchema,type ApprovalPage,type ApprovalQuery,type ApprovalRecord,type ApprovalDecisionResult} from "@/lib/approval-contract";
import {canReviewApproval} from "@/lib/approval-review-policy";
import type {AppRole} from "@/lib/roles";
import {useI18n} from "@/components/i18n-provider";

export function useApprovalWorkspace(initial:ApprovalPage|null,initialQuery:ApprovalQuery,query:ApprovalQuery,actor:{id:string;role:AppRole},correctQuery:(query:ApprovalQuery)=>void){
 const {t}=useI18n(),key=JSON.stringify(query);
 const initialValid=initial&&initial.page<=Math.max(1,Math.ceil(initial.total/initial.pageSize));
 const [data,setData]=useState<ApprovalPage>(initial??{items:[],total:0,page:initialQuery.page,pageSize:initialQuery.pageSize,asOf:new Date().toISOString(),summary:{pending:0,approved:0,rejected:0,cancelled:0,expired:0,failedExecution:0,highPrivilegePending:0}});
 const [loadedKey,setLoadedKey]=useState<string|null>(initialValid?JSON.stringify(initialQuery):null),[loading,setLoading]=useState(false),[readFailed,setReadFailed]=useState(!initial);
 const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(""),[accepted,setAccepted]=useState<ApprovalDecisionResult|null>(null),[tick,setTick]=useState(0);
 const sequence=useRef(0),controller=useRef<AbortController|null>(null),busy=useRef(false),original=useRef<{id:string;body:string}|null>(null),unknown=useRef(false);
 const loaded=useRef(initialValid?JSON.stringify(initialQuery):null),requestedTick=useRef(0);
 const cancelRead=useCallback(()=>{sequence.current++;controller.current?.abort();},[]);
 const load=useCallback(async()=>{
  if(busy.current||original.current)return;
  const current=++sequence.current;controller.current?.abort();const active=new AbortController();controller.current=active;
  setLoading(true);setReadFailed(false);
  const next:ApprovalQuery=JSON.parse(key);
  const fetchPage=async()=>{
   const raw=await apiFetch<unknown>(`/api/approvals?${new URLSearchParams(Object.fromEntries(Object.entries(next).map(([name,value])=>[name,String(value)])))}`,{signal:active.signal});
   const parsed=approvalPageSchema.safeParse(raw);
   if(!parsed.success||parsed.data.page!==next.page||parsed.data.pageSize!==next.pageSize)throw new ApiClientError("INVALID_APPROVAL_RESPONSE",502);
   return parsed.data;
  };
  try{
   let result=await fetchPage();if(current!==sequence.current||active.signal.aborted)return;
   const last=Math.max(1,Math.ceil(result.total/next.pageSize));
   if(next.page>last){next.page=last;result=await fetchPage();if(current!==sequence.current||active.signal.aborted)return;}
   loaded.current=JSON.stringify(next);setData(result);setLoadedKey(loaded.current);
   if(loaded.current!==key)correctQuery(next);
  }catch{if(current===sequence.current&&!active.signal.aborted){loaded.current=null;setLoadedKey(null);setReadFailed(true);}}
  finally{if(current===sequence.current&&!active.signal.aborted)setLoading(false);}
 },[key,correctQuery]);
 useEffect(()=>{
  if(busy.current||original.current||loaded.current===key&&requestedTick.current===tick)return;
  requestedTick.current=tick;
  const timer=window.setTimeout(()=>void load(),query.q?250:0);
  return()=>{window.clearTimeout(timer);cancelRead();};
 },[cancelRead,key,load,query.q,tick]);
 useEffect(()=>()=>cancelRead(),[cancelRead]);
 const current=loadedKey===key,refreshOnly=Boolean(accepted)&&(!current||loading||readFailed);
 const locked=pending||uncertain||refreshOnly||loading||!current||readFailed;
 const canDecide=(item:ApprovalRecord)=>!locked&&canReviewApproval(actor,item)&&data.items.some(row=>row.id===item.id&&row.reviewToken===item.reviewToken&&row.canDecide);
 const decide=async(item?:ApprovalRecord,decision?:"APPROVED"|"REJECTED",comment="")=>{
  if(busy.current||item&&!canDecide(item))return null;
  if(!original.current){
   if(!item||!decision)return null;
   const payload=approvalDecisionSchema.safeParse({decision,comment,expectedReviewToken:item.reviewToken,requestKey:crypto.randomUUID()});
   if(!payload.success){setError(t(decision==="REJECTED"&&!comment.trim()?"approval.rejectRequired":"approvalReview.reload"));return null;}
   original.current={id:item.id,body:JSON.stringify(payload.data)};
  }
  const request=original.current,command=approvalDecisionSchema.parse(JSON.parse(request.body));
  busy.current=true;cancelRead();loaded.current=null;setLoadedKey(null);setLoading(false);setPending(true);setError("");setAccepted(null);
  let result:ApprovalDecisionResult;
  try{
   const raw=await apiFetch<{item?:unknown}>(`/api/approvals/${request.id}/decision`,{method:"POST",headers:{"content-type":"application/json"},body:request.body});
   const parsed=approvalDecisionResultSchema.safeParse(raw?.item);
   if(!parsed.success||parsed.data.id!==request.id||parsed.data.status!==command.decision.toLowerCase())throw new ApiClientError("INVALID_APPROVAL_RESPONSE",502);
   result=parsed.data;original.current=null;unknown.current=false;setUncertain(false);setAccepted(result);
  }catch(caught){
   if(isDefinitiveMutationFailure(caught)&&!unknown.current){original.current=null;setUncertain(false);setError(presentApiError(caught,t,"approval.saveFailed").message);}
   else {unknown.current=true;setUncertain(true);setError(t("approvalReview.uncertain"));}
   busy.current=false;setPending(false);if(!original.current)setTick(value=>value+1);return null;
  }
  busy.current=false;setPending(false);setTick(value=>value+1);return result;
 };
 return {data,current,loading,readError:readFailed?t("approvalReview.readFailed"):"",pending,uncertain,error,accepted,refreshOnly,locked,canDecide,decide,
  refresh:()=>{if(!busy.current&&!original.current)setTick(value=>value+1);},clearFeedback:()=>{if(!original.current&&!busy.current){setError("");setAccepted(null);}},
 };
}
