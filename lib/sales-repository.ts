import { supabaseJson, supabaseRequest } from "./supabase-server";

export type SalesMemberMetric = { id:string; nameZh:string; nameEn:string; team:string; role:string; target:number; actual:number; forecast:number; opportunities:number };
export type SalesTrendPoint = { date:string; target:number; actual:number };
export type FunnelMetric = { stage:"DISCOVERY"|"EVALUATION"|"HESITATION"|"PAYMENT"|"WON"|"LOST"; count:number; amount:number; weighted:number };
export type RelationshipScores = { contact:number; meal:number; family:number; advocacy:number };
export type RelationshipAccount = { id:string; name_zh:string; name_en:string; owner_zh:string; owner_en:string; contract_value:number; contact:boolean; meal:boolean; family:boolean; advocacy:boolean };
export type SalesPerformanceData = {
  period:"month"|"quarter"|"year"; periodStart:string; periodEnd:string; currency:string;
  target:number; actual:number; forecast:number; teams:string[]; members:SalesMemberMetric[];
  trends:SalesTrendPoint[]; funnel:FunnelMetric[]; relationshipTargets:RelationshipScores;
  relationshipActual:RelationshipScores; relationshipAccounts:RelationshipAccount[];
};

function number(value:unknown){return Number(value??0);}
export async function loadSalesPerformance(period:"month"|"quarter"|"year"="quarter",team="all"):Promise<SalesPerformanceData>{
  const raw=await supabaseJson<Record<string,unknown>>("/rest/v1/rpc/sales_performance_report",{method:"POST",body:JSON.stringify({report_period:period,team_filter:team})});
  const score=(value:unknown):RelationshipScores=>{const item=(value??{}) as Record<string,unknown>;return{contact:number(item.contact),meal:number(item.meal),family:number(item.family),advocacy:number(item.advocacy)};};
  return {
    period:String(raw.period??period) as SalesPerformanceData["period"],periodStart:String(raw.periodStart??""),periodEnd:String(raw.periodEnd??""),currency:String(raw.currency??"CNY"),
    target:number(raw.target),actual:number(raw.actual),forecast:number(raw.forecast),teams:Array.isArray(raw.teams)?raw.teams.map(String):[],
    members:(Array.isArray(raw.members)?raw.members:[]).map((item)=>{const row=item as Record<string,unknown>;return{id:String(row.id),nameZh:String(row.nameZh??""),nameEn:String(row.nameEn??""),team:String(row.team??""),role:String(row.role??""),target:number(row.target),actual:number(row.actual),forecast:number(row.forecast),opportunities:number(row.opportunities)};}),
    trends:(Array.isArray(raw.trends)?raw.trends:[]).map((item)=>{const row=item as Record<string,unknown>;return{date:String(row.date),target:number(row.target),actual:number(row.actual)};}),
    funnel:(Array.isArray(raw.funnel)?raw.funnel:[]).map((item)=>{const row=item as Record<string,unknown>;return{stage:String(row.stage) as FunnelMetric["stage"],count:number(row.count),amount:number(row.amount),weighted:number(row.weighted)};}),
    relationshipTargets:score(raw.relationshipTargets),relationshipActual:score(raw.relationshipActual),
    relationshipAccounts:(Array.isArray(raw.relationshipAccounts)?raw.relationshipAccounts:[]).map((item)=>{const row=item as Record<string,unknown>;return{id:String(row.id),name_zh:String(row.name_zh??""),name_en:String(row.name_en??""),owner_zh:String(row.owner_zh??""),owner_en:String(row.owner_en??""),contract_value:number(row.contract_value),contact:Boolean(row.contact),meal:Boolean(row.meal),family:Boolean(row.family),advocacy:Boolean(row.advocacy)};}),
  };
}

export async function saveRelationshipTargets(input:{periodStart:string;periodEnd:string;managerId?:string|null;contact:number;meal:number;family:number;advocacy:number}){
  return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/save_relationship_targets",{method:"POST",body:JSON.stringify({period_from:input.periodStart,period_to:input.periodEnd,target_manager:input.managerId??null,contact_percent:input.contact,meal_percent:input.meal,family_percent:input.family,advocacy_percent:input.advocacy})});
}

export async function recordRelationshipMilestone(input:{organizationId:string;milestone:"CONTACT"|"MEAL"|"FAMILY_CHAT"|"ADVOCACY";evidence:string}){
  return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/upsert_relationship_milestone",{method:"POST",body:JSON.stringify({target_organization:input.organizationId,milestone:input.milestone,evidence:input.evidence})});
}

export type OpportunityRecord={id:string;subjectType:"SCHOOL"|"HOUSEHOLD";organizationId:string;householdId:string;subjectZh:string;subjectEn:string;organizationZh:string;organizationEn:string;pipeline:string;titleZh:string;titleEn:string;stage:FunnelMetric["stage"];amount:number;currency:string;probability:number;expectedCloseDate:string|null;nextActionZh:string;nextActionEn:string;ownerId:string;ownerZh:string;ownerEn:string;lastActivityAt:string|null};
type OpportunityRow={id:string;subject_type:"SCHOOL"|"HOUSEHOLD";pipeline_key:string;organization_id:string|null;household_id:string|null;title_zh:string;title_en:string;stage:OpportunityRecord["stage"];amount:number|string;currency:string;probability:number;expected_close_date:string|null;next_action_zh:string;next_action_en:string;owner_id:string;last_activity_at:string|null;organizations:{name_zh:string;name_en:string}|null;households:{name_zh:string;name_en:string}|null};

