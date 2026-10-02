import { DataLoadError } from "@/components/data-state";
import { PipelinePage } from "@/components/pipeline-page";
import { listOpportunities, loadSalesPerformance } from "@/lib/sales-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
import { z } from "zod";
export async function generateMetadata(){return localizedPageMetadata("meta.opportunities");}

export default async function Page({searchParams}:{searchParams:Promise<{focus?:string}>}){
  await requireCapability("opportunities.view");const params=await searchParams;
  const parsed=z.uuid().safeParse(params.focus),focus=parsed.success?parsed.data:undefined;
  let data;try{
    const focused=focus?await listOpportunities({id:focus,page:1,pageSize:20}):null;
    const performance=await loadSalesPerformance("quarter","all",focused?.items[0]?.currency);
    const opportunities=focused??await listOpportunities({page:1,pageSize:20,currency:performance.currency});
    data={performance,opportunities};
  }catch{return <DataLoadError detailKey="pipeline.loadFailed"/>;}
  return <PipelinePage key={focus??"all"} initialItems={data.opportunities.items} initialTotal={data.opportunities.total} initialFunnel={data.performance.funnel} initialCurrency={data.performance.currency} initialCurrencies={data.performance.currencies} initialFocus={focus}/>;
}
