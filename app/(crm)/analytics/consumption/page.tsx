import { ConsumptionAnalysisPage } from "@/components/consumption-analysis-page";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.consumption");

export default function Page() {
  return <ConsumptionAnalysisPage />;
}
