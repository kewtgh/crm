"use client";

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

  const loadThread=useCallback(async(id:string,messagePage?:number,messagePageSize=20,signal?:AbortSignal,keepError=false)=>{
    setThreadLoading(true);
    try{
      const params=new URLSearchParams({threadId:id,messagePageSize:String(messagePageSize)});
      if(messagePage)params.set("messagePage",String(messagePage));
      const result=await apiFetch<CommunicationThreadRecord>(`/api/communications?${params}`,{signal});
      setThread(result);
      if(!keepError)setError("");
      return result;
    }catch{
      if(!signal?.aborted)setError(t("communications.failed"));
      return null;
    }finally{
      if(!signal?.aborted)setThreadLoading(false);
    }
  },[t]);

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
    try{
      const params=new URLSearchParams({
        q:nextQuery.trim(),
        page:String(nextPage),
        pageSize:String(nextPageSize),
      });
      const result=await apiFetch<CommunicationInboxResult>(`/api/communications?${params}`,{signal});
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
      else setThread(null);
    }catch{
      if(!signal?.aborted)setError(t("communications.failed"));
    }finally{
      if(!signal?.aborted)setListLoading(false);
    }
  },[loadThread,t]);

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
    if(!thread||threadLoading||!thread.messages.some(message=>["QUEUED","PROCESSING"].includes(message.deliveryStatus)))return;
    const timer=window.setTimeout(()=>{
      void loadThread(thread.id,thread.messagePage,thread.messagePageSize);
    },5000);
    return()=>window.clearTimeout(timer);
  },[loadThread,thread,threadLoading]);

  const chooseThread=(id:string)=>{
    if(id===selectedId)return;
    messageRequest.current=null;
    selectedIdRef.current=id;
    setSelectedId(id);
    setThread(null);
    void loadThread(id);
  };

  const searchContacts=useCallback(async(value:string)=>{
    const result=await apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string;type:string}>}>(`/api/search/related?q=${encodeURIComponent(value)}`).catch(()=>({items:[]}));
    setContacts(result.items.filter(item=>item.type==="CONTACT").map(item=>({
      value:item.value.split(":")[1]??"",
      label:locale==="zh-CN"?item.labelZh:item.labelEn,
      detail:t("nav.people"),
    })));
  },[locale,t]);

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
            :t("communications.failed"));
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
    if(!thread||threadLoading)return;
    const form=new FormData(event.currentTarget);
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
    event.currentTarget.reset();
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
      <div><p className="eyebrow">{t("communications.eyebrow")}</p><h1>{t("communications.title")}</h1><p>{t("communications.help")}</p></div>
      <button className="primary-button" type="button" disabled={pending} onClick={()=>setOpen(true)}><Plus size={17}/>{t("communications.new")}</button>
    </section>
    <InlineMessage type="info">{t("communications.governance")}</InlineMessage>
    {error&&!open&&<InlineMessage type="error">{error}</InlineMessage>}
    <section className="communications-layout surface">
      <aside aria-label={t("communications.conversations")} aria-busy={listLoading}>
        <div className="communications-search"><SearchField value={query} onChange={value=>{setQuery(value);setPage(1);}} placeholder={t("communications.search")}/></div>
        {listLoading&&<p className="communications-loading" role="status">{t("common.loading")}</p>}
        {inbox.items.map(item=><button type="button" className={item.id===selectedId?"active":""} aria-pressed={item.id===selectedId} onClick={()=>chooseThread(item.id)} key={item.id}>
          <Mail size={17}/>
          <span><b>{locale==="zh-CN"?item.contactZh:item.contactEn}</b><small>{item.subject}</small></span>
          <StatusBadge tone={item.status==="OPEN"?"green":"gray"}>{t(`communications.status.${item.status.toLowerCase()}`)}</StatusBadge>
        </button>)}
        {!inbox.items.length&&<div className="empty-state"><span>{t(query?"communications.noResults":"communications.empty")}</span></div>}
        {inbox.total>0&&<div className="communications-pagination"><Pagination page={Math.min(inbox.page,listPages)} totalPages={listPages} total={inbox.total} pageSize={inbox.pageSize} onPage={setPage} onPageSize={value=>{setPageSize(value);setPage(1);}}/></div>}
      </aside>
      <article className="communication-thread" aria-busy={threadLoading}>
        {thread?<>
          <header><div><h2>{thread.subject}</h2><p>{locale==="zh-CN"?thread.contactZh:thread.contactEn} · {thread.email} · {t(`communications.purpose.${thread.purpose.toLowerCase()}`)}</p></div></header>
          <div className="communication-messages">{thread.messages.map(message=><div className={message.direction.toLowerCase()} key={message.id}>
            <p>{message.body}</p>
            <small>{formatDate(message.createdAt,{includeTime:true})} · {t(`communications.delivery.${message.deliveryStatus.toLowerCase()}`)} · {t("communications.attempts")} {message.direction==="OUTBOUND"?message.providerAttemptCount:message.attemptCount}{communicationFailureKeys.has(message.failureCode)?` · ${t(`communications.failure.${message.failureCode}`)}`:""}</small>
            {message.direction==="OUTBOUND"&&message.retryAllowed&&<button className="text-button" type="button" disabled={pending||threadLoading} onClick={()=>void retry(message.id)}><RotateCcw size={14}/>{t("communications.retry")}</button>}
          </div>)}</div>
          {thread.messageTotal>0&&<div className="communication-message-pagination"><Pagination page={Math.min(thread.messagePage,messagePages)} totalPages={messagePages} total={thread.messageTotal} pageSize={thread.messagePageSize} onPage={value=>void loadThread(thread.id,value,thread.messagePageSize)} onPageSize={value=>void loadThread(thread.id,undefined,value)}/></div>}
          <form className="communication-composer" onSubmit={send} onChange={()=>{if(!pending)messageRequest.current=null;}}>
            <label className="field"><span>{t("communications.message")}</span><textarea name="body" rows={4} required maxLength={10000} disabled={threadLoading}/></label>
            <div className="drawer-actions"><button className="secondary-button" name="intent" value="inbound" disabled={pending||threadLoading}>{t("communications.recordInbound")}</button><button className="primary-button" name="intent" value="send" disabled={pending||threadLoading}><Send size={16}/>{pending?t("common.processing"):t("communications.send")}</button></div>
          </form>
        </>:<div className="empty-state"><span>{t("communications.choose")}</span></div>}
      </article>
    </section>
    {open&&<AccessibleDrawer pending={pending} title={t("communications.new")} description={t("communications.purposeHelp")} onClose={()=>setOpen(false)}>
      <form onSubmit={create} onChange={()=>{if(!pending)threadRequest.current=null;}}>
        <SearchableSelect label={t("privacyRequests.contact")} value={contact} options={contacts} onChange={value=>{setContact(value);threadRequest.current=null;}} onSearch={searchContacts}/>
        <label className="field"><span>{t("communications.subject")}</span><input name="subject" required maxLength={200}/></label>
        <label className="field"><span>{t("communications.purpose")}</span><select name="purpose" defaultValue="SERVICE">{communicationPurposes.map(value=><option key={value} value={value}>{t(`communications.purpose.${value.toLowerCase()}`)}</option>)}</select><small>{t("communications.purposeClassification")}</small></label>
        {error&&<InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={()=>setOpen(false)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending?t("common.processing"):t("common.create")}</button></div>
      </form>
    </AccessibleDrawer>}
    {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
  </div>;
}
