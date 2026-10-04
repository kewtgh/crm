import { databaseJson, databaseRequest } from "./db/gateway";
import { businessConfig,businessContextFilters,type BusinessContext,type BusinessRecord,type BusinessResource } from "./education-business";

export type BusinessPage = {items:BusinessRecord[];total:number;page:number;pageSize:number;labels:Record<string,string>;editableIds:string[];today:string};
type Adapter = {json:typeof databaseJson;request:typeof databaseRequest};
const database:Adapter={json:databaseJson,request:databaseRequest};
export async function listEducationBusiness(resource:BusinessResource,options:{page:number;pageSize:number;context?:BusinessContext;query?:string},adapter=database):Promise<BusinessPage>{
  const config=businessConfig[resource];
  const fields=["id","revision","updated_at",...config.fields.map(field=>field.key)];
  const params=new URLSearchParams({select:fields.join(","),order:"updated_at.desc,id.asc",...businessContextFilters(resource,options.context)});
  const query=options.query?.replace(/[*,()]/g," ").trim().slice(0,100);
  if(query&&resource==="events")params.set("name",`ilike.*${query}*`);
  const pageSize=Math.max(1,Math.min(50,Math.floor(options.pageSize))),page=Math.max(1,Math.floor(options.page));
  const response=await adapter.request(`/db/table/${config.table}?${params}`,{headers:{Prefer:"count=exact",Range:`${(page-1)*pageSize}-${page*pageSize-1}`}});
  const items=await response.json() as BusinessRecord[];
  const total=Number(response.headers.get("content-range")?.split("/")[1]??items.length);
  // References are resolved under their own RLS; never return an inaccessible record's name.
  const references=new Map<string,Set<string>>();
  const add=(type:string,id:unknown)=>{if(typeof id!=="string"||!id)return;const ids=references.get(type)??new Set();ids.add(id);references.set(type,ids);};
  if(options.context)add(options.context.type,options.context.id);
  for(const row of items){
    if(resource==="organizations")add("ORGANIZATION",row.id);
    if(resource==="needs")add("HOUSEHOLD",row.id);
    for(const field of config.fields)if(field.kind==="relation")add(field.relation!,row[field.key]);
  }
  const labels:Record<string,string>={};
  const lookupTables:Record<string,string>={ORGANIZATION:"organizations",HOUSEHOLD:"households",CONTACT:"contacts",EVENT:"education_outreach_events",PRODUCT:"products",COHORT:"product_cohorts",CAMPAIGN:"growth_campaigns"};
  await Promise.all([...references].map(async([type,ids])=>{
    if(type==="STUDENT"){
      const rows=await adapter.json<Array<{id:string;contacts:{name_zh:string;name_en:string}|null}>>(`/db/table/students?select=id,contacts:contacts!students_person_id_fkey(name_zh,name_en)&id=in.(${[...ids].join(",")})`);
      for(const row of rows)if(row.contacts)labels[`${type}:${row.id}`]=[row.contacts.name_zh,row.contacts.name_en].filter(Boolean).join(" / ");
    }else if(type==="APPLICATION"){
      const rows=await adapter.json<Array<{id:string;target_name_zh:string|null;target_name_en:string|null;external_application_id:string|null}>>(`/db/table/student_application_records?select=id,target_name_zh,target_name_en,external_application_id&id=in.(${[...ids].join(",")})`);
      for(const row of rows)labels[`${type}:${row.id}`]=[row.target_name_zh,row.target_name_en,row.external_application_id].filter(Boolean).join(" / ")||row.id;
    }else{
      const rows=await adapter.json<Array<{id:string;name?:string;name_zh?:string;name_en?:string}>>(`/db/table/${lookupTables[type]}?select=${type==="EVENT"?"id,name":"id,name_zh,name_en"}&id=in.(${[...ids].join(",")})`);
      for(const row of rows)labels[`${type}:${row.id}`]=row.name??[row.name_zh,row.name_en].filter(Boolean).join(" / ");
    }
  }));
  const permissions=items.length?await adapter.json<Array<{id:string;can_edit:boolean}>>("/db/rpc/education_business_permissions",{method:"POST",body:JSON.stringify({resource,record_ids:items.map(row=>row.id)})}):[];
  const today=await adapter.json<string>("/db/rpc/education_business_today",{method:"POST",body:"{}"});
  return{items,total,page,pageSize,labels,editableIds:permissions.filter(row=>row.can_edit).map(row=>row.id),today};
}
export function saveEducationBusiness(input:{resource:BusinessResource;id:string;expectedRevision:number|null;data:Record<string,unknown>},adapter=database){
  return adapter.json<BusinessRecord>("/db/rpc/save_education_business",{method:"POST",body:JSON.stringify({resource:input.resource,record_id:input.id,expected_revision:input.expectedRevision,data:input.data})});
}

