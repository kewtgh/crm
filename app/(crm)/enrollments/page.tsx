import { requireCapability } from "@/lib/auth";
import { z } from "zod";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { getEnrollment, listEnrollments } from "@/lib/enrollment-repository";
import { EnrollmentsWorkspace } from "@/components/enrollments-workspace";
import { WorkspaceTabs, familyTabs } from "@/components/workspace-tabs";
export const generateMetadata = () => localizedPageMetadata("enrollments.title");
export default async function Page({searchParams}: {searchParams: Promise<{focus?: string; studentId?: string}>}) {
  await requireCapability("education.view");
  const params = await searchParams, student = z.uuid().safeParse(params.studentId), focus = z.uuid().safeParse(params.focus);
  const studentId = student.success ? student.data : undefined;
  const [initial, detail] = await Promise.all([listEnrollments({studentId}).catch(() => null), focus.success ? getEnrollment(focus.data).catch(() => null) : Promise.resolve(null)]);
  return <div className="page-stack"><WorkspaceTabs items={familyTabs} active="/enrollments"/><EnrollmentsWorkspace initial={initial} initialDetail={detail} initialStudentId={studentId}/></div>;
}
