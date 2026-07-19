import { DataLoadError } from "@/components/data-state";
import { LeadsWorkspace } from "@/components/v200-workspaces";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { getLead, listLeads } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.leads");
export default async function Page({searchParams}:{searchParams:Promise<{focus?:string}>}) {
  await requireCapability("leads.view");
  const {focus}=await searchParams;
  const focusedLead=focus?await getLead(focus).catch(()=>null):null;
  const data = await listLeads().catch(() => null);
  return data ? <LeadsWorkspace initial={data} focusedLead={focusedLead}/> : <DataLoadError/>;
}
