import { supabaseJson } from "./supabase-server";

export type TaskWorkItem={
  id:string;titleZh:string;titleEn:string;related:string;status:string;priority:string;
  ownerId:string;ownerName:string;dueAt:string|null;slaDueAt:string|null;
};
export type TeamCapacity={
  userId:string;name:string;role:string;team:string;open:number;overdue:number;dueThisWeek:number;slaBreached:number;
};
export type TaskWorkspace={canViewTeam:boolean;items:TaskWorkItem[];capacity:TeamCapacity[]};

export async function loadTaskWorkspace(){
  const raw=await supabaseJson<TaskWorkspace>("/rest/v1/rpc/crm_task_workspace",{method:"POST",body:"{}"});
  return{
    canViewTeam:Boolean(raw.canViewTeam),
    items:(raw.items??[]).map(item=>({...item})),
    capacity:(raw.capacity??[]).map(item=>({...item,open:Number(item.open),overdue:Number(item.overdue),dueThisWeek:Number(item.dueThisWeek),slaBreached:Number(item.slaBreached)})),
  };
}
export async function bulkCompleteTasks(ids:string[],reason:string){
  return supabaseJson<number>("/rest/v1/rpc/bulk_complete_crm_tasks",{method:"POST",body:JSON.stringify({task_ids:ids,completion_reason:reason})});
}
