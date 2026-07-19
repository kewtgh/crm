import { supabaseRequest, supabaseJson } from "./supabase-server";
import type { DataRow, StatusTone } from "./crm-data";

export type PersistentResource = "schools" | "people" | "tasks";
export type CrmMetrics = { total: number; needsAttention: number; averageCompleteness: number };
export type PagedRows = { items: DataRow[]; total: number; page: number; pageSize: number; metrics: CrmMetrics };
export type CrmHistoryEntry = { action: string; changedAt: string; actorId: string | null; actorName: string };
export type CrmRecordDetail = {
  id: string;
  resource: PersistentResource;
  nameZh: string;
  nameEn: string;
  status: string;
  ownerId: string | null;
  ownerName: string;
  updatedAt: string;
  archived: boolean;
  city?: string;
  curriculum?: string;
  email?: string;
  phone?: string;
  title?: string;
  organizationId?: string | null;
  priority?: string;
  dueAt?: string | null;
  slaDueAt?: string | null;
  relatedType?: string;
  relatedId?: string | null;
  relatedLabel?: string;
  history: CrmHistoryEntry[];
};

const resourceConfig = {
  schools: { table: "organizations", search: ["name_zh", "name_en", "city", "curriculum"], sort: { primary: "name_zh", secondary: "city", status: "status", meta: "key_contact_coverage", extra: "last_contact_at", completeness: "completeness" } },
  people: { table: "contacts", search: ["name_zh", "name_en", "email", "phone", "title"], sort: { primary: "name_zh", secondary: "title", status: "status", meta: "email", extra: "last_interaction_at", completeness: "completeness" } },
  tasks: { table: "crm_tasks", search: ["title_zh", "title_en", "related_label"], sort: { primary: "title_zh", secondary: "related_label", status: "status", meta: "owner_id", extra: "due_at", completeness: "updated_at" } },
} as const;

const toneByStatus: Record<string, StatusTone> = {
  HEALTHY: "green", ACTIVE: "green", VERIFIED: "blue", DONE: "green",
  ATTENTION: "amber", FOLLOW_UP: "amber", TODO: "amber", WAITING_APPROVAL: "amber",
  DEVELOPING: "blue", IN_PROGRESS: "blue", PROTECTED: "purple",
  RISK: "red", OVERDUE: "red", UNVERIFIED: "gray",
};

const statusKeys: Record<string, string> = {
  HEALTHY: "records.status.healthy", ATTENTION: "records.status.attention", DEVELOPING: "records.status.developing", RISK: "records.status.risk", UNVERIFIED: "records.status.unverified",
  ACTIVE: "records.status.active", FOLLOW_UP: "records.status.followUp", VERIFIED: "records.status.verified", PROTECTED: "records.status.protected",
  TODO: "records.status.todo", IN_PROGRESS: "records.status.inProgress", WAITING_APPROVAL: "records.status.waitingApproval", DONE: "records.status.done", OVERDUE: "records.status.overdue",
};

function cleanSearch(value: string) { return value.replace(/[*,()]/g, " ").trim().slice(0, 100); }
function isoDate(value: unknown) { return value ? String(value) : "—"; }

function toRow(resource: PersistentResource, record: Record<string, unknown>,owner="—"): DataRow {
  const status = String(record.status ?? "UNVERIFIED");
  if (resource === "schools") return {
    id: String(record.id),href:`/schools/${record.id}`, primary: String(record.name_zh),primaryEn:String(record.name_en), secondary: `${record.city} · ${record.curriculum}`,secondaryEn:`${record.city} · ${record.curriculum}`,
    owner, status, statusKey: statusKeys[status], statusTone: toneByStatus[status] ?? "gray", meta: `${record.key_contact_coverage}%`, extra: isoDate(record.last_contact_at), completeness: Number(record.completeness),
  };
  if (resource === "people") return {
    id: String(record.id),href:`/people/${record.id}`, primary: String(record.name_zh),primaryEn:String(record.name_en),bilingualName:true, secondary: String(record.title || record.contact_type),
    owner, status, statusKey: statusKeys[status], statusTone: toneByStatus[status] ?? "gray", meta: String(record.email ?? record.phone ?? "—"), extra: isoDate(record.last_interaction_at), completeness: Number(record.completeness),
  };
  return {
    id: String(record.id),href:`/tasks/${record.id}`, primary: String(record.title_zh),primaryEn:String(record.title_en), secondary: String(record.related_label || "—"),
    owner, status, statusKey: statusKeys[status], statusTone: toneByStatus[status] ?? "gray", meta: String(record.priority), extra: isoDate(record.due_at), completeness: status === "DONE" ? 100 : 70,
  };
}

