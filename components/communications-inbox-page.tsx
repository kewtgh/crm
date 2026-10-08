"use client";
import {WorkspaceHeading} from "./workspace-heading";


import { useCallback,useEffect,useRef,useState } from "react";
import { Mail,Plus,RotateCcw,Send } from "lucide-react";
import {
  AccessibleDrawer,
  InlineMessage,
  Pagination,
  SearchableSelect,
  SearchField,
  StatusBadge,
  Toast,
} from "./ui";
import { useI18n } from "./i18n-provider";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { useRemoteSearch } from "@/hooks/use-remote-search";
import type {
  CommunicationInboxResult,
  CommunicationThreadRecord,
} from "@/lib/v220-repository";
import { useUserPreferences } from "./user-preferences-context";

const communicationPurposes=["SERVICE","TRANSACTIONAL","EVENT","MARKETING"] as const;
type OperationResult={operation:"thread"|"send"|"inbound"|"retry";threadId:string;messageId?:string;deliveryStatus?:string;accepted?:boolean};
const communicationFailureKeys=new Set([
  "PROVIDER_REJECTED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_INVALID_RESPONSE",
  "RECIPIENT_EMAIL_UNAVAILABLE",
  "CONSENT_REVOKED",
  "DELIVERY_CONFIGURATION_UNAVAILABLE",
  "MAX_PROVIDER_ATTEMPTS",
  "THREAD_CLOSED",
  "LEASE_EXPIRED_BEFORE_PROVIDER_ATTEMPT",
  "LEASE_EXPIRED_AFTER_PROVIDER_ATTEMPT",
  "IDEMPOTENCY_WINDOW_EXPIRED",
]);

