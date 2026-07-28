import { SupabaseRequestError, supabaseAdminJson, supabaseAdminRequest } from "./supabase-server";
import type { AppRole } from "./roles";
import { compensatedScimVersion } from "./scim-compensation.mjs";

export const scimUserSchema = "urn:ietf:params:scim:schemas:core:2.0:User";
export const scimEnterpriseSchema = "urn:lumina:params:scim:schemas:extension:2.0:User";
export const scimErrorSchema = "urn:ietf:params:scim:api:messages:2.0:Error";

export type ScimDirectoryUser = {
  id:string; workspace_id:string; auth_user_id:string|null; external_id:string; user_name:string;
  display_name_zh:string; display_name_en:string; role:Exclude<AppRole,"SUPER_ADMIN"|"ADMIN">;
  team:string; active:boolean; version:number; created_at:string; updated_at:string;
};

export type ScimUserInput = {
  externalId:string; userName:string; displayNameZh:string; displayNameEn:string;
  role:ScimDirectoryUser["role"]; team:string; active:boolean;
};

function enabled(value:string|undefined){return /^(1|true|yes|on)$/i.test(value?.trim()??"");}
function workspaceId(){const value=process.env.CRM_WORKSPACE_ID?.trim();if(!value||!/^[0-9a-f-]{36}$/i.test(value))throw new SupabaseRequestError(503,"WORKSPACE_NOT_CONFIGURED","Workspace is not configured");return value;}

async function digest(value:string){return new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));}
export async function authorizeScim(request:Request){
  const expected=process.env.SCIM_BEARER_TOKEN?.trim();
  if(!enabled(process.env.SCIM_ENABLED)||!expected||expected.length<32)return false;
  const presented=request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]??"";
  const [left,right]=await Promise.all([digest(expected),digest(presented)]);
  let difference=0;for(let index=0;index<left.length;index+=1)difference|=left[index]^right[index];
  return difference===0;
}

export function toScimUser(row:ScimDirectoryUser,baseUrl:string){
  return {schemas:[scimUserSchema,scimEnterpriseSchema],id:row.id,externalId:row.external_id,userName:row.user_name,displayName:row.display_name_en,name:{formatted:row.display_name_en},active:row.active,[scimEnterpriseSchema]:{displayNameZh:row.display_name_zh,displayNameEn:row.display_name_en,role:row.role,team:row.team},meta:{resourceType:"User",created:row.created_at,lastModified:row.updated_at,version:`W/\"${row.version}\"`,location:`${baseUrl}/api/scim/v2/Users/${row.id}`}};
}

export async function listScimDirectoryUsers(filter:string|undefined,startIndex:number,count:number){
  const offset=Math.max(0,startIndex-1);const params=new URLSearchParams({select:"*",workspace_id:`eq.${workspaceId()}`,order:"created_at.asc"});
  const match=filter?.match(/^userName\s+eq\s+"([^"]+)"$/i);if(filter&&!match)throw new SupabaseRequestError(400,"SCIM_FILTER_UNSUPPORTED","Only userName eq filters are supported");if(match)params.set("user_name",`eq.${match[1].toLowerCase()}`);
  const response=await supabaseAdminRequest(`/rest/v1/enterprise_directory_users?${params}`,{headers:{Prefer:"count=exact",Range:`${offset}-${offset+count-1}`}});const rows=await response.json() as ScimDirectoryUser[];const total=Number((response.headers.get("content-range")??"*/0").split("/")[1]??rows.length);return{rows,total};
}

export async function getScimDirectoryUser(id:string){const rows=await supabaseAdminJson<ScimDirectoryUser[]>(`/rest/v1/enterprise_directory_users?select=*&workspace_id=eq.${workspaceId()}&id=eq.${id}&limit=1`);if(!rows[0])throw new SupabaseRequestError(404,"SCIM_USER_NOT_FOUND","SCIM user was not found");return rows[0];}

export async function createScimDirectoryUser(input:ScimUserInput){
  const rows=await supabaseAdminJson<ScimDirectoryUser[]>("/rest/v1/enterprise_directory_users",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({workspace_id:workspaceId(),external_id:input.externalId,user_name:input.userName.toLowerCase(),display_name_zh:input.displayNameZh,display_name_en:input.displayNameEn,role:input.role,team:input.team,active:input.active})});
  await recordScimAudit(rows[0],"SCIM_USER_STAGED");return rows[0];
}

