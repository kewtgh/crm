import { DataLoadError } from "@/components/data-state";
import { ProgressionWorkspace } from "@/components/v200-workspaces";
import { WorkspaceTabs,familyTabs } from "@/components/workspace-tabs";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listProgressionBatches } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.progression");
export default async function Page() {
  await requireCapability("progression.manage");
  const data = await listProgressionBatches().catch(() => null);
  return <div className="page-stack"><WorkspaceTabs items={familyTabs} active="/progression"/>{data ? <ProgressionWorkspace initial={data}/> : <DataLoadError/>}</div>;
}
