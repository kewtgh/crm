"use client";
import { RecordDeleteAction } from "./record-delete-action";
import {commercialFields} from "@/lib/channel-commercial-input";
import {ApplicationSelector} from "./application-selector";

import Link from "next/link";
import {ProductCohortSelector} from "./product-cohort-selector";
import {EnrollmentRelation} from "./enrollment-relation";
import { useCallback,useEffect,useRef,useState } from "react";
import { apiFetch,ApiClientError } from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";
import { businessConfig,businessResourcesFor,businessSaveSchema,businessWarnings,type BusinessContext,type BusinessField,type BusinessRecord,type BusinessResource } from "@/lib/education-business";
import type { BusinessPage } from "@/lib/education-business-repository";
import { useCapability } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { useUserPreferences } from "./user-preferences-context";
import { AccessibleDrawer,InlineMessage,Pagination,SearchableSelect } from "./ui";
import { DateInput } from "./structured-inputs";
import { DetailTabs } from "./detail-tabs";
import { useRemoteSearch } from "@/hooks/use-remote-search";

type SaveAttempt={resource:BusinessResource;id:string;expectedRevision:number|null;data:Record<string,unknown>};
const subjectKey:Record<BusinessResource,string>={organizations:"id",needs:"id",pathways:"student_id",events:"organization_id",referrals:"source_organization_id",participations:"household_id",applications:"student_id"};
function initialDraft(resource:BusinessResource,context?:BusinessContext):Record<string,unknown>{
  const result=Object.fromEntries(businessConfig[resource].fields.map(field=>[field.key,field.kind==="multi"?[]:field.kind==="number"||field.kind==="date"||field.kind==="relation"?null:resource==="organizations"&&commercialFields.includes(field.key as typeof commercialFields[number])&&field.kind==="enum"?null:field.initial??""]));
  if(resource==="organizations"||resource==="needs")result.id=null;
  if(resource==="organizations")result.organization_type="";
  if(context){
    if(context.type===businessConfig[resource].subject)result[subjectKey[resource]]=context.id;
    if(resource==="referrals")result[context.type==="HOUSEHOLD"?"household_id":"source_organization_id"]=context.id;
  }
  return result;
}
function referenceHref(type:string,id:string){
  if(type==="CONTACT")return `/people/${id}`;
  if(type==="ORGANIZATION")return `/schools/${id}`;
  if(type==="HOUSEHOLD")return `/households?focus=${id}`;
  if(type==="APPLICATION")return `/applications?focus=${id}`;
  if(type==="STUDENT")return `/students?focus=${id}`;
  return `/education-business?subject=ORGANIZATION&subjectId=${id}`;
}

