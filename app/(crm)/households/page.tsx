import { DataLoadError } from "@/components/data-state";
import { HouseholdsWorkspace } from "@/components/v200-workspaces";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { getHouseholdDetail, listHouseholds } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.households");
export default async function Page({searchParams}:{searchParams:Promise<{focus?:string}>}) {
  await requireCapability("education.view");
  const {focus}=await searchParams;
  const initialDetail=focus?await getHouseholdDetail(focus).catch(()=>null):null;
  const data = await listHouseholds().catch(() => null);
  return data ? <HouseholdsWorkspace initial={data} initialDetail={initialDetail}/> : <DataLoadError/>;
}
