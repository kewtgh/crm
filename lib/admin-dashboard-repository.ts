import { supabaseJson, supabaseRequest } from "./supabase-server";

export type AdminAuditEvent={id:string;action:string;entityType:string;entityId:string|null;actorZh:string;actorEn:string;createdAt:string};
export type AdminDashboardData={staffTotal:number;activeStaff:number;mfaMissing:number;privilegedTotal:number;privilegedMfa:number;pendingApprovals:number;failedJobs:number;unreadNotifications:number;audits:AdminAuditEvent[]};
export type AdminAuditPage={items:AdminAuditEvent[];total:number;page:number;pageSize:number};

export async function listAdminAudits(options:{query?:string;page?:number;pageSize?:number}={}):Promise<AdminAuditPage>{
  const page=Math.max(1,Number(options.page??1));const pageSize=Math.max(1,Math.min(50,Number(options.pageSize??20)));const start=(page-1)*pageSize;const params=new URLSearchParams({select:"id,action,entity_type,entity_id,actor_id,created_at",order:"created_at.desc"});const query=(options.query??"").replace(/[*,()]/g," ").trim().slice(0,100);if(query)params.set("or",`(action.ilike.*${query}*,entity_type.ilike.*${query}*,entity_id.ilike.*${query}*)`);
  const response=await supabaseRequest(`/rest/v1/audit_events?${params}`,{headers:{Prefer:"count=exact",Range:`${start}-${start+pageSize-1}`}});const audits=await response.json() as Array<{id:string;action:string;entity_type:string;entity_id:string|null;actor_id:string|null;created_at:string}>;const total=Number((response.headers.get("content-range")??"*/0").split("/")[1]??audits.length);
  const actorIds=[...new Set(audits.map(item=>item.actor_id).filter(Boolean))] as string[];const names=new Map<string,{zh:string;en:string}>();if(actorIds.length){const profiles=await supabaseJson<Array<{user_id:string;display_name_zh:string;display_name_en:string}>>(`/rest/v1/user_profiles?select=user_id,display_name_zh,display_name_en&user_id=in.(${actorIds.join(",")})`);profiles.forEach(profile=>names.set(profile.user_id,{zh:profile.display_name_zh,en:profile.display_name_en}));}
  return {items:audits.map(item=>{const actor=item.actor_id?names.get(item.actor_id):undefined;return{id:item.id,action:item.action,entityType:item.entity_type,entityId:item.entity_id,actorZh:actor?.zh??"",actorEn:actor?.en??"",createdAt:item.created_at};}),total,page,pageSize};
}

export async function loadAdminDashboard():Promise<AdminDashboardData>{
  const [metrics,audits]=await Promise.all([supabaseJson<Record<string,number>>("/rest/v1/rpc/admin_dashboard_metrics",{method:"POST",body:"{}"}),listAdminAudits({page:1,pageSize:8})]);
  return {staffTotal:Number(metrics.staff_total??0),activeStaff:Number(metrics.active_staff??0),mfaMissing:Number(metrics.mfa_missing??0),privilegedTotal:Number(metrics.privileged_total??0),privilegedMfa:Number(metrics.privileged_mfa??0),pendingApprovals:Number(metrics.pending_approvals??0),failedJobs:Number(metrics.failed_jobs??0),unreadNotifications:Number(metrics.unread_notifications??0),audits:audits.items};
}
