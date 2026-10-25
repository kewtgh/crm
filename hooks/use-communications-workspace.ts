"use client";

import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import {ApiClientError,apiFetch} from "@/lib/api-client";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {presentApiError} from "@/lib/api-error-presenter";
import {communicationCommandSchema,communicationInboxSchema,communicationResultSchema,communicationThreadSchema,type CommunicationCommand,type CommunicationResult,type CommunicationView} from "@/lib/communications-contract";
import type {CommunicationInboxResult,CommunicationThreadRecord} from "@/lib/v220-repository";
import {useI18n} from "@/components/i18n-provider";

const inboxKey=(view:CommunicationView)=>JSON.stringify({q:view.q,status:view.status,purpose:view.purpose,delivery:view.delivery,page:view.page,pageSize:view.pageSize});
export function useCommunicationsWorkspace(initial:CommunicationInboxResult|null,initialThread:CommunicationThreadRecord|null,initialView:CommunicationView,view:CommunicationView,canManage:boolean,correctView:(patch:Partial<CommunicationView>)=>void){
 const {t}=useI18n(),key=inboxKey(view);
 const [inbox,setInbox]=useState<CommunicationInboxResult>(initial??{items:[],total:0,page:initialView.page,pageSize:initialView.pageSize});
 const [loadedKey,setLoadedKey]=useState<string|null>(initial?inboxKey(initialView):null),[thread,setThread]=useState(initialThread);
 const [loadedThread,setLoadedThread]=useState<string|null>(initialThread?.id??null);
 const [listLoading,setListLoading]=useState(false),[threadLoading,setThreadLoading]=useState(false);
 const [listError,setListError]=useState(initial?"":t("commsRecovery.listFailed")),[threadError,setThreadError]=useState("");
 const [listTick,setListTick]=useState(0),[threadTick,setThreadTick]=useState(0);
 const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
 const [accepted,setAccepted]=useState<CommunicationResult|null>(null);
 const listSequence=useRef(0),threadSequence=useRef(0),listController=useRef<AbortController|null>(null),threadController=useRef<AbortController|null>(null);
 const firstList=useRef(true),firstThread=useRef(true),busy=useRef(false),original=useRef<string|null>(null),unknownOutcome=useRef(false);
 const inboxCurrent=loadedKey===key;
 const selectedId=view.thread||inbox.items[0]?.id||"";
 const selectedIdRef=useRef(selectedId);
 useLayoutEffect(()=>{selectedIdRef.current=selectedId;},[selectedId]);
 const cancelList=useCallback(()=>{listSequence.current++;listController.current?.abort();},[]);
 const cancelThread=useCallback(()=>{threadSequence.current++;threadController.current?.abort();},[]);
 const loadInbox=useCallback(async()=>{
  if(busy.current||original.current)return;
  const sequence=++listSequence.current;listController.current?.abort();const controller=new AbortController();listController.current=controller;
  setListLoading(true);setListError("");
  const next=JSON.parse(key) as Omit<CommunicationView,"thread">;
  const fetchPage=async()=>{
   const raw=await apiFetch<unknown>(`/api/communications?${new URLSearchParams(Object.fromEntries(Object.entries(next).map(([name,value])=>[name,String(value)])))}`,{signal:controller.signal});
   const parsed=communicationInboxSchema.safeParse(raw);
   if(!parsed.success||parsed.data.page!==next.page||parsed.data.pageSize!==next.pageSize)throw new ApiClientError("INVALID_COMMUNICATION_RESPONSE",502);
   return parsed.data;
  };
  try{
   let result=await fetchPage();if(sequence!==listSequence.current||controller.signal.aborted)return;
   const last=Math.max(1,Math.ceil(result.total/next.pageSize));
   if(next.page>last){next.page=last;result=await fetchPage();if(sequence!==listSequence.current||controller.signal.aborted)return;}
   setInbox(result);setLoadedKey(JSON.stringify(next));
   if(next.page!==JSON.parse(key).page)correctView({page:next.page});
  }catch{if(sequence===listSequence.current&&!controller.signal.aborted){setLoadedKey(null);setListError(t("commsRecovery.listFailed"));}}
  finally{if(sequence===listSequence.current&&!controller.signal.aborted)setListLoading(false);}
 },[key,correctView,t]);
 const loadThread=useCallback(async(id:string,messagePage?:number,messagePageSize=20)=>{
  if(busy.current||original.current||!id)return;
  const sequence=++threadSequence.current;threadController.current?.abort();const controller=new AbortController();threadController.current=controller;
  setThreadLoading(true);setThreadError("");
  const params=new URLSearchParams({threadId:id,messagePageSize:String(messagePageSize)});if(messagePage)params.set("messagePage",String(messagePage));
  try{
   const raw=await apiFetch<unknown>(`/api/communications?${params}`,{signal:controller.signal});
   if(sequence!==threadSequence.current||controller.signal.aborted||selectedIdRef.current!==id)return;
   const parsed=communicationThreadSchema.safeParse(raw);
   if(!parsed.success||parsed.data.id!==id)throw new ApiClientError("INVALID_COMMUNICATION_RESPONSE",502);
   setThread(parsed.data);setLoadedThread(id);
  }catch{if(sequence===threadSequence.current&&!controller.signal.aborted&&selectedIdRef.current===id){setLoadedThread(null);setThreadError(t("commsRecovery.threadFailed"));}}
  finally{if(sequence===threadSequence.current&&!controller.signal.aborted)setThreadLoading(false);}
 },[t]);
 useEffect(()=>{
  const skip=firstList.current&&initial!==null&&key===inboxKey(initialView)&&initial.page<=Math.max(1,Math.ceil(initial.total/initial.pageSize));firstList.current=false;if(skip)return;
  const timer=window.setTimeout(()=>void loadInbox(),JSON.parse(key).q?250:0);
  return()=>{window.clearTimeout(timer);cancelList();};
 },[cancelList,initial,initialView,key,listTick,loadInbox]);
 useEffect(()=>{
  const skip=firstThread.current&&initialThread?.id===selectedId;firstThread.current=false;if(skip)return;
  const timer=window.setTimeout(()=>{if(selectedId)void loadThread(selectedId);},0);
  return()=>{window.clearTimeout(timer);cancelThread();};
 },[cancelThread,initialThread,loadThread,selectedId,threadTick]);
 useEffect(()=>()=>{cancelList();cancelThread();},[cancelList,cancelThread]);
 const threadCurrent=Boolean(selectedId)&&loadedThread===selectedId;
 const visibleThread=thread?.id===selectedId?thread:null;
 const refreshOnly=Boolean(accepted)&&(!inboxCurrent||!threadCurrent||listLoading||threadLoading||Boolean(listError||threadError));
 const locked=pending||uncertain||refreshOnly;
 const ready=canManage&&!locked&&threadCurrent&&!threadLoading&&!threadError&&visibleThread?.status==="OPEN"&&Boolean(view.thread||inboxCurrent&&!listLoading&&!listError);
 useEffect(()=>{
  if(locked||!threadCurrent||threadLoading||threadError||!visibleThread?.messages.some(message=>["QUEUED","PROCESSING"].includes(message.deliveryStatus)))return;
  const timer=window.setTimeout(()=>void loadThread(visibleThread.id,visibleThread.messagePage,visibleThread.messagePageSize),5000);
  return()=>window.clearTimeout(timer);
 },[loadThread,locked,threadCurrent,threadError,threadLoading,visibleThread]);
 const execute=async(command?:CommunicationCommand)=>{
  if(!canManage||busy.current||command&&locked||command&&command.operation!=="thread"&&!ready)return null;
  if(!original.current){
   if(!command)return null;const parsed=communicationCommandSchema.safeParse(command);
   if(!parsed.success){setError(t("commsRecovery.reload"));return null;}
   original.current=JSON.stringify(parsed.data);
  }
  const body=original.current,payload=communicationCommandSchema.parse(JSON.parse(body));
  busy.current=true;cancelList();cancelThread();setListLoading(false);setThreadLoading(false);setLoadedKey(null);setLoadedThread(null);
  setPending(true);setError("");setAccepted(null);
  let result:CommunicationResult;
  try{
   const raw=await apiFetch<unknown>("/api/communications",{method:"POST",headers:{"content-type":"application/json"},body});
   const parsed=communicationResultSchema.safeParse(raw);
   if(!parsed.success||parsed.data.operation!==payload.operation||"threadId" in payload&&parsed.data.threadId!==payload.threadId||payload.operation==="retry"&&parsed.data.messageId!==payload.messageId)throw new ApiClientError("INVALID_COMMUNICATION_RESPONSE",502);
   result=parsed.data;original.current=null;unknownOutcome.current=false;setUncertain(false);setAccepted(result);
  }catch(caught){
   // A denied confirmation cannot prove the outcome of an earlier timed-out request.
   if(isDefinitiveMutationFailure(caught)&&!unknownOutcome.current){original.current=null;setUncertain(false);setError(presentApiError(caught,t,"communications.failed").message);}
   else {unknownOutcome.current=true;setUncertain(true);setError(t("commsRecovery.uncertain"));}
   busy.current=false;setPending(false);
   if(!original.current){setListTick(value=>value+1);setThreadTick(value=>value+1);}
   return null;
  }
  busy.current=false;setPending(false);setListTick(value=>value+1);setThreadTick(value=>value+1);
  return result;
 };
 return {inbox,inboxCurrent,thread:visibleThread,threadCurrent,selectedId,listLoading,threadLoading,listError,threadError,pending,uncertain,error,accepted,refreshOnly,locked,ready,execute,
  refreshInbox:()=>{if(!busy.current&&!original.current)setListTick(value=>value+1);},
  refreshThread:(page?:number,size?:number)=>{if(!busy.current&&!original.current)void loadThread(selectedId,page,size??visibleThread?.messagePageSize??20);},
 };
}
