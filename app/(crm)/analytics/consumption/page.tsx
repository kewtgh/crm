import { ConsumptionAnalysisPage } from "@/components/consumption-analysis-page";
import { WorkspaceTabs,reportTabs } from "@/components/workspace-tabs";
import { DataLoadError } from "@/components/data-state";
import { loadConsumption } from "@/lib/consumption-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.consumption");

export default async function Page() {
  let data; try { data=await loadConsumption("quarter"); } catch { data=undefined; }
  return <div className="page-stack"><WorkspaceTabs items={reportTabs} active="/analytics/consumption"/>{data?<ConsumptionAnalysisPage initialData={data} persistent />:<DataLoadError detailKey="consumption.loadFailed" />}</div>;
}
