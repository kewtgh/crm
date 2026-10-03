import { databaseJson, databaseRequest } from "./db/gateway";
import type { EnrollmentData, AttributionData, EnrollmentLookupType } from "./enrollment-input";
import {enrollmentFinanceProjection, type EnrollmentContractFinance} from "./enrollment-finance";

export type EnrollmentRecord = EnrollmentData & {
  id: string; workspace_id: string; revision: number; created_by: string | null; created_at: string; updated_at: string;
  student_name_zh: string; student_name_en: string; student_number: string | null;
  cohort_name_zh: string; cohort_name_en: string; product_name_zh: string; product_name_en: string;
  household_name_zh: string | null; household_name_en: string | null; owner_name_zh: string | null; owner_name_en: string | null; can_edit: boolean; has_primary_attribution: boolean;
  sales_owner_name_zh?: string | null; sales_owner_name_en?: string | null; opportunity_title_zh?: string | null; opportunity_title_en?: string | null;
};
export type EnrollmentHistory = {id: string; workspace_id: string; enrollment_id: string; enrollment_revision: number; from_status: EnrollmentData["status"] | null; to_status: EnrollmentData["status"]; changed_at: string; changed_by: string | null; reason: string};
export type EnrollmentAttribution = AttributionData & {
  id: string; workspace_id: string; created_by: string | null; created_at: string;
  organization_name_zh?: string | null; organization_name_en?: string | null; contact_name_zh?: string | null; contact_name_en?: string | null;
  event_name?: string | null; campaign_name_zh?: string | null; campaign_name_en?: string | null; referral_on?: string | null;
  referral_organization_name_zh?: string | null; referral_organization_name_en?: string | null; referral_household_name_zh?: string | null; referral_household_name_en?: string | null;
};
export type EnrollmentPage = {items: EnrollmentRecord[]; page: number; pageSize: number; total: number};
type Adapter = {json: typeof databaseJson; request: typeof databaseRequest};
const database: Adapter = {json: databaseJson, request: databaseRequest};
export type ChannelEnrollmentSnapshot={organization_id:string;name_zh:string;name_en:string;product_id:string;cohort_id:string;primary_enrollment_count:number;assist_enrollment_count:number;active_enrollment_count:number};
export function listChannelEnrollmentSnapshots(options:{productId?:string;cohortId?:string;page?:number},adapter=database) {
  const params=new URLSearchParams({order:"organization_id.asc,cohort_id.asc",limit:"50",offset:String(((options.page??1)-1)*50)});
  if(options.productId)params.set("product_id",`eq.${options.productId}`);
  if(options.cohortId)params.set("cohort_id",`eq.${options.cohortId}`);
  return adapter.json<ChannelEnrollmentSnapshot[]>(`/db/table/channel_enrollment_snapshots?${params}`);
}
export async function getEnrollmentFinanceProjection(id: string, adapter = database) {
  const visibility = await adapter.json<{available:boolean;partial:boolean}>("/db/rpc/enrollment_finance_visibility", {method:"POST",body:JSON.stringify({target_enrollment:id})});
  const rows: EnrollmentContractFinance[] = [];
  // Page through all related contracts; no silent truncation of financial totals.
  for (let page = 0; ; page++) {
    const items = await adapter.json<EnrollmentContractFinance[]>(`/db/table/enrollment_contract_finance?${new URLSearchParams({enrollment_id:`eq.${id}`,order:"contract_id.asc",limit:"100",offset:String(page*100)})}`);
    rows.push(...items); if (items.length < 100) break;
  }
  return enrollmentFinanceProjection(id, rows, visibility);
}
export async function listEnrollments(options: {page?: number; pageSize?: number; query?: string; studentId?: string; cohortId?: string; status?: EnrollmentData["status"]; ownerId?: string}, adapter = database): Promise<EnrollmentPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1)), pageSize = Math.max(1, Math.min(50, Math.floor(options.pageSize ?? 20)));
  const params = new URLSearchParams({order: "updated_at.desc,id.asc"});
  for (const [column, value] of [["student_id", options.studentId], ["cohort_id", options.cohortId], ["status", options.status], ["owner_id", options.ownerId]])
    if (value) params.set(column!, `eq.${value}`);
  const query = options.query?.replace(/[*,()%_]/g, " ").trim().slice(0, 80);
  if (query) params.set("or", `(student_name_zh.ilike.*${query}*,student_name_en.ilike.*${query}*,student_number.ilike.*${query}*)`);
  const response = await adapter.request(`/db/table/student_enrollment_records?${params}`, {headers: {Prefer: "count=exact", Range: `${(page - 1) * pageSize}-${page * pageSize - 1}`}});
  const items = await response.json() as EnrollmentRecord[];
  return {items, page, pageSize, total: Number(response.headers.get("content-range")?.split("/")[1] ?? items.length)};
}
export async function getEnrollment(id: string, adapter = database) {
  const rows = await adapter.json<EnrollmentRecord[]>(`/db/table/student_enrollment_records?${new URLSearchParams({id: `eq.${id}`, limit: "1"})}`);
  return rows[0] ?? null;
}
export function saveEnrollment(input: {id: string; expectedRevision: number | null; requestKey: string; statusReason: string; data: EnrollmentData}, adapter = database) {
  return adapter.json<EnrollmentData & {id: string; revision: number}>("/db/rpc/save_student_enrollment", {method: "POST", body: JSON.stringify({record_id: input.id, expected_revision: input.expectedRevision, p_request_key: input.requestKey, status_reason: input.statusReason, data: input.data})});
}
export function listEnrollmentStatusHistory(id: string, page = 1, adapter = database) {
  const params = new URLSearchParams({enrollment_id: `eq.${id}`, order: "changed_at.asc,id.asc", limit: "50", offset: String((page - 1) * 50)});
  return adapter.json<EnrollmentHistory[]>(`/db/table/student_enrollment_status_history?${params}`);
}
export function listEnrollmentAttributions(id: string, page = 1, adapter = database) {
  const params = new URLSearchParams({enrollment_id: `eq.${id}`, order: "created_at.asc,id.asc", limit: "50", offset: String((page - 1) * 50)});
  return adapter.json<EnrollmentAttribution[]>(`/db/table/enrollment_attribution_records?${params}`);
}
export function saveEnrollmentAttribution(input: {id: string; requestKey: string; data: AttributionData}, adapter = database) {
  return adapter.json<EnrollmentAttribution>("/db/rpc/save_enrollment_attribution", {method: "POST", body: JSON.stringify({record_id: input.id, p_request_key: input.requestKey, data: input.data})});
}
export async function lookupEnrollmentRelations(type: EnrollmentLookupType, query = "", adapter = database) {
  const clean = query.replace(/[*,()%_]/g, " ").trim().slice(0, 80), params = new URLSearchParams({limit: "20", order: "updated_at.desc,id.asc"});
  const table = {COHORT: "product_cohorts", EVENT: "education_outreach_events", CAMPAIGN: "growth_campaigns", REFERRAL: "enrollment_referral_options"}[type];
  if (clean && ["COHORT", "CAMPAIGN"].includes(type)) params.set("or", `(name_zh.ilike.*${clean}*,name_en.ilike.*${clean}*,code.ilike.*${clean}*)`);
  if (clean && type === "EVENT") params.set("name", `ilike.*${clean}*`);
  if (clean && type === "REFERRAL") params.set("or", `(organization_name_zh.ilike.*${clean}*,organization_name_en.ilike.*${clean}*,household_name_zh.ilike.*${clean}*,household_name_en.ilike.*${clean}*)`);
  const rows = await adapter.json<Array<Record<string, unknown>>>(`/db/table/${table}?${params}`);
  return rows.map(row => ({value: String(row.id), labelZh: type === "EVENT" ? String(row.name) : type === "REFERRAL" ? `${row.organization_name_zh || row.organization_name_en} → ${row.household_name_zh || row.household_name_en} · ${row.referred_on}` : `${row.name_zh || row.name_en} · ${row.code}`, labelEn: type === "EVENT" ? String(row.name) : type === "REFERRAL" ? `${row.organization_name_en || row.organization_name_zh} → ${row.household_name_en || row.household_name_zh} · ${row.referred_on}` : `${row.name_en || row.name_zh} · ${row.code}`}));
}
