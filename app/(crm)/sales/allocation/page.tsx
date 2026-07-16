import { PerformanceAllocationPage } from "@/components/governance-pages";
import { requireRole } from "@/lib/auth";

export default async function Page() {
  await requireRole("SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR", "SALES_MANAGER");
  return <PerformanceAllocationPage />;
}
