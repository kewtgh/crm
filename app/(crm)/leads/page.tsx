import { DataLoadError } from "@/components/data-state";
import { LeadsWorkspace } from "@/components/v200-workspaces";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listLeads } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.leads");
export default async function Page() {
  await requireCapability("leads.view");
  const data = await listLeads().catch(() => null);
  return data ? <LeadsWorkspace initial={data}/> : <DataLoadError/>;
}
