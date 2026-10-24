import { databaseJson, DatabaseRequestError } from "./db/gateway";
import {confirmedTaskCompletion,taskCompletionSchema,type TaskCompletion} from "./task-completion";

export type TaskWorkItem={
  id:string;titleZh:string;titleEn:string;related:string;status:string;priority:string;
  ownerId:string;ownerName:string;dueAt:string|null;slaDueAt:string|null;revision:number;
};
export type TeamCapacity={
  userId:string;name:string;role:string;team:string;open:number;overdue:number;dueThisWeek:number;slaBreached:number;
};
export type TaskWorkspace={canViewTeam:boolean;items:TaskWorkItem[];capacity:TeamCapacity[]};

export async function loadTaskWorkspace(){
  const raw=await databaseJson<TaskWorkspace>("/db/rpc/crm_task_workspace",{method:"POST",body:"{}"});
  return{
    canViewTeam:Boolean(raw.canViewTeam),
    items:(raw.items??[]).map(item=>({...item})),
    capacity:(raw.capacity??[]).map(item=>({...item,open:Number(item.open),overdue:Number(item.overdue),dueThisWeek:Number(item.dueThisWeek),slaBreached:Number(item.slaBreached)})),
  };
}
export async function executeTaskCompletion(input:TaskCompletion,adapter=databaseJson){
  const {requestKey,...command}=taskCompletionSchema.parse(input);
  const value=await adapter<unknown>("/db/rpc/complete_crm_tasks_command",{method:"POST",body:JSON.stringify({command,p_request_key:requestKey})});
  const result=confirmedTaskCompletion(value,input);
  if(!result)throw new DatabaseRequestError(502,"INVALID_TASK_COMPLETION_RESULT","Unconfirmed task completion result");
  return result;
}
