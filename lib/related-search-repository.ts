import { supabaseJson } from "./supabase-server";

export type RelatedSearchRecord = { value: string; labelZh: string; labelEn: string; type: "ORGANIZATION" | "CONTACT" | "USER" };

export async function searchRelatedRecords(query: string): Promise<RelatedSearchRecord[]> {
  const clean = query.trim().replace(/[,*()]/g, "").slice(0, 80);
  const pattern = encodeURIComponent(`*${clean}*`);
  const [organizations, contacts, users] = await Promise.all([
    supabaseJson<Array<{ id:string; name_zh:string; name_en:string }>>(`/rest/v1/organizations?select=id,name_zh,name_en&or=(name_zh.ilike.${pattern},name_en.ilike.${pattern})&order=updated_at.desc&limit=8`),
    supabaseJson<Array<{ id:string; name_zh:string; name_en:string }>>(`/rest/v1/contacts?select=id,name_zh,name_en&or=(name_zh.ilike.${pattern},name_en.ilike.${pattern})&order=updated_at.desc&limit=8`),
    supabaseJson<Array<{ user_id:string; display_name_zh:string; display_name_en:string }>>(`/rest/v1/user_profiles?select=user_id,display_name_zh,display_name_en&or=(display_name_zh.ilike.${pattern},display_name_en.ilike.${pattern})&order=updated_at.desc&limit=8`),
  ]);
  return [
    ...organizations.map((item) => ({ value:`ORGANIZATION:${item.id}`,labelZh:item.name_zh,labelEn:item.name_en,type:"ORGANIZATION" as const })),
    ...contacts.map((item) => ({ value:`CONTACT:${item.id}`,labelZh:`${item.name_zh} / ${item.name_en}`,labelEn:`${item.name_zh} / ${item.name_en}`,type:"CONTACT" as const })),
    ...users.map((item) => ({ value:`USER:${item.user_id}`,labelZh:item.display_name_zh,labelEn:item.display_name_en,type:"USER" as const })),
  ];
}
