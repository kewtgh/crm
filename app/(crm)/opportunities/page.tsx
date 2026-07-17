import { DataLoadError } from "@/components/data-state";
import { PipelinePage } from "@/components/pipeline-page";
import { listOpportunities, loadSalesPerformance } from "@/lib/sales-repository";

export default async function Page(){let data;try{data=await Promise.all([listOpportunities({page:1,pageSize:20}),loadSalesPerformance("quarter","all")]);}catch{return <DataLoadError detailKey="pipeline.loadFailed"/>;}const [opportunities,performance]=data;return <PipelinePage initialItems={opportunities.items} initialTotal={opportunities.total} initialFunnel={performance.funnel}/>;}
