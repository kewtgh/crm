import { databaseJson } from "./db/gateway";
import { cohortDatabaseData, type CohortData } from "./cohort-input";

export type ProductCohort = CohortData & {
  id: string; workspaceId: string; revision: number; createdBy: string | null; createdAt: string; updatedAt: string;
};
type Row = Record<string, unknown>;
export type CohortEnrollmentSnapshot={cohort_id:string;target_enrollment:number|null;capacity:number|null;total_records:number;current_open:number;lead:number;interested:number;registering:number;active:number;completed:number;withdrawn:number;cancelled:number};
export async function getCohortEnrollmentSnapshot(id:string,json=databaseJson) {
  const rows=await json<CohortEnrollmentSnapshot[]>(`/db/table/cohort_enrollment_snapshots?${new URLSearchParams({cohort_id:`eq.${id}`,limit:"1"})}`);
  return rows[0]??null;
}
const nullableString = (value: unknown) => value == null ? null : String(value);
function cohortRecord(row: Row): ProductCohort {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), productId: String(row.product_id),
    code: String(row.code), nameZh: String(row.name_zh), nameEn: String(row.name_en),
    intakeType: row.intake_type as CohortData["intakeType"], academicYear: String(row.academic_year),
    applicationOpenOn: nullableString(row.application_open_on), applicationDeadline: nullableString(row.application_deadline),
    startOn: nullableString(row.start_on), endOn: nullableString(row.end_on),
    targetEnrollment: row.target_enrollment == null ? null : Number(row.target_enrollment),
    capacity: row.capacity == null ? null : Number(row.capacity), status: row.status as CohortData["status"],
    defaultCurrency: String(row.default_currency), ownerId: nullableString(row.owner_id), revision: Number(row.revision),
    createdBy: nullableString(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
export async function listProductCohorts(productId: string, options: {status?: CohortData["status"]; page?: number;query?:string;usage?:"OPPORTUNITY"|"EVENT"|"QUOTE"} = {}, json = databaseJson) {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const params = new URLSearchParams({ product_id: `eq.${productId}`, order: "start_on.asc,id.asc", limit: "50", offset: String((page - 1) * 50) });
  if (options.status) params.set("status", `eq.${options.status}`);
  else if(options.usage==="OPPORTUNITY")params.set("status","in.(DRAFT,RECRUITING,CLOSED,ACTIVE)");
  else if(options.usage==="QUOTE")params.set("status","in.(RECRUITING,ACTIVE)");
  const query=options.query?.replace(/[*,()%_]/g," ").trim().slice(0,80);
  if(query)params.set("or",`(name_zh.ilike.*${query}*,name_en.ilike.*${query}*,code.ilike.*${query}*)`);
  return (await json<Row[]>(`/db/table/product_cohorts?${params}`)).map(cohortRecord);
}
export async function getProductCohort(id: string, json = databaseJson) {
  const params = new URLSearchParams({ id: `eq.${id}`, limit: "1" });
  const rows = await json<Row[]>(`/db/table/product_cohorts?${params}`);
  return rows[0] ? cohortRecord(rows[0]) : null;
}
export async function saveProductCohort(input: {id: string; expectedRevision: number | null; requestKey: string; data: CohortData}, json = databaseJson) {
  const row = await json<Row>("/db/rpc/save_product_cohort", {method: "POST", body: JSON.stringify({
    record_id: input.id, expected_revision: input.expectedRevision, data: cohortDatabaseData(input.data), p_request_key: input.requestKey,
  })});
  return cohortRecord(row);
}
