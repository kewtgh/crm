import { SalesPerformancePage } from "@/components/sales-performance-page";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.salesPerformance");

export default function Page() {
  return <SalesPerformancePage />;
}