export function CommunicationsInboxPage({
  initial,
  initialThread,
}:{
  initial:CommunicationInboxResult;
  initialThread:CommunicationThreadRecord|null;
}){
  const{locale,t}=useI18n();
  const{formatDate}=useUserPreferences();
  const[inbox,setInbox]=useState(initial);
  const[selectedId,setSelectedId]=useState(initialThread?.id??initial.items[0]?.id??"");
  const[thread,setThread]=useState(initialThread);
  const[query,setQuery]=useState("");
  const[page,setPage]=useState(initial.page);
  const[pageSize,setPageSize]=useState(initial.pageSize);
  const[open,setOpen]=useState(false);
  const[contact,setContact]=useState("");
  const[contacts,setContacts]=useState<Array<{value:string;label:string;detail:string}>>([]);
  const[pending,setPending]=useState(false);
  const[listLoading,setListLoading]=useState(false);
  const[threadLoading,setThreadLoading]=useState(false);
  const[error,setError]=useState("");
  const[toast,setToast]=useState("");
  const[refreshToken,setRefreshToken]=useState(0);
  const initialLoad=useRef(true);
  const preferredThread=useRef<string|null>(null);
  const preserveErrorOnRefresh=useRef(false);
  const selectedIdRef=useRef(selectedId);
  const operationLock=useRef(false);
  const messageRequest=useRef<{operation:"send"|"inbound";threadId:string;body:string;key:string}|null>(null);
  const threadRequest=useRef<{contactId:string;subject:string;purpose:string;key:string}|null>(null);
  const runThread=useRemoteSearch(),runInbox=useRemoteSearch(),runContacts=useRemoteSearch();

  const loadThread=useCallback(async(id:string,messagePage?:number,messagePageSize=20,signal?:AbortSignal,keepError=false)=>{
    setThreadLoading(true);
    const params=new URLSearchParams({threadId:id,messagePageSize:String(messagePageSize)});
    if(messagePage)params.set("messagePage",String(messagePage));
    const result=await runThread(signal=>apiFetch<CommunicationThreadRecord>(`/api/communications?${params}`,{signal}),signal);
    if(!result.current||selectedIdRef.current!==id)return null;
    setThreadLoading(false);
    if("value" in result){
      if(result.value.id!==id)return null;
      setThread(result.value);
      if(!keepError)setError("");
      return result.value;
    }
    setError(presentApiError(result.error,t,"communications.failed").message);
    return null;
  },[runThread,t]);

  const loadInbox=useCallback(async(
    nextQuery:string,
    nextPage:number,
    nextPageSize:number,
    signal?:AbortSignal,
    preferred?:string|null,
  )=>{
    setListLoading(true);
    const keepError=preserveErrorOnRefresh.current;
    preserveErrorOnRefresh.current=false;
    const outcome=await runInbox(async signal=>{
      const params=new URLSearchParams({
        q:nextQuery.trim(),
        page:String(nextPage),
        pageSize:String(nextPageSize),
      });
      return apiFetch<CommunicationInboxResult>(`/api/communications?${params}`,{signal});
    },signal);
    if(!outcome.current)return;
    setListLoading(false);
    // A read started before a write must not change its selected conversation.
    if(operationLock.current)return;
    if("value" in outcome){
      const result=outcome.value;
      const currentSelected=selectedIdRef.current;
      const nextSelected=preferred&&result.items.some(item=>item.id===preferred)
        ?preferred
        :result.items.some(item=>item.id===currentSelected)
          ?currentSelected
          :(result.items[0]?.id??"");
      setInbox(result);
      setPage(result.page);
      setPageSize(result.pageSize);
      selectedIdRef.current=nextSelected;
      setSelectedId(nextSelected);
      if(!keepError)setError("");
      if(nextSelected){
        setThread(current=>current?.id===nextSelected?current:null);
        await loadThread(nextSelected,undefined,20,signal,keepError);
      }
      else {setThread(null);setThreadLoading(false);}
    }else{
      setError(presentApiError(outcome.error,t,"communications.failed").message);
    }
  },[loadThread,runInbox,t]);

  useEffect(()=>{
    if(initialLoad.current){initialLoad.current=false;return;}
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      const preferred=preferredThread.current;
      preferredThread.current=null;
      void loadInbox(query,page,pageSize,controller.signal,preferred);
    },query?250:0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[loadInbox,page,pageSize,query,refreshToken]);

  useEffect(()=>{
    if(pending||!thread||threadLoading||!thread.messages.some(message=>["QUEUED","PROCESSING"].includes(message.deliveryStatus)))return;
    const timer=window.setTimeout(()=>{
      if(!operationLock.current)void loadThread(thread.id,thread.messagePage,thread.messagePageSize);
    },5000);
    return()=>window.clearTimeout(timer);
  },[loadThread,pending,thread,threadLoading]);

  const chooseThread=(id:string)=>{
    if(operationLock.current||id===selectedId)return;
    messageRequest.current=null;
    selectedIdRef.current=id;
    setSelectedId(id);
    setThread(null);
    void loadThread(id);
  };

  const searchContacts=useCallback(async(value:string)=>{
    const result=await runContacts(signal=>apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string;type:string}>}>(`/api/search/related?types=CONTACT&q=${encodeURIComponent(value)}`,{signal}));
    if(!result.current)return;
    if("error" in result){setError(presentApiError(result.error,t,"modules.relatedSearchFailed").message);return;}
    setContacts(result.value.items.filter(item=>item.type==="CONTACT").map(item=>({
      value:item.value.split(":")[1]??"",
      label:locale==="zh-CN"?item.labelZh:item.labelEn,
      detail:t("nav.people"),
    })));
  },[locale,runContacts,t]);

  const refresh=(preferred?:string)=>{
    preferredThread.current=(preferred??selectedId)||null;
    setRefreshToken(value=>value+1);
  };

  const operate=async(body:Record<string,unknown>)=>{
    if(operationLock.current)return null;
    operationLock.current=true;
    setPending(true);
    setError("");
    try{
      return await apiFetch<OperationResult>("/api/communications",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(body),
      });
    }catch(caught){
      const code=caught instanceof Error?caught.message:"";
      setError(code.includes("CONSENT")
        ?t("communications.consentRequired")
        :code.includes("NOT_CONFIGURED")
          ?t("communications.deliveryMissing")
          :code.includes("IDEMPOTENCY_CONFLICT")
            ?t("communications.conflict")
            :presentApiError(caught,t,"communications.failed").message);
      preserveErrorOnRefresh.current=true;
      refresh();
      return null;
    }finally{
      operationLock.current=false;
      setPending(false);
    }
  };

  const create=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(operationLock.current)return;
    const form=new FormData(event.currentTarget);
    const subject=String(form.get("subject")??"").trim();
    const purpose=String(form.get("purpose")??"SERVICE");
    if(!contact){setError(t("communications.contactRequired"));return;}
    const prior=threadRequest.current;
    const request=prior&&prior.contactId===contact&&prior.subject===subject&&prior.purpose===purpose
      ?prior
      :{contactId:contact,subject,purpose,key:crypto.randomUUID()};
    threadRequest.current=request;
    const result=await operate({
      operation:"thread",
      contactId:contact,
      subject,
      channel:"EMAIL",
      purpose,
      requestKey:request.key,
    });
    if(!result)return;
    threadRequest.current=null;
    setOpen(false);
    setContact("");
    setQuery("");
    setPage(1);
    preferredThread.current=result.threadId;
    setRefreshToken(value=>value+1);
    setToast(t("communications.created"));
  };

  const send=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(operationLock.current||!thread||threadLoading||thread.id!==selectedIdRef.current)return;
    const formElement=event.currentTarget;
    const form=new FormData(formElement);
    const submitter=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
    const operation:"send"|"inbound"=submitter?.value==="inbound"?"inbound":"send";
    const body=String(form.get("body")??"").trim();
    const prior=messageRequest.current;
    const request=prior&&prior.operation===operation&&prior.threadId===thread.id&&prior.body===body
      ?prior
      :{operation,threadId:thread.id,body,key:crypto.randomUUID()};
    messageRequest.current=request;
    const result=await operate({operation,threadId:thread.id,body,idempotencyKey:request.key});
    if(!result)return;
    messageRequest.current=null;
    formElement.reset();
    refresh(result.threadId);
    setToast(t(operation==="inbound"?"communications.recorded":"communications.sent"));
  };

  const retry=async(messageId:string)=>{
    const result=await operate({operation:"retry",messageId});
    if(result){refresh(result.threadId);setToast(t("communications.retryQueued"));}
  };

  const listPages=Math.max(1,Math.ceil(inbox.total/inbox.pageSize));
  const messagePages=Math.max(1,Math.ceil((thread?.messageTotal??0)/(thread?.messagePageSize??20)));
  return <div className="page-stack communications-page">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t("communications.eyebrow")}</p><WorkspaceHeading>{t("communications.title")}</WorkspaceHeading><p>{t("communications.help")}</p></div>
      <button className="primary-button" type="button" disabled={pending} onClick={()=>setOpen(true)}><Plus size={17}/>{t("communications.new")}</button>
    </section>
    <InlineMessage type="info">{t("communications.governance")}</InlineMessage>
    {error&&!open&&<InlineMessage type="error">{error}</InlineMessage>}
    <section className="communications-layout surface">
      <aside aria-label={t("communications.conversations")} aria-busy={listLoading}>
        <fieldset disabled={pending} className="communications-search"><SearchField value={query} onChange={value=>{if(operationLock.current)return;setQuery(value);setPage(1);}} placeholder={t("communications.search")}/></fieldset>
        {listLoading&&<p className="communications-loading" role="status">{t("common.loading")}</p>}
        {inbox.items.map(item=><button type="button" disabled={pending} className={item.id===selectedId?"active":""} aria-pressed={item.id===selectedId} onClick={()=>chooseThread(item.id)} key={item.id}>
          <Mail size={17}/>
          <span><b>{locale==="zh-CN"?item.contactZh:item.contactEn}</b><small>{item.subject}</small></span>
          <StatusBadge tone={item.status==="OPEN"?"green":"gray"}>{t(`communications.status.${item.status.toLowerCase()}`)}</StatusBadge>
        </button>)}
        {!inbox.items.length&&<div className="empty-state"><span>{t(query?"communications.noResults":"communications.empty")}</span></div>}
        {inbox.total>0&&<fieldset disabled={pending} className="communications-pagination"><Pagination page={Math.min(inbox.page,listPages)} totalPages={listPages} total={inbox.total} pageSize={inbox.pageSize} onPage={setPage} onPageSize={value=>{setPageSize(value);setPage(1);}}/></fieldset>}
      </aside>
      <article className="communication-thread" aria-busy={threadLoading}>
        {thread?<>
          <header><div><h2>{thread.subject}</h2><p>{locale==="zh-CN"?thread.contactZh:thread.contactEn} · {thread.email} · {t(`communications.purpose.${thread.purpose.toLowerCase()}`)}</p></div></header>
          <div className="communication-messages">{thread.messages.map(message=><div className={message.direction.toLowerCase()} key={message.id}>
            <p>{message.body}</p>
            <small>{formatDate(message.createdAt,{includeTime:true})} · {t(`communications.delivery.${message.deliveryStatus.toLowerCase()}`)} · {t("communications.attempts")} {message.direction==="OUTBOUND"?message.providerAttemptCount:message.attemptCount}{communicationFailureKeys.has(message.failureCode)?` · ${t(`communications.failure.${message.failureCode}`)}`:""}</small>
            {message.direction==="OUTBOUND"&&message.retryAllowed&&<button className="text-button" type="button" disabled={pending||threadLoading} onClick={()=>void retry(message.id)}><RotateCcw size={14}/>{t("communications.retry")}</button>}
          </div>)}</div>
          {thread.messageTotal>0&&<fieldset disabled={pending} className="communication-message-pagination"><Pagination page={Math.min(thread.messagePage,messagePages)} totalPages={messagePages} total={thread.messageTotal} pageSize={thread.messagePageSize} onPage={value=>void loadThread(thread.id,value,thread.messagePageSize)} onPageSize={value=>void loadThread(thread.id,undefined,value)}/></fieldset>}
          <form className="communication-composer" onSubmit={send} onChange={()=>{if(!pending)messageRequest.current=null;}}>
            <label className="field"><span>{t("communications.message")} <span className="required-indicator">*</span></span><textarea name="body" rows={4} required maxLength={10000} disabled={pending||threadLoading}/></label>
            <div className="drawer-actions"><button className="secondary-button" name="intent" value="inbound" disabled={pending||threadLoading}>{t("communications.recordInbound")}</button><button className="primary-button" name="intent" value="send" disabled={pending||threadLoading}><Send size={16}/>{pending?t("common.processing"):t("communications.send")}</button></div>
          </form>
        </>:<div className="empty-state"><span>{t("communications.choose")}</span></div>}
      </article>
    </section>
    {open&&<AccessibleDrawer pending={pending} title={t("communications.new")} description={t("communications.purposeHelp")} onClose={()=>setOpen(false)}>
      <form onSubmit={create} onChange={()=>{if(!pending)threadRequest.current=null;}}>
        <fieldset disabled={pending}>
        <SearchableSelect label={t("privacyRequests.contact")} required value={contact} options={contacts} onChange={value=>{setContact(value);threadRequest.current=null;}} onSearch={searchContacts}/>
        <label className="field"><span>{t("communications.subject")} <span className="required-indicator">*</span></span><input name="subject" required minLength={2} maxLength={200}/></label>
        <label className="field"><span>{t("communications.purpose")} <span className="required-indicator">*</span></span><select name="purpose" defaultValue="SERVICE" required>{communicationPurposes.map(value=><option key={value} value={value}>{t(`communications.purpose.${value.toLowerCase()}`)}</option>)}</select><small>{t("communications.purposeClassification")}</small></label>
        </fieldset>
        {error&&<InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={()=>setOpen(false)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending?t("common.processing"):t("common.create")}</button></div>
      </form>
    </AccessibleDrawer>}
    {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
  </div>;
}
