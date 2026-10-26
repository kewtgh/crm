import {readReportFilter} from "@/lib/management-trend-contract";
import { DataLoadError } from "@/components/data-state";
import { FinancePage } from "@/components/finance-page";
import { loadFinanceOverview } from "@/lib/phase2-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
import {FocusedRecordNotice} from "@/components/focused-record-notice";
import {z} from "zod";
export async function generateMetadata(){return localizedPageMetadata("meta.finance");}
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 await requireCapability("finance.view");
 const params=await searchParams,reportFilter=readReportFilter(params,"/finance"),parsed=z.uuid().safeParse(params.quote),quoteId=parsed.success?parsed.data:undefined;
 const data=await loadFinanceOverview({reportFilter,quoteId}).catch(()=>null);
 return data?<div className="page-stack">{params.quote&&<FocusedRecordNotice found={Boolean(quoteId&&data.quotes.some(item=>item.id===quoteId))} href="/finance"/>}<FinancePage key={quoteId??"directory"} initialReportFilter={reportFilter} initialQuoteId={quoteId} initial={data}/></div>:<DataLoadError/>;
}