export async function listOpportunities(input:{page?:number;pageSize?:number;query?:string;stage?:string;team?:string}={}){
  const page=Math.max(1,input.page??1);const pageSize=Math.min(100,Math.max(1,input.pageSize??20));const params=new URLSearchParams({select:"id,subject_type,pipeline_key,organization_id,household_id,title_zh,title_en,stage,amount,currency,probability,expected_close_date,next_action_zh,next_action_en,owner_id,last_activity_at,organizations:organizations!opportunities_workspace_organization_fk(name_zh,name_en),households:households!opportunities_workspace_household_fk(name_zh,name_en)",order:"updated_at.desc"});
  if(input.stage&&input.stage!=="all")params.set("stage",`eq.${input.stage}`);
  const query=input.query?.replace(/[*,()]/g," ").trim().slice(0,100);if(query)params.set("or",`(title_zh.ilike.*${query}*,title_en.ilike.*${query}*)`);
  const response=await supabaseRequest(`/rest/v1/opportunities?${params}`,{headers:{Prefer:"count=exact",Range:`${(page-1)*pageSize}-${page*pageSize-1}`}});const rows=await response.json() as OpportunityRow[];
  const ownerIds=[...new Set(rows.map(row=>row.owner_id))];const owners=new Map<string,{zh:string;en:string}>();if(ownerIds.length){const profiles=await supabaseJson<Array<{user_id:string;display_name_zh:string;display_name_en:string}>>(`/rest/v1/user_profiles?select=user_id,display_name_zh,display_name_en&user_id=in.(${ownerIds.join(",")})`);profiles.forEach(profile=>owners.set(profile.user_id,{zh:profile.display_name_zh,en:profile.display_name_en}));}
  const contentRange=response.headers.get("content-range")??"*/0";
  return {page,pageSize,total:Number(contentRange.split("/")[1]??rows.length),items:rows.map((row):OpportunityRecord=>{const owner=owners.get(row.owner_id);const subjectZh=row.subject_type==="HOUSEHOLD"?row.households?.name_zh??"":row.organizations?.name_zh??"";const subjectEn=row.subject_type==="HOUSEHOLD"?row.households?.name_en??"":row.organizations?.name_en??"";return{id:row.id,subjectType:row.subject_type,organizationId:row.organization_id??"",householdId:row.household_id??"",subjectZh,subjectEn,organizationZh:subjectZh,organizationEn:subjectEn,pipeline:row.pipeline_key,titleZh:row.title_zh,titleEn:row.title_en,stage:row.stage,amount:Number(row.amount),currency:row.currency,probability:Number(row.probability),expectedCloseDate:row.expected_close_date,nextActionZh:row.next_action_zh,nextActionEn:row.next_action_en,ownerId:row.owner_id,ownerZh:owner?.zh??"",ownerEn:owner?.en??"",lastActivityAt:row.last_activity_at};})};
}

export async function createOpportunity(input:{subjectType:"SCHOOL"|"HOUSEHOLD";organizationId?:string|null;householdId?:string|null;productId?:string|null;titleZh:string;titleEn:string;stage:OpportunityRecord["stage"];amount:number;currency:string;probability:number;expectedCloseDate?:string|null;nextActionZh:string;nextActionEn:string}){
  const rows=await supabaseJson<OpportunityRow[]>("/rest/v1/opportunities",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({subject_type:input.subjectType,pipeline_key:input.subjectType==="SCHOOL"?"SCHOOL_DEFAULT":"HOUSEHOLD_DEFAULT",organization_id:input.subjectType==="SCHOOL"?input.organizationId:null,household_id:input.subjectType==="HOUSEHOLD"?input.householdId:null,product_id:input.productId??null,title_zh:input.titleZh,title_en:input.titleEn,stage:input.stage,amount:input.amount,currency:input.currency,probability:input.probability,expected_close_date:input.expectedCloseDate??null,next_action_zh:input.nextActionZh,next_action_en:input.nextActionEn})});return rows[0];
}

export async function updateOpportunity(id:string,input:{stage:OpportunityRecord["stage"];probability:number;expectedCloseDate?:string|null;nextActionZh:string;nextActionEn:string;reason?:string;evidence?:string}){
  return supabaseJson<OpportunityRow>("/rest/v1/rpc/change_opportunity_stage",{
    method:"POST",
    body:JSON.stringify({
      target_opportunity:id,
      next_stage:input.stage,
      next_probability:input.probability,
      next_expected_close:input.expectedCloseDate??null,
      next_action_zh:input.nextActionZh,
      next_action_en:input.nextActionEn,
      stage_reason:input.reason??"",
      stage_evidence:input.evidence??"",
    }),
  });
}