export function EducationBusinessWorkspace({context,initialResource,embedded=false}:{context?:BusinessContext;initialResource?:BusinessResource;embedded?:boolean}){
  const {t}=useI18n();const canManage=useCapability("education.manage");const {formatDate}=useUserPreferences();
  const resources=embedded&&initialResource?[initialResource].filter(key=>businessResourcesFor(context).includes(key)):businessResourcesFor(context);
  const [resource,setResource]=useState<BusinessResource>(initialResource&&resources.includes(initialResource)?initialResource:resources[0]);
  const [pageSize,setPageSize]=useState(20);
  const [data,setData]=useState<BusinessPage|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [editor,setEditor]=useState<{record:BusinessRecord|null;token:string}|null>(null),[pending,setPending]=useState(false);
  const runLoad=useRemoteSearch();
  const load=useCallback(async(page=1,signal?:AbortSignal)=>{
    setLoading(true);
    const params=new URLSearchParams({resource,page:String(page),pageSize:String(pageSize)});
    if(context){params.set("subject",context.type);params.set("subjectId",context.id);}
    const result=await runLoad(current=>apiFetch<BusinessPage>(`/api/education-business?${params}`,{signal:signal?AbortSignal.any([signal,current]):current}));
    if(!result.current||signal?.aborted)return false;
    setLoading(false);
    if("error" in result){setError(t("business.loadFailed"));return false;}
    setData(result.value);setError("");return true;
  },[resource,context,t,runLoad,pageSize,setData,setError,setLoading]);
  useEffect(()=>{const controller=new AbortController();const timer=setTimeout(()=>void load(1,controller.signal),0);return()=>{clearTimeout(timer);controller.abort();};},[load]);
  const saved=async()=>{setEditor(null);setNotice(t("business.saved"));const refreshed=await load(data?.page??1);if(!refreshed)setNotice(t("business.savedRefreshFailed"));};
  const label=(row:BusinessRecord)=>resource==="events"?String(row.name):resource==="applications"?String(row.title):data?.labels[`${resource==="needs"||resource==="participations"?"HOUSEHOLD":resource==="pathways"?"STUDENT":"ORGANIZATION"}:${row[subjectKey[resource]]}`]??t("business.unavailable");
  const showValue=(row:BusinessRecord,field:BusinessField)=>{
    const value=row[field.key];
    if(value===null||value===undefined||value===""||Array.isArray(value)&&!value.length)return t("business.unknown");
    if(field.kind==="multi")return (value as string[]).map(option=>t(`business.option.${option}`)).join(" · ");
    if(field.kind==="enum")return t(`business.option.${value}`);
    if(field.kind==="date")return formatDate(String(value),{dateOnly:true});
    if(field.kind==="relation"){
      const name=data?.labels[`${field.relation}:${value}`];
      return name?(["EVENT","PRODUCT","COHORT","CAMPAIGN"].includes(field.relation!)?<span>{name}</span>:<Link href={referenceHref(field.relation!,String(value))}>{name}</Link>):t("business.unavailable");
    }
    return String(value);
  };
  return <div className="page-stack education-business-workspace">
    <section className="page-heading-row"><div><p className="eyebrow">{t("business.eyebrow")}</p>{embedded?<h2>{t(`business.resource.${resource}`)}</h2>:<h1>{t("business.title")}</h1>}<p>{t("business.description")}</p></div><div className="page-actions"><button className="secondary-button" disabled={loading||pending} onClick={()=>void load(data?.page??1)}>{t("common.refresh")}</button>{canManage&&<button className="primary-button" disabled={pending} onClick={()=>{setError("");setEditor({record:null,token:crypto.randomUUID()});}}>{t(`business.add.${resource}`)}</button>}</div></section>
    {context&&!embedded&&<InlineMessage type="info"><b>{data?.labels[`${context.type}:${context.id}`]??t("common.loading")}</b> · {t("business.contextHelp")} <Link href="/education-business">{t("business.allRecords")}</Link></InlineMessage>}
    <InlineMessage type="info">{t(`business.help.${resource}`)}</InlineMessage>
    {error&&<InlineMessage type="error">{error}<button className="text-button" disabled={loading} onClick={()=>void load(data?.page??1)}>{t("common.retry")}</button></InlineMessage>}
    {notice&&<InlineMessage type="info">{notice}</InlineMessage>}
    <DetailTabs hideNavigation={embedded} items={resources.map(key=>({key,label:`business.resource.${key}`}))} active={resource} onChange={key=>{setResource(key as BusinessResource);setData(null);setNotice("");setError("");}} disabled={pending||!!editor} label={t("business.title")}>
      {loading&&<p role="status">{t("common.loading")}</p>}
      {data&&<><p>{t("business.total",{count:data.total})}</p><div className="business-record-grid">{data.items.map(row=><article className="detail-section business-record-card" key={row.id}>
        <div className="surface-heading"><h2>{label(row)}</h2>{canManage&&data.editableIds.includes(row.id)&&<button className="secondary-button" onClick={()=>setEditor({record:row,token:row.id})}>{t("crm.edit")}</button>}{canManage&&data.editableIds.includes(row.id)&&<RecordDeleteAction kind={({organizations:"ORGANIZATION_PROFILE",needs:"FAMILY_NEED",pathways:"PATHWAY",events:"OUTREACH_EVENT",referrals:"REFERRAL",participations:"EVENT_PARTICIPATION",applications:"APPLICATION"} as const)[resource]} id={row.id} onDeleted={()=>load(data.page)}/>}</div>
        <dl className="customer-profile">{businessConfig[resource].fields.filter(field=>["campaign_id","product_id","cohort_id","roles","partnership_stage","services","budget_min","budget_max","budget_currency","stage","program_type","kind","starts_on","status","referred_on","household_id","event_id","party_size","due_on","title","next_action"].includes(field.key)).map(field=><div key={field.key}><dt>{t(`business.field.${field.key}`)}</dt><dd>{showValue(row,field)}</dd></div>)}</dl>
        {businessWarnings(resource,row,data.today).map(warning=><p className="business-warning" key={warning}>{t(`business.warning.${warning}`)}</p>)}
        <details><summary>{t("business.details")}</summary><dl className="customer-profile">{businessConfig[resource].fields.map(field=><div key={field.key}><dt>{t(`business.field.${field.key}`)}</dt><dd>{showValue(row,field)}</dd></div>)}</dl><small>{t("business.updated")}: {formatDate(row.updated_at,{includeTime:true})}</small></details>
      </article>)}</div>{!data.items.length&&!loading&&<div className="empty-state">{t("business.empty")}</div>}<Pagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} onPage={page=>void load(page)} onPageSize={setPageSize}/></>}
    </DetailTabs>
    {editor&&<BusinessEditor key={`${resource}:${editor.token}`} resource={resource} context={context} record={editor.record} token={editor.token} labels={data?.labels??{}} onClose={()=>setEditor(null)} onSaved={saved} onPending={setPending}/>}
  </div>;
}

