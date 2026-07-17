import { supabaseJson, supabaseRequest } from "./supabase-server";

export type ApprovalRecord = {
  id: string; requestNumber: string; type: "contractSign"|"contractExport"|"performanceSummary"|"performanceAllocation"; object: string; requester: string; submitted: string; level: "admin"|"superAdmin"; reason: string; status: "pending"|"approved"|"rejected"; executionStatus:"NOT_STARTED"|"SUCCEEDED"|"FAILED";
};

const approvalTypes: Record<string, ApprovalRecord["type"]> = { CONTRACT_SIGN:"contractSign", CONTRACT_EXPORT:"contractExport", PERFORMANCE_SUMMARY:"performanceSummary", PERFORMANCE_ALLOCATION:"performanceAllocation" };
const databaseApprovalTypes:Record<ApprovalRecord["type"],string>={contractSign:"CONTRACT_SIGN",contractExport:"CONTRACT_EXPORT",performanceSummary:"PERFORMANCE_SUMMARY",performanceAllocation:"PERFORMANCE_ALLOCATION"};
export type ApprovalSummary={pending:number;approved:number;rejected:number;highPrivilegePending:number};
export type ApprovalPage={items:ApprovalRecord[];total:number;page:number;pageSize:number;summary:ApprovalSummary};

function approvalFilters(options:{query?:string;type?:string;status?:string}){const params=new URLSearchParams();const clean=(options.query??"").replace(/[*,()]/g," ").trim().slice(0,100);if(clean)params.set("or",`(request_number.ilike.*${clean}*,business_object_type.ilike.*${clean}*,business_object_id.ilike.*${clean}*,reason.ilike.*${clean}*)`);if(options.type&&options.type!=="all"&&options.type in databaseApprovalTypes)params.set("request_type",`eq.${databaseApprovalTypes[options.type as ApprovalRecord["type"]]}`);if(options.status&&options.status!=="all")params.set("status",`eq.${options.status.toUpperCase()}`);return params;}
async function approvalCount(filter:string){const response=await supabaseRequest(`/rest/v1/approval_requests?select=id${filter}`,{headers:{Prefer:"count=exact",Range:"0-0"}});return Number((response.headers.get("content-range")??"*/0").split("/")[1]??0);}

export async function listApprovals(options:{query?:string;type?:string;status?:string;page?:number;pageSize?:number}={}): Promise<ApprovalPage> {
  const page=Math.max(1,Number(options.page??1));const pageSize=Math.max(1,Math.min(50,Number(options.pageSize??8)));const start=(page-1)*pageSize;const params=approvalFilters(options);params.set("select","id,request_number,request_type,business_object_type,business_object_id,requester_id,required_role,status,reason,execution_status,created_at");params.set("order","created_at.desc");
  const response=await supabaseRequest(`/rest/v1/approval_requests?${params}`,{headers:{Prefer:"count=exact",Range:`${start}-${start+pageSize-1}`}});const requests=await response.json() as Record<string,unknown>[];const total=Number((response.headers.get("content-range")??"*/0").split("/")[1]??requests.length);
  const requesterIds=[...new Set(requests.map(item=>String(item.requester_id)).filter(Boolean))];
  const [profiles,pending,approved,rejected,highPrivilegePending] = await Promise.all([
    requesterIds.length?supabaseJson<{user_id:string;display_name_zh:string;display_name_en:string}[]>(`/rest/v1/user_profiles?select=user_id,display_name_zh,display_name_en&user_id=in.(${requesterIds.join(",")})`):[],
    approvalCount("&status=eq.PENDING"),approvalCount("&status=eq.APPROVED"),approvalCount("&status=eq.REJECTED"),approvalCount("&status=eq.PENDING&required_role=eq.SUPER_ADMIN"),
  ]);
  const names=new Map(profiles.map((item)=>[item.user_id,`${item.display_name_zh} / ${item.display_name_en}`]));
  const items=requests.map((item)=>({ id:String(item.id),requestNumber:String(item.request_number),type:approvalTypes[String(item.request_type)]??"performanceSummary",object:`${item.business_object_type} · ${item.business_object_id}`,requester:names.get(String(item.requester_id))??String(item.requester_id).slice(0,8),submitted:String(item.created_at),level:item.required_role==="SUPER_ADMIN"?"superAdmin" as const:"admin" as const,reason:String(item.reason),status:String(item.status).toLowerCase() as ApprovalRecord["status"],executionStatus:String(item.execution_status??"NOT_STARTED") as ApprovalRecord["executionStatus"] }));
  return {items,total,page,pageSize,summary:{pending,approved,rejected,highPrivilegePending}};
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
  const now=new Date();const periodStart=target?String(target.period_start):new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString().slice(0,10);const periodEnd=target?String(target.period_end):new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).toISOString().slice(0,10);
  const periodExclusive=new Date(new Date(`${periodEnd}T00:00:00Z`).getTime()+86400000).toISOString();
  const contributions=target?await supabaseJson<Record<string,unknown>[]>(`/rest/v1/performance_contributions?select=contributor_member_id,amount,payments!inner(paid_at,status,currency)&payments.status=eq.CONFIRMED&payments.currency=eq.${encodeURIComponent(String(target.currency))}&payments.paid_at=gte.${periodStart}T00:00:00Z&payments.paid_at=lt.${periodExclusive}`):[];
  const actualByMember=new Map<string,number>();for(const item of contributions){const id=String(item.contributor_member_id);actualByMember.set(id,(actualByMember.get(id)??0)+Number(item.amount));}
  return {targetId:target?String(target.id):null,managerId,target:target?Number(target.target_amount):0,periodStart,periodEnd,currency:target?String(target.currency):"CNY",status:target?String(target.status):"DRAFT",members,allocations:allocationRaw.map((item)=>{const member=byId.get(String(item.contributor_member_id));return{id:String(item.id),memberId:String(item.contributor_member_id),name:member?.name??String(item.contributor_member_id),role:member?.role??"specialist",amount:Number(item.allocated_amount),actual:actualByMember.get(String(item.contributor_member_id))??0,rule:item.attribution_type==="ASSISTED"?"assisted":"direct"};})};
}

export async function savePerformanceWorkspace(input:{targetId:string|null;managerId:string;target:number;periodStart:string;periodEnd:string;currency:string;allocations:{memberId:string;amount:number;rule:string}[]}){
  return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/save_performance_plan",{method:"POST",body:JSON.stringify({plan_id:input.targetId,manager:input.managerId,period_from:input.periodStart,period_to:input.periodEnd,plan_currency:input.currency,plan_amount:input.target,plan_allocations:input.allocations.map((item)=>({contributorMemberId:item.memberId,amount:item.amount,attributionType:item.rule.toUpperCase()}))})});
}

export async function submitPerformanceWorkspace(targetId:string,reason:string){return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/submit_performance_plan",{method:"POST",body:JSON.stringify({plan_id:targetId,business_reason:reason})});}
