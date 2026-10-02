import type { CustomerSubject, FollowUpPlan } from "./customer-operations";

const profileFields = ["organization_id", "city", "curriculum", "website", "email", "phone", "title", "preferred_language", "next_follow_up_at", "organization_overview_markdown", "notes_markdown", "education_expectations_markdown"];
const businessFields = ["id", "name_zh", "name_en", "title_zh", "title_en", "contract_number", "status", "stage", "product_id", "owner_id", "owner_name", "member_role", "next_follow_up_at", "communication_level"];
export function pickCustomerFields<T extends object>(record: T, fields: readonly string[]): T {
  return Object.fromEntries(fields.filter(key => Object.hasOwn(record, key)).map(key => [key, (record as Record<string, unknown>)[key]])) as T;
}
export function customerBusinessView<T extends object>(record: T): T { return pickCustomerFields(record, businessFields); }
export function customerProfileView(record: Record<string, unknown>) { return pickCustomerFields(record, profileFields); }
export function customerPlanView(plan: FollowUpPlan | null) {
  return plan ? pickCustomerFields(plan, ["id", "title", "target_level", "target_count", "start_date", "due_date", "updated_at"]) : null;
}
// Repeated filters are supported by the local gateway; PostgREST-style `and` is not.
export function followUpCompletionPath(subject: CustomerSubject, id: string, plan: FollowUpPlan) {
  const params = new URLSearchParams({select:"id",kind:"in.(CALL,EMAIL,MEETING,VISIT,MEAL)",subject_kind:`eq.${subject}`,subject_id:`eq.${id}`});
  params.append("occurred_at", `gte.${plan.start_date}T00:00:00Z`);
  params.append("occurred_at", `lt.${new Date(Date.parse(plan.due_date)+86400000).toISOString()}`);
  return `/db/table/customer_follow_up_history?${params}`;
}
