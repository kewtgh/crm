"use client";
import {useRef,useState} from "react";
import {apiFetch,ApiClientError} from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";
import {successStatuses,successHealth,successGoalTypes,successGoalStatuses,successCaseSaveSchema,successGoalSaveSchema,type SuccessCaseData,type SuccessGoalData} from "@/lib/student-success-input";
import type {SuccessCase,SuccessGoal} from "@/lib/student-success-repository";
import type {EnrollmentRecord} from "@/lib/enrollment-repository";
import {enrollmentTimestamp} from "@/lib/enrollment-input";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {AccessibleDrawer,InlineMessage} from "./ui";
import {DateInput} from "./structured-inputs";
import {EnrollmentRelation} from "./enrollment-relation";

export function useSuccessSave(onSaved:()=>Promise<void>){
 const {t}=useI18n(),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(""),[conflict,setConflict]=useState(false),attempt=useRef<unknown>(null),busy=useRef(false);
 const save=async(input:unknown)=>{if(busy.current)return;attempt.current??=input;busy.current=true;setPending(true);setError("");setConflict(false);
  try{await apiFetch("/api/student-success",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(attempt.current)});}
  catch(error){const unknown=!(error instanceof ApiClientError)||error.status===0||error.status>=500;setUncertain(unknown);setConflict(error instanceof ApiClientError&&error.status===409);if(!unknown)attempt.current=null;setError(presentApiError(error,t,"success.saveFailed").message);busy.current=false;setPending(false);return;}
  attempt.current=null;setUncertain(false);try{await onSaved();}catch{setError(t("success.savedRefreshFailed"));}finally{busy.current=false;setPending(false);}
 };
 return{pending,uncertain,error,conflict,save,setError};
}
function SaveMessages({mutation}:{mutation:ReturnType<typeof useSuccessSave>}){const {t}=useI18n();return <>{mutation.error&&<InlineMessage type="error">{mutation.error}</InlineMessage>}{mutation.uncertain&&<InlineMessage type="warning">{t("success.uncertain")}</InlineMessage>}</>;}
function SaveActions({mutation,onClose,onReload}:{mutation:ReturnType<typeof useSuccessSave>;onClose:()=>void;onReload:()=>void}){const {t}=useI18n();return <div className="drawer-actions"><button className="secondary-button" type="button" disabled={mutation.pending||mutation.uncertain} onClick={onClose}>{t("common.cancel")}</button>{mutation.conflict&&<button className="secondary-button" type="button" onClick={onReload}>{t("success.reload")}</button>}<button className="primary-button" disabled={mutation.pending||mutation.conflict}>{t(mutation.pending?"common.saving":mutation.uncertain?"success.retry":"common.save")}</button></div>;}
export function SuccessCaseEditor({record,enrollment,onClose,onSaved,onReload}:{record?:SuccessCase;enrollment?:EnrollmentRecord;onClose:()=>void;onSaved:(id:string)=>Promise<void>;onReload:()=>void}){
 const {t,locale}=useI18n(),[id]=useState(()=>record?.id??crypto.randomUUID()),[reason,setReason]=useState(""),mutation=useSuccessSave(()=>onSaved(id));
 const [data,setData]=useState<SuccessCaseData>(()=>({enrollment_id:record?.enrollment_id??enrollment?.id??"",status:record?.status??"PLANNING",health_status:record?.health_status??"UNKNOWN",owner_id:record?record.owner_id:enrollment?.owner_id??null,next_review_on:record?.next_review_on??null,success_summary:record?.success_summary??null,plan_summary:record?.plan_summary??null}));
 const context=record??enrollment,label=(zh?:string|null,en?:string|null)=>(locale==="en"?en:zh)||zh||en||"—";
 const change=<K extends keyof SuccessCaseData>(key:K,value:SuccessCaseData[K])=>setData(old=>({...old,[key]:value}));
 const submit=(event:React.FormEvent)=>{event.preventDefault();const parsed=successCaseSaveSchema.safeParse({id,expectedRevision:record?.revision??null,requestKey:crypto.randomUUID(),statusReason:reason,data});if(!parsed.success){mutation.setError(t("success.invalid"));return;}void mutation.save(parsed.data);};
 return <AccessibleDrawer title={t(record?"success.edit":"success.start")} description={t("success.identityHelp")} pending={mutation.pending||mutation.uncertain} onClose={onClose}><form onSubmit={submit}><fieldset className="follow-up-fields" disabled={mutation.pending||mutation.uncertain||mutation.conflict}>
 <label className="field"><span>{t("applications.enrollment")}</span><input readOnly value={`${label(context?.student_name_zh,context?.student_name_en)} · ${label(context?.cohort_name_zh,context?.cohort_name_en)}`}/></label>
 <label className="field"><span>{t("success.caseStatus")}</span><select name="status" value={data.status} onChange={event=>change("status",event.target.value as SuccessCaseData["status"])}>{successStatuses.map(value=><option key={value} value={value}>{t(`success.status.${value}`)}</option>)}</select></label>
 <label className="field"><span>{t("success.health")}</span><select name="health_status" value={data.health_status} onChange={event=>change("health_status",event.target.value as SuccessCaseData["health_status"])}>{successHealth.map(value=><option key={value} value={value}>{t(`success.health.${value}`)}</option>)}</select></label><p className="field-help">{t("success.healthHelp")}</p>
 <EnrollmentRelation type="USER" label={t("enrollments.owner")} value={data.owner_id??""} initialLabel={record?label(record.owner_name_zh,record.owner_name_en):label(enrollment?.owner_name_zh,enrollment?.owner_name_en)} onChange={value=>change("owner_id",value||null)}/>
 <label className="field"><span>{t("success.nextReview")}</span><DateInput name="next_review_on" value={data.next_review_on??""} onChange={event=>change("next_review_on",event.target.value||null)}/></label>
 {(["success_summary","plan_summary"] as const).map(key=><label className="field" key={key}><span>{t(`success.${key}`)}</span><textarea name={key} rows={3} maxLength={key==="success_summary"?2000:4000} value={data[key]??""} onChange={event=>change(key,event.target.value||null)}/></label>)}<p className="field-help">{t("success.notesHelp")}</p>
 <label className="field"><span>{t("success.reason")}</span><input name="reason" maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
 </fieldset><SaveMessages mutation={mutation}/><SaveActions mutation={mutation} onClose={onClose} onReload={onReload}/></form></AccessibleDrawer>;
}
export function SuccessGoalEditor({record,caseRecord,onClose,onSaved,onReload}:{record?:SuccessGoal;caseRecord:SuccessCase;onClose:()=>void;onSaved:()=>Promise<void>;onReload:()=>void}){
 const {t,locale}=useI18n(),preferences=useUserPreferences(),[id]=useState(()=>record?.id??crypto.randomUUID()),mutation=useSuccessSave(onSaved);
 const [data,setData]=useState<SuccessGoalData>(()=>({case_id:caseRecord.id,goal_type:record?.goal_type??"ACADEMIC",title:record?.title??"",description:record?.description??null,status:record?.status??"PLANNED",target_on:record?.target_on??null,achieved_at:record?.achieved_at??null,owner_id:record?record.owner_id:caseRecord.owner_id}));
 const change=<K extends keyof SuccessGoalData>(key:K,value:SuccessGoalData[K])=>setData(old=>({...old,[key]:value}));
 const submit=(event:React.FormEvent)=>{event.preventDefault();const parsed=successGoalSaveSchema.safeParse({id,expectedRevision:record?.revision??null,requestKey:crypto.randomUUID(),data});if(!parsed.success){mutation.setError(t(data.status==="ACHIEVED"&&!data.achieved_at?"success.achievedRequired":"success.invalid"));return;}void mutation.save({operation:"goal",input:parsed.data});};
 return <AccessibleDrawer title={t(record?"success.editGoal":"success.addGoal")} description={t("success.goalHelp")} pending={mutation.pending||mutation.uncertain} onClose={onClose}><form onSubmit={submit}><fieldset className="follow-up-fields" disabled={mutation.pending||mutation.uncertain||mutation.conflict}>
 <label className="field"><span>{t("success.goalTitle")}</span><input required name="title" maxLength={200} value={data.title} onChange={event=>change("title",event.target.value)}/></label>
 <label className="field"><span>{t("success.goalType")}</span><select name="goal_type" value={data.goal_type} onChange={event=>change("goal_type",event.target.value as SuccessGoalData["goal_type"])}>{successGoalTypes.map(value=><option key={value} value={value}>{t(`success.goalType.${value}`)}</option>)}</select></label>
 <label className="field"><span>{t("common.status")}</span><select name="goal_status" value={data.status} onChange={event=>change("status",event.target.value as SuccessGoalData["status"])}>{successGoalStatuses.map(value=><option key={value} value={value}>{t(`success.goalStatus.${value}`)}</option>)}</select></label>
 <label className="field"><span>{t("success.target")}</span><DateInput name="target_on" value={data.target_on??""} onChange={event=>change("target_on",event.target.value||null)}/></label>
 <label className="field"><span>{t("success.achievedAt")}</span><DateInput name="achieved_at" type="datetime-local" value={data.achieved_at?preferences.localDateTimeInput(data.achieved_at):""} onChange={event=>change("achieved_at",enrollmentTimestamp(event.target.value,record?.achieved_at??null,preferences.localDateTimeInput,preferences.localDateTimeToIso))}/></label>
 <EnrollmentRelation type="USER" label={t("enrollments.owner")} value={data.owner_id??""} initialLabel={record?(locale==="en"?record.owner_name_en:record.owner_name_zh)||"":(locale==="en"?caseRecord.owner_name_en:caseRecord.owner_name_zh)||""} onChange={value=>change("owner_id",value||null)}/>
 <label className="field"><span>{t("success.description")}</span><textarea name="description" rows={3} maxLength={2000} value={data.description??""} onChange={event=>change("description",event.target.value||null)}/></label>
 </fieldset><SaveMessages mutation={mutation}/><SaveActions mutation={mutation} onClose={onClose} onReload={onReload}/></form></AccessibleDrawer>;
}
