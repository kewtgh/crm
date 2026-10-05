import {readReportFilter} from "@/lib/management-trend-contract";
import { requireCapability } from "@/lib/auth";
import { z } from "zod";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { getEnrollment, listEnrollments } from "@/lib/enrollment-repository";
import { EnrollmentsWorkspace } from "@/components/enrollments-workspace";
import { WorkspaceTabs, familyTabs } from "@/components/workspace-tabs";
export const generateMetadata = () => localizedPageMetadata("enrollments.title");
export default async function Page({searchParams}: {searchParams: Promise<Record<string,string|undefined>>}) {
  await requireCapability("education.view");
  const params = await searchParams, reportFilter=readReportFilter(params,"/enrollments"), student = z.uuid().safeParse(params.studentId), focus = z.uuid().safeParse(params.focus);
  const studentId = student.success ? student.data : undefined;
  const [initial, detail] = await Promise.all([listEnrollments({studentId,reportFilter}).catch(() => null), focus.success ? getEnrollment(focus.data).catch(() => null) : Promise.resolve(null)]);
  return <div className="page-stack"><WorkspaceTabs items={familyTabs} active="/enrollments"/><EnrollmentsWorkspace initialDetailTab={params.tab} initialReportFilter={reportFilter} initial={initial} initialDetail={detail} initialStudentId={studentId}/></div>;
}
