"use client";

import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import {Mail,Plus,RefreshCw,RotateCcw,Send} from "lucide-react";
import {WorkspaceHeading} from "./workspace-heading";
import {AccessibleDrawer,ConfirmDialog,InlineMessage,Pagination,SearchableSelect,SearchField,StatusBadge} from "./ui";
import {useI18n} from "./i18n-provider";
import {useCapability} from "./app-user-context";
import {useUserPreferences} from "./user-preferences-context";
import {apiFetch} from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";
import {useRemoteSearch} from "@/hooks/use-remote-search";
import {useCommunicationsWorkspace} from "@/hooks/use-communications-workspace";
import {communicationDefaults,communicationPurposes,readCommunicationView,writeCommunicationView,type CommunicationResult,type CommunicationView} from "@/lib/communications-contract";
import type {CommunicationInboxResult,CommunicationThreadRecord} from "@/lib/v220-repository";

const communicationFailureKeys=new Set(["PROVIDER_REJECTED","PROVIDER_UNAVAILABLE","PROVIDER_INVALID_RESPONSE","RECIPIENT_EMAIL_UNAVAILABLE","CONSENT_REVOKED","DELIVERY_CONFIGURATION_UNAVAILABLE","MAX_PROVIDER_ATTEMPTS","THREAD_CLOSED","LEASE_EXPIRED_BEFORE_PROVIDER_ATTEMPT","LEASE_EXPIRED_AFTER_PROVIDER_ATTEMPT","IDEMPOTENCY_WINDOW_EXPIRED"]);

