import { pendingApprovalCount } from "./pending-approval-count";
import { databaseJson } from "./db/gateway";
import {executeTaskCompletion} from "./task-workspace-repository";
import { loadGrowthPerformance } from "./v220-repository";
export type DashboardTask={id:string;titleZh:string;titleEn:string;related:string;status:string;priority:string;dueAt:string|null;revision:number};
export type DashboardSnapshot={approvalUnavailable?:boolean;growthUnavailable?:boolean;todayTasks:number;overdueTasks:number;pendingApprovals:number;renewalsDue:number;riskContracts:number;activeProducts:number;unreadNotifications:number;newLeads:number;activeStudents:number;pendingProgression:number;activeCampaigns:number;attributedLeads:number;pendingAdmissions:number;monthRevenueByCurrency:Record<string,number>;focusTasks:DashboardTask[]};
export async function loadDashboardSignals(adapter={json:databaseJson,growth:loadGrowthPerformance}){const[raw,growth]=await Promise.all([adapter.json<DashboardSnapshot>("/db/rpc/dashboard_snapshot",{method:"POST",body:JSON.stringify({reporting_timezone:null})}),adapter.growth().catch(()=>null)]);return {...raw,growthUnavailable:growth===null,todayTasks:Number(raw.todayTasks),overdueTasks:Number(raw.overdueTasks),pendingApprovals:Number(raw.pendingApprovals),renewalsDue:Number(raw.renewalsDue),riskContracts:Number(raw.riskContracts),activeProducts:Number(raw.activeProducts),unreadNotifications:Number(raw.unreadNotifications),newLeads:Number(raw.newLeads??0),activeStudents:Number(raw.activeStudents??0),pendingProgression:Number(raw.pendingProgression??0),activeCampaigns:Number(growth?.summary.activeCampaigns??0),attributedLeads:Number(growth?.summary.attributedLeads??0),pendingAdmissions:Number(growth?.summary.pendingAdmissions??0),monthRevenueByCurrency:Object.fromEntries(Object.entries(raw.monthRevenueByCurrency??{}).map(([key,value])=>[key,Number(value)])),focusTasks:raw.focusTasks??[]};}
export async function loadDashboard(adapter={json:databaseJson,growth:loadGrowthPerformance,approvals:pendingApprovalCount}):Promise<DashboardSnapshot>{
  const [snapshot,approvals]=await Promise.all([
    loadDashboardSignals(adapter),
    adapter.approvals().then(count=>({count,unavailable:false})).catch(()=>({count:0,unavailable:true})),
  ]);
  return {...snapshot,pendingApprovals:approvals.count,approvalUnavailable:approvals.unavailable};
}
export async function completeDashboardTask(id:string,expectedRevision:number,requestKey:string,adapter=databaseJson){
  return executeTaskCompletion({operation:"complete",tasks:[{id,expectedRevision}],requestKey},adapter);
}
