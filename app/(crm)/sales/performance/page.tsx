import {requireCapability} from "@/lib/auth";
import { SalesPerformancePage } from "@/components/sales-performance-page";
import { WorkspaceTabs,performanceTabs } from "@/components/workspace-tabs";
import { DataLoadError } from "@/components/data-state";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { loadSalesPerformance } from "@/lib/sales-repository";

export const generateMetadata = () => localizedPageMetadata("meta.salesPerformance");

export default async function Page() {
  await requireCapability("performance.view");
  let data;
  try{data=await loadSalesPerformance("quarter","all");}catch{return <DataLoadError detailKey="sales.loadFailed"/>;}
  return <div className="page-stack"><WorkspaceTabs items={performanceTabs} active="/sales/performance"/><SalesPerformancePage initialData={data}/></div>;
}
