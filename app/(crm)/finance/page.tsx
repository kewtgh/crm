import { DataLoadError } from "@/components/data-state";
import { FinancePage } from "@/components/finance-page";
import { loadFinanceOverview } from "@/lib/phase2-repository";
export default async function Page(){const data=await loadFinanceOverview().catch(()=>null);return data?<FinancePage initial={data}/>:<DataLoadError/>;}
