import { PerformanceAllocationPage } from "@/components/governance-pages";
import { DataLoadError } from "@/components/data-state";
import { requireRole } from "@/lib/auth";
import { loadPerformanceWorkspace } from "@/lib/governance-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata=()=>localizedPageMetadata("meta.allocation");

export default async function Page() {
  const user=await requireRole("SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR", "SALES_MANAGER");
  let workspace;try{workspace=await loadPerformanceWorkspace(user.id);}catch{workspace=undefined;}return workspace?<PerformanceAllocationPage workspace={workspace} persistent/>:<DataLoadError detailKey="allocation.loadFailed"/>;
}
