import {databaseJson,databaseRequest} from "./db/gateway";
import type {z} from "zod";
import type {ApplicationData,applicationFiltersSchema,applicationSaveSchema} from "./application-input";
import {saveEducationBusiness} from "./education-business-repository";
export type ApplicationRecord=ApplicationData&{id:string;workspace_id:string;revision:number;created_at:string;updated_at:string;student_id:string;cohort_id:string;product_id:string;student_number:string;student_name_zh:string;student_name_en:string;product_name_zh:string;product_name_en:string;cohort_name_zh:string;cohort_name_en:string;target_name_zh:string|null;target_name_en:string|null;owner_name_zh:string|null;owner_name_en:string|null;cohort_application_deadline:string|null;can_edit:boolean};
export type ApplicationHistory={id:string;from_status:ApplicationData["status"]|null;to_status:ApplicationData["status"];changed_at:string;reason:string;application_revision:number};
export type ApplicationTask={id:string;revision:number;student_id:string;application_id:string|null;title:string;due_on:string|null;status:"TODO"|"IN_PROGRESS"|"DONE"|"WAIVED";next_action:string;updated_at:string};
export type ApplicationPage={items:ApplicationRecord[];page:number;pageSize:number;total:number};
type Adapter={json:typeof databaseJson;request:typeof databaseRequest};
const database:Adapter={json:databaseJson,request:databaseRequest};
export async function listApplications(options:Partial<z.infer<typeof applicationFiltersSchema>>,adapter=database):Promise<ApplicationPage>{
 const page=options.page??1,pageSize=options.pageSize??20,params=new URLSearchParams({order:"updated_at.desc,id.desc"});
 for(const [column,key] of [["enrollment_id","enrollmentId"],["student_id","studentId"],["product_id","productId"],["cohort_id","cohortId"],["owner_id","ownerId"],["target_organization_id","targetOrganizationId"],["status","status"],["decision","decision"]] as const)if(options[key])params.set(column,`eq.${options[key]}`);
 const query=options.query?.replace(/[*,()%_]/g," ").trim();if(query)params.set("or",`(student_name_zh.ilike.*${query}*,student_name_en.ilike.*${query}*,student_number.ilike.*${query}*,external_application_id.ilike.*${query}*)`);
 if(options.deadlineFrom&&options.deadlineTo)params.set("and",`(deadline_on.gte.${options.deadlineFrom},deadline_on.lte.${options.deadlineTo})`);
 else if(options.deadlineFrom)params.set("deadline_on",`gte.${options.deadlineFrom}`);else if(options.deadlineTo)params.set("deadline_on",`lte.${options.deadlineTo}`);
 const response=await adapter.request(`/db/table/student_application_records?${params}`,{headers:{Prefer:"count=exact",Range:`${(page-1)*pageSize}-${page*pageSize-1}`}});
 const items=await response.json() as ApplicationRecord[];return{items,page,pageSize,total:Number(response.headers.get("content-range")?.split("/")[1]??items.length)};
}
export async function getApplication(id:string,adapter=database){return(await adapter.json<ApplicationRecord[]>(`/db/table/student_application_records?${new URLSearchParams({id:`eq.${id}`,limit:"1"})}`))[0]??null;}
export function saveApplication(input:z.infer<typeof applicationSaveSchema>,adapter=database){return adapter.json<ApplicationData&{id:string;revision:number}>("/db/rpc/save_student_application",{method:"POST",body:JSON.stringify({record_id:input.id,expected_revision:input.expectedRevision,data:input.data,p_request_key:input.requestKey,status_reason:input.statusReason})});}
export function listApplicationStatusHistory(id:string,page=1,adapter=database){return adapter.json<ApplicationHistory[]>(`/db/table/student_application_status_history?${new URLSearchParams({application_id:`eq.${id}`,order:"changed_at.asc,id.asc",limit:"50",offset:String((page-1)*50)})}`);}
export function listApplicationTasks(id:string,page=1,adapter=database){return adapter.json<ApplicationTask[]>(`/db/table/student_application_tasks?${new URLSearchParams({application_id:`eq.${id}`,order:"updated_at.desc,id.asc",limit:"50",offset:String((page-1)*50)})}`);}
export function saveApplicationTask(input:{id:string;expectedRevision:number|null;data:Omit<ApplicationTask,"id"|"revision"|"updated_at">},adapter=database){return saveEducationBusiness({...input,resource:"applications"},adapter);}
