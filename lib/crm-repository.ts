import { supabaseRequest, supabaseJson } from "./supabase-server";
import type { DataRow, StatusTone } from "./crm-data";

export type PersistentResource = "schools" | "people" | "tasks";
export type PagedRows = { items: DataRow[]; total: number; page: number; pageSize: number };

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
function isoDate(value: unknown) { return value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(String(value))) : "—"; }

function toRow(resource: PersistentResource, record: Record<string, unknown>): DataRow {
  const status = String(record.status ?? "UNVERIFIED");
  if (resource === "schools") return {
    id: String(record.id), primary: String(record.name_zh), secondary: `${record.name_en} · ${record.city} · ${record.curriculum}`,
    owner: "—", status, statusKey: statusKeys[status], statusTone: toneByStatus[status] ?? "gray", meta: `${record.key_contact_coverage}%`, extra: isoDate(record.last_contact_at), completeness: Number(record.completeness),
  };
  if (resource === "people") return {
    id: String(record.id), primary: String(record.name_zh), secondary: `${record.name_en} · ${record.title || record.contact_type}`,
    owner: "—", status, statusKey: statusKeys[status], statusTone: toneByStatus[status] ?? "gray", meta: String(record.email ?? record.phone ?? "—"), extra: isoDate(record.last_interaction_at), completeness: Number(record.completeness),
  };
  return {
    id: String(record.id), primary: String(record.title_zh), secondary: `${record.title_en} · ${record.related_label || "—"}`,
    owner: "—", status, statusKey: statusKeys[status], statusTone: toneByStatus[status] ?? "gray", meta: String(record.priority), extra: isoDate(record.due_at), completeness: status === "DONE" ? 100 : 70,
  };
}

export async function listCrmRows(resource: PersistentResource, options: { query?: string; page?: number; pageSize?: number; status?: string; sort?: string; direction?: string } = {}): Promise<PagedRows> {
  const config = resourceConfig[resource];
  const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? 20), 100));
  const page = Math.max(1, Number(options.page ?? 1));
  const start = (page - 1) * pageSize;
  const params = new URLSearchParams({ select: "*" });
  const query = cleanSearch(options.query ?? "");
  if (query) params.set("or", `(${config.search.map((field) => `${field}.ilike.*${query}*`).join(",")})`);
  if (options.status && options.status !== "all") params.set("status", `eq.${options.status}`);
  const sortKey = options.sort && options.sort in config.sort ? options.sort as keyof typeof config.sort : "primary";
  params.set("order", `${config.sort[sortKey]}.${options.direction === "asc" ? "asc" : "desc"}`);
  const response = await supabaseRequest(`/rest/v1/${config.table}?${params}`, { headers: { Prefer: "count=exact", Range: `${start}-${start + pageSize - 1}` } });
  const records = await response.json() as Record<string, unknown>[];
  const contentRange = response.headers.get("content-range") ?? "*/0";
  return { items: records.map((record) => toRow(resource, record)), total: Number(contentRange.split("/")[1] ?? records.length), page, pageSize };
}

export async function checkCrmDuplicate(resource: PersistentResource, input: { email?: string; phone?: string; nameZh?: string; nameEn?: string }) {
  return supabaseJson<{ id: string; nameZh: string; nameEn: string; reason: string }[]>("/rest/v1/rpc/crm_duplicate_check", { method: "POST", body: JSON.stringify({ resource, candidate_email: input.email || null, candidate_phone: input.phone || null, candidate_name_zh: input.nameZh || null, candidate_name_en: input.nameEn || null }) });
}

export async function createCrmRecord(resource: PersistentResource, input: Record<string, unknown>) {
  const body = resource === "schools" ? { name_zh: input.nameZh, name_en: input.nameEn, city: input.city ?? "", curriculum: input.curriculum ?? "", status: "UNVERIFIED", completeness: 50 }
    : resource === "people" ? { name_zh: input.nameZh, name_en: input.nameEn, email: input.email || null, phone: input.phone || null, title: input.title ?? "", contact_type: "CONTACT", status: "UNVERIFIED", completeness: 50 }
      : { title_zh: input.nameZh, title_en: input.nameEn, related_label: input.contact ?? "", status: "TODO", priority: "NORMAL", due_at: input.dueAt || null };
  const table = resourceConfig[resource].table;
  const created = await supabaseJson<Record<string, unknown>[]>(`/rest/v1/${table}`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
  return toRow(resource, created[0]);
}
