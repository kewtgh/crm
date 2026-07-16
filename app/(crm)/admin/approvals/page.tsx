import { ApprovalCenterPage } from "@/components/governance-pages";
import { listApprovals } from "@/lib/governance-repository";

export default async function Page() { let requests; try { requests=await listApprovals(); } catch { requests=undefined; } return requests?<ApprovalCenterPage initialRequests={requests} persistent />:<ApprovalCenterPage />; }
