import { hasCapability } from "./capabilities";
import { loadDashboard } from "./dashboard-repository";
import { loadReleaseReadiness } from "./operations-repository";
import { databaseRequest } from "./db/gateway";
import type { AppUser } from "./user";

export type ActionCenterItem={id:string;category:"work"|"sales"|"service"|"governance";priority:"urgent"|"high"|"normal";count:number;titleKey:string;detailKey:string;href:string;source:"live_aggregate"};
export type ActionCenterSnapshot={generatedAt:string;role:AppUser["role"];items:ActionCenterItem[];total:number;urgent:number};

async function activePrivacyRequestCount() {
  const statuses = "RECEIVED,IDENTITY_REVIEW,IN_PROGRESS,WAITING_APPROVAL,EXECUTING,EXECUTION_FAILED";
  const response = await databaseRequest(
    `/db/table/privacy_requests?select=id&status=in.(${statuses})`,
    { headers: { Prefer: "count=exact", Range: "0-0" } },
  );
  return Number((response.headers.get("content-range") ?? "*/0").split("/")[1] ?? 0);
}

export async function loadActionCenter(user:AppUser):Promise<ActionCenterSnapshot>{
  const canManagePrivacy = hasCapability(user.role, "privacyRequests.manage");
  const canManageOperations = hasCapability(user.role, "admin.access");
  const [data, privacyCount, readiness] = await Promise.all([
    loadDashboard(),
    canManagePrivacy ? activePrivacyRequestCount() : Promise.resolve(0),
    canManageOperations ? loadReleaseReadiness() : Promise.resolve(null),
  ]);
  const items:ActionCenterItem[]=[];const add=(item:Omit<ActionCenterItem,"source">,allowed=true)=>{if(allowed&&item.count>0)items.push({...item,source:"live_aggregate"});};
  add({id:"overdue-tasks",category:"work",priority:"urgent",count:data.overdueTasks,titleKey:"actionCenter.item.overdueTasks",detailKey:"actionCenter.item.overdueTasksHelp",href:"/tasks"},hasCapability(user.role,"tasks.view"));
  add({id:"today-tasks",category:"work",priority:"high",count:data.todayTasks,titleKey:"actionCenter.item.todayTasks",detailKey:"actionCenter.item.todayTasksHelp",href:"/tasks"},hasCapability(user.role,"tasks.view"));
  add({id:"pending-approvals",category:"governance",priority:"urgent",count:data.pendingApprovals,titleKey:"actionCenter.item.approvals",detailKey:"actionCenter.item.approvalsHelp",href:"/admin/approvals"},hasCapability(user.role,"admin.access"));
  add({id:"renewals",category:"sales",priority:"high",count:data.renewalsDue,titleKey:"actionCenter.item.renewals",detailKey:"actionCenter.item.renewalsHelp",href:"/contracts"},hasCapability(user.role,"contracts.view"));
  add({id:"risk-contracts",category:"sales",priority:"urgent",count:data.riskContracts,titleKey:"actionCenter.item.riskContracts",detailKey:"actionCenter.item.riskContractsHelp",href:"/contracts"},hasCapability(user.role,"contracts.view"));
  add({id:"new-leads",category:"sales",priority:"normal",count:data.newLeads,titleKey:"actionCenter.item.newLeads",detailKey:"actionCenter.item.newLeadsHelp",href:"/leads"},hasCapability(user.role,"leads.view"));
  add({id:"progression",category:"service",priority:"high",count:data.pendingProgression,titleKey:"actionCenter.item.progression",detailKey:"actionCenter.item.progressionHelp",href:"/progression"},hasCapability(user.role,"progression.manage"));
  add({id:"admissions",category:"service",priority:"high",count:data.pendingAdmissions,titleKey:"actionCenter.item.admissions",detailKey:"actionCenter.item.admissionsHelp",href:"/growth"},hasCapability(user.role,"portal.decide"));
  add({id:"notifications",category:"work",priority:"normal",count:data.unreadNotifications,titleKey:"actionCenter.item.notifications",detailKey:"actionCenter.item.notificationsHelp",href:"/messages"},hasCapability(user.role,"messages.view"));
  add({id:"privacy-requests",category:"governance",priority:"urgent",count:privacyCount,titleKey:"actionCenter.item.privacy",detailKey:"actionCenter.item.privacyHelp",href:"/privacy-requests"},canManagePrivacy);
  add({id:"operational-failures",category:"governance",priority:"urgent",count:(readiness?.failedJobs??0)+(readiness?.stuckJobs??0),titleKey:"actionCenter.item.operations",detailKey:"actionCenter.item.operationsHelp",href:"/admin/operations"},canManageOperations);
  const order={urgent:0,high:1,normal:2};items.sort((left,right)=>order[left.priority]-order[right.priority]||right.count-left.count||left.id.localeCompare(right.id));
  return{generatedAt:new Date().toISOString(),role:user.role,items,total:items.reduce((sum,item)=>sum+item.count,0),urgent:items.filter(item=>item.priority==="urgent").reduce((sum,item)=>sum+item.count,0)};
}