export function CommunicationsInboxPage({initial,initialThread,initialView=communicationDefaults}:{initial:CommunicationInboxResult|null;initialThread:CommunicationThreadRecord|null;initialView?:CommunicationView}){
 const {locale,t}=useI18n(),{formatDate}=useUserPreferences(),canManage=useCapability("messages.manage");
 const router=useRouter(),pathname=usePathname(),params=useSearchParams(),search=params.toString();
 const view=useMemo(()=>readCommunicationView(new URLSearchParams(search)),[search]);
 const location=useRef({pathname,search,view});
 useLayoutEffect(()=>{location.current={pathname,search,view};},[pathname,search,view]);
 const navigate=useCallback((patch:Partial<CommunicationView>,replace=false)=>{
  const current=location.current,next=writeCommunicationView(new URLSearchParams(current.search),{...current.view,...patch}).toString();
  (replace?router.replace:router.push)(current.pathname+(next?"?"+next:""),{scroll:false});
 },[router]);
 const correctView=useCallback((patch:Partial<CommunicationView>)=>navigate(patch,true),[navigate]);
 const state=useCommunicationsWorkspace(initial,initialThread,initialView,view,canManage,correctView);
 const [open,setOpen]=useState(false),[contact,setContact]=useState(""),[subject,setSubject]=useState(""),[purpose,setPurpose]=useState<(typeof communicationPurposes)[number]>("SERVICE");
 const [contacts,setContacts]=useState<Array<{value:string;label:string;detail:string}>>([]),[formError,setFormError]=useState("");
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[exitHref,setExitHref]=useState<string|null>(null);
 const runContacts=useRemoteSearch(),{thread,selectedId}=state;
 const dirty=Object.values(drafts).some(value=>Boolean(value.trim()))||open&&Boolean(contact||subject.trim());
 useEffect(()=>{
  if(!dirty&&!state.pending&&!state.uncertain)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
  const leave=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const anchor=(event.target as Element).closest<HTMLAnchorElement>("a[href]");if(!anchor||anchor.target==="_blank"||anchor.hasAttribute("download"))return;
   const url=new URL(anchor.href,window.location.href),current=new URL(window.location.href);
   if(url.origin!==current.origin||url.pathname===current.pathname&&url.searchParams.get("tab")===current.searchParams.get("tab"))return;
   event.preventDefault();event.stopPropagation();setExitHref(url.pathname+url.search+url.hash);
  };
  window.addEventListener("beforeunload",warn);document.addEventListener("click",leave,true);
  return()=>{window.removeEventListener("beforeunload",warn);document.removeEventListener("click",leave,true);};
 },[dirty,state.pending,state.uncertain]);
 const change=(patch:Partial<CommunicationView>,replace=false)=>{if(!state.pending&&!state.uncertain)navigate(patch,replace);};
 const searchContacts=useCallback(async(value:string)=>{
  if(!canManage)return;
  const result=await runContacts(signal=>apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string;type:string}>}>(`/api/search/related?types=CONTACT&q=${encodeURIComponent(value)}`,{signal}));
  if(!result.current)return;
  if("error" in result){setFormError(presentApiError(result.error,t,"modules.relatedSearchFailed").message);return;}
  setContacts(result.value.items.filter(item=>item.type==="CONTACT").map(item=>({value:item.value.split(":")[1]??"",label:locale==="zh-CN"?item.labelZh:item.labelEn,detail:t("nav.people")})));
 },[canManage,locale,runContacts,t]);
 const applyResult=(result:CommunicationResult|null)=>{
  if(!result)return;
  if(result.operation==="thread"){setOpen(false);setContact("");setSubject("");setPurpose("SERVICE");}
  if(result.operation==="send"||result.operation==="inbound")setDrafts(previous=>({...previous,[result.threadId]:""}));
  navigate({thread:result.threadId});
 };
 const create=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!canManage||state.locked)return;
  if(!contact){setFormError(t("communications.contactRequired"));return;}setFormError("");
  applyResult(await state.execute({operation:"thread",contactId:contact,subject,channel:"EMAIL",purpose,requestKey:crypto.randomUUID()}));
 };
 const send=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!state.ready||!thread)return;
  const submitter=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
  const operation=submitter?.value==="inbound"?"inbound":"send";
  applyResult(await state.execute({operation,threadId:thread.id,body:drafts[thread.id]??"",idempotencyKey:crypto.randomUUID()}));
 };
 const pages=Math.max(1,Math.ceil(state.inbox.total/view.pageSize)),filtered=Boolean(view.q||view.status!=="all"||view.purpose!=="all"||view.delivery!=="all");
 const retryOriginal=()=>void state.execute().then(applyResult);
 return <div className="page-stack communications-page" data-communication-current={state.inboxCurrent&&state.threadCurrent}>
  <section className="page-heading-row"><div><p className="eyebrow">{t("communications.eyebrow")}</p><WorkspaceHeading>{t("communications.title")}</WorkspaceHeading><p>{t("communications.help")}</p></div>{canManage&&<button className="primary-button" type="button" disabled={state.locked} onClick={()=>{setFormError("");setOpen(true);}}><Plus size={17}/>{t("communications.new")}</button>}</section>
  <InlineMessage type="info">{t(canManage?"communications.governance":"commsRecovery.readOnly")}</InlineMessage>
  {state.error&&!open&&<InlineMessage type={state.uncertain?"warning":"error"}>{state.uncertain?t("commsRecovery.uncertain"):state.error}</InlineMessage>}
  {state.uncertain&&!open&&<button className="primary-button communication-confirm" type="button" disabled={state.pending} onClick={retryOriginal}>{t("commsRecovery.confirmOriginal")}</button>}
  {state.accepted&&<InlineMessage type="info">{t(state.accepted.operation==="thread"?"communications.created":state.accepted.operation==="inbound"?"communications.recorded":"commsRecovery.accepted")}</InlineMessage>}
  {state.refreshOnly&&<InlineMessage type="warning">{t("commsRecovery.refreshOnly")}</InlineMessage>}
  <section className="communications-layout surface">
   <aside aria-label={t("communications.conversations")} aria-busy={state.listLoading}>
    <div className="communication-pane-heading"><b>{t("communications.conversations")}</b><button className="secondary-button" type="button" disabled={state.listLoading||state.pending||state.uncertain} onClick={state.refreshInbox}><RefreshCw size={15}/>{t("commsRecovery.refreshInbox")}</button></div>
    <fieldset disabled={state.pending||state.uncertain} className="communications-filters">
     <SearchField value={view.q} onChange={value=>change({q:value.slice(0,160),page:1},true)} placeholder={t("communications.search")}/>
     <label className="field"><span>{t("common.status")}</span><select value={view.status} onChange={event=>change({status:event.target.value as CommunicationView["status"],page:1})}><option value="all">{t("common.all")}</option>{["OPEN","CLOSED"].map(value=><option key={value} value={value}>{t(`communications.status.${value.toLowerCase()}`)}</option>)}</select></label>
     <label className="field"><span>{t("communications.purpose")}</span><select value={view.purpose} onChange={event=>change({purpose:event.target.value as CommunicationView["purpose"],page:1})}><option value="all">{t("common.all")}</option>{communicationPurposes.map(value=><option key={value} value={value}>{t(`communications.purpose.${value.toLowerCase()}`)}</option>)}</select></label>
     <label className="field"><span>{t("commsRecovery.delivery")}</span><select value={view.delivery} onChange={event=>change({delivery:event.target.value as CommunicationView["delivery"],page:1})}>{["all","pending","failed","uncertain"].map(value=><option key={value} value={value}>{t(value==="all"?"common.all":`commsRecovery.delivery.${value}`)}</option>)}</select></label>
     {filtered&&<button className="secondary-button" type="button" onClick={()=>change({...communicationDefaults,pageSize:view.pageSize,thread:selectedId})}>{t("commsRecovery.reset")}</button>}
    </fieldset>
    {state.listError&&<InlineMessage type="error">{state.listError}</InlineMessage>}
    {state.listLoading&&<p className="communications-loading" role="status">{t("common.loading")}</p>}
    <div className="communications-threads">{state.inbox.items.map(item=><button type="button" disabled={state.pending||state.uncertain||!state.inboxCurrent||state.listLoading} className={item.id===selectedId?"active":""} aria-pressed={item.id===selectedId} onClick={()=>change({thread:item.id})} key={item.id}>
     <Mail size={17}/><span><b>{locale==="zh-CN"?item.contactZh:item.contactEn}</b><small>{item.subject}</small></span><StatusBadge tone={item.status==="OPEN"?"green":"gray"}>{t(`communications.status.${item.status.toLowerCase()}`)}</StatusBadge>
    </button>)}</div>
    {!state.inbox.items.length&&state.inboxCurrent&&!state.listLoading&&!state.listError&&<div className="empty-state"><span>{t(filtered?"communications.noResults":"communications.empty")}</span></div>}
    {state.inboxCurrent&&<fieldset disabled={state.pending||state.uncertain||state.listLoading} className="communications-pagination"><Pagination page={Math.min(state.inbox.page,pages)} totalPages={pages} total={state.inbox.total} pageSize={view.pageSize} onPage={page=>change({page})} onPageSize={pageSize=>change({pageSize,page:1})}/></fieldset>}
   </aside>
   <article className="communication-thread" aria-busy={state.threadLoading}>
    <div className="communication-pane-heading"><b>{t("commsRecovery.conversation")}</b><button className="secondary-button" type="button" disabled={!selectedId||state.threadLoading||state.pending||state.uncertain} onClick={()=>state.refreshThread()}><RefreshCw size={15}/>{t("commsRecovery.refreshThread")}</button></div>
    {state.threadError&&<InlineMessage type="error">{state.threadError}</InlineMessage>}
    {state.threadLoading&&<p className="communications-loading" role="status">{t("common.loading")}</p>}
    {thread?<>
     <header><h2>{thread.subject}</h2><p>{locale==="zh-CN"?thread.contactZh:thread.contactEn} · {thread.email} · {t(`communications.purpose.${thread.purpose.toLowerCase()}`)}</p>{thread.status!=="OPEN"&&<InlineMessage type="info">{t("commsRecovery.closed")}</InlineMessage>}</header>
     <div className="communication-messages">{thread.messages.map(message=><div className={message.direction.toLowerCase()} key={message.id}>
      <p>{message.body}</p><small>{formatDate(message.createdAt,{includeTime:true})} · {t(`communications.delivery.${message.deliveryStatus.toLowerCase()}`)} · {t("communications.attempts")} {message.direction==="OUTBOUND"?message.providerAttemptCount:message.attemptCount}{communicationFailureKeys.has(message.failureCode)?` · ${t(`communications.failure.${message.failureCode}`)}`:""}</small>
      {canManage&&message.direction==="OUTBOUND"&&message.retryAllowed&&thread.status==="OPEN"&&<button className="text-button" type="button" disabled={!state.ready} onClick={()=>void state.execute({operation:"retry",messageId:message.id,expectedUpdatedAt:message.retryToken,requestKey:crypto.randomUUID()}).then(applyResult)}><RotateCcw size={14}/>{t("communications.retry")}</button>}
     </div>)}</div>
     {thread.messageTotal>0&&<fieldset disabled={state.pending||state.uncertain||state.threadLoading} className="communication-message-pagination"><Pagination page={thread.messagePage} totalPages={Math.max(1,Math.ceil(thread.messageTotal/thread.messagePageSize))} total={thread.messageTotal} pageSize={thread.messagePageSize} onPage={page=>state.refreshThread(page)} onPageSize={size=>state.refreshThread(undefined,size)}/></fieldset>}
     {canManage&&<form className="communication-composer" onSubmit={send}>
      <label className="field"><span>{t("communications.message")} <span className="required-indicator">*</span></span><textarea name="body" rows={4} required maxLength={10000} disabled={!state.ready} value={drafts[selectedId]??""} onChange={event=>setDrafts(previous=>({...previous,[selectedId]:event.target.value}))}/><small>{t("commsRecovery.draftHelp")}</small></label>
      <div className="drawer-actions"><button className="secondary-button" name="intent" value="inbound" disabled={!state.ready}>{t("communications.recordInbound")}</button><button className="primary-button" name="intent" value="send" disabled={!state.ready}><Send size={16}/>{t(state.pending?"common.processing":"communications.send")}</button></div>
     </form>}
    </>:!state.threadLoading&&!state.threadError?<div className="empty-state"><span>{t("communications.choose")}</span></div>:null}
   </article>
  </section>
  {open&&canManage&&<AccessibleDrawer pending={state.pending||state.uncertain} title={t("communications.new")} description={t("communications.purposeHelp")} onClose={()=>setOpen(false)}>
   <form onSubmit={create}><fieldset disabled={state.pending||state.uncertain||state.refreshOnly}>
    <SearchableSelect label={t("privacyRequests.contact")} required value={contact} options={contacts} onChange={setContact} onSearch={searchContacts}/>
    <label className="field"><span>{t("communications.subject")} <span className="required-indicator">*</span></span><input name="subject" required minLength={2} maxLength={200} value={subject} onChange={event=>setSubject(event.target.value)}/></label>
    <label className="field"><span>{t("communications.purpose")} <span className="required-indicator">*</span></span><select name="purpose" value={purpose} onChange={event=>setPurpose(event.target.value as typeof purpose)}>{communicationPurposes.map(value=><option key={value} value={value}>{t(`communications.purpose.${value.toLowerCase()}`)}</option>)}</select><small>{t("communications.purposeClassification")}</small></label>
   </fieldset>{(formError||state.error)&&<InlineMessage type={state.uncertain?"warning":"error"}>{state.uncertain?t("commsRecovery.uncertain"):formError||state.error}</InlineMessage>}
   <div className="drawer-actions"><button className="secondary-button" type="button" data-drawer-dismiss disabled={state.pending||state.uncertain}>{t("common.cancel")}</button>{state.uncertain?<button className="primary-button" type="button" disabled={state.pending} onClick={retryOriginal}>{t("commsRecovery.confirmOriginal")}</button>:<button className="primary-button" disabled={state.pending||state.refreshOnly}>{t(state.pending?"common.processing":"common.create")}</button>}</div></form>
  </AccessibleDrawer>}
  {exitHref&&<ConfirmDialog title={t("flow.unsavedTitle")} description={t(state.uncertain||state.pending?"commsRecovery.leaveUnknown":"commsRecovery.leaveDrafts")} confirmLabel={t("flow.discard")} onClose={()=>setExitHref(null)} onConfirm={()=>{setExitHref(null);router.push(exitHref);}}/>}
 </div>;
}
