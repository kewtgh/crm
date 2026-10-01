import { ContractsPage } from "@/components/contracts-page";
import { listContracts } from "@/lib/contract-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { DataLoadError } from "@/components/data-state";
import { requireCapability } from "@/lib/auth";

export const generateMetadata = () => localizedPageMetadata("meta.contracts");

export default async function Page({searchParams}:{searchParams:Promise<{query?:string;focus?:string}>}) {
  await requireCapability("contracts.view");
  const params=await searchParams,query=(params.query??"").trim().slice(0,100);
  let result; try { result=await listContracts({page:1,pageSize:10,query}); } catch { result=undefined; }
  const selected=result?.items.some(item=>item.id===params.focus)?params.focus:"";
  return result?<ContractsPage key={`${query}:${selected}`} initialContracts={result.items} initialTotal={result.total} initialSummary={result.summary} initialQuery={query} initialSelectedId={selected} persistent/>:<DataLoadError detailKey="contracts.loadFailed" />;
}
