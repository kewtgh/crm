import {readReportFilter} from "@/lib/management-trend-contract";
import { DataLoadError } from "@/components/data-state";
import { FinancePage } from "@/components/finance-page";
import { loadFinanceOverview } from "@/lib/phase2-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
export async function generateMetadata(){return localizedPageMetadata("meta.finance");}
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){const reportFilter=readReportFilter(await searchParams,"/finance");await requireCapability("finance.view");const data=await loadFinanceOverview({reportFilter}).catch(()=>null);return data?<FinancePage initialReportFilter={reportFilter} initial={data}/>:<DataLoadError/>;}
