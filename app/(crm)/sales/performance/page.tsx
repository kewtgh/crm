import { SalesPerformancePage } from "@/components/sales-performance-page";
import { DataLoadError } from "@/components/data-state";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { loadSalesPerformance } from "@/lib/sales-repository";

export const generateMetadata = () => localizedPageMetadata("meta.salesPerformance");

export default async function Page() {
  let data;
  try{data=await loadSalesPerformance("quarter","all");}catch{return <DataLoadError detailKey="sales.loadFailed"/>;}
  return <SalesPerformancePage initialData={data} />;
}
