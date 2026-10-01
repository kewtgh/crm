import { DataLoadError } from "@/components/data-state";
import { HouseholdsWorkspace,StudentsWorkspace } from "@/components/v200-workspaces";
import { WorkspaceTabs,familyTabs } from "@/components/workspace-tabs";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { getHouseholdDetail, listHouseholds,getStudentDetail,listStudents } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.households");
export default async function Page({searchParams}:{searchParams:Promise<{focus?:string;tab?:string}>}) {
  await requireCapability("education.view");
  const {focus,tab}=await searchParams;
  if(tab==="students"){
    const [data,detail]=await Promise.all([listStudents().catch(()=>null),focus?getStudentDetail(focus).catch(()=>null):null]);
    return <div className="page-stack"><WorkspaceTabs items={familyTabs} active="/households?tab=students"/>{data?<StudentsWorkspace initial={data} initialDetail={detail}/>:<DataLoadError/>}</div>;
  }
  const initialDetail=focus?await getHouseholdDetail(focus).catch(()=>null):null;
  const data = await listHouseholds().catch(() => null);
  return <div className="page-stack"><WorkspaceTabs items={familyTabs} active="/households"/>{data ? <HouseholdsWorkspace initial={data} initialDetail={initialDetail}/> : <DataLoadError/>}</div>;
}
