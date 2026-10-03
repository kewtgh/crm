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