export async function listCrmRows(resource: PersistentResource, options: { query?: string; page?: number; pageSize?: number; status?: string; sort?: string; direction?: string } = {}): Promise<PagedRows> {
  const config = resourceConfig[resource];
  const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? 20), 100));
  const page = Math.max(1, Number(options.page ?? 1));
  const start = (page - 1) * pageSize;
  const params = new URLSearchParams({ select: "*" });
  params.set("archived_at", "is.null");
  const query = cleanSearch(options.query ?? "");
  if (query) params.set("or", `(${config.search.map((field) => `${field}.ilike.*${query}*`).join(",")})`);
  if (options.status && options.status !== "all") params.set("status", `eq.${options.status}`);
  const sortKey = options.sort && options.sort in config.sort ? options.sort as keyof typeof config.sort : "primary";
  params.set("order", `${config.sort[sortKey]}.${options.direction === "desc" ? "desc" : "asc"}`);
  const [response,metrics] = await Promise.all([
    supabaseRequest(`/rest/v1/${config.table}?${params}`, { headers: { Prefer: "count=exact", Range: `${start}-${start + pageSize - 1}` } }),
    supabaseJson<CrmMetrics>("/rest/v1/rpc/crm_resource_metrics", { method:"POST",body:JSON.stringify({resource_key:resource,search_query:query,status_filter:options.status??"all"}) }),
  ]);
  const records = await response.json() as Record<string, unknown>[];
  const contentRange = response.headers.get("content-range") ?? "*/0";
  const ownerIds=[...new Set(records.map(record=>record.owner_id).filter(Boolean).map(String))];const owners=new Map<string,string>();if(ownerIds.length){const profiles=await supabaseJson<Array<{user_id:string;display_name_zh:string;display_name_en:string}>>(`/rest/v1/user_profiles?select=user_id,display_name_zh,display_name_en&user_id=in.(${ownerIds.join(",")})`);profiles.forEach(profile=>owners.set(profile.user_id,`${profile.display_name_zh} / ${profile.display_name_en}`));}
  return { items: records.map((record) => toRow(resource, record,record.owner_id?owners.get(String(record.owner_id))??"—":"—")), total: Number(contentRange.split("/")[1] ?? records.length), page, pageSize,metrics };
}

export async function checkCrmDuplicate(resource: PersistentResource, input: { email?: string; phone?: string; nameZh?: string; nameEn?: string }) {
  return supabaseJson<{ id: string; nameZh: string; nameEn: string; reason: string }[]>("/rest/v1/rpc/crm_duplicate_check", { method: "POST", body: JSON.stringify({ resource, candidate_email: input.email || null, candidate_phone: input.phone || null, candidate_name_zh: input.nameZh || null, candidate_name_en: input.nameEn || null }) });
}

