import {databaseJson} from "./db/gateway";
import {approvalDatabaseTypes,approvalDefaults,approvalQuerySchema,approvalTypeKey,approvalPageSchema,approvalDecisionSchema,approvalDecisionResultSchema,type ApprovalQuery,type ApprovalDecision} from "./approval-contract";
export type {ApprovalRecord,ApprovalSummary,ApprovalPage} from "./approval-contract";

export async function listApprovals(options:Partial<ApprovalQuery>&{query?:string}={},request=databaseJson){
 const query=approvalQuerySchema.parse({...approvalDefaults,...Object.fromEntries(Object.entries(options).filter(([key])=>key!=="query")),q:options.q??options.query??""});
 const result=await request<Record<string,unknown>>("/db/rpc/query_approval_workspace",{method:"POST",body:JSON.stringify({p_query:query.q,p_type:query.type==="all"||query.type==="other"?query.type:approvalDatabaseTypes[query.type],p_status:query.status,p_scope:query.scope,p_execution:query.execution,p_page:query.page,p_page_size:query.pageSize})});
 const items=Array.isArray(result.items)?result.items.map(item=>({...item,type:approvalTypeKey(item.requestType)})):result.items;
 const parsed=approvalPageSchema.parse({...result,items});
 if(parsed.page!==query.page||parsed.pageSize!==query.pageSize)throw new Error("INVALID_APPROVAL_RESPONSE");
 return parsed;
}

export async function createApproval(input:
  | {type:"CONTRACT_SIGN"|"CONTRACT_EXPORT"|"PERFORMANCE_SUMMARY"|"PERFORMANCE_ALLOCATION";objectType:string;objectId:string;reason:string}
  | {type:"CRM_EXPORT";resource:"schools"|"people"|"tasks"|"students"|"households"|"leads"|"sales"|"finance";query:string;status:string;sort:string;direction:"asc"|"desc";format:"CSV"|"XLSX"|"PDF";reason:string}
) {
  if(input.type==="CRM_EXPORT"){
    return databaseJson<Record<string,unknown>>("/db/rpc/create_crm_export_approval",{method:"POST",body:JSON.stringify({
      resource_key:input.resource,search_query:input.query,status_filter:input.status,
      sort_key:input.sort,sort_direction:input.direction,business_reason:input.reason,export_format:input.format,
    })});
  }
  return databaseJson<Record<string,unknown>>("/db/rpc/create_approval",{method:"POST",body:JSON.stringify({request_kind:input.type,object_type:input.objectType,object_id:input.objectId,business_reason:input.reason})});
}

export async function decideApproval(id:string,input:ApprovalDecision,request=databaseJson) {
 const command=approvalDecisionSchema.parse(input);
 const result=approvalDecisionResultSchema.parse(await request("/db/rpc/decide_approval_command",{method:"POST",body:JSON.stringify({p_id:id,p_review_token:command.expectedReviewToken,p_decision:command.decision,p_comment:command.comment,p_request_key:command.requestKey})}));
 if(result.id!==id||result.status!==command.decision.toLowerCase())throw new Error("INVALID_APPROVAL_RESPONSE");
 return result;
}

export function approvalRecordId(item: unknown) {
  const record = Array.isArray(item) ? item[0] : item;
  return record && typeof record === "object" && typeof (record as Record<string, unknown>).id === "string"
    ? String((record as Record<string, unknown>).id)
    : null;
}

export async function executeSuperAdminApproval(id: string) {
  return databaseJson<Record<string,unknown>>("/db/rpc/super_admin_execute_approval", {
    method: "POST",
    body: JSON.stringify({ request_id: id }),
  });
}

export type PerformanceWorkspace={
  targetId:string|null; managerId:string; target:number; periodStart:string; periodEnd:string; currency:string; status:string;
  members:{id:string;name:string;role:"specialist"|"support";team:string}[];
  allocations:{id:string;memberId:string;name:string;role:"specialist"|"support";amount:number;actual:number;rule:"direct"|"assisted"}[];
};

export async function loadPerformanceWorkspace(managerId:string):Promise<PerformanceWorkspace>{
  const membersRaw=await databaseJson<Record<string,unknown>[]>("/db/rpc/staff_sales_roster",{method:"POST",body:"{}"});
  const targets=await databaseJson<Record<string,unknown>[]>(`/db/table/performance_targets?select=id,manager_id,period_start,period_end,currency,target_amount,status&manager_id=eq.${encodeURIComponent(managerId)}&order=created_at.desc&limit=1`);
  const target=targets[0];
  const members=membersRaw.map((item)=>({id:String(item.id),name:`${item.name_zh} / ${item.name_en}`,role:item.role==="SALES_SUPPORT"?"support" as const:"specialist" as const,team:String(item.team)}));
  const byId=new Map(members.map((item)=>[item.id,item]));
  const allocationRaw=target?await databaseJson<Record<string,unknown>[]>(`/db/table/performance_allocations?select=id,contributor_member_id,allocated_amount,verified_amount,attribution_type&target_id=eq.${target.id}&order=created_at`):[];
  const now=new Date();const periodStart=target?String(target.period_start):new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString().slice(0,10);const periodEnd=target?String(target.period_end):new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).toISOString().slice(0,10);
  const periodExclusive=new Date(new Date(`${periodEnd}T00:00:00Z`).getTime()+86400000).toISOString();
  const contributions=target?await databaseJson<Record<string,unknown>[]>(`/db/table/performance_contributions?select=contributor_member_id,amount,payments!inner(paid_at,status,currency)&payments.status=eq.CONFIRMED&payments.currency=eq.${encodeURIComponent(String(target.currency))}&payments.paid_at=gte.${periodStart}T00:00:00Z&payments.paid_at=lt.${periodExclusive}`):[];
  const actualByMember=new Map<string,number>();for(const item of contributions){const id=String(item.contributor_member_id);actualByMember.set(id,(actualByMember.get(id)??0)+Number(item.amount));}
  return {targetId:target?String(target.id):null,managerId,target:target?Number(target.target_amount):0,periodStart,periodEnd,currency:target?String(target.currency):"CNY",status:target?String(target.status):"DRAFT",members,allocations:allocationRaw.map((item)=>{const member=byId.get(String(item.contributor_member_id));return{id:String(item.id),memberId:String(item.contributor_member_id),name:member?.name??String(item.contributor_member_id),role:member?.role??"specialist",amount:Number(item.allocated_amount),actual:actualByMember.get(String(item.contributor_member_id))??0,rule:item.attribution_type==="ASSISTED"?"assisted":"direct"};})};
}

export async function savePerformanceWorkspace(input:{targetId:string|null;managerId:string;target:number;periodStart:string;periodEnd:string;currency:string;allocations:{memberId:string;amount:number;rule:string}[]}){
  return databaseJson<Record<string,unknown>>("/db/rpc/save_performance_plan",{method:"POST",body:JSON.stringify({plan_id:input.targetId,manager:input.managerId,period_from:input.periodStart,period_to:input.periodEnd,plan_currency:input.currency,plan_amount:input.target,plan_allocations:input.allocations.map((item)=>({contributorMemberId:item.memberId,amount:item.amount,attributionType:item.rule.toUpperCase()}))})});
}

export async function submitPerformanceWorkspace(targetId:string,reason:string){return databaseJson<Record<string,unknown>>("/db/rpc/submit_performance_plan",{method:"POST",body:JSON.stringify({plan_id:targetId,business_reason:reason})});}
