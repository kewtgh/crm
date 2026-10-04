import {databaseJson,databaseRequest} from "./db/gateway";
import type {z} from "zod";
import type {poolFilterSchema,assignmentInputSchema} from "./lead-pool-input";
export type PoolLead={id:string;subject_type:string;organization_id:string|null;household_id:string|null;subject_name_zh:string;subject_name_en:string;source:string;status:string;pool_visibility:string;owner_id:string|null;revision:number;qualification_score:number;qualification_note:string;next_action:string;created_at:string;updated_at:string;city:string|null;school_type:string|null;commercial_tier:string|null;partnership_potential_score:number|null;key_contact_count:number;latest_activity_at:string|null;can_edit:boolean;can_assign:boolean;is_mine:boolean};
type Adapter={json:typeof databaseJson;request:typeof databaseRequest};const database:Adapter={json:databaseJson,request:databaseRequest};
export async function listLeadPool(options:z.infer<typeof poolFilterSchema>&{page:number;pageSize:number;query?:string;status?:string},adapter=database){
 const p=new URLSearchParams({select:"*",order:options.sort==="potential"?"partnership_potential_score.desc.nullslast,id.asc":options.sort==="tier"?"commercial_tier.asc.nullslast,id.asc":`created_at.${options.sort==="oldest"?"asc":"desc"},id.asc`});
 if(options.organization)p.set("organization_id",`eq.${options.organization}`);
 if(options.view==="pool"){p.set("subject_type","eq.SCHOOL");p.set("pool_visibility","eq.WORKSPACE_PUBLIC");p.set("owner_id","is.null");p.set("status","in.(NEW,QUALIFYING,QUALIFIED)");}
 if(options.view==="mine"){p.set("is_mine","eq.true");p.set("status","in.(NEW,QUALIFYING,QUALIFIED)");}
 if(options.status&&options.status!=="all"){p.set("status",`eq.${options.status}`);if(options.view!=="all"&&!['NEW','QUALIFYING','QUALIFIED'].includes(options.status))p.set("id","is.null");}
 const safe=(v:string)=>v.replace(/[*,()]/g," ").trim();if(options.query?.trim())p.set("or",`(subject_name_zh.ilike.*${safe(options.query)}*,subject_name_en.ilike.*${safe(options.query)}*)`);
 if(options.city)p.set("city",`ilike.*${safe(options.city)}*`);if(options.tier!=="all")p.set("commercial_tier","eq."+options.tier);if(options.schoolType!=="all")p.set("school_type","eq."+options.schoolType);
 if(options.potentialMin!==undefined)p.set("partnership_potential_score","gte."+options.potentialMin);if(options.keyContact!=="all")p.set("key_contact_count",options.keyContact==="yes"?"gt.0":"eq.0");
 if(options.ageDays)p.set("created_at","lte."+new Date(Date.now()-options.ageDays*86400000).toISOString());
 const page=Math.max(1,options.page),pageSize=Math.max(1,Math.min(50,options.pageSize));
 const response=await adapter.request(`/db/table/lead_pool_records?${p}`,{headers:{Prefer:"count=exact",Range:`${(page-1)*pageSize}-${page*pageSize-1}`}});
 return{items:await response.json() as PoolLead[],total:Number(response.headers.get("content-range")?.split("/")[1]??0),page,pageSize};
}
export function assignLead(id:string,operation:string,input:z.infer<typeof assignmentInputSchema>,adapter=database){return adapter.json<PoolLead>("/db/rpc/manage_lead_assignment",{method:"POST",body:JSON.stringify({target_lead:id,expected_revision:input.expectedRevision,operation,target_owner:input.ownerId??null,reason:input.reason,p_request_key:input.requestKey})});}
export function listLeadAssignmentHistory(id:string,adapter=database){return adapter.json<Array<{id:string;event_type:string;from_owner_id:string|null;to_owner_id:string|null;changed_at:string;reason:string|null;lead_revision:number}>>(`/db/table/lead_assignment_history?lead_id=eq.${id}&order=changed_at.desc,id.asc&limit=100`);}
export async function getPoolLead(id:string,adapter=database){return(await adapter.json<PoolLead[]>(`/db/table/lead_pool_records?id=eq.${encodeURIComponent(id)}&limit=1`))[0]??null;}
