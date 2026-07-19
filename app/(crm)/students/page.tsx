import { DataLoadError } from "@/components/data-state";
import { StudentsWorkspace } from "@/components/v200-workspaces";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { getStudentDetail, listStudents } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.students");
export default async function Page({searchParams}:{searchParams:Promise<{focus?:string}>}) {
  await requireCapability("education.view");
  const {focus}=await searchParams;
  const initialDetail=focus?await getStudentDetail(focus).catch(()=>null):null;
  const data = await listStudents().catch(() => null);
  return data ? <StudentsWorkspace initial={data} initialDetail={initialDetail}/> : <DataLoadError/>;
}
