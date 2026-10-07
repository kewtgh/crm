import {databaseJson} from "./db/gateway";
import type {z} from "zod";
import type {Accrual,Eligibility,Settlement,accrualGenerateSchema,settlementSaveSchema,settlementTransitionSchema} from "./commission-input";
export function getCommissionEligibility(organizationId:string,enrollmentId:string|null=null,adapter=databaseJson){return adapter<{available:boolean;items:Eligibility[]}>("/db/rpc/commission_eligibility",{method:"POST",body:JSON.stringify({target_organization:organizationId,target_enrollment:enrollmentId})});}
export type CommissionListFilters={currency?:string;status?:string;from?:string;to?:string};
export function commissionListQuery(organizationId:string,kind:"accruals"|"settlements",filters:CommissionListFilters={}){
 const params=new URLSearchParams({organization_id:`eq.${organizationId}`,order:kind==="accruals"?"accrued_at.desc,id.asc":"created_at.desc,id.asc",limit:"100"});
 if(filters.currency)params.set("currency",`eq.${filters.currency}`);
 if(filters.status)params.set(kind==="accruals"?"settlement_status":"status",filters.status==="OPEN"?"is.null":`eq.${filters.status}`);
 const date=kind==="accruals"?"accrued_at":"created_at";
 if(filters.from)params.append(date,`gte.${filters.from}T00:00:00Z`);
 if(filters.to)params.append(date,`lt.${new Date(Date.parse(filters.to)+86400000).toISOString()}`);
 return params;
}
export function listCommissionAccruals(organizationId:string,adapter=databaseJson,filters:CommissionListFilters={}){return adapter<Accrual[]>(`/db/table/commission_accrual_listing?${commissionListQuery(organizationId,"accruals",filters)}`);}
export function listCommissionSettlements(organizationId:string,adapter=databaseJson,filters:CommissionListFilters={}){return adapter<Settlement[]>(`/db/table/commission_settlement_summary?${commissionListQuery(organizationId,"settlements",filters)}`);}
export function generateCommissionAccrual(input:z.infer<typeof accrualGenerateSchema>,adapter=databaseJson){return adapter<Accrual>("/db/rpc/generate_commission_accrual",{method:"POST",body:JSON.stringify({target_rule:input.ruleId,target_enrollment:input.enrollmentId,target_payment:input.paymentId,p_request_key:input.requestKey})});}
export function saveCommissionSettlement(input:z.infer<typeof settlementSaveSchema>,adapter=databaseJson){return adapter<Settlement>("/db/rpc/save_commission_settlement",{method:"POST",body:JSON.stringify({target_id:input.id,expected_revision:input.expectedRevision,data:input.data,p_request_key:input.requestKey})});}
export function changeCommissionSettlementStatus(id:string,input:z.infer<typeof settlementTransitionSchema>,adapter=databaseJson){return adapter<Settlement>("/db/rpc/change_commission_settlement_status",{method:"POST",body:JSON.stringify({target_id:id,expected_revision:input.expectedRevision,next_status:input.status,reference:input.reference,reason:input.reason,p_request_key:input.requestKey})});}
