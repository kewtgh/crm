import { ApprovalCenterPage } from "@/components/governance-pages";
import { DataLoadError } from "@/components/data-state";
import { listApprovals } from "@/lib/governance-repository";

export default async function Page() { let result; try { result=await listApprovals({status:"pending",page:1,pageSize:10}); } catch { result=undefined; } return result?<ApprovalCenterPage initialPage={result}/>:<DataLoadError detailKey="approval.loadFailed" />; }