function BusinessEditor({resource,context,record,token,labels,onClose,onSaved,onPending}:{resource:BusinessResource;context?:BusinessContext;record:BusinessRecord|null;token:string;labels:Record<string,string>;onClose:()=>void;onSaved:()=>Promise<void>;onPending:(value:boolean)=>void}){
  const {t}=useI18n();const config=businessConfig[resource];
  const [draft,setDraft]=useState<Record<string,unknown>>(()=>record?Object.fromEntries([...config.fields.map(field=>field.key),...(resource==="organizations"||resource==="needs"?["id"]:[])].map(key=>[key,record[key]])):initialDraft(resource,context));
  const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(""),[invalidField,setInvalidField]=useState("");
  const attempt=useRef<SaveAttempt|null>(null),busy=useRef(false);
  const change=(key:string,value:unknown)=>{if(resource==="organizations"&&commercialFields.includes(key as typeof commercialFields[number])&&value===""&&config.fields.find(f=>f.key===key)?.kind==="enum")value=null;setDraft(previous=>({...previous,[key]:value,...(key==="student_id"?{application_id:null}:{})}));setInvalidField("");setError("");};
  const save=async(event?:React.FormEvent)=>{
    event?.preventDefault();if(busy.current)return;
    const payload=attempt.current??{resource,id:record?.id??(resource==="organizations"||resource==="needs"?String(draft.id??""):token),expectedRevision:record?.revision??null,data:draft};
    const parsed=businessSaveSchema.safeParse(payload);
    if(!parsed.success){const path=parsed.error.issues[0]?.path;setInvalidField(String(path?.at(-1)??"id"));setError(t("business.invalid"));return;}
    attempt.current=structuredClone(parsed.data);busy.current=true;setPending(true);onPending(true);setError("");
    try{
      await apiFetch("/api/education-business",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(attempt.current)});
      attempt.current=null;setUncertain(false);await onSaved();
    }catch(caught){
      if(caught instanceof ApiClientError&&caught.status>=400&&caught.status<500){
        attempt.current=null;setUncertain(false);
        setError(caught.code.startsWith("COMMERCIAL_")?presentApiError(caught,t,"commercial.saveFailed").message:t(caught.code==="BUSINESS_VERSION_CONFLICT"?"business.conflict":caught.code==="BUSINESS_UPDATE_FORBIDDEN"?"business.forbidden":caught.code==="BUSINESS_EVENT_SOURCE_MISMATCH"?"business.eventMismatch":caught.code==="BUSINESS_CAPACITY_EXCEEDED"?"business.capacityExceeded":caught.code==="BUSINESS_EVENT_CANCELLED"||caught.code==="BUSINESS_ACTIVE_PARTICIPATIONS"?"business.cancelledEvent":caught.code==="RECORD_CONFLICT"?"business.duplicateParticipation":caught.code==="BUSINESS_PARENT_IMMUTABLE"?"business.parentImmutable":"business.invalid"));
      }else{setUncertain(true);setError(t("business.uncertain"));}
    }finally{busy.current=false;setPending(false);onPending(false);}
  };
  const subjectField:BusinessField|undefined=resource==="organizations"?{key:"id",kind:"relation",relation:"ORGANIZATION",required:true}:resource==="needs"?{key:"id",kind:"relation",relation:"HOUSEHOLD",required:true}:undefined;
  const fields=subjectField?[subjectField,...config.fields]:config.fields;
  return <AccessibleDrawer title={t(`business.resource.${resource}`)} description={t(`business.help.${resource}`)} onClose={onClose} pending={pending||uncertain}>
    <form onSubmit={event=>void save(event)} className="page-stack"><fieldset className="follow-up-fields" disabled={pending||uncertain}><div className="form-grid two-column">{fields.map(field=>{
      const value=draft[field.key];const locked=!!record&&["id",subjectKey[resource],...(resource==="referrals"?["household_id"]:resource==="participations"?["event_id"]:[])].includes(field.key)||!!context&&((context.type===config.subject&&field.key===subjectKey[resource])||resource==="referrals"&&field.key===(context.type==="HOUSEHOLD"?"household_id":"source_organization_id"));
      const fieldLabel=field.key==="id"?t(resource==="organizations"?"business.field.organization_id":"business.field.household_id"):t(`business.field.${field.key}`);
      if(field.key==="application_id")return <ApplicationSelector key={`${field.key}:${draft.student_id}`} studentId={String(draft.student_id??"")} value={String(value??"")} initialLabel={labels["APPLICATION:"+value]} disabled={pending||uncertain} onChange={value=>change(field.key,value||null)}/>;
      if(field.key==="cohort_id")return <ProductCohortSelector key={field.key} usage="EVENT" productId={String(draft.product_id??"")} value={String(value??"")} disabled={pending||uncertain} onChange={value=>change(field.key,value||null)}/>;
      if(field.key==="campaign_id")return <EnrollmentRelation key={field.key} type="CAMPAIGN" label={fieldLabel} value={String(value??"")} initialLabel={labels['CAMPAIGN:'+value]} disabled={pending||uncertain} onChange={value=>change(field.key,value||null)}/>;
      if(field.kind==="relation")return <BusinessRelation key={field.key} field={field} label={fieldLabel} value={String(value??"")} initialLabel={labels[`${field.relation}:${value}`]} disabled={pending||uncertain||locked} onChange={value=>change(field.key,value||null)}/>;
      if(field.kind==="multi")return <fieldset className="business-choices" key={field.key}><legend>{fieldLabel}</legend>{field.options!.map(option=><label key={option}><input type="checkbox" checked={(value as string[]).includes(option)} onChange={event=>change(field.key,event.target.checked?[...(value as string[]),option]:(value as string[]).filter(item=>item!==option))}/>{t(`business.option.${option}`)}</label>)}</fieldset>;
      return <label className="field" key={field.key}><span>{fieldLabel}</span>{field.kind==="enum"?<select name={field.key} required={field.required} value={String(value??"")} onChange={event=>change(field.key,event.target.value)} aria-invalid={invalidField===field.key}>{!field.options!.includes("")&&<option value="">{t("business.select")}</option>}{field.options!.map(option=><option key={option} value={option}>{option?t(`business.option.${option}`):t("business.unknown")}</option>)}</select>:field.kind==="date"?<DateInput name={field.key} required={field.required} value={String(value??"")} onChange={event=>change(field.key,event.target.value||null)} aria-invalid={invalidField===field.key}/>:field.kind==="number"?<input name={field.key} type="number" step={field.integer?"1":"any"} min={field.min} max={field.max} value={String(value??"")} onChange={event=>change(field.key,event.target.value===""?null:Number(event.target.value))} aria-invalid={invalidField===field.key}/>:<textarea name={field.key} rows={field.key==="next_action"?3:1} required={field.required} maxLength={field.max} value={String(value??"")} onChange={event=>change(field.key,event.target.value)} aria-invalid={invalidField===field.key}/>}</label>;
    })}</div></fieldset>
    {error&&<InlineMessage type="error">{error}{invalidField&&<span> {t(`business.field.${invalidField}`)}</span>}</InlineMessage>}
    {uncertain&&<button type="button" className="primary-button" disabled={pending} onClick={()=>void save()}>{t("business.retrySame")}</button>}
    <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending||uncertain} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={pending||uncertain}>{pending?t("common.saving"):t("common.save")}</button></div>
    </form>
  </AccessibleDrawer>;
}

