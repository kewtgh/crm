import type { Metadata } from "next";
import { ConsumptionAnalysisPage } from "@/components/consumption-analysis-page";

export const metadata: Metadata = { title: "客户消费分析" };

export default function Page() {
  return <ConsumptionAnalysisPage />;
}
