import { DataLoadError } from "@/components/data-state";
import { ProgressionWorkspace } from "@/components/v200-workspaces";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listProgressionBatches } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.progression");
export default async function Page() {
  await requireCapability("progression.manage");
  const data = await listProgressionBatches().catch(() => null);
  return data ? <ProgressionWorkspace initial={data}/> : <DataLoadError/>;
}
