import { availablePoolLead } from "./lead-pool-input";
import type { PoolLead } from "./lead-assignment-repository";
import type { AppRole } from "./roles";
export const leadFilterDefaults = {q:"", city:"", schoolType:"all", tier:"all", keyContact:"all", status:"all", sort:"newest", potentialMin:"", ageDays:""};
export type LeadFilters = typeof leadFilterDefaults;
export const leadAdvancedKeys = ["city","schoolType","tier","keyContact","potentialMin","ageDays","sort"] as const;
export function leadAdvancedCount(filters: LeadFilters) { return leadAdvancedKeys.filter(key => filters[key] !== leadFilterDefaults[key]).length; }
/** Reorders existing permitted actions; the server still authorizes each mutation. */
export function leadQueueActions(lead: PoolLead, scope: string, manage: boolean, manager: boolean) {
  const primary: "claim"|"convert"|"update"|null = manage && scope === "pool" && availablePoolLead(lead) ? "claim" :
    manage && lead.can_edit && lead.status === "QUALIFIED" ? "convert" :
    manage && lead.can_edit && ["NEW","QUALIFYING"].includes(lead.status) ? "update" : null;
  const more: Array<"update"|"release"|"reassign"|"visibility"|"history"|"archive"> = [];
  if (manage && lead.can_edit && lead.status !== "CONVERTED" && primary !== "update") more.push("update");
  if (manage && lead.pool_visibility === "WORKSPACE_PUBLIC" && lead.owner_id && (lead.is_mine || lead.can_assign) && !["DISQUALIFIED","CONVERTED"].includes(lead.status)) more.push("release");
  if (manager && lead.can_assign) { more.push("reassign"); if (lead.subject_type === "SCHOOL") more.push("visibility"); }
  more.push("history");
  if (manage && lead.can_edit) more.push("archive");
  return {primary, more};
}
export type DashboardMode = "daily" | "management";
export const dashboardPreferenceKey = (userId: string) => `lumina:dashboard-mode:${userId}`;
export function dashboardDefaultMode(role: AppRole, managementAllowed: boolean): DashboardMode {
  return managementAllowed && ["SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER"].includes(role) ? "management" : "daily";
}
export function readDashboardMode(storage: Pick<Storage,"getItem"> | null, userId: string, role: AppRole, managementAllowed: boolean): DashboardMode {
  try { const value = storage?.getItem(dashboardPreferenceKey(userId)); if (value === "daily" || value === "management" && managementAllowed) return value; } catch { /* Preference failure cannot block work. */ }
  return dashboardDefaultMode(role, managementAllowed);
}
export function saveDashboardMode(storage: Pick<Storage,"setItem"> | null, userId: string, mode: DashboardMode) {
  try { storage?.setItem(dashboardPreferenceKey(userId), mode); } catch { /* Preference is best effort. */ }
}