async function applyBoundIdentity(row:ScimDirectoryUser){
  if(!row.auth_user_id)return;
  const status=row.active?"ACTIVE":"SUSPENDED";
  await supabaseAdminRequest(`/rest/v1/workspace_memberships?workspace_id=eq.${row.workspace_id}&user_id=eq.${row.auth_user_id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({role:row.role,status})});
  await supabaseAdminRequest(`/rest/v1/user_profiles?user_id=eq.${row.auth_user_id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({display_name_zh:row.display_name_zh,display_name_en:row.display_name_en,updated_at:new Date().toISOString()})});
  const members=await supabaseAdminJson<Array<{id:string}>>(`/rest/v1/sales_team_members?select=id&workspace_id=eq.${row.workspace_id}&auth_user_id=eq.${row.auth_user_id}&limit=1`);const memberBody={name_zh:row.display_name_zh,name_en:row.display_name_en,role:row.role,team:row.team,active:row.active};
  if(members[0])await supabaseAdminRequest(`/rest/v1/sales_team_members?id=eq.${members[0].id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(memberBody)});else await supabaseAdminRequest("/rest/v1/sales_team_members",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:row.workspace_id,auth_user_id:row.auth_user_id,...memberBody})});
  await supabaseAdminRequest(`/auth/v1/admin/users/${row.auth_user_id}`,{method:"PUT",body:JSON.stringify({app_metadata:{role:row.role,account_status:status,workspace_id:row.workspace_id},user_metadata:{chinese_name:row.display_name_zh,english_name:row.display_name_en},ban_duration:row.active?"none":"876000h"})});
}

export async function updateScimDirectoryUser(id:string,changes:Partial<ScimUserInput>){
  const current=await getScimDirectoryUser(id);
  const workspace=workspaceId();
  const writtenVersion=current.version+1;
  const next={
    external_id:changes.externalId??current.external_id,
    user_name:(changes.userName??current.user_name).toLowerCase(),
    display_name_zh:changes.displayNameZh??current.display_name_zh,
    display_name_en:changes.displayNameEn??current.display_name_en,
    role:changes.role??current.role,
    team:changes.team??current.team,
    active:changes.active??current.active,
    version:writtenVersion,
    updated_at:new Date().toISOString(),
    deprovisioned_at:(changes.active??current.active)?null:new Date().toISOString(),
  };
  const rows=await supabaseAdminJson<ScimDirectoryUser[]>(
    `/rest/v1/enterprise_directory_users?id=eq.${id}&workspace_id=eq.${workspace}&version=eq.${current.version}`,
    {method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(next)},
  );
  if(!rows[0])throw new SupabaseRequestError(409,"SCIM_VERSION_CONFLICT","SCIM user changed concurrently");
  try{
    await applyBoundIdentity(rows[0]);
  }catch(error){
    const restore={
      external_id:current.external_id,
      user_name:current.user_name,
      display_name_zh:current.display_name_zh,
      display_name_en:current.display_name_en,
      role:current.role,
      team:current.team,
      active:current.active,
      // Preserve monotonic versions after compensation. Reusing the previous
      // version would create an ABA window for writers that read N earlier.
      version:compensatedScimVersion(writtenVersion),
      updated_at:current.updated_at,
      deprovisioned_at:current.active?null:current.updated_at,
    };
    let restored:ScimDirectoryUser[];
    try{
      restored=await supabaseAdminJson<ScimDirectoryUser[]>(
        `/rest/v1/enterprise_directory_users?id=eq.${id}&workspace_id=eq.${workspace}&version=eq.${writtenVersion}`,
        {method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(restore)},
      );
    }catch{
      throw new SupabaseRequestError(502,"IDENTITY_COMPENSATION_REQUIRED","SCIM directory compensation requires repair");
    }
    if(!restored[0]){
      throw new SupabaseRequestError(502,"IDENTITY_COMPENSATION_REQUIRED","A newer SCIM version prevented unsafe compensation");
    }
    await recordScimAudit(restored[0],"SCIM_USER_COMPENSATED").catch(()=>undefined);
    if(current.auth_user_id){
      try{await applyBoundIdentity(current);}
      catch{throw new SupabaseRequestError(502,"IDENTITY_COMPENSATION_REQUIRED","SCIM identity compensation requires repair");}
    }
    throw error;
  }
  await recordScimAudit(rows[0],rows[0].active?"SCIM_USER_UPDATED":"SCIM_USER_DEPROVISIONED");
  return rows[0];
}

async function recordScimAudit(row:ScimDirectoryUser|undefined,action:string){if(!row)return;await supabaseAdminRequest("/rest/v1/audit_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:row.workspace_id,actor_id:null,entity_type:"enterprise_directory_user",entity_id:row.id,action,after_data:{externalId:row.external_id,role:row.role,active:row.active,version:row.version}})});}

export async function claimScimSsoIdentity(payload:Record<string,unknown>){
  if(!enabled(process.env.SCIM_ENABLED))return null;const email=String(payload.email??"").trim().toLowerCase();const userId=String(payload.id??"");if(!email||!userId)return null;
  const rows=await supabaseAdminJson<ScimDirectoryUser[]>(`/rest/v1/enterprise_directory_users?select=*&workspace_id=eq.${workspaceId()}&user_name=eq.${encodeURIComponent(email)}&active=eq.true&limit=1`);const row=rows[0];if(!row||(row.auth_user_id&&row.auth_user_id!==userId))return null;
  if(!row.auth_user_id){const bound=await supabaseAdminJson<ScimDirectoryUser[]>(`/rest/v1/enterprise_directory_users?id=eq.${row.id}&auth_user_id=is.null`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({auth_user_id:userId,version:row.version+1,updated_at:new Date().toISOString()})});if(!bound[0])return null;Object.assign(row,bound[0]);}
  await supabaseAdminRequest("/rest/v1/workspace_memberships",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({workspace_id:row.workspace_id,user_id:userId,role:row.role,status:"ACTIVE",must_change_password:false})});
  await supabaseAdminRequest(`/rest/v1/user_profiles?user_id=eq.${userId}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({display_name_zh:row.display_name_zh,display_name_en:row.display_name_en,updated_at:new Date().toISOString()})});
  row.auth_user_id=userId;await applyBoundIdentity(row);await recordScimAudit(row,"SCIM_IDENTITY_CLAIMED");return row;
}
