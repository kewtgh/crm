import { supabaseJson } from "./supabase-server";

export type ApprovalRecord = {
  id: string; requestNumber: string; type: "contractSign"|"contractExport"|"performanceSummary"|"performanceAllocation"; object: string; requester: string; submitted: string; level: "admin"|"superAdmin"; reason: string; status: "pending"|"approved"|"rejected";
};

const approvalTypes: Record<string, ApprovalRecord["type"]> = { CONTRACT_SIGN:"contractSign", CONTRACT_EXPORT:"contractExport", PERFORMANCE_SUMMARY:"performanceSummary", PERFORMANCE_ALLOCATION:"performanceAllocation" };

export async function listApprovals(): Promise<ApprovalRecord[]> {
  const [requests, profiles] = await Promise.all([
    supabaseJson<Record<string,unknown>[]>("/rest/v1/approval_requests?select=id,request_number,request_type,business_object_type,business_object_id,requester_id,required_role,status,reason,created_at&order=created_at.desc&limit=100"),
    supabaseJson<{user_id:string;display_name_zh:string;display_name_en:string}[]>("/rest/v1/user_profiles?select=user_id,display_name_zh,display_name_en"),
  ]);
  const names=new Map(profiles.map((item)=>[item.user_id,`${item.display_name_zh} / ${item.display_name_en}`]));
  return requests.map((item)=>({ id:String(item.id),requestNumber:String(item.request_number),type:approvalTypes[String(item.request_type)]??"performanceSummary",object:`${item.business_object_type} · ${item.business_object_id}`,requester:names.get(String(item.requester_id))??String(item.requester_id).slice(0,8),submitted:new Intl.DateTimeFormat("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(String(item.created_at))),level:item.required_role==="SUPER_ADMIN"?"superAdmin":"admin",reason:String(item.reason),status:String(item.status).toLowerCase() as ApprovalRecord["status"] }));
}

export async function createApproval(input:{type:"CONTRACT_SIGN"|"CONTRACT_EXPORT"|"PERFORMANCE_SUMMARY"|"PERFORMANCE_ALLOCATION";objectType:string;objectId:string;reason:string}) {
  return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/create_approval",{method:"POST",body:JSON.stringify({request_kind:input.type,object_type:input.objectType,object_id:input.objectId,business_reason:input.reason})});
}

export async function decideApproval(id:string,decision:"APPROVED"|"REJECTED",comment?:string) {
  return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/decide_approval",{method:"POST",body:JSON.stringify({request_id:id,decision,decision_comment:comment||null})});
}

export type PerformanceWorkspace={
  targetId:string|null; managerId:string; target:number; periodStart:string; periodEnd:string; currency:string; status:string;
  members:{id:string;name:string;role:"specialist"|"support";team:string}[];
  allocations:{id:string;memberId:string;name:string;role:"specialist"|"support";amount:number;actual:number;rule:"direct"|"assisted"}[];
};

export async function loadPerformanceWorkspace(managerId:string):Promise<PerformanceWorkspace>{
  const membersRaw=await supabaseJson<Record<string,unknown>[]>("/rest/v1/sales_team_members?select=id,name_zh,name_en,role,team&active=eq.true&order=name_en");
  const targets=await supabaseJson<Record<string,unknown>[]>(`/rest/v1/performance_targets?select=id,manager_id,period_start,period_end,currency,target_amount,status&manager_id=eq.${encodeURIComponent(managerId)}&order=created_at.desc&limit=1`);
  const target=targets[0];
  const members=membersRaw.map((item)=>({id:String(item.id),name:`${item.name_zh} / ${item.name_en}`,role:item.role==="SALES_SUPPORT"?"support" as const:"specialist" as const,team:String(item.team)}));
  const byId=new Map(members.map((item)=>[item.id,item]));
  const allocationRaw=target?await supabaseJson<Record<string,unknown>[]>(`/rest/v1/performance_allocations?select=id,contributor_member_id,allocated_amount,verified_amount,attribution_type&target_id=eq.${target.id}&order=created_at`):[];
  return {targetId:target?String(target.id):null,managerId,target:target?Number(target.target_amount):2400000,periodStart:target?String(target.period_start):"2026-07-01",periodEnd:target?String(target.period_end):"2026-07-31",currency:target?String(target.currency):"CNY",status:target?String(target.status):"DRAFT",members,allocations:allocationRaw.map((item)=>{const member=byId.get(String(item.contributor_member_id));return{id:String(item.id),memberId:String(item.contributor_member_id),name:member?.name??String(item.contributor_member_id),role:member?.role??"specialist",amount:Number(item.allocated_amount),actual:Number(item.verified_amount),rule:item.attribution_type==="ASSISTED"?"assisted":"direct"};})};
}

export async function savePerformanceWorkspace(input:{targetId:string|null;managerId:string;target:number;periodStart:string;periodEnd:string;currency:string;allocations:{memberId:string;amount:number;rule:string}[]}){
  return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/save_performance_plan",{method:"POST",body:JSON.stringify({plan_id:input.targetId,manager:input.managerId,period_from:input.periodStart,period_to:input.periodEnd,plan_currency:input.currency,plan_amount:input.target,plan_allocations:input.allocations.map((item)=>({contributorMemberId:item.memberId,amount:item.amount,attributionType:item.rule.toUpperCase()}))})});
}

export async function submitPerformanceWorkspace(targetId:string,reason:string){return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/submit_performance_plan",{method:"POST",body:JSON.stringify({plan_id:targetId,business_reason:reason})});}
