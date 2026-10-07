"use client";
import {RecordIdentity} from "./record-header";
import { useState } from "react";
import Link from "next/link";
import { EnrollmentRelation } from "./enrollment-relation";
import { AccessibleDrawer, InlineMessage } from "./ui";
import { AcademicYearInput, OptionInput } from "./structured-inputs";
import { GRADE_OPTIONS } from "@/lib/structured-inputs";
import { studentUpdateInput } from "@/lib/record-workspace-presentation";
import type { StudentDetail } from "@/lib/v200-repository";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useI18n } from "./i18n-provider";

/** Manual placement correction updates the existing Student, never the annual worker. */
export function AcademicCorrection() {
  const {t}=useI18n(),[student,setStudent]=useState(""),[record,setRecord]=useState<StudentDetail|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const open=async()=>{if(!student||pending)return;setPending(true);setError("");try{setRecord((await apiFetch<{item:StudentDetail}>(`/api/education?resource=studentDetail&id=${student}`)).item);}catch{setError(t("education.loadFailed"));}finally{setPending(false);}};
  const save=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!record||pending)return;const data=studentUpdateInput(record,new FormData(event.currentTarget),record.householdId);setPending(true);setError("");try{await apiFetch("/api/education",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});setRecord(null);setNotice(t("education.studentSaved"));}catch(caught){setError(t(caught instanceof ApiClientError&&caught.status===409?"crm.conflict":"education.saveFailed"));}finally{setPending(false);}};
  return <section className="surface academic-correction"><div className="surface-heading"><h2>{t("repair.correctStudent")}</h2><p className="field-help">{t("progression.automationHelp")}</p></div><div className="compact-task-controls"><EnrollmentRelation type="STUDENT" label={t("education.students")} value={student} onChange={setStudent}/><button type="button" className="secondary-button" disabled={!student||pending} onClick={()=>void open()}>{t("common.edit")}</button>{student&&<Link href={`/students?focus=${student}`}>{t("common.details")}</Link>}</div>{notice&&<InlineMessage type="success">{notice}</InlineMessage>}{error&&<InlineMessage type="error">{error}</InlineMessage>}{record&&<AccessibleDrawer guardChanges pending={pending} title={t("repair.correctStudent")} onClose={()=>setRecord(null)}><form onSubmit={save}><p><RecordIdentity nameZh={record.nameZh} nameEn={record.nameEn}/> · {record.grade} · {record.academicYear}</p><div className="form-grid two-column"><label className="field"><span>{t("education.grade")}</span><OptionInput name="grade" options={GRADE_OPTIONS} required defaultValue={record.grade}/></label><label className="field"><span>{t("education.academicYear")}</span><AcademicYearInput name="academicYear" required defaultValue={record.academicYear}/></label></div>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" disabled={pending} onClick={()=>setRecord(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{t("common.save")}</button></div></form></AccessibleDrawer>}</section>;
}
