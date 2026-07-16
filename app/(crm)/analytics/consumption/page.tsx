import { ConsumptionAnalysisPage } from "@/components/consumption-analysis-page";
import { loadConsumption } from "@/lib/consumption-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.consumption");

export default async function Page() {
  let data; try { data=await loadConsumption("quarter"); } catch { data=undefined; }
  return data?<ConsumptionAnalysisPage initialData={data} persistent />:<ConsumptionAnalysisPage />;
}