export type CommercialContact={id:string;name_zh:string;name_en:string;title:string;decision_role:string;next_follow_up_at:string|null;wechat_id:string|null;updated_at:string;can_edit:boolean};
export type OrganizationCommercialSnapshot={organization:Record<string,unknown>;profile:BusinessRecord|null;contacts:CommercialContact[];intelligence:import("./channel-commercial-input").ContactIntelligence[];relationships:import("./channel-commercial-input").ContactRelationship[];outcomes:import("./channel-commercial-input").AdmissionOutcome[];opportunities:Record<string,unknown>[];canManage:boolean;limited:boolean};
export async function getOrganizationCommercial(id:string,adapter=database):Promise<OrganizationCommercialSnapshot|null>{
 const organization=(await adapter.json<Record<string,unknown>[]>("/db/table/organizations?"+new URLSearchParams({id:"eq."+id,archived_at:"is.null",limit:"1"})))[0];if(!organization)return null;
 const [profiles,contacts,intelligence,relationships,outcomes,opportunities,canManage]=await Promise.all([
 adapter.json<BusinessRecord[]>("/db/table/organization_business_profiles?id=eq."+id+"&limit=1"),
 adapter.json<CommercialContact[]>("/db/table/organization_commercial_contact_records?organization_id=eq."+id+"&order=name_zh.asc,id.asc&limit=101"),
 adapter.json<OrganizationCommercialSnapshot["intelligence"]>("/db/table/organization_contact_intelligence_records?organization_id=eq."+id+"&order=updated_at.desc,id.asc&limit=101"),
 adapter.json<OrganizationCommercialSnapshot["relationships"]>("/db/table/organization_contact_relationship_records?organization_id=eq."+id+"&order=status.asc,id.asc&limit=101"),
 adapter.json<OrganizationCommercialSnapshot["outcomes"]>("/db/table/organization_admission_outcome_records?organization_id=eq."+id+"&order=academic_year.desc,destination_region.asc&limit=101"),
 adapter.json<Record<string,unknown>[]>("/db/table/opportunity_commercial_records?organization_id=eq."+id+"&order=updated_at.desc,id.asc&limit=101"),
 adapter.json<boolean>("/db/rpc/channel_intelligence_access",{method:"POST",body:JSON.stringify({resource:"outcomes",record:{organization_id:id,workspace_id:organization.workspace_id},edit:true})})]);
 return{organization,profile:profiles[0]??null,contacts:contacts.slice(0,100),intelligence:intelligence.slice(0,100),relationships:relationships.slice(0,100),outcomes:outcomes.slice(0,100),opportunities:opportunities.slice(0,100),canManage,limited:[contacts,intelligence,relationships,outcomes,opportunities].some(rows=>rows.length>100)};
}
export function saveOrganizationAdmissionOutcome(input:import("./channel-commercial-input").ChannelSave<import("zod").z.infer<typeof import("./channel-commercial-input").outcomeDataSchema>>,adapter=database){return adapter.json<import("./channel-commercial-input").AdmissionOutcome>("/db/rpc/save_organization_admission_outcome",{method:"POST",body:JSON.stringify({record_id:input.id,expected_revision:input.expectedRevision,data:input.data,p_request_key:input.requestKey})});}
