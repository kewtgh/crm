import { ApprovalCenterPage } from "@/components/governance-pages";
import { DataLoadError } from "@/components/data-state";
import { requireUser } from "@/lib/auth";
import { listApprovals } from "@/lib/governance-repository";

export default async function Page(){
  await requireUser();
  const result=await listApprovals({status:"pending",page:1,pageSize:10}).catch(()=>null);
  return result?<ApprovalCenterPage initialPage={result}/>:<DataLoadError detailKey="approval.loadFailed"/>;
}
