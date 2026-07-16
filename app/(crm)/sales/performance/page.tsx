import type { Metadata } from "next";
import { SalesPerformancePage } from "@/components/sales-performance-page";

export const metadata: Metadata = { title: "销售业绩目标与分析" };

export default function Page() {
  return <SalesPerformancePage />;
}
