"use client";
import Link from "next/link";
import { useScopeQuery } from "@/hooks/use-scope-query";
import type { HouseholdDetail, StudentDetail } from "@/lib/v200-repository";
import type { ApplicationPage } from "@/lib/application-repository";
import type { SuccessPage } from "@/lib/student-success-repository";
import type { CustomerOperationsSnapshot } from "@/lib/customer-operations-repository";
import { useI18n } from "./i18n-provider";
import { RecordIdentity } from "./record-header";
import { InlineMessage, StatusBadge } from "./ui";
import { GraduationCap, FileText, HeartPulse, Users } from "lucide-react";
import { SectionHeader } from "./responsive-detail-layout";
import { StudentEnrollmentsSection, type StudentRelatedCount } from "./student-enrollments-section";
import { EducationBusinessWorkspace } from "./education-business-workspace";
import { useMemo, useEffect, useState } from "react";
import { UiIcon } from "./ui-icon";
import { useUserPreferences } from "./user-preferences-context";

function householdResponse(value: unknown): { item: HouseholdDetail } {
  const response = value as { item: HouseholdDetail };
  if (!response?.item?.id || !Array.isArray(response.item.members)) throw new Error("RECORD_RESPONSE_INVALID");
  return response;
}
function applicationResponse(value: unknown): ApplicationPage {
  const page = value as ApplicationPage;
  if (!Array.isArray(page?.items) || typeof page.total !== "number" || page.items.some(row => !row.id || !row.status || !row.enrollment_id)) throw new Error("RECORD_RESPONSE_INVALID");
  return page;
}
function supportResponse(value: unknown): SuccessPage {
  const page = value as SuccessPage;
  if (!Array.isArray(page?.items) || typeof page.total !== "number" || page.items.some(row => !row.id || !row.status || !row.health_status || !row.enrollment_id || !Number.isInteger(row.active_goal_count) || row.active_goal_count<0)) throw new Error("RECORD_RESPONSE_INVALID");
  return page;
}
function activityResponse(value:unknown):CustomerOperationsSnapshot {
  const response=value as CustomerOperationsSnapshot;
  if(response?.subject!=="CONTACT"||!response.id||!Array.isArray(response.entries)||response.entries.some(row=>!row.id||typeof row.summary!=="string"||!row.kind||!row.occurred_at))throw new Error("RECORD_RESPONSE_INVALID");
  return response;
}
export function StudentActivitySummary({student}:{student:StudentDetail}) {
  const {t,enumLabel}=useI18n(),{formatDate}=useUserPreferences();
  const query=useScopeQuery("/api/customer-operations",new URLSearchParams({subject:"CONTACT",id:student.personId}).toString(),activityResponse);
  return <section className="detail-section"><SectionHeader icon={<UiIcon name="activity"/>} title={t("workspace.recentActivity")}/>{query.loading&&<p role="status">{t("common.loading")}</p>}{query.failure&&<InlineMessage type="error">{t("modules.loadFailed")}<button className="text-button" onClick={query.retry}>{t("common.retry")}</button></InlineMessage>}{query.data&&<><div className="workspace-activity-list">{query.data.entries.slice(0,3).map(entry=><article key={entry.id}><time>{formatDate(entry.occurred_at,{includeTime:true})}</time><div><b>{enumLabel(`activity.kind.${entry.kind}`).label}</b><p>{entry.summary}</p><small>{t("ux.record.nextAction")}: {entry.next_step||t("ux.record.notRecorded")}</small></div></article>)}</div>{!query.data.entries.length&&<div className="workspace-empty"><UiIcon name="activity" size={24}/><b>{t("workspace.noActivity")}</b></div>}</>}</section>;
}
export function StudentFamilySummary({ student }: { student: StudentDetail }) {
  if (!student.householdId) return <section className="detail-section workspace-empty"><Users size={24}/><b><NoFamily/></b></section>;
  return <HouseholdMemberSummary householdId={student.householdId} studentId={student.id}/>;
}
function NoFamily() { const { t } = useI18n(); return t("ux.record.noFamily"); }
function HouseholdMemberSummary({ householdId, studentId }: { householdId: string; studentId: string }) {
  const { t, enumLabel } = useI18n();
  const query = useScopeQuery("/api/education", new URLSearchParams({ resource: "householdDetail", id: householdId }).toString(), householdResponse);
  const href = `/households?tab=families&focus=${householdId}&returnTo=${encodeURIComponent(`/students?focus=${studentId}`)}`;
  return <section className="detail-section" data-testid="student-family-summary"><SectionHeader icon={<UiIcon name="family"/>} title={t("ux.record.familySummary")} action={<Link className="text-button" href={href}>{t("ux.record.openFamily")}</Link>}/>
    {query.loading && <p role="status">{t("common.loading")}</p>}{query.failure && <InlineMessage type="error">{t("education.loadFailed")}<button className="text-button" onClick={query.retry}>{t("common.retry")}</button></InlineMessage>}
    {query.data && <><RecordIdentity nameZh={query.data.item.nameZh} nameEn={query.data.item.nameEn}/><div className="detail-record-list">{query.data.item.members.map(member => <article key={member.id}><div><Link href={`/people/${member.contactId}`}><RecordIdentity nameZh={member.nameZh} nameEn={member.nameEn}/></Link><small>{enumLabel(`education.memberRole.${member.role.toLowerCase()}`).label}{member.primary ? ` · ${t("education.primaryContact")}` : ""}</small></div></article>)}</div></>}
  </section>;
}
export type StudentJourneyFacts={studentId:string;enrollments:StudentRelatedCount;applications:StudentRelatedCount;support:StudentRelatedCount};
export function StudentJourney({ student, mode="journey",onFacts }: { student: StudentDetail; mode?:"journey"|"overview"|"support";onFacts?:(facts:StudentJourneyFacts)=>void }) {
  const { t, enumLabel } = useI18n();
  const {formatDate}=useUserPreferences();
  const query = new URLSearchParams({ studentId: student.id, page: "1", pageSize: "10" }).toString();
  const applications = useScopeQuery("/api/applications", query, applicationResponse);
  const support = useScopeQuery("/api/student-success", query, supportResponse);
  const [enrollmentTotal,setEnrollmentTotal]=useState<StudentRelatedCount>("loading");
  useEffect(()=>{onFacts?.({studentId:student.id,enrollments:enrollmentTotal,applications:applications.loading?"loading":applications.failure??applications.data?.total??"unavailable",support:support.loading?"loading":support.failure??support.data?.total??"unavailable"});},[student.id,enrollmentTotal,applications.loading,applications.failure,applications.data?.total,support.loading,support.failure,support.data?.total,onFacts]);
  const context = useMemo(() => ({ type: "STUDENT" as const, id: student.id }), [student.id]);
  const householdContext = useMemo(() => ({ type: "HOUSEHOLD" as const, id: student.householdId }), [student.householdId]);
  const compact=mode==="overview";
  return <div className="workspace-main-stack" data-testid="student-journey">{mode!=="support"&&<><section className="detail-section workspace-journey" data-surface-tone="context"><SectionHeader icon={<GraduationCap size={18}/>} title={t("workspace.studentJourney")} help={t("workspace.journeyContext")}/><ol className="workspace-journey-groups"><li>{t("workspace.participationStage")}</li><li>{t("workspace.applicationStage")}</li><li>{t("workspace.supportStage")}</li></ol></section><StudentEnrollmentsSection compact={compact} onTotal={setEnrollmentTotal} studentId={student.id} studentLabel={student.nameZh || student.nameEn}/></>}
    {mode!=="support"&&<section className="detail-section"><SectionHeader icon={<FileText size={18}/>} title={t("ux.nav.applications")} action={<Link className="secondary-button" href={`/applications?studentId=${student.id}`}>{t("workspace.viewAll")}</Link>}/>
      {applications.loading && <p role="status">{t("common.loading")}</p>}{applications.failure && <InlineMessage type="error">{t("modules.loadFailed")}<button className="text-button" onClick={applications.retry}>{t("common.retry")}</button></InlineMessage>}
      {applications.data && <><table className="workspace-record-table"><thead><tr><th scope="col">{t("workspace.applicationTarget")}</th><th scope="col">{t("common.status")}</th><th scope="col">{t("applications.deadline")}</th><th scope="col">{t("enrollments.owner")}</th><th scope="col">{t("common.details")}</th></tr></thead><tbody>{(compact?applications.data.items.slice(0,3):applications.data.items).map(row=><tr key={row.id}><td><Link href={`/applications?focus=${row.id}`}><RecordIdentity nameZh={row.target_name_zh} nameEn={row.target_name_en}/></Link><small>{row.product_name_zh||row.product_name_en||t("ux.record.notRecorded")}</small></td><td data-label={t("common.status")}><StatusBadge tone="blue">{enumLabel(`applications.status.${row.status}`).label}</StatusBadge>{row.decision&&<small>{enumLabel(`applications.decision.${row.decision}`).label}</small>}</td><td data-label={t("applications.deadline")}>{row.deadline_on?formatDate(row.deadline_on,{dateOnly:true}):t("ux.record.notRecorded")}</td><td data-label={t("enrollments.owner")}><RecordIdentity nameZh={row.owner_name_zh} nameEn={row.owner_name_en}/></td><td><Link className="text-button" href={`/applications?focus=${row.id}`}>{t("common.details")} →</Link></td></tr>)}</tbody></table>{!applications.data.items.length && <p>{t("ux.record.noApplications")}</p>}</>}
    </section>}
    <section className="detail-section"><SectionHeader icon={<HeartPulse size={18}/>} title={t("success.title")} action={<Link className="secondary-button" href={`/student-success?studentId=${student.id}`}>{t("workspace.viewAll")}</Link>}/>
      {support.loading && <p role="status">{t("common.loading")}</p>}{support.failure && <InlineMessage type="error">{t("success.loadFailed")}<button className="text-button" onClick={support.retry}>{t("common.retry")}</button></InlineMessage>}
      {support.data && <><div className="workspace-support-list">{(compact?support.data.items.slice(0,2):support.data.items).map(row => <article key={row.id}><div className="workspace-related-row"><Link href={`/student-success?focus=${row.id}`}><RecordIdentity nameZh={row.product_name_zh} nameEn={row.product_name_en}/></Link><StatusBadge tone="blue">{enumLabel(`success.status.${row.status}`).label}</StatusBadge></div><dl className="workspace-info-grid"><div><dt className="ux-icon-label"><UiIcon name="support" size={16}/>{t("success.health")}</dt><dd>{enumLabel(`success.health.${row.health_status}`).label}</dd></div><div><dt>{t("success.activeGoals")}</dt><dd>{row.active_goal_count??t("ux.record.notRecorded")}</dd></div><div><dt>{t("ux.record.risks")}</dt><dd>{row.open_risk_count??t("ux.record.notRecorded")}</dd></div><div><dt>{t("success.nextReview")}</dt><dd>{row.next_review_on?formatDate(row.next_review_on,{dateOnly:true}):t("ux.record.notRecorded")}</dd></div></dl></article>)}</div>{!support.data.items.length && <p>{t("ux.record.noSupport")}</p>}</>}
    </section>
    {mode==="journey"&&<details><summary>{t("business.studentEntry")}</summary><EducationBusinessWorkspace embedded context={context} initialResource="pathways"/></details>}
    {mode==="journey"&&student.householdId && <details><summary>{t("ux.record.householdParticipation")}</summary><p>{t("ux.record.householdParticipationHelp")}</p><EducationBusinessWorkspace embedded context={householdContext} initialResource="participations"/></details>}
  </div>;
}