export async function createCrmRecord(resource: PersistentResource, input: Record<string, unknown>,ownerId:string) {
  if(resource==="people"&&input.organizationId){
    const organizations=await supabaseJson<Array<{id:string}>>(`/rest/v1/organizations?select=id&id=eq.${input.organizationId}&limit=1`);
    if(!organizations.length)throw new Error("RELATED_ORGANIZATION_NOT_FOUND");
  }
  if(resource==="tasks"&&input.relatedId){
    const table=input.relatedType==="CONTACT"?"contacts":"organizations";
    const related=await supabaseJson<Array<{id:string}>>(`/rest/v1/${table}?select=id&id=eq.${input.relatedId}&limit=1`);
    if(!related.length)throw new Error("RELATED_RECORD_NOT_FOUND");
  }
  const requestedOwner=String(input.ownerId??ownerId);
  if(resource==="tasks"){
    const created=await supabaseJson<Record<string,unknown>>("/rest/v1/rpc/create_crm_task",{
      method:"POST",
      body:JSON.stringify({
        task_title_zh:input.nameZh,
        task_title_en:input.nameEn,
        relation_type:input.relatedType,
        relation_id:input.relatedId,
        relation_label:input.contact,
        task_priority:input.priority,
        task_due_at:input.dueAt,
        task_owner:requestedOwner,
      }),
    });
    return toRow(resource,created);
  }
  const body = resource === "schools" ? { name_zh: input.nameZh, name_en: input.nameEn, city: input.city, curriculum: input.curriculum, status: "UNVERIFIED", completeness: 90,owner_id:requestedOwner }
    : resource === "people" ? { organization_id:input.organizationId||null,name_zh: input.nameZh, name_en: input.nameEn, email: input.email || null, phone: input.phone || null, title: input.title, contact_type: "CONTACT", status: "UNVERIFIED", completeness: 90,owner_id:requestedOwner }
      : { title_zh: input.nameZh, title_en: input.nameEn, related_type:input.relatedType,related_id:input.relatedId||null,related_label:input.contact ?? "", status: "TODO", priority: input.priority, due_at: input.dueAt,owner_id:requestedOwner };
  const table = resourceConfig[resource].table;
  const created = await supabaseJson<Record<string, unknown>[]>(`/rest/v1/${table}`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
  return toRow(resource, created[0]);
}

function tableFor(resource:PersistentResource){return resourceConfig[resource].table;}
function entityName(resource:PersistentResource){return resource==="schools"?"ORGANIZATION":resource==="people"?"CONTACT":"TASK";}

export async function loadCrmRecord(resource:PersistentResource,id:string):Promise<CrmRecordDetail>{
  const table=tableFor(resource);
  const rows=await supabaseJson<Record<string,unknown>[]>(`/rest/v1/${table}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  const record=rows[0];
  if(!record)throw new Error("CRM_RECORD_NOT_FOUND");
  const [profiles,history]=await Promise.all([
    record.owner_id?supabaseJson<Array<{user_id:string;display_name_zh:string;display_name_en:string}>>(`/rest/v1/user_profiles?select=user_id,display_name_zh,display_name_en&user_id=eq.${record.owner_id}&limit=1`):Promise.resolve([]),
    supabaseJson<Array<{action:string;changed_at:string;actor_id:string|null;actor_name:string}>>("/rest/v1/rpc/crm_record_history",{
      method:"POST",body:JSON.stringify({resource_key:resource,target_id:id,page_size:30}),
    }),
  ]);
  const profile=profiles[0];
  const common={
    id:String(record.id),resource,
    nameZh:String(resource==="tasks"?record.title_zh:record.name_zh),
    nameEn:String(resource==="tasks"?record.title_en:record.name_en),
    status:String(record.status),
    ownerId:record.owner_id?String(record.owner_id):null,
    ownerName:profile?`${profile.display_name_zh} / ${profile.display_name_en}`:"—",
    updatedAt:String(record.updated_at),
    archived:Boolean(record.archived_at),
    history:history.map(item=>({action:item.action,changedAt:item.changed_at,actorId:item.actor_id,actorName:item.actor_name})),
  };
  if(resource==="schools")return{...common,city:String(record.city??""),curriculum:String(record.curriculum??"")};
  if(resource==="people")return{...common,email:String(record.email??""),phone:String(record.phone??""),title:String(record.title??""),organizationId:record.organization_id?String(record.organization_id):null};
  return{...common,priority:String(record.priority),dueAt:record.due_at?String(record.due_at):null,slaDueAt:record.sla_due_at?String(record.sla_due_at):null,relatedType:String(record.related_type??""),relatedId:record.related_id?String(record.related_id):null,relatedLabel:String(record.related_label??"")};
}

export async function updateCrmRecord(resource:PersistentResource,id:string,expectedUpdatedAt:string,patch:Record<string,unknown>){
  return supabaseJson<Record<string,unknown>>("/rest/v1/rpc/save_crm_record",{
    method:"POST",
    body:JSON.stringify({resource_key:resource,target_id:id,expected_updated_at:expectedUpdatedAt,patch}),
  });
}

export async function archiveCrmRecord(resource:PersistentResource,id:string,expectedUpdatedAt:string){
  return updateCrmRecord(resource,id,expectedUpdatedAt,{archived:true});
}

export function crmEntityType(resource:PersistentResource){return entityName(resource);}
