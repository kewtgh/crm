import { ContractsPage } from "@/components/contracts-page";
import { listContracts } from "@/lib/contract-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { DataLoadError } from "@/components/data-state";
import { requireCapability } from "@/lib/auth";
import {z} from "zod";
import {FocusedRecordNotice} from "@/components/focused-record-notice";

export const generateMetadata = () => localizedPageMetadata("meta.contracts");

export default async function Page({searchParams}:{searchParams:Promise<{query?:string;focus?:string}>}) {
  await requireCapability("contracts.view");
  const params=await searchParams,query=(params.query??"").trim().slice(0,100);
  const parsed=z.uuid().safeParse(params.focus),focus=parsed.success?parsed.data:undefined;
  let result; try { result=await listContracts({page:1,pageSize:10,query,id:focus}); } catch { result=undefined; }
  const selected=result?.items.some(item=>item.id===params.focus)?params.focus:"";
  return result?<div className="page-stack">{params.focus&&<FocusedRecordNotice found={Boolean(focus&&selected)} href="/contracts"/>}<ContractsPage key={`${query}:${focus??""}`} initialContracts={result.items} initialTotal={result.total} initialSummary={result.summary} initialQuery={query} initialSelectedId={selected} initialFocus={focus} persistent/></div>:<DataLoadError detailKey="contracts.loadFailed" />;
}
