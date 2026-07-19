import { DataLoadError } from "@/components/data-state";
import { HouseholdsWorkspace } from "@/components/v200-workspaces";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listHouseholds } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.households");
export default async function Page() {
  await requireCapability("education.view");
  const data = await listHouseholds().catch(() => null);
  return data ? <HouseholdsWorkspace initial={data}/> : <DataLoadError/>;
}
