import {applyReportFilter,type ReportFilter} from "./management-trend-contract";
import {databaseJson,databaseRequest} from "./db/gateway";
import type {z} from "zod";
import type {successOutcomeDataSchema,successOutcomeSaveSchema,successOutcomeVoidSchema} from "./student-success-outcomes-input";
export type SuccessOutcome=z.infer<typeof successOutcomeDataSchema>&{id:string;workspace_id:string;revision:number;record_status:"RECORDED"|"VOIDED";void_reason:string|null;voided_at:string|null;goal_title:string|null;owner_name_zh:string|null;owner_name_en:string|null};
export function listSuccessOutcomes(caseId:string,page=1,showVoided=false,adapter=databaseJson,period?:{from?:string;to?:string}){return adapter<SuccessOutcome[]>(`/db/table/student_success_outcome_records?${new URLSearchParams({case_id:`eq.${caseId}`,order:"occurred_on.desc,id.asc",limit:"50",offset:String((page-1)*50),...(period?.from&&period?.to?{and:`(occurred_on.gte.${period.from},occurred_on.lte.${period.to})`}:period?.from?{occurred_on:`gte.${period.from}`}:period?.to?{occurred_on:`lte.${period.to}`}:{ }),...(!showVoided?{record_status:"eq.RECORDED"}:{})})}`);}
export async function getSuccessOutcome(caseId:string,id:string,adapter=databaseJson){const items=await adapter<SuccessOutcome[]>(`/db/table/student_success_outcome_records?${new URLSearchParams({case_id:`eq.${caseId}`,id:`eq.${id}`,limit:"1"})}`);return items[0]??null;}
export function saveSuccessOutcome(input:z.infer<typeof successOutcomeSaveSchema>,adapter=databaseJson){return adapter<SuccessOutcome>("/db/rpc/save_student_success_outcome",{method:"POST",body:JSON.stringify({record_id:input.id,expected_revision:input.expectedRevision,data:input.data,p_request_key:input.requestKey})});}
export function voidSuccessOutcome(input:z.infer<typeof successOutcomeVoidSchema>,adapter=databaseJson){return adapter<SuccessOutcome>("/db/rpc/void_student_success_outcome",{method:"POST",body:JSON.stringify({record_id:input.id,expected_revision:input.expectedRevision,reason:input.reason,p_request_key:input.requestKey})});}

export async function listSuccessOutcomePage(filters:ReportFilter,page=1,pageSize=20,adapter=databaseRequest){
 const params=new URLSearchParams({order:"occurred_on.desc,id.asc",record_status:"eq.RECORDED"});applyReportFilter(params,{...filters,reportMetric:filters.reportMetric??"recordedOutcomes"});
 const response=await adapter(`/db/table/student_success_outcome_records?${params}`,{headers:{Prefer:"count=exact",Range:`${(page-1)*pageSize}-${page*pageSize-1}`}});
 const items=await response.json() as SuccessOutcome[];return{items,total:Number(response.headers.get("content-range")?.split("/")[1]??items.length),page,pageSize};
}
