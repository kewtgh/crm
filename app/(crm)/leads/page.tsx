import {readReportFilter} from "@/lib/management-trend-contract";
import { DataLoadError } from "@/components/data-state";
import { LeadPoolWorkspace } from "@/components/lead-pool-workspace";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { getPoolLead, listLeadPool } from "@/lib/lead-assignment-repository";
import {poolFilterSchema} from "@/lib/lead-pool-input";
import {parseUuid} from "@/lib/api";

export const generateMetadata = () => localizedPageMetadata("meta.leads");
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  await requireCapability("leads.view");
  const params=await searchParams;const reportFilter=readReportFilter(params,"/leads");const {focus,organization}=params;const organizationId=organization?parseUuid(organization):undefined;
  const focusedLead=focus?await getPoolLead(parseUuid(focus)).catch(()=>null):null;
  const data = await listLeadPool({...poolFilterSchema.parse({organization:organizationId}),page:1,pageSize:20,reportFilter}).catch(() => null);
  return data ? <LeadPoolWorkspace initialReportFilter={reportFilter} initial={data} focusedLead={focusedLead} organizationId={organizationId}/> : <DataLoadError/>;
}
