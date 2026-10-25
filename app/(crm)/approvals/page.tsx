import { ApprovalCenterPage } from "@/components/governance-pages";
import { requireUser } from "@/lib/auth";
import { listApprovals } from "@/lib/governance-repository";
import {readApprovalQuery} from "@/lib/approval-contract";

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  await requireUser();
  const raw=await searchParams,query=readApprovalQuery(new URLSearchParams(Object.entries(raw).flatMap(([key,value])=>typeof value==="string"?[[key,value]]:[])));
  const result=await listApprovals(query).catch(()=>null);
  return <ApprovalCenterPage initialPage={result} initialQuery={query}/>;
}
