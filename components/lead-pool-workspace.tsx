"use client";
import {NextActionInput} from "./next-action-input";
import {WorkspaceHeading} from "./workspace-heading";

import {UiIcon} from "./ui-icon";
import {FilterBar} from "./filter-bar";
import {QueueItem} from "./queue-item";
import {MoreActions} from "./more-actions";
import {RecordIdentity} from "./record-header";
import {localeIdentity} from "@/lib/ux-presentation";
import {leadFilterDefaults,leadAdvancedCount,leadAdvancedKeys,leadQueueActions,type LeadFilters} from "@/lib/frontline-presentation";
import {ReportScopeNotice} from "./report-scope-notice";
import type {ReportFilter} from "@/lib/management-trend-contract";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {isDefinitiveMutationFailure,settleMutation} from "@/lib/mutation-outcome";
import {apiFetch,ApiClientError} from "@/lib/api-client";
import type {PoolLead,listLeadPool,listLeadAssignmentHistory} from "@/lib/lead-assignment-repository";
import {leadStatuses} from "@/lib/lead-pool-input";
import {useI18n} from "./i18n-provider";
import {useAppUser,useCapability} from "./app-user-context";
import {useUserPreferences} from "./user-preferences-context";
import {AccessibleDrawer,InlineMessage,Pagination,StatusBadge} from "./ui";
import {EnrollmentRelation as EnrollmentRelationPicker} from "./enrollment-relation";
import {ProductCohortSelector} from "./product-cohort-selector";
import {CurrencySelect,MoneyInput,BilingualNameHint} from "./structured-inputs";
type Editor={kind:"create"|"claim"|"release"|"reassign"|"visibility"|"update"|"convert"|"history"|"archive";lead?:PoolLead};
export function LeadPoolWorkspace({initial,focusedLead=null,organizationId,initialReportFilter={}}:{initialReportFilter?:ReportFilter;initial:Awaited<ReturnType<typeof listLeadPool>>;focusedLead?:PoolLead|null;organizationId?:string}){
 const {t,locale,enumLabel}=useI18n(),{formatDate}=useUserPreferences(),user=useAppUser(),manage=useCapability("leads.manage"),manager=["SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER"].includes(user.role);
 const [data,setData]=useState(initial),[view,setView]=useState("all"),[editor,setEditor]=useState<Editor|null>(focusedLead?{kind:"history",lead:focusedLead}:null),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [filters,setFilters]=useState<LeadFilters>({...leadFilterDefaults}),[search,setSearch]=useState("");
 const [busy,setBusy]=useState(false),sequence=useRef(0),[asOf]=useState(()=>Date.now());
 const load=async(page=1,nextView=view,pageSize=data.pageSize,nextFilters=filters)=>{const token=++sequence.current;setBusy(true);try{const result=await apiFetch<Awaited<ReturnType<typeof listLeadPool>>>(`/api/leads?${new URLSearchParams({...initialReportFilter,...nextFilters,...(organizationId?{organization:organizationId}:{}),view:nextView,page:String(page),pageSize:String(pageSize)})}`);if(token===sequence.current){setData(result);setError("");}}catch(caught){if(token===sequence.current)setError(t(caught instanceof ApiClientError&&caught.status===403?"pool.forbidden":"pool.loadFailed"));}finally{if(token===sequence.current)setBusy(false);}};
 const apply=(next:LeadFilters)=>{setFilters(next);void load(1,view,data.pageSize,next);};
 const count=leadAdvancedCount(filters);
 const advanced=(draft:LeadFilters,change:(value:LeadFilters)=>void)=><div className="form-grid two-column">{["city","potentialMin","ageDays"].map(k=><label className="field" key={k}><span>{t(`pool.filter.${k}`)}</span><input value={draft[k as keyof LeadFilters]} type={k==="city"?"text":"number"} min={k==="potentialMin"?10:1} max={k==="potentialMin"?100:3650} onChange={e=>change({...draft,[k]:e.target.value})}/></label>)}{([["schoolType",["all","PUBLIC","PRIVATE","INTERNATIONAL","OTHER"]],["tier",["all","S","A","B","C","D"]],["keyContact",["all","yes","no"]],["sort",["newest","oldest","potential","tier"]]] as const).map(([key,values])=><label className="field" key={key}><span>{t(`pool.filter.${key}`)}</span><select value={draft[key]} onChange={e=>change({...draft,[key]:e.target.value})}>{values.map(v=><option key={v} value={v}>{v==="all"?t("common.all"):key==="tier"?v:key==="schoolType"?enumLabel(`channel.option.${v}`).label:t(`pool.option.${v}`)}</option>)}</select></label>)}</div>;
 return <div className="page-stack lead-workspace ux-lead-queue"><ReportScopeNotice filter={initialReportFilter}/><section className="page-heading-row"><div><p className="eyebrow">{t("leads.eyebrow")}</p><WorkspaceHeading>{t("leads.title")}</WorkspaceHeading><p>{t("frontline.queueHelp")}</p></div>{manage&&<button className="primary-button" onClick={()=>setEditor({kind:"create"})}><UiIcon name="add" size={16}/>{t("leads.new")}</button>}</section>{notice&&<InlineMessage type="info">{notice}</InlineMessage>}{error&&<InlineMessage type="error">{error}</InlineMessage>}
 <FilterBar search={search} onSearchChange={setSearch} onSearch={()=>apply({...filters,q:search})} placeholder={t("pool.filter.q")} pending={busy} applied={filters} defaults={{...filters,...Object.fromEntries(leadAdvancedKeys.map(key=>[key,leadFilterDefaults[key]]))}} onApply={apply} advancedCount={count} activeCount={count+Number(Boolean(filters.q))+Number(filters.status!=="all")} onReset={()=>{setSearch("");apply({...leadFilterDefaults});}} primaryFilters={<><label className="field"><span>{t("frontline.scope")}</span><select value={view} disabled={busy} onChange={e=>{setView(e.target.value);void load(1,e.target.value);}}>{["pool","mine","all"].map(value=><option key={value} value={value}>{t(`pool.view.${value}`)}</option>)}</select></label><label className="field"><span>{t("pool.filter.status")}</span><select value={filters.status} disabled={busy} onChange={e=>apply({...filters,status:e.target.value})}>{["all",...leadStatuses].map(value=><option key={value} value={value}>{value==="all"?t("common.all"):enumLabel(`leads.status.${value.toLowerCase()}`).label}</option>)}</select></label></>} renderAdvanced={advanced}/>
 <section className="ux-lead-items" aria-busy={busy}>{data.items.map(l=>{
   const actions=leadQueueActions(l,view,manage,manager),identity=localeIdentity(locale,l.subject_name_zh,l.subject_name_en),status=enumLabel(`leads.status.${l.status.toLowerCase()}`);
   const contextHref=l.organization_id?`/schools/${l.organization_id}`:l.household_id?`/households?tab=families&focus=${l.household_id}`:null;
   const next=l.next_action||t("ux.missing"),days=Math.max(0,Math.floor((asOf-Date.parse(l.created_at))/86400000));
   const source=["PROFILE","LEAD","CONTACT","OPPORTUNITY","EVENT","ATTRIBUTION"].includes(l.source)?t(`pool.source.${l.source}`):l.source;
   return <QueueItem key={l.id} identity={<h2><RecordIdentity nameZh={l.subject_name_zh} nameEn={l.subject_name_en}/></h2>} state={<StatusBadge tone={status.known&&l.status==="QUALIFIED"?"green":"gray"}>{status.label}</StatusBadge>}
     context={<dl><div><dt>{t("pool.owner")}</dt><dd>{l.is_mine?t("pool.you"):l.owner_name||t(l.owner_id?"experience.assigned":"pool.unassigned")}</dd></div><div><dt>{t("pool.age")}</dt><dd>{Number.isFinite(days)?t("frontline.ageDays",{count:days}):t("ux.missing")} · {formatDate(l.created_at)}</dd></div><div><dt>{t("pool.latestActivity")}</dt><dd>{l.latest_activity_at?formatDate(l.latest_activity_at,{includeTime:true}):t("ux.missing")}</dd></div></dl>}
     nextAction={<><b>{t("business.field.next_action")}</b><p>{next}</p></>}
     signal={<details className="lead-qualification-panel"><summary>{t("frontline.signal")}{l.partnership_potential_score!==null?` · ${l.partnership_potential_score}`:""}</summary><p>{l.city||t("ux.missing")} · {l.school_type?enumLabel(`channel.option.${l.school_type}`).label:t("ux.missing")} · {source}</p><dl><div><dt>{t("channel.field.commercial_tier")}</dt><dd>{l.commercial_tier??t("common.notSet")}</dd></div><div><dt>{t("leads.scoreLabel")}</dt><dd>{l.qualification_score}</dd></div><div><dt>{t("pool.keyPeople")}</dt><dd>{l.key_contact_count}</dd></div></dl></details>}
     primaryAction={actions.primary?<button className="primary-button" aria-label={`${t(`pool.${actions.primary}`)} · ${identity.primary}`} onClick={()=>setEditor({kind:actions.primary!,lead:l})}>{t(`pool.${actions.primary}`)}</button>:l.status==="CONVERTED"&&contextHref?<Link className="primary-button" href={contextHref}>{t("pool.viewAccount")}</Link>:<span className="ux-read-only">{t("frontline.readOnly")}</span>}
     secondaryLink={contextHref&&l.status!=="CONVERTED"?<Link className="secondary-button" href={contextHref}><UiIcon name="organization" size={16}/>{t("pool.viewAccount")}</Link>:null}
     more={<MoreActions label={t("frontline.more",{name:identity.primary})}>{actions.more.map(kind=><button type="button" role="menuitem" key={kind} onClick={()=>setEditor({kind,lead:l})}>{t(`pool.${kind}`)}</button>)}</MoreActions>}/>;
 })}{!data.items.length&&<p className="empty-state">{t(view==="pool"?"pool.empty":"leads.empty")}</p>}</section><Pagination page={data.page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={p=>void load(p)} onPageSize={size=>void load(1,view,size)}/>
 {editor&&<LeadEditor key={`${editor.kind}:${editor.lead?.id??"new"}`} editor={editor} manager={manager} onClose={()=>setEditor(null)} onSaved={async()=>{const kind=editor.kind;setEditor(null);setNotice(t(kind==="claim"?"pool.claimed":"business.saved"));if(kind==="claim"){setView("mine");await load(1,"mine");}else await load();}}/>}</div>;
}

function LeadEditor({editor,manager,onClose,onSaved}:{editor:Editor;manager:boolean;onClose:()=>void;onSaved:()=>Promise<void>}){
 const {t}=useI18n(),{formatDate}=useUserPreferences(),l=editor.lead,k=editor.kind;
 const [type,setType]=useState<"SCHOOL"|"HOUSEHOLD">("SCHOOL"),[subject,setSubject]=useState(""),[product,setProduct]=useState(""),[cohort,setCohort]=useState(""),[owner,setOwner]=useState(l?.owner_id??""),[error,setError]=useState(""),[pending,setPending]=useState(false),[saved,setSaved]=useState(false),[uncertain,setUncertain]=useState(false),[history,setHistory]=useState<Awaited<ReturnType<typeof listLeadAssignmentHistory>>>([]);
 const attempt=useRef<{url:string;body:unknown}|null>(null),id=useRef(crypto.randomUUID()),busy=useRef(false);
 useEffect(()=>{if(k==="history"&&l)void apiFetch<{items:typeof history}>(`/api/leads/${l.id}/history`).then(r=>setHistory(r.items)).catch(()=>setError(t("pool.loadFailed")));},[k,l,t]);
 const save=async(event?:React.FormEvent<HTMLFormElement>)=>{event?.preventDefault();if(busy.current||saved)return;if(!attempt.current&&event){const f=new FormData(event.currentTarget),key=crypto.randomUUID();let body:Record<string,unknown>,url="/api/leads";
 if(k==="create"){if(!subject){setError(t("leads.subjectRequired"));return;}body={operation:"create",id:id.current,requestKey:key,type,organizationId:type==="SCHOOL"?subject:null,householdId:type==="HOUSEHOLD"?subject:null,nameZh:f.get("nameZh"),nameEn:f.get("nameEn"),source:f.get("source"),score:Number(f.get("score")),note:f.get("note"),status:f.get("status"),poolVisibility:f.get("visibility")??"PRIVATE"};}
 else if(k==="update"){body={operation:"update",id:l!.id,expectedRevision:l!.revision,requestKey:key,status:f.get("status"),score:Number(f.get("score")),note:f.get("note"),nextAction:f.get("nextAction")};}
 else if(k==="archive"){url=`/api/leads/${l!.id}/archive`;body={expectedRevision:l!.revision,requestKey:key};}
 else if(k==="convert"){if(!product||!owner){setError(t("pool.productOwnerRequired"));return;}body={operation:"convert",id:l!.id,requestKey:key,titleZh:f.get("nameZh"),titleEn:f.get("nameEn"),amount:Number(f.get("amount")),currency:f.get("currency"),productId:product,cohortId:cohort||null,ownerId:owner};}
 else{url=`/api/leads/${l!.id}/${k}`;body={expectedRevision:l!.revision,requestKey:key,reason:f.get("reason")??"",...(k==="reassign"?{ownerId:owner}:{}),...(k==="visibility"?{visibility:f.get("visibility")}: {})};}attempt.current={url,body};}
 if(!attempt.current)return;busy.current=true;setPending(true);setError("");const request=attempt.current;
 const outcome=await settleMutation(async()=>{
  await apiFetch(request.url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request.body)});
  attempt.current=null;setUncertain(false);setSaved(true);
 },onSaved);
 if(outcome.state==="failed"){
  const caught=outcome.error;
  if(isDefinitiveMutationFailure(caught)){attempt.current=null;setUncertain(false);setError(t(caught.code.includes("ALREADY_CLAIMED")?"pool.alreadyClaimed":caught.code.includes("VERSION_CONFLICT")?"pool.conflict":caught.status===403?"pool.forbidden":"pool.invalid"));}
  else{setUncertain(true);setError(t("pool.uncertain"));}
 }else if(outcome.state==="saved-refresh-failed")setError(t("audit.savedRefreshFailed"));
 busy.current=false;setPending(false);};
 const refreshOnly=async()=>{if(busy.current)return;busy.current=true;setPending(true);try{await onSaved();}catch{setError(t("audit.savedRefreshFailed"));}finally{busy.current=false;setPending(false);}};

 return <AccessibleDrawer title={t(`pool.${k}`)} onClose={onClose} pending={pending||uncertain}>{k==="history"?<div className="detail-record-list">{history.map(h=><article key={h.id}><div>{t(`pool.event.${h.event_type}`)}<p>{h.from_owner_id||t("pool.unassigned")} → {h.to_owner_id||t("pool.unassigned")}</p><p>{h.reason}</p><small>{formatDate(h.changed_at,{includeTime:true})}</small></div></article>)}{!history.length&&<p>{t("pool.noHistory")}</p>}</div>:<form onSubmit={e=>void save(e)}><fieldset className="follow-up-fields" disabled={pending||uncertain||saved}>
 {k==="archive"&&<InlineMessage type="warning">{t("repair.recoverable")}</InlineMessage>}
 {k==="claim"&&<InlineMessage type="info">{t("pool.claimHelp")}</InlineMessage>}
 {k==="create"&&<><label className="field"><span>{t("leads.type")}</span><select value={type} onChange={e=>{setType(e.target.value as typeof type);setSubject("");}}><option value="SCHOOL">{t("leads.type.school")}</option><option value="HOUSEHOLD">{t("leads.type.household")}</option></select></label><EnrollmentRelationPicker type={type==="SCHOOL"?"ORGANIZATION":"HOUSEHOLD"} value={subject} onChange={setSubject} label={t("leads.subject")}/><label className="field"><span>{t("leads.source")}</span><input name="source" required maxLength={80}/></label></>}
 {(k==="create"||k==="convert")&&<div className="form-grid two-column"><label className="field"><span>{t("leads.titleZh")}</span><input name="nameZh" maxLength={120}/></label><label className="field"><span>{t("leads.titleEn")}</span><input name="nameEn" maxLength={160}/></label><BilingualNameHint/></div>}
 {(k==="create"||k==="update")&&<><label className="field"><span>{t("common.status")}</span><select name="status" defaultValue={l?.status??"NEW"}>{leadStatuses.filter(v=>v!=="CONVERTED").map(v=><option key={v} value={v}>{t(`leads.status.${v.toLowerCase()}`)}</option>)}</select></label><label className="field"><span>{t("leads.scoreLabel")}</span><input name="score" type="number" min={0} max={100} defaultValue={l?.qualification_score??0}/></label><label className="field"><span>{t("leads.note")}</span><textarea name="note" maxLength={1000} defaultValue={l?.qualification_note??""}/></label>{k==="update"&&<label className="field"><span>{t("business.field.next_action")}</span><NextActionInput name="nextAction" maxLength={1000} defaultValue={l?.next_action??""}/></label>}</>}
 {(k==="visibility"||k==="create"&&manager&&type==="SCHOOL")&&<label className="field"><span>{t("pool.visibility")}</span><select name="visibility" defaultValue={l?.pool_visibility??"PRIVATE"}>{["PRIVATE","WORKSPACE_PUBLIC"].map(v=><option key={v} value={v}>{t(`pool.option.${v}`)}</option>)}</select></label>}
 {(k==="release"||k==="reassign")&&<label className="field"><span>{t("pool.reason")}</span><textarea name="reason" required maxLength={1000}/></label>}
 {(k==="reassign"||k==="convert")&&<EnrollmentRelationPicker type="USER" value={owner} onChange={setOwner} label={t("pool.owner")}/>}
 {k==="convert"&&<><EnrollmentRelationPicker type="PRODUCT" value={product} onChange={id=>setProduct(id)} label={t("pool.product")}/><ProductCohortSelector productId={product} value={cohort} onChange={setCohort} usage="OPPORTUNITY"/><label className="field"><span>{t("leads.amount")}</span><MoneyInput name="amount" min={0} defaultValue="0" required/></label><label className="field"><span>{t("leads.currency")}</span><CurrencySelect name="currency" defaultValue="CNY" required/></label></>}
 </fieldset>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" disabled={pending||uncertain} onClick={onClose}>{t("common.cancel")}</button>{saved?<button className="primary-button" type="button" disabled={pending} onClick={()=>void refreshOnly()}>{t("reliability.refreshOnly")}</button>:<button className="primary-button" disabled={pending} type={uncertain?"button":"submit"} onClick={uncertain?()=>void save():undefined}>{t(uncertain?"business.retrySame":k==="archive"?"pool.archive":"common.save")}</button>}</div></form>}{error&&k==="history"&&<InlineMessage type="error">{error}</InlineMessage>}</AccessibleDrawer>;
}
