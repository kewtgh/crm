"use client";
import Link from "next/link";
import { useScopeQuery } from "@/hooks/use-scope-query";
import type { HouseholdDetail, StudentDetail } from "@/lib/v200-repository";
import type { ApplicationPage } from "@/lib/application-repository";
import type { SuccessPage } from "@/lib/student-success-repository";
import { useI18n } from "./i18n-provider";
import { RecordIdentity } from "./record-header";
import { InlineMessage, StatusBadge } from "./ui";
import { SectionHeader } from "./responsive-detail-layout";
import { StudentEnrollmentsSection } from "./student-enrollments-section";
import { EducationBusinessWorkspace } from "./education-business-workspace";
import { useMemo } from "react";

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
  if (!Array.isArray(page?.items) || typeof page.total !== "number" || page.items.some(row => !row.id || !row.status || !row.health_status || !row.enrollment_id)) throw new Error("RECORD_RESPONSE_INVALID");
  return page;
}
export function StudentFamilySummary({ student }: { student: StudentDetail }) {
  if (!student.householdId) return <p className="detail-empty"> <NoFamily/> </p>;
  return <HouseholdMemberSummary householdId={student.householdId} studentId={student.id}/>;
}
function NoFamily() { const { t } = useI18n(); return t("ux.record.noFamily"); }
function HouseholdMemberSummary({ householdId, studentId }: { householdId: string; studentId: string }) {
  const { t, enumLabel } = useI18n();
  const query = useScopeQuery("/api/education", new URLSearchParams({ resource: "householdDetail", id: householdId }).toString(), householdResponse);
  const href = `/households?tab=families&focus=${householdId}&returnTo=${encodeURIComponent(`/students?focus=${studentId}`)}`;
  return <section className="detail-section" data-testid="student-family-summary"><SectionHeader title={t("ux.record.familySummary")} action={<Link className="secondary-button" href={href}>{t("ux.record.openFamily")}</Link>}/>
    {query.loading && <p role="status">{t("common.loading")}</p>}{query.failure && <InlineMessage type="error">{t("education.loadFailed")}<button className="text-button" onClick={query.retry}>{t("common.retry")}</button></InlineMessage>}
    {query.data && <><RecordIdentity nameZh={query.data.item.nameZh} nameEn={query.data.item.nameEn}/><div className="detail-record-list">{query.data.item.members.map(member => <article key={member.id}><div><Link href={`/people/${member.contactId}`}><RecordIdentity nameZh={member.nameZh} nameEn={member.nameEn}/></Link><small>{enumLabel(`education.memberRole.${member.role.toLowerCase()}`).label}{member.primary ? ` · ${t("education.primaryContact")}` : ""}</small></div></article>)}</div></>}
  </section>;
}
export function StudentJourney({ student }: { student: StudentDetail }) {
  const { t, enumLabel } = useI18n();
  const query = new URLSearchParams({ studentId: student.id, page: "1", pageSize: "10" }).toString();
  const applications = useScopeQuery("/api/applications", query, applicationResponse);
  const support = useScopeQuery("/api/student-success", query, supportResponse);
  const context = useMemo(() => ({ type: "STUDENT" as const, id: student.id }), [student.id]);
  const householdContext = useMemo(() => ({ type: "HOUSEHOLD" as const, id: student.householdId }), [student.householdId]);
  return <div className="page-stack" data-testid="student-journey"><p>{t("ux.record.journeyHelp")}</p><StudentEnrollmentsSection studentId={student.id} studentLabel={student.nameZh || student.nameEn}/>
    <section className="detail-section"><SectionHeader title={t("ux.nav.applications")} action={<Link className="secondary-button" href={`/applications?studentId=${student.id}`}>{t("enrollments.viewAll")}</Link>}/>
      {applications.loading && <p role="status">{t("common.loading")}</p>}{applications.failure && <InlineMessage type="error">{t("modules.loadFailed")}<button className="text-button" onClick={applications.retry}>{t("common.retry")}</button></InlineMessage>}
      {applications.data && <><div className="detail-record-list">{applications.data.items.map(row => <article key={row.id}><div><Link href={`/applications?focus=${row.id}`}>{row.target_name_zh||row.target_name_en?<RecordIdentity nameZh={row.target_name_zh} nameEn={row.target_name_en}/>:t("ux.record.notRecorded")}</Link><small>{t("applications.deadline")}: {row.deadline_on || t("ux.record.notRecorded")} · {row.owner_name_zh || row.owner_name_en || t("ux.record.notRecorded")}</small>{row.decision && <small>{enumLabel(`applications.decision.${row.decision}`).label}</small>}</div><StatusBadge tone="blue">{enumLabel(`applications.status.${row.status}`).label}</StatusBadge></article>)}</div>{!applications.data.items.length && <p>{t("ux.record.noApplications")}</p>}</>}
    </section>
    <section className="detail-section"><SectionHeader title={t("success.title")} action={<Link className="secondary-button" href={`/student-success?studentId=${student.id}`}>{t("enrollments.viewAll")}</Link>}/>
      {support.loading && <p role="status">{t("common.loading")}</p>}{support.failure && <InlineMessage type="error">{t("success.loadFailed")}<button className="text-button" onClick={support.retry}>{t("common.retry")}</button></InlineMessage>}
      {support.data && <><div className="detail-record-list">{support.data.items.map(row => <article key={row.id}><div><Link href={`/student-success?focus=${row.id}`}><RecordIdentity nameZh={row.product_name_zh} nameEn={row.product_name_en}/></Link><small>{enumLabel(`success.health.${row.health_status}`).label} · {row.next_review_on || t("ux.record.notRecorded")}{row.open_risk_count !== undefined ? ` · ${t("ux.record.risks")}: ${row.open_risk_count}` : ""}</small></div><StatusBadge tone="blue">{enumLabel(`success.status.${row.status}`).label}</StatusBadge></article>)}</div>{!support.data.items.length && <p>{t("ux.record.noSupport")}</p>}</>}
    </section>
    <details><summary>{t("business.studentEntry")}</summary><EducationBusinessWorkspace embedded context={context} initialResource="pathways"/></details>
    {student.householdId && <details><summary>{t("ux.record.householdParticipation")}</summary><p>{t("ux.record.householdParticipationHelp")}</p><EducationBusinessWorkspace embedded context={householdContext} initialResource="participations"/></details>}
  </div>;
}
