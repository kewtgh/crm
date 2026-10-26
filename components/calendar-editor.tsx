"use client";

import {useRef,useState} from "react";
import {CalendarDays,MapPin,Users,Video} from "lucide-react";
import {AccessibleDrawer,InlineMessage,SearchableSelect} from "./ui";
import {DateInput,OptionInput} from "./structured-inputs";
import {useI18n} from "./i18n-provider";
import {useRemoteSearch} from "@/hooks/use-remote-search";
import {apiFetch} from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";
import {isDefinitiveMutationFailure} from "@/lib/mutation-outcome";
import {createReceiptAttempt} from "@/lib/receipt-attempt";
import {appointmentCreateSchema,type AppointmentCreate} from "@/lib/calendar-actions";
import {calendarRelationTypes,calendarReminders,reminderKeys} from "@/lib/calendar-workspace";
import {CHANNEL_OPTIONS} from "@/lib/structured-inputs";
import type {CalendarRecord} from "@/lib/calendar-repository";

type Relation={value:string;labelZh:string;labelEn:string;type:string};
export function CalendarEditor({date,persistent,onClose,onSaved,onWriting,onSettled}:{date:string;persistent:boolean;onClose:()=>void;onSaved:(item:CalendarRecord)=>void;onWriting:()=>void;onSettled:()=>void}) {
 const {t,locale}=useI18n(),latest=useRemoteSearch(),attempt=useRef(createReceiptAttempt()),busy=useRef(false);
 const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
 const [relation,setRelation]=useState<Relation|null>(null),[options,setOptions]=useState<Relation[]>([]),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState("");
 const searchRelated=async(query:string)=>{
  if(!persistent)return;setSearching(true);setSearchError("");
  const params=new URLSearchParams({q:query});
  const result=await latest(signal=>apiFetch<{items:Relation[];unavailable?:boolean}>(`/api/calendar/relations?${params}`,{signal}));
  if(!result.current)return;setSearching(false);
  if("error" in result){setSearchError(t("calendar.relatedLoadFailed"));return;}
  setOptions(result.value.items.filter(item=>calendarRelationTypes.some(type=>type===item.type)));if(result.value.unavailable)setSearchError(t("calendar.relatedLoadFailed"));
 };
 const choices=relation&&!options.some(item=>item.value===relation.value)?[relation,...options]:options;
 const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(busy.current)return;
  const form=new FormData(event.currentTarget);
  const [relatedType,relatedId]=relation?.value.split(":")??[null,null];
  const input={title:String(form.get("title")??""),locale,date:String(form.get("date")??""),time:String(form.get("time")??""),type:String(form.get("type")??""),channel:String(form.get("channel")??""),related:relation?(locale==="zh-CN"?relation.labelZh:relation.labelEn):t("calendar.unlinked"),relatedType,relatedId,reminder:Number(form.get("reminder")),attendees:String(form.get("attendees")??"").split(/[,;\n]/).map(value=>value.trim()).filter(Boolean).map(email=>({email,consentConfirmed:form.get("attendeeConsent")==="on"}))};
  // An unresolved attempt owns its original bytes, independent of form and locale changes.
  const body=attempt.current.prepare(input),parsed=appointmentCreateSchema.safeParse(JSON.parse(body));
  if(!parsed.success){attempt.current.clear();setError(t("calendarRecovery.invalid"));return;}
  const sent:AppointmentCreate=parsed.data;
  busy.current=true;setPending(true);setError("");onWriting();
  try{
   const result=persistent?await apiFetch<{item:{id:string;event_version:number}}>("/api/calendar",{method:"POST",headers:{"content-type":"application/json"},body}):{item:{id:crypto.randomUUID(),event_version:1}};
   if(!result.item?.id||!Number.isInteger(result.item.event_version)||result.item.event_version<1)throw new Error("INVALID_CALENDAR_RESULT");
   onSaved({id:result.item.id,eventVersion:result.item.event_version,date:sent.date,time:sent.time,title:sent.title,titleEn:sent.title,related:sent.related,relationType:sent.relatedType,incoming:false,type:sent.type,channel:sent.channel,reminder:reminderKeys[sent.reminder],deliveryStatus:sent.attendees.length?"QUEUED":"NONE"});
   attempt.current.clear();setUncertain(false);onSettled();
  }catch(caught){
   if(isDefinitiveMutationFailure(caught)){attempt.current.clear();setUncertain(false);onSettled();setError(presentApiError(caught,t,"calendar.saveFailed").message);}
   else {setUncertain(true);setError(t("calendarRecovery.uncertainCreate"));}
  }finally{busy.current=false;setPending(false);}
 };
 return <AccessibleDrawer pending={pending||uncertain} title={t("calendar.new")} eyebrow={t("eyebrow.newAppointment")} description={t("calendar.formHelp")} onClose={()=>{if(!busy.current&&!uncertain)onClose();}}>
  <form onSubmit={submit}>
   <fieldset className="calendar-editor-fields" disabled={pending||uncertain}>
    <label className="field"><span>{t("calendar.subject")}</span><input name="title" required maxLength={160} placeholder={t("calendar.subjectPlaceholder")}/></label>
    <div className="form-grid two-column"><label className="field"><span>{t("calendar.date")}</span><DateInput name="date" type="date" defaultValue={date} required/></label><label className="field"><span>{t("calendar.time")}</span><DateInput name="time" type="time" defaultValue="10:00" required/></label></div>
    <div className="form-grid two-column"><label className="field"><span>{t("calendar.type")}</span><select name="type" defaultValue="meeting"><option value="meeting">{t("calendar.meeting")}</option><option value="consultation">{t("calendar.consultation")}</option><option value="followup">{t("calendar.followup")}</option><option value="deadline">{t("calendar.deadline")}</option></select></label><label className="field"><span>{t("calendar.channel")}</span><span className="input-icon"><Video size={16}/><OptionInput name="channel" maxLength={80} defaultValue="Teams" options={CHANNEL_OPTIONS}/></span></label></div>
    <SearchableSelect label={t("calendar.related")} options={choices.map(item=>({value:item.value,label:locale==="zh-CN"?item.labelZh:item.labelEn,detail:t(item.type==="ORGANIZATION"?"calendar.relatedOrganization":item.type==="USER"?"calendarHistory.relation.member":"calendar.relatedContact")}))} value={relation?.value??""} onChange={value=>setRelation(choices.find(item=>item.value===value)??null)} onSearch={searchRelated} loading={searching} placeholder={t("calendar.relatedPlaceholder")}/>
    {relation?.type==="USER"&&<p className="field-help">{t("calendarInvite.help")}</p>}
    <label className="field"><span>{t("calendar.attendees")}</span><textarea name="attendees" rows={3} maxLength={5000} placeholder={t("calendar.attendeesPlaceholder")}/></label>
    <label className="check-row"><input name="attendeeConsent" type="checkbox"/><span>{t("calendar.attendeeConsent")}</span></label>
    <label className="field"><span>{t("calendar.remindAt")}</span><select name="reminder" defaultValue="1440">{calendarReminders.map(value=><option value={value} key={value}>{t(reminderKeys[value])}</option>)}</select></label>
   </fieldset>
   <div className="appointment-hints"><span><Users size={16}/>{t("calendar.deliveryHelp")}</span><span><MapPin size={16}/>{t("calendar.locationHelp")}</span></div>
   {searchError&&<InlineMessage type="warning">{searchError}</InlineMessage>}{error&&<InlineMessage type="error">{error}</InlineMessage>}
   <div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending||uncertain} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={pending} aria-busy={pending}><CalendarDays size={17}/>{t(pending?"common.processing":uncertain?"business.retrySame":"calendar.save")}</button></div>
  </form>
 </AccessibleDrawer>;
}
