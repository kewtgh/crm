import { databaseJson } from "./db/gateway";

export type RelatedSearchRecord = { value: string; labelZh: string; labelEn: string; type: "ORGANIZATION" | "CONTACT" | "USER" | "OPPORTUNITY" | "TASK" | "CONTRACT" | "QUOTE" | "PRODUCT" | "STUDENT" | "HOUSEHOLD" | "LEAD" };

export async function searchRelatedRecords(query: string): Promise<RelatedSearchRecord[]> {
  const clean = query.trim().replace(/[,*()]/g, "").slice(0, 80);
  if (clean.length < 2) return [];
  const pattern = encodeURIComponent(`*${clean}*`);
  const [organizations, contacts, users,opportunities,tasks,contracts,quotes,products,students,households,leads] = await Promise.all([
    databaseJson<Array<{ id:string; name_zh:string; name_en:string }>>(`/db/table/organizations?select=id,name_zh,name_en&archived_at=is.null&or=(name_zh.ilike.${pattern},name_en.ilike.${pattern})&order=updated_at.desc&limit=8`),
    databaseJson<Array<{ id:string; name_zh:string; name_en:string }>>(`/db/table/contacts?select=id,name_zh,name_en&archived_at=is.null&or=(name_zh.ilike.${pattern},name_en.ilike.${pattern})&order=updated_at.desc&limit=8`),
    databaseJson<Array<{ user_id:string; display_name_zh:string; display_name_en:string }>>("/db/rpc/list_assignable_crm_users",{
      method:"POST",body:JSON.stringify({search_query:clean}),
    }),
    databaseJson<Array<{id:string;title_zh:string;title_en:string}>>(`/db/table/opportunities?select=id,title_zh,title_en&or=(title_zh.ilike.${pattern},title_en.ilike.${pattern})&order=updated_at.desc&limit=5`),
    databaseJson<Array<{id:string;title_zh:string;title_en:string;related_label:string}>>(`/db/table/crm_tasks?select=id,title_zh,title_en,related_label&archived_at=is.null&or=(title_zh.ilike.${pattern},title_en.ilike.${pattern},related_label.ilike.${pattern})&order=updated_at.desc&limit=5`),
    databaseJson<Array<{id:string;contract_number:string}>>(`/db/table/contracts?select=id,contract_number&contract_number=ilike.${pattern}&order=updated_at.desc&limit=5`),
    databaseJson<Array<{id:string;quote_number:string}>>(`/db/table/quotes?select=id,quote_number&quote_number=ilike.${pattern}&order=updated_at.desc&limit=5`),
    databaseJson<Array<{id:string;code:string;name_zh:string;name_en:string}>>(`/db/table/products?select=id,code,name_zh,name_en&or=(code.ilike.${pattern},name_zh.ilike.${pattern},name_en.ilike.${pattern})&order=updated_at.desc&limit=5`),
    databaseJson<Array<{id:string;name_zh:string;name_en:string;student_number:string|null;current_grade:string}>>("/db/rpc/list_students_page",{
      method:"POST",body:JSON.stringify({search_query:clean,page_number:1,page_size:5,status_filter:"all"}),
    }),
    databaseJson<Array<{id:string;name_zh:string;name_en:string;address:string}>>(`/db/table/households?select=id,name_zh,name_en,address&status=neq.ARCHIVED&or=(name_zh.ilike.${pattern},name_en.ilike.${pattern})&order=updated_at.desc&limit=5`),
    databaseJson<Array<{id:string;name_zh:string;name_en:string;source:string}>>(`/db/table/leads?select=id,name_zh,name_en,source&or=(name_zh.ilike.${pattern},name_en.ilike.${pattern})&order=updated_at.desc&limit=5`),
  ]);
  return [
    ...organizations.map((item) => ({ value:`ORGANIZATION:${item.id}`,labelZh:item.name_zh,labelEn:item.name_en,type:"ORGANIZATION" as const })),
    ...contacts.map((item) => ({ value:`CONTACT:${item.id}`,labelZh:`${item.name_zh} / ${item.name_en}`,labelEn:`${item.name_zh} / ${item.name_en}`,type:"CONTACT" as const })),
    ...users.map((item) => ({ value:`USER:${item.user_id}`,labelZh:item.display_name_zh,labelEn:item.display_name_en,type:"USER" as const })),
    ...opportunities.map(item=>({value:`OPPORTUNITY:${item.id}`,labelZh:item.title_zh,labelEn:item.title_en,type:"OPPORTUNITY" as const})),
    ...tasks.map(item=>({value:`TASK:${item.id}`,labelZh:item.title_zh,labelEn:item.title_en,type:"TASK" as const})),
    ...contracts.map(item=>({value:`CONTRACT:${item.id}`,labelZh:item.contract_number,labelEn:item.contract_number,type:"CONTRACT" as const})),
    ...quotes.map(item=>({value:`QUOTE:${item.id}`,labelZh:item.quote_number,labelEn:item.quote_number,type:"QUOTE" as const})),
    ...products.map(item=>({value:`PRODUCT:${item.id}`,labelZh:`${item.name_zh} · ${item.code}`,labelEn:`${item.name_en} · ${item.code}`,type:"PRODUCT" as const})),
    ...students.map(item=>({value:`STUDENT:${item.id}`,labelZh:`${item.name_zh} · ${item.current_grade}`,labelEn:`${item.name_en} · ${item.current_grade}`,type:"STUDENT" as const})),
    ...households.map(item=>({value:`HOUSEHOLD:${item.id}`,labelZh:item.name_zh,labelEn:item.name_en,type:"HOUSEHOLD" as const})),
    ...leads.map(item=>({value:`LEAD:${item.id}`,labelZh:item.name_zh,labelEn:item.name_en,type:"LEAD" as const})),
  ];
}
