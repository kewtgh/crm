import { DataLoadError } from "@/components/data-state";
import { PipelinePage } from "@/components/pipeline-page";
import { listOpportunities, loadSalesPerformance } from "@/lib/sales-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
export async function generateMetadata(){return localizedPageMetadata("meta.opportunities");}

export default async function Page(){await requireCapability("opportunities.view");let data;try{const performance=await loadSalesPerformance("quarter","all");const opportunities=await listOpportunities({page:1,pageSize:20,currency:performance.currency});data={performance,opportunities};}catch{return <DataLoadError detailKey="pipeline.loadFailed"/>;}return <PipelinePage initialItems={data.opportunities.items} initialTotal={data.opportunities.total} initialFunnel={data.performance.funnel} initialCurrency={data.performance.currency} initialCurrencies={data.performance.currencies}/>;}