function BusinessRelation({field,label,value,initialLabel,disabled,onChange}:{field:BusinessField;label:string;value:string;initialLabel?:string;disabled:boolean;onChange:(value:string)=>void}){
  const {t,locale}=useI18n();const [options,setOptions]=useState<Array<{value:string;label:string}>>([]),[error,setError]=useState("");const latest=useRemoteSearch();
  const search=async(query:string)=>{
    const result=await latest(signal=>field.relation==="EVENT"?apiFetch<BusinessPage>(`/api/education-business?resource=events&q=${encodeURIComponent(query)}&pageSize=20`,{signal}).then(page=>page.items.map(row=>({value:row.id,label:String(row.name)}))):apiFetch<{items:Array<{value:string;labelZh:string;labelEn:string}>}>(`/api/search/related?types=${field.relation}&q=${encodeURIComponent(query)}`,{signal}).then(result=>result.items.map(item=>({value:item.value.split(":")[1],label:(locale==="en"?item.labelEn:item.labelZh)||item.labelZh||item.labelEn}))));
    if(!result.current)return;
    if("error" in result){setError(t("modules.relatedSearchFailed"));return;}
    setOptions(result.value);setError("");
  };
  const selected=value&&!options.some(item=>item.value===value)?[{value,label:initialLabel??t("business.selectedContext")}]:[];
  return <fieldset className="follow-up-fields" disabled={disabled}><SearchableSelect label={label} value={value} options={[...selected,...options]} required={field.required} onChange={onChange} onSearch={search}/>{!field.required&&value&&<button type="button" className="text-button" onClick={()=>onChange("")}>{t("business.clear")}</button>}{error&&<InlineMessage type="error">{error}</InlineMessage>}</fieldset>;
}
