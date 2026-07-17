import { supabaseJson, supabaseRequest } from "./supabase-server";

export type NotificationRecord={id:string;kind:string;titleKey:string;bodyKey:string;values:Record<string,string|number>;sourceType:string|null;sourceId:string|null;createdAt:string};
type Row={id:string;kind:string;title_key:string;body_key:string;values:Record<string,string|number>;source_type:string|null;source_id:string|null;created_at:string};

export async function listNotifications(page=1,pageSize=10){
  const response=await supabaseRequest("/rest/v1/user_notifications?select=id,kind,title_key,body_key,values,source_type,source_id,created_at&read_at=is.null&order=created_at.desc",{headers:{Prefer:"count=exact",Range:`${(Math.max(1,page)-1)*pageSize}-${Math.max(1,page)*pageSize-1}`}});
  const rows=await response.json() as Row[];const total=Number(response.headers.get("content-range")?.split("/")[1]??rows.length);
  return {total,items:rows.map((row):NotificationRecord=>({id:row.id,kind:row.kind,titleKey:row.title_key,bodyKey:row.body_key,values:row.values??{},sourceType:row.source_type,sourceId:row.source_id,createdAt:row.created_at}))};
}
export async function markNotificationsRead(ids?:string[]){
  const filter=ids?.length?`id=in.(${ids.join(",")})`:"read_at=is.null";
  await supabaseJson(`/rest/v1/user_notifications?${filter}`,{method:"PATCH",body:JSON.stringify({read_at:new Date().toISOString()}),headers:{Prefer:"return=minimal"}});
}
