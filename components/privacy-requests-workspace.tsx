"use client";
import {useCallback,useRef,useState} from "react";
import Link from "next/link";
import {ShieldCheck,RefreshCw} from "lucide-react";
import {usePrivacyWorkspace} from "@/hooks/use-privacy-workspace";
import {useRemoteSearch} from "@/hooks/use-remote-search";
import {privacyNextStatuses,privacyTypes,privacyStatuses,type PrivacyCommand,type PrivacyPage,type PrivacyRequestRecord,type PrivacyView} from "@/lib/privacy-request-contract";
import {apiFetch} from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";
import {useAppUser,useCapability} from "./app-user-context";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {WorkspaceHeading} from "./workspace-heading";
import {AccessibleDrawer,InlineMessage,Pagination,SearchableSelect,StatusBadge} from "./ui";
export function PrivacyRequestsWorkspace({initial,initialView}:{initial:PrivacyPage|null;initialView?:PrivacyView}){
 const {t,locale}=useI18n(),{formatDate}=useUserPreferences(),user=useAppUser(),canManage=useCapability("privacyRequests.manage"),state=usePrivacyWorkspace(initial,initialView),latest=useRemoteSearch();
 const createForm=useRef<HTMLFormElement>(null);
 const [contact,setContact]=useState(""),[requestType,setRequestType]=useState("ACCESS"),[options,setOptions]=useState<Array<{value:string;label:string}>>([]),[searching,setSearching]=useState(false),[contactError,setContactError]=useState(false),[localError,setLocalError]=useState("");
 const [reviewing,setReviewing]=useState<PrivacyRequestRecord|null>(null),[nextStatus,setNextStatus]=useState(""),[identity,setIdentity]=useState("PENDING"),[decision,setDecision]=useState("");
 const search=useCallback(async(q:string)=>{setSearching(true);const result=await latest(signal=>apiFetch<{items:Array<{value:string;type:string;labelZh:string;labelEn:string}>}>('/api/search/related?types=CONTACT&q='+encodeURIComponent(q),{signal}));if(!result.current)return;setSearching(false);if('error' in result){setContactError(true);setOptions([]);return;}setContactError(false);setOptions(result.value.items.filter(item=>item.type==='CONTACT').map(item=>({value:item.value.slice(8),label:locale==='en'?item.labelEn:item.labelZh})));},[latest,locale]);
 const submit=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!state.current||state.locked)return;setLocalError("");const form=event.currentTarget,values=new FormData(form);if(!contact){setLocalError(t("privacyRequests.contactRequired"));return;}
  const changes=requestType==='CORRECTION'?Object.fromEntries(['nameZh','nameEn','email','phone','title'].map(key=>[key,String(values.get(key)??'').trim()]).filter(([,value])=>value)):{};
  if(requestType==='CORRECTION'&&!Object.keys(changes).length){setLocalError(t("privacyRequests.correctionRequired"));return;}
  if(await state.mutate({operation:'create',type:requestType as (typeof privacyTypes)[number],note:String(values.get('note')),contactId:contact,changes,requestKey:crypto.randomUUID()})){form.reset();setContact('');setRequestType('ACCESS');}
 };
 const open=(item:PrivacyRequestRecord)=>{if(!state.current||state.locked)return;setReviewing(item);setNextStatus(privacyNextStatuses(item)[0]??'');setIdentity(item.identityStatus);setDecision('');};
 const manage=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!reviewing||!state.current||state.locked)return;
  if(await state.mutate({operation:'manage',id:reviewing.id,reviewToken:reviewing.reviewToken,status:nextStatus as Extract<PrivacyCommand,{operation:'manage'}>['status'],identityStatus:identity as 'PENDING'|'VERIFIED'|'FAILED',decision,requestKey:crypto.randomUUID()}))setReviewing(null);
 };
 const retry=async()=>{if(await state.mutate()){if(!reviewing){createForm.current?.reset();setContact('');setRequestType('ACCESS');}setReviewing(null);}};
 const tone=(status:string)=>status==='FULFILLED'?'green':status==='REJECTED'||status==='EXECUTION_FAILED'?'red':'amber';
 const locked=state.locked||!state.current,secondReviewer=reviewing&&(reviewing.type==='EXPORT'||reviewing.type==='DELETION')&&reviewing.status==='WAITING_APPROVAL'&&reviewing.assignedTo===user.id&&nextStatus==='FULFILLED';
 const error=state.error?presentApiError(state.error,t,'privacyRequests.failed').message:'';
 return <div className="page-stack privacy-workspace">
  <section className="page-heading-row"><div><p className="eyebrow">{t('privacyRequests.eyebrow')}</p><WorkspaceHeading>{t('privacyRequests.title')}</WorkspaceHeading><p>{t('privacyFlow.scope')}</p></div><button type="button" className="secondary-button" disabled={state.locked||state.loading} onClick={()=>void state.refresh()}><RefreshCw size={16}/>{t('common.refresh')}</button></section>
  <InlineMessage type="info">{t('privacyRequests.identityHelp')}</InlineMessage>
  {state.accepted&&<InlineMessage type="success">{t(state.accepted.status==='EXECUTING'?'privacyFlow.queued':'privacyFlow.accepted')}</InlineMessage>}
  {state.failed&&!state.uncertain&&<InlineMessage type="warning">{t(state.accepted?'privacyFlow.savedRefreshFailed':'privacyFlow.readFailed')}</InlineMessage>}
  {state.uncertain&&<InlineMessage type="warning">{t('privacyFlow.uncertain')}</InlineMessage>}
  {state.loading&&<p role="status">{t('common.loading')}</p>}{error&&!reviewing&&<InlineMessage type="error">{error}</InlineMessage>}
  <form ref={createForm} className="surface v200-action-form" onSubmit={submit}><fieldset className="settings-edit-fields" disabled={locked}>
   <SearchableSelect label={t('privacyRequests.contact')} required value={contact} options={options} onChange={setContact} onSearch={search} loading={searching}/>{contactError&&<InlineMessage type="error">{t('privacyFlow.contactsFailed')}</InlineMessage>}
   <label className="field"><span>{t('privacyRequests.type')}</span><select name="type" value={requestType} onChange={event=>setRequestType(event.target.value)}>{privacyTypes.map(value=><option key={value} value={value}>{t('privacyRequests.type.'+value.toLowerCase())}</option>)}</select></label>
   {requestType==='CORRECTION'&&<fieldset className="form-grid two-column"><legend>{t('privacyRequests.correctionFields')}</legend>{['nameZh','nameEn','email','phone','title'].map(key=><label className="field" key={key}><span>{t('privacyFlow.field.'+key)}</span><input name={key} type={key==='email'?'email':'text'} maxLength={key==='email'?320:key==='phone'?80:160}/></label>)}</fieldset>}
   <label className="field"><span>{t('privacyRequests.note')}</span><textarea name="note" minLength={10} maxLength={2000} rows={3} required/></label>{localError&&<InlineMessage type="error">{localError}</InlineMessage>}
   <button className="primary-button" type="submit"><ShieldCheck size={16}/>{t(state.writing?'common.processing':'privacyRequests.submit')}</button>
  </fieldset></form>{state.uncertain&&!reviewing&&<button className="secondary-button" type="button" disabled={state.writing} onClick={()=>void retry()}>{t('business.retrySame')}</button>}
  <section className="surface privacy-triage"><fieldset className="privacy-filters" disabled={state.locked}>
   <label className="field"><span>{t('privacyFlow.status')}</span><select aria-label={t('privacyFlow.status')} value={state.view.status} onChange={event=>state.changeView({status:event.target.value as PrivacyView['status'],page:1})}>{['all',...privacyStatuses].map(value=><option key={value} value={value}>{t(value==='all'?'common.all':'privacyRequests.status.'+value.toLowerCase())}</option>)}</select></label>
   <label className="field"><span>{t('privacyRequests.type')}</span><select aria-label={t('privacyFlow.type')} value={state.view.type} onChange={event=>state.changeView({type:event.target.value as PrivacyView['type'],page:1})}>{['all',...privacyTypes].map(value=><option key={value} value={value}>{t(value==='all'?'common.all':'privacyRequests.type.'+value.toLowerCase())}</option>)}</select></label>
   <label className="field"><span>{t('privacyFlow.owner')}</span><select aria-label={t('privacyFlow.owner')} value={state.view.scope} onChange={event=>state.changeView({scope:event.target.value as PrivacyView['scope'],page:1})}><option value="all">{t('privacyFlow.visible')}</option><option value="mine">{t('privacyFlow.mine')}</option></select></label>
   <label className="field"><span>{t('privacyFlow.deadline')}</span><select aria-label={t('privacyFlow.deadline')} value={state.view.due} onChange={event=>state.changeView({due:event.target.value as PrivacyView['due'],page:1})}><option value="all">{t('common.all')}</option><option value="overdue">{t('privacyFlow.overdue')}</option></select></label>
  </fieldset><div className="v200-list" aria-busy={state.loading}>{state.data?.items.map(item=><article className="privacy-case" key={item.id}><span className="product-icon"><ShieldCheck size={18}/></span><div><b>{t('privacyRequests.type.'+item.type.toLowerCase())}</b><p>{item.note}</p><small>{t('privacyRequests.identity',{status:t('privacyRequests.identity.'+item.identityStatus.toLowerCase())})} · {t('privacyRequests.due',{date:formatDate(item.dueAt,{includeTime:true})})}</small>{item.executionStatus&&<small>{t('privacyFlow.execution.'+item.executionStatus)}</small>}{item.receiptSha256&&<small>{t("privacyRequests.receipt",{hash:item.receiptSha256.slice(0,12)})}</small>}{item.artifactExpiresAt&&<small>{t("privacyRequests.expires",{date:formatDate(item.artifactExpiresAt,{includeTime:true})})}</small>}{item.executionFailed&&<p className="danger-text">{t('privacyFlow.executionFailed')}</p>}</div><StatusBadge tone={tone(item.status)}>{t('privacyRequests.status.'+item.status.toLowerCase())}</StatusBadge>{canManage&&privacyNextStatuses(item).length>0&&<button className="secondary-button" type="button" disabled={locked} onClick={()=>open(item)}>{t('privacyRequests.review')}</button>}</article>)}</div>
   {state.current&&state.data?.items.length===0&&<div className="empty-state">{t('privacyRequests.empty')}</div>}
   {state.data&&<Pagination page={state.data.page} totalPages={Math.max(1,Math.ceil(state.data.total/state.view.pageSize))} total={state.data.total} pageSize={state.view.pageSize} onPage={page=>state.changeView({page})} onPageSize={pageSize=>state.changeView({pageSize:pageSize as PrivacyView['pageSize'],page:1})}/>}
  </section>
  {reviewing&&<AccessibleDrawer pending={state.locked} title={t('privacyRequests.reviewTitle')} description={t('privacyRequests.reviewHelp')} onClose={()=>setReviewing(null)}>
   <section className="privacy-review-context"><StatusBadge tone={tone(reviewing.status)}>{t('privacyRequests.status.'+reviewing.status.toLowerCase())}</StatusBadge><h3>{t('privacyRequests.type.'+reviewing.type.toLowerCase())}</h3><p>{reviewing.note}</p>{reviewing.contactId&&<Link href={'/people/'+reviewing.contactId}>{t('privacyFlow.contactContext')}</Link>}<dl>{Object.entries(reviewing.requestedChanges).map(([key,value])=><div key={key}><dt>{t('privacyFlow.field.'+key)}</dt><dd>{value||t('privacyFlow.clearValue')}</dd></div>)}</dl><p>{t('privacyRequests.identity',{status:t('privacyRequests.identity.'+reviewing.identityStatus.toLowerCase())})}</p>{reviewing.decisionNote&&<p>{reviewing.decisionNote}</p>}</section>
   <form onSubmit={manage}><fieldset className="settings-edit-fields" disabled={locked}><label className="field"><span>{t('privacyRequests.nextStatus')}</span><select value={nextStatus} onChange={event=>setNextStatus(event.target.value)}>{privacyNextStatuses(reviewing).map(status=><option key={status} value={status}>{t('privacyRequests.status.'+status.toLowerCase())}</option>)}</select></label>
    <label className="field"><span>{t('privacyRequests.identityStatus')}</span><select value={identity} onChange={event=>setIdentity(event.target.value)}>{['PENDING','VERIFIED','FAILED'].map(status=><option key={status} value={status}>{t('privacyRequests.identity.'+status.toLowerCase())}</option>)}</select></label><label className="field"><span>{t('privacyRequests.decision')}</span><textarea name="decision" value={decision} onChange={event=>setDecision(event.target.value)} minLength={3} maxLength={2000} required/></label>
    {(reviewing.type==='EXPORT'||reviewing.type==='DELETION')&&<InlineMessage type="warning">{t('privacyRequests.dualReview')}</InlineMessage>}{secondReviewer&&<InlineMessage type="warning">{t('privacyFlow.secondReviewer')}</InlineMessage>}{error&&<InlineMessage type="error">{error}</InlineMessage>}<button className="primary-button" type="submit" disabled={Boolean(secondReviewer)}>{t('common.confirm')}</button>
   </fieldset></form>{state.uncertain&&<button type="button" className="secondary-button" disabled={state.writing} onClick={()=>void retry()}>{t('business.retrySame')}</button>}{!state.current&&!state.locked&&<button type="button" className="secondary-button" onClick={()=>{setReviewing(null);void state.refresh();}}>{t('privacyFlow.reloadReview')}</button>}
  </AccessibleDrawer>}
 </div>;
}
