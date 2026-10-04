import {databaseJson,databaseRequest} from "./db/gateway";
import type {z} from "zod";
import type {MilestoneData,milestoneSaveSchema} from "./admission-milestone-input";
export type MilestoneRecord=MilestoneData&{id:string;workspace_id:string;revision:number;created_at:string;updated_at:string;owner_name_zh:string|null;owner_name_en:string|null;can_edit:boolean;overdue:boolean|null};
export type MilestoneHistory={id:string;from_status:MilestoneData["status"]|null;to_status:MilestoneData["status"];changed_at:string;reason:string;milestone_revision:number};
export type MilestonePage={items:MilestoneRecord[];page:number;pageSize:number;total:number};
export type AdmissionsTimelineEvent={id:string;sourceType:"APPLICATION"|"MILESTONE"|"WORKFLOW";sourceId:string;applicationId:string|null;eventType:"SUBMITTED"|"DECISION"|"WITHDRAWN"|"MILESTONE"|"STARTED"|"COMPLETED";milestoneType:MilestoneData["milestone_type"]|null;status:string;eventAt:string;sequence:number;outcome:string|null};
export type AdmissionsTimelinePage={items:AdmissionsTimelineEvent[];page:number;pageSize:number;total:number};
type Adapter={json:typeof databaseJson;request:typeof databaseRequest};const database:Adapter={json:databaseJson,request:databaseRequest};
export async function listMilestones(options:{enrollmentId:string;applicationId?:string;page?:number;pageSize?:number},adapter=database):Promise<MilestonePage>{
 const page=options.page??1,pageSize=options.pageSize??20,params=new URLSearchParams({enrollment_id:`eq.${options.enrollmentId}`,order:"sequence.asc,id.asc"});if(options.applicationId)params.set("application_id",`eq.${options.applicationId}`);
 const response=await adapter.request(`/db/table/admission_milestone_records?${params}`,{headers:{Prefer:"count=exact",Range:`${(page-1)*pageSize}-${page*pageSize-1}`}}),items=await response.json() as MilestoneRecord[];return{items,page,pageSize,total:Number(response.headers.get("content-range")?.split("/")[1]??items.length)};
}
export async function getMilestone(id:string,adapter=database){return(await adapter.json<MilestoneRecord[]>(`/db/table/admission_milestone_records?${new URLSearchParams({id:`eq.${id}`,limit:"1"})}`))[0]??null;}
export function saveMilestone(input:z.infer<typeof milestoneSaveSchema>,adapter=database){return adapter.json<MilestoneData&{id:string;revision:number}>("/db/rpc/save_admission_milestone",{method:"POST",body:JSON.stringify({record_id:input.id,expected_revision:input.expectedRevision,data:input.data,p_request_key:input.requestKey,status_reason:input.statusReason})});}
export function listMilestoneStatusHistory(id:string,page=1,adapter=database){return adapter.json<MilestoneHistory[]>(`/db/table/admission_milestone_status_history?${new URLSearchParams({milestone_id:`eq.${id}`,order:"changed_at.asc,id.asc",limit:"50",offset:String((page-1)*50)})}`);}
export async function listAdmissionsTimeline(enrollmentId:string,page=1,pageSize=20,adapter=database):Promise<AdmissionsTimelinePage>{
 const params=new URLSearchParams({enrollment_id:`eq.${enrollmentId}`,order:"event_at.asc,sequence.asc,source_type.asc,source_id.asc,event_type.asc"}),response=await adapter.request(`/db/table/admissions_timeline?${params}`,{headers:{Prefer:"count=exact",Range:`${(page-1)*pageSize}-${page*pageSize-1}`}});
 const rows=await response.json() as Array<{source_type:AdmissionsTimelineEvent["sourceType"];source_id:string;application_id:string|null;event_type:AdmissionsTimelineEvent["eventType"];milestone_type:AdmissionsTimelineEvent["milestoneType"];status:string;event_at:string;sequence:number;outcome:string|null}>;
 return{items:rows.map(row=>({id:`${row.source_type}:${row.source_id}:${row.event_type}`,sourceType:row.source_type,sourceId:row.source_id,applicationId:row.application_id,eventType:row.event_type,milestoneType:row.milestone_type,status:row.status,eventAt:row.event_at,sequence:row.sequence,outcome:row.outcome})),page,pageSize,total:Number(response.headers.get("content-range")?.split("/")[1]??rows.length)};
}
