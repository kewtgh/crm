import { PerformanceAllocationPage } from "@/components/governance-pages";
import { requireRole } from "@/lib/auth";
import { loadPerformanceWorkspace } from "@/lib/governance-repository";

export default async function Page() {
  const user=await requireRole("SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR", "SALES_MANAGER");
  let workspace;try{workspace=await loadPerformanceWorkspace(user.id);}catch{workspace=undefined;}return workspace?<PerformanceAllocationPage workspace={workspace} persistent/>:<PerformanceAllocationPage/>;
}
