import {actionSignalSummary} from "./workflow-navigation";
import { hasCapability } from "./capabilities";
import { loadDashboardSignals } from "./dashboard-repository";
import { loadReleaseReadiness } from "./operations-repository";
import { databaseRequest } from "./db/gateway";
import { exactCount, pendingApprovalCount } from "./pending-approval-count";
import type { AppUser } from "./user";

export type ActionCenterItem={id:string;category:"work"|"sales"|"service"|"governance";priority:"urgent"|"high"|"normal";count:number;titleKey:string;detailKey:string;href:string;source:"live_aggregate"};
export type ActionSource="dashboard"|"growth"|"approvals"|"privacy"|"operations";
export type ActionCenterSnapshot={unavailableSources?:ActionSource[];growthUnavailable?:boolean;generatedAt:string;role:AppUser["role"];items:ActionCenterItem[];total:number;urgent:number};

async function activePrivacyRequestCount() {
  const statuses = "RECEIVED,IDENTITY_REVIEW,IN_PROGRESS,WAITING_APPROVAL,EXECUTING,EXECUTION_FAILED";
  const response = await databaseRequest(
    `/db/table/privacy_requests?select=id&status=in.(${statuses})`,
    { headers: { Prefer: "count=exact", Range: "0-0" } },
  );
  return exactCount(response);
}

export async function loadActionCenter(user:AppUser,adapter={dashboard:loadDashboardSignals,privacy:activePrivacyRequestCount,readiness:loadReleaseReadiness,approvals:pendingApprovalCount}):Promise<ActionCenterSnapshot>{
  const canManagePrivacy = hasCapability(user.role, "privacyRequests.manage");
  const canManageOperations = hasCapability(user.role, "admin.access");
  const [dashboard, privacy, operations, approvals] = await Promise.allSettled([
    adapter.dashboard(),
    canManagePrivacy ? adapter.privacy() : Promise.resolve(0),
    canManageOperations ? adapter.readiness() : Promise.resolve(null),
    adapter.approvals(),
  ]);
  const unavailableSources:ActionSource[]=[];
  if(dashboard.status==="rejected")unavailableSources.push("dashboard");
  if(approvals.status==="rejected")unavailableSources.push("approvals");
  if(canManagePrivacy&&privacy.status==="rejected")unavailableSources.push("privacy");
  if(canManageOperations&&operations.status==="rejected")unavailableSources.push("operations");
  const data=dashboard.status==="fulfilled"?dashboard.value:null;
  if(data?.growthUnavailable&&hasCapability(user.role,"portal.decide"))unavailableSources.push("growth");
  const privacyCount=privacy.status==="fulfilled"?privacy.value:0;
  const readiness=operations.status==="fulfilled"?operations.value:null;
  const approvalCount=approvals.status==="fulfilled"?approvals.value:0;
  const items:ActionCenterItem[]=[];const add=(item:Omit<ActionCenterItem,"source">,allowed=true)=>{if(allowed&&item.count>0)items.push({...item,source:"live_aggregate"});};
  add({id:"overdue-tasks",category:"work",priority:"urgent",count:data?.overdueTasks??0,titleKey:"actionCenter.item.overdueTasks",detailKey:"actionCenter.item.overdueTasksHelp",href:"/tasks?queue=overdue"},hasCapability(user.role,"tasks.view"));
  add({id:"today-tasks",category:"work",priority:"high",count:data?.todayTasks??0,titleKey:"actionCenter.item.todayTasks",detailKey:"actionCenter.item.todayTasksHelp",href:"/tasks?queue=today"},hasCapability(user.role,"tasks.view"));
  add({id:"pending-approvals",category:"governance",priority:"urgent",count:approvalCount,titleKey:"actionCenter.item.approvals",detailKey:"actionCenter.item.approvalsHelp",href:canManageOperations?"/admin/approvals":"/approvals"});
  add({id:"renewals",category:"sales",priority:"high",count:data?.renewalsDue??0,titleKey:"actionCenter.item.renewals",detailKey:"actionCenter.item.renewalsHelp",href:"/contracts"},hasCapability(user.role,"contracts.view"));
  add({id:"risk-contracts",category:"sales",priority:"urgent",count:data?.riskContracts??0,titleKey:"actionCenter.item.riskContracts",detailKey:"actionCenter.item.riskContractsHelp",href:"/contracts"},hasCapability(user.role,"contracts.view"));
  add({id:"new-leads",category:"sales",priority:"normal",count:data?.newLeads??0,titleKey:"actionCenter.item.newLeads",detailKey:"actionCenter.item.newLeadsHelp",href:"/leads"},hasCapability(user.role,"leads.view"));
  add({id:"progression",category:"service",priority:"high",count:data?.pendingProgression??0,titleKey:"actionCenter.item.progression",detailKey:"actionCenter.item.progressionHelp",href:"/progression"},hasCapability(user.role,"progression.manage"));
  add({id:"admissions",category:"service",priority:"high",count:data?.pendingAdmissions??0,titleKey:"actionCenter.item.admissions",detailKey:"actionCenter.item.admissionsHelp",href:"/growth"},!data?.growthUnavailable&&hasCapability(user.role,"portal.decide"));
  add({id:"notifications",category:"work",priority:"normal",count:data?.unreadNotifications??0,titleKey:"actionCenter.item.notifications",detailKey:"actionCenter.item.notificationsHelp",href:"/notifications"},hasCapability(user.role,"messages.view"));
  add({id:"privacy-requests",category:"governance",priority:"urgent",count:privacyCount,titleKey:"actionCenter.item.privacy",detailKey:"actionCenter.item.privacyHelp",href:"/privacy-requests"},canManagePrivacy);
  add({id:"operational-failures",category:"governance",priority:"urgent",count:(readiness?.failedJobs??0)+(readiness?.stuckJobs??0),titleKey:"actionCenter.item.operations",detailKey:"actionCenter.item.operationsHelp",href:"/admin/operations"},canManageOperations);
  const order={urgent:0,high:1,normal:2};items.sort((left,right)=>order[left.priority]-order[right.priority]||right.count-left.count||left.id.localeCompare(right.id));
  return{unavailableSources,growthUnavailable:data?.growthUnavailable,generatedAt:new Date().toISOString(),role:user.role,items,...actionSignalSummary(items)};
}
