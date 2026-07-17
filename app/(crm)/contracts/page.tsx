import { ContractsPage } from "@/components/contracts-page";
import { listContracts } from "@/lib/contract-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { DataLoadError } from "@/components/data-state";

export const generateMetadata = () => localizedPageMetadata("meta.contracts");

export default async function Page() {
  let result; try { result=await listContracts({page:1,pageSize:10}); } catch { result=undefined; }
  return result?<ContractsPage initialContracts={result.items} initialTotal={result.total} initialSummary={result.summary} persistent/>:<DataLoadError detailKey="contracts.loadFailed" />;
}
