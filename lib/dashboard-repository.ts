import { pendingApprovalCount } from "./pending-approval-count";
import { databaseJson, DatabaseRequestError } from "./db/gateway";
import { loadGrowthPerformance } from "./v220-repository";
export type DashboardTask={id:string;titleZh:string;titleEn:string;related:string;status:string;priority:string;dueAt:string|null};
export type DashboardSnapshot={approvalUnavailable?:boolean;growthUnavailable?:boolean;todayTasks:number;overdueTasks:number;pendingApprovals:number;renewalsDue:number;riskContracts:number;activeProducts:number;unreadNotifications:number;newLeads:number;activeStudents:number;pendingProgression:number;activeCampaigns:number;attributedLeads:number;pendingAdmissions:number;monthRevenueByCurrency:Record<string,number>;focusTasks:DashboardTask[]};
export async function loadDashboardSignals(adapter={json:databaseJson,growth:loadGrowthPerformance}){const[raw,growth]=await Promise.all([adapter.json<DashboardSnapshot>("/db/rpc/dashboard_snapshot",{method:"POST",body:JSON.stringify({reporting_timezone:null})}),adapter.growth().catch(()=>null)]);return {...raw,growthUnavailable:growth===null,todayTasks:Number(raw.todayTasks),overdueTasks:Number(raw.overdueTasks),pendingApprovals:Number(raw.pendingApprovals),renewalsDue:Number(raw.renewalsDue),riskContracts:Number(raw.riskContracts),activeProducts:Number(raw.activeProducts),unreadNotifications:Number(raw.unreadNotifications),newLeads:Number(raw.newLeads??0),activeStudents:Number(raw.activeStudents??0),pendingProgression:Number(raw.pendingProgression??0),activeCampaigns:Number(growth?.summary.activeCampaigns??0),attributedLeads:Number(growth?.summary.attributedLeads??0),pendingAdmissions:Number(growth?.summary.pendingAdmissions??0),monthRevenueByCurrency:Object.fromEntries(Object.entries(raw.monthRevenueByCurrency??{}).map(([key,value])=>[key,Number(value)])),focusTasks:raw.focusTasks??[]};}
export async function loadDashboard(adapter={json:databaseJson,growth:loadGrowthPerformance,approvals:pendingApprovalCount}):Promise<DashboardSnapshot>{
  const [snapshot,approvals]=await Promise.all([
    loadDashboardSignals(adapter),
    adapter.approvals().then(count=>({count,unavailable:false})).catch(()=>({count:0,unavailable:true})),
  ]);
  return {...snapshot,pendingApprovals:approvals.count,approvalUnavailable:approvals.unavailable};
}
export async function completeDashboardTask(id:string, adapter=databaseJson){
  const timestamp=new Date().toISOString();
  const rows=await adapter<Array<{id:string}>>(`/db/table/crm_tasks?id=eq.${encodeURIComponent(id)}&archived_at=is.null&status=neq.DONE`,{
    method:"PATCH",body:JSON.stringify({status:"DONE",completed_at:timestamp,updated_at:timestamp}),headers:{Prefer:"return=representation"},
  });
  // A transport success is not evidence that RLS allowed a row to change.
  // Repeated completion cannot rewrite the original completion timestamp.
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==id){
    throw new DatabaseRequestError(409,"TASK_STATE_CHANGED","Task state changed or is unavailable");
  }
}
