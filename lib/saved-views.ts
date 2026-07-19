import { supabaseJson } from "./supabase-server";
import { viewConfigSchema, type ViewConfig } from "./saved-view-schema";

export { viewConfigSchema } from "./saved-view-schema";

type SharedViewRow={
  id:string;name:string;visibility:"PERSONAL"|"TEAM";config:unknown;owner_id:string;
};

export async function listSharedViews(resource:string,currentUserId:string){
  const rows=await supabaseJson<SharedViewRow[]>(`/rest/v1/shared_views?select=id,name,visibility,config,owner_id&resource_key=eq.${encodeURIComponent(resource)}&order=updated_at.desc`);
  return rows.flatMap(row=>{
    const parsed=viewConfigSchema.safeParse(row.config);
    return parsed.success?[{...parsed.data,id:row.id,name:row.name,visibility:row.visibility,source:"SERVER" as const,owned:row.owner_id===currentUserId}]:[];
  });
}

export async function saveSharedView(resource:string,name:string,visibility:"PERSONAL"|"TEAM",config:ViewConfig){
  return supabaseJson("/rest/v1/rpc/save_shared_view",{method:"POST",body:JSON.stringify({p_resource_key:resource,p_view_name:name,p_view_visibility:visibility,p_view_config:config})});
}

export async function deleteSharedView(id:string){
  return supabaseJson("/rest/v1/rpc/delete_shared_view",{method:"POST",body:JSON.stringify({target_view:id})});
}
