import { supabaseJson, supabaseRequest } from "./supabase-server";

type PageOptions = { page?: number; pageSize?: number; query?: string; status?: string };
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };

function pageValues(options: PageOptions) {
  return {
    page: Math.max(1, options.page ?? 1),
    pageSize: Math.min(50, Math.max(1, options.pageSize ?? 20)),
  };
}

async function exactPage<T>(path: string, options: PageOptions) {
  const { page, pageSize } = pageValues(options);
  const response = await supabaseRequest(path, {
    headers: { Prefer: "count=exact", Range: `${(page - 1) * pageSize}-${page * pageSize - 1}` },
  });
  const items = await response.json() as T[];
  const total = Number((response.headers.get("content-range") ?? `*/${items.length}`).split("/")[1] ?? items.length);
  return { items, total, page, pageSize };
}

export type HouseholdRecord = {
  id: string; nameZh: string; nameEn: string; status: string; address: string;
  memberCount: number; updatedAt: string;
};
type HouseholdRow = {
  id: string; name_zh: string; name_en: string; status: string; address: string;
  updated_at: string; household_members?: Array<{ count: number }>;
};

export async function listHouseholds(options: PageOptions = {}): Promise<PageResult<HouseholdRecord>> {
  const params = new URLSearchParams({
    select: "id,name_zh,name_en,status,address,updated_at,household_members:household_members!household_members_household_id_fkey(count)",
    order: "updated_at.desc",
  });
  const query = options.query?.replace(/[*,()]/g, " ").trim();
  if (query) params.set("or", `(name_zh.ilike.*${query}*,name_en.ilike.*${query}*)`);
  if (options.status && options.status !== "all") params.set("status", `eq.${options.status}`);
  const result = await exactPage<HouseholdRow>(`/rest/v1/households?${params}`, options);
  return {
    ...result,
    items: result.items.map((row) => ({
      id: row.id, nameZh: row.name_zh, nameEn: row.name_en, status: row.status,
      address: row.address, memberCount: Number(row.household_members?.[0]?.count ?? 0), updatedAt: row.updated_at,
    })),
  };
}

export async function createHousehold(input: { nameZh: string; nameEn: string; address: string }) {
  const rows = await supabaseJson<HouseholdRow[]>("/rest/v1/households", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name_zh: input.nameZh, name_en: input.nameEn, address: input.address }),
  });
  return rows[0];
}

export type StudentRecord = {
  id: string; personId: string; nameZh: string; nameEn: string; householdZh: string;
  householdEn: string; studentNumber: string; grade: string; academicYear: string; status: string; updatedAt: string;
};
type StudentRow = {
  id: string; person_id: string; current_grade: string; academic_year: string; status: string; updated_at: string;
  contacts: { name_zh: string; name_en: string } | null;
  households: { name_zh: string; name_en: string } | null;
};
type StudentPageRow = {
  id: string; person_id: string; student_number: string | null; current_grade: string; academic_year: string;
  status: string; updated_at: string; name_zh: string; name_en: string;
  household_name_zh: string | null; household_name_en: string | null; total_count: number | string;
};

export async function listStudents(options: PageOptions = {}): Promise<PageResult<StudentRecord>> {
  const { page, pageSize } = pageValues(options);
  const rows = await supabaseJson<StudentPageRow[]>("/rest/v1/rpc/list_students_page", {
    method: "POST",
    body: JSON.stringify({
      search_query: options.query ?? "",
      page_number: page,
      page_size: pageSize,
      status_filter: options.status ?? "all",
    }),
  });
  return {
    items: rows.map((row) => ({
      id: row.id, personId: row.person_id, nameZh: row.name_zh, nameEn: row.name_en,
      householdZh: row.household_name_zh ?? "", householdEn: row.household_name_en ?? "",
      studentNumber: row.student_number ?? "", grade: row.current_grade,
      academicYear: row.academic_year, status: row.status, updatedAt: row.updated_at,
    })),
    total: Number(rows[0]?.total_count ?? 0),
    page,
    pageSize,
  };
}

export type StudentDetail = StudentRecord & {
  householdId: string;
  academicRecords: Array<{
    id: string; curriculum: string; grade: string; academicYear: string; validFrom: string;
    validTo: string; status: string; schoolZh: string; schoolEn: string;
  }>;
  guardians: Array<{
    id: string; contactId: string; relationship: string; primary: boolean; emergency: boolean;
    legalAuthority: boolean; nameZh: string; nameEn: string;
  }>;
};
type StudentDetailRow = StudentRow & {
  student_number: string | null; household_id: string | null;
  student_academic_records?: Array<{
    id: string; curriculum: string; grade: string; academic_year: string; valid_from: string;
    valid_to: string | null; status: string; organizations: { name_zh: string; name_en: string } | null;
  }>;
  student_guardian_relationships?: Array<{
    id: string; guardian_contact_id: string; relationship_type: string; primary_guardian: boolean; emergency_contact: boolean;
    legal_authority: boolean; contacts: { name_zh: string; name_en: string } | null;
  }>;
};

export async function getStudentDetail(id: string): Promise<StudentDetail | null> {
  const rows = await supabaseJson<StudentDetailRow[]>(`/rest/v1/students?select=id,person_id,student_number,household_id,current_grade,academic_year,status,updated_at,contacts:contacts!students_person_id_fkey(name_zh,name_en),households:households!students_household_id_fkey(name_zh,name_en),student_academic_records:student_academic_records!student_academic_records_student_id_fkey(id,curriculum,grade,academic_year,valid_from,valid_to,status,organizations:organizations!student_academic_records_school_id_fkey(name_zh,name_en)),student_guardian_relationships:student_guardian_relationships!student_guardian_relationships_student_id_fkey(id,guardian_contact_id,relationship_type,primary_guardian,emergency_contact,legal_authority,contacts:contacts!student_guardian_relationships_guardian_contact_id_fkey(name_zh,name_en))&id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, personId: row.person_id, nameZh: row.contacts?.name_zh ?? "", nameEn: row.contacts?.name_en ?? "",
    householdZh: row.households?.name_zh ?? "", householdEn: row.households?.name_en ?? "",
    householdId: row.household_id ?? "", studentNumber: row.student_number ?? "",
    grade: row.current_grade, academicYear: row.academic_year, status: row.status, updatedAt: row.updated_at,
    academicRecords: (row.student_academic_records ?? []).map((item) => ({
      id: item.id, curriculum: item.curriculum, grade: item.grade, academicYear: item.academic_year,
      validFrom: item.valid_from, validTo: item.valid_to ?? "", status: item.status,
      schoolZh: item.organizations?.name_zh ?? "", schoolEn: item.organizations?.name_en ?? "",
    })),
    guardians: (row.student_guardian_relationships ?? []).map((item) => ({
      id: item.id, contactId: item.guardian_contact_id, relationship: item.relationship_type, primary: item.primary_guardian,
      emergency: item.emergency_contact, legalAuthority: item.legal_authority,
      nameZh: item.contacts?.name_zh ?? "", nameEn: item.contacts?.name_en ?? "",
    })),
  };
}

export function updateStudent(input: {
  id: string; expectedUpdatedAt: string; grade: string; academicYear: string; householdId?: string | null; status: string;
}) {
  return supabaseJson<StudentRow>("/rest/v1/rpc/update_student_record", {
    method: "POST", body: JSON.stringify({
      target_student: input.id, expected_updated_at: input.expectedUpdatedAt,
      next_grade: input.grade, next_academic_year: input.academicYear,
      next_household: input.householdId || null, next_status: input.status,
    }),
  });
}

export function addStudentAcademicRecord(input: {
  studentId: string; schoolId?: string | null; curriculum: string; grade: string;
  academicYear: string; validFrom: string; validTo?: string | null; status: string;
}) {
  return supabaseJson("/rest/v1/student_academic_records", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      student_id: input.studentId, school_id: input.schoolId || null, curriculum: input.curriculum,
      grade: input.grade, academic_year: input.academicYear, valid_from: input.validFrom,
      valid_to: input.validTo || null, status: input.status,
    }),
  });
}

export async function createStudent(input: {
  personId: string; householdId?: string | null; studentNumber?: string; grade: string; academicYear: string;
}) {
  const rows = await supabaseJson<StudentRow[]>("/rest/v1/students", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      person_id: input.personId, household_id: input.householdId || null,
      student_number: input.studentNumber || null, current_grade: input.grade, academic_year: input.academicYear,
    }),
  });
  return rows[0];
}

export type HouseholdDetail = HouseholdRecord & {
  members: Array<{ id: string; contactId: string; role: string; primary: boolean; nameZh: string; nameEn: string }>;
};
type HouseholdDetailRow = Omit<HouseholdRow, "household_members"> & {
  household_members?: Array<{
    id: string; contact_id: string; member_role: string; primary_contact: boolean;
    contacts: { name_zh: string; name_en: string } | null;
  }>;
};

export async function getHouseholdDetail(id: string): Promise<HouseholdDetail | null> {
  const rows = await supabaseJson<HouseholdDetailRow[]>(`/rest/v1/households?select=id,name_zh,name_en,status,address,updated_at,household_members:household_members!household_members_household_id_fkey(id,contact_id,member_role,primary_contact,contacts:contacts!household_members_contact_id_fkey(name_zh,name_en))&id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, nameZh: row.name_zh, nameEn: row.name_en, status: row.status,
    address: row.address, memberCount: row.household_members?.length ?? 0, updatedAt: row.updated_at,
    members: (row.household_members ?? []).map((item) => ({
      id: item.id, contactId: item.contact_id, role: item.member_role, primary: item.primary_contact,
      nameZh: item.contacts?.name_zh ?? "", nameEn: item.contacts?.name_en ?? "",
    })),
  };
}

export function updateHousehold(input: {
  id: string; expectedUpdatedAt: string; nameZh: string; nameEn: string; address: string; status: string;
}) {
  return supabaseJson<HouseholdRow>("/rest/v1/rpc/update_household_record", {
    method: "POST", body: JSON.stringify({
      target_household: input.id, expected_updated_at: input.expectedUpdatedAt,
      next_name_zh: input.nameZh, next_name_en: input.nameEn,
      next_address: input.address, next_status: input.status,
    }),
  });
}

export function saveHouseholdMember(input: {
  householdId: string; contactId: string; role: string; primary: boolean;
}) {
  return supabaseJson("/rest/v1/rpc/save_household_member", {
    method: "POST",
    body: JSON.stringify({
      target_household: input.householdId,
      target_contact: input.contactId,
      member_role_value: input.role,
      is_primary: input.primary,
    }),
  });
}

export function removeHouseholdMember(id: string) {
  return supabaseJson("/rest/v1/rpc/remove_household_member", {
    method: "POST", body: JSON.stringify({ target_member: id }),
  });
}

export function saveStudentGuardian(input: {
  studentId: string; contactId: string; relationship: string;
  primary: boolean; emergency: boolean; legalAuthority: boolean;
}) {
  return supabaseJson("/rest/v1/rpc/save_student_guardian", {
    method: "POST",
    body: JSON.stringify({
      target_student: input.studentId,
      target_contact: input.contactId,
      relationship_value: input.relationship,
      is_primary: input.primary,
      is_emergency: input.emergency,
      has_legal_authority: input.legalAuthority,
    }),
  });
}

export function removeStudentGuardian(id: string) {
  return supabaseJson("/rest/v1/rpc/remove_student_guardian", {
    method: "POST", body: JSON.stringify({ target_relationship: id }),
  });
}

export type ProgressionBatchRecord = {
  id: string; fromYear: string; toYear: string; status: string; selected: number; applied: number; createdAt: string;
};
type ProgressionRow = {
  id: string; from_academic_year: string; to_academic_year: string; status: string; created_at: string;
  progression_batch_items?: Array<{ selected: boolean; status: string }>;
};

export async function listProgressionBatches(options: PageOptions = {}): Promise<PageResult<ProgressionBatchRecord>> {
  const result = await exactPage<ProgressionRow>(
    "/rest/v1/progression_batches?select=id,from_academic_year,to_academic_year,status,created_at,progression_batch_items:progression_batch_items!progression_batch_items_batch_id_fkey(selected,status)&order=created_at.desc",
    options,
  );
  return {
    ...result,
    items: result.items.map((row) => ({
      id: row.id, fromYear: row.from_academic_year, toYear: row.to_academic_year, status: row.status,
      selected: (row.progression_batch_items ?? []).filter((item) => item.selected).length,
      applied: (row.progression_batch_items ?? []).filter((item) => item.status === "APPLIED").length,
      createdAt: row.created_at,
    })),
  };
}

export function previewProgression(fromYear: string, toYear: string, requestKey: string) {
  return supabaseJson<ProgressionRow>("/rest/v1/rpc/preview_student_progression", {
    method: "POST", body: JSON.stringify({ from_year: fromYear, to_year: toYear, p_idempotency_key: requestKey }),
  });
}

export function applyProgression(id: string, requestKey: string) {
  return supabaseJson<ProgressionRow>("/rest/v1/rpc/apply_student_progression", {
    method: "POST", body: JSON.stringify({ target_batch: id, p_idempotency_key: requestKey }),
  });
}

export type ProgressionItemRecord = {
  id: string; studentId: string; nameZh: string; nameEn: string;
  fromGrade: string; toGrade: string; action: string; selected: boolean;
  status: string; errorCode: string; reason: string;
};

type ProgressionItemRow = {
  id: string; student_id: string; from_grade: string; to_grade: string; action: string;
  selected: boolean; status: string; error_code: string | null; reason: string;
  students: { contacts: { name_zh: string; name_en: string } | null } | null;
};

export async function getProgressionBatchDetail(id: string) {
  const batches = await supabaseJson<ProgressionRow[]>(`/rest/v1/progression_batches?select=id,from_academic_year,to_academic_year,status,created_at,progression_batch_items:progression_batch_items!progression_batch_items_batch_id_fkey(selected,status)&id=eq.${encodeURIComponent(id)}&limit=1`);
  const batch = batches[0];
  if (!batch) return null;
  const rows = await supabaseJson<ProgressionItemRow[]>(`/rest/v1/progression_batch_items?select=id,student_id,from_grade,to_grade,action,selected,status,error_code,reason,students:students!progression_batch_items_student_id_fkey(contacts:contacts!students_person_id_fkey(name_zh,name_en))&batch_id=eq.${encodeURIComponent(id)}&order=status.asc,from_grade.asc`);
  return {
    batch: {
      id: batch.id, fromYear: batch.from_academic_year, toYear: batch.to_academic_year,
      status: batch.status,
      selected: (batch.progression_batch_items ?? []).filter((item) => item.selected).length,
      applied: (batch.progression_batch_items ?? []).filter((item) => item.status === "APPLIED").length,
      createdAt: batch.created_at,
    } satisfies ProgressionBatchRecord,
    items: rows.map((row): ProgressionItemRecord => ({
      id: row.id, studentId: row.student_id,
      nameZh: row.students?.contacts?.name_zh ?? "",
      nameEn: row.students?.contacts?.name_en ?? "",
      fromGrade: row.from_grade, toGrade: row.to_grade, action: row.action,
      selected: row.selected, status: row.status, errorCode: row.error_code ?? "", reason: row.reason,
    })),
  };
}

export function updateProgressionItem(input: {
  id: string; selected: boolean; toGrade: string; action: string; reason: string;
}) {
  return supabaseJson("/rest/v1/rpc/update_progression_batch_item", {
    method: "POST",
    body: JSON.stringify({
      target_item: input.id, item_selected: input.selected,
      destination_grade: input.toGrade, item_action: input.action, item_reason: input.reason,
    }),
  });
}

export function cancelProgression(id: string) {
  return supabaseJson("/rest/v1/rpc/cancel_student_progression", {
    method: "POST", body: JSON.stringify({ target_batch: id }),
  });
}

export type ProgressionRuleRecord = {
  id: string; fromGrade: string; toGrade: string; action: string; active: boolean; updatedAt: string;
};
type ProgressionRuleRow = {
  id: string; from_grade: string; to_grade: string; action: string; active: boolean; updated_at: string;
};

export async function listProgressionRules() {
  const rows = await supabaseJson<ProgressionRuleRow[]>("/rest/v1/grade_progression_rules?select=id,from_grade,to_grade,action,active,updated_at&order=active.desc,from_grade.asc&limit=200");
  return rows.map((row): ProgressionRuleRecord => ({
    id: row.id, fromGrade: row.from_grade, toGrade: row.to_grade,
    action: row.action, active: row.active, updatedAt: row.updated_at,
  }));
}

export function saveProgressionRule(input: {
  id?: string | null; fromGrade: string; toGrade: string; action: string; active: boolean;
}) {
  return supabaseJson("/rest/v1/rpc/save_progression_rule", {
    method: "POST",
    body: JSON.stringify({
      target_rule: input.id ?? null, source_grade: input.fromGrade,
      destination_grade: input.toGrade, rule_action: input.action, rule_active: input.active,
    }),
  });
}

export type LeadRecord = {
  id: string; type: string; nameZh: string; nameEn: string; source: string; status: string;
  score: number; pipeline: string; updatedAt: string;
};
type LeadRow = {
  id: string; subject_type: string; name_zh: string; name_en: string; source: string; status: string;
  qualification_score: number; pipeline_key: string; updated_at: string;
};

export async function listLeads(options: PageOptions = {}): Promise<PageResult<LeadRecord>> {
  const params = new URLSearchParams({
    select: "id,subject_type,name_zh,name_en,source,status,qualification_score,pipeline_key,updated_at",
    order: "updated_at.desc",
  });
  const query = options.query?.replace(/[*,()]/g, " ").trim();
  if (query) params.set("or", `(name_zh.ilike.*${query}*,name_en.ilike.*${query}*)`);
  if (options.status && options.status !== "all") params.set("status", `eq.${options.status}`);
  const result = await exactPage<LeadRow>(`/rest/v1/leads?${params}`, options);
  return {
    ...result,
    items: result.items.map((row) => ({
      id: row.id, type: row.subject_type, nameZh: row.name_zh, nameEn: row.name_en,
      source: row.source, status: row.status, score: row.qualification_score,
      pipeline: row.pipeline_key, updatedAt: row.updated_at,
    })),
  };
}

export async function getLead(id: string): Promise<LeadRecord | null> {
  const rows = await supabaseJson<LeadRow[]>(`/rest/v1/leads?select=id,subject_type,name_zh,name_en,source,status,qualification_score,pipeline_key,updated_at&id=eq.${encodeURIComponent(id)}&limit=1`);
  const row = rows[0];
  return row ? {
    id: row.id, type: row.subject_type, nameZh: row.name_zh, nameEn: row.name_en,
    source: row.source, status: row.status, score: row.qualification_score,
    pipeline: row.pipeline_key, updatedAt: row.updated_at,
  } : null;
}

export async function createLead(input: {
  type: "SCHOOL" | "HOUSEHOLD"; organizationId?: string | null; householdId?: string | null;
  nameZh: string; nameEn: string; source: string; score: number; note: string;
}) {
  const rows = await supabaseJson<LeadRow[]>("/rest/v1/leads", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      subject_type: input.type, organization_id: input.organizationId || null, household_id: input.householdId || null,
      name_zh: input.nameZh, name_en: input.nameEn, source: input.source,
      qualification_score: input.score, qualification_note: input.note,
      status: input.score >= 60 ? "QUALIFIED" : "QUALIFYING",
      pipeline_key: input.type === "SCHOOL" ? "SCHOOL_DEFAULT" : "HOUSEHOLD_DEFAULT",
    }),
  });
  return rows[0];
}

export function convertLead(input: {
  id: string; titleZh: string; titleEn: string; amount: number; currency: string; requestKey: string;
}) {
  return supabaseJson("/rest/v1/rpc/convert_lead_to_opportunity", {
    method: "POST", body: JSON.stringify({
      target_lead: input.id, title_zh: input.titleZh, title_en: input.titleEn,
      amount: input.amount, currency: input.currency, p_idempotency_key: input.requestKey,
    }),
  });
}

export type PrivacyRequestRecord = {
  id: string; type: string; status: string; identityStatus: string; note: string;
  decisionNote: string; dueAt: string; createdAt: string; assignedTo: string; executionTaskId: string;
};
type PrivacyRow = {
  id: string; request_type: string; status: string; identity_status: string;
  request_note: string; decision_note: string | null; due_at: string; created_at: string;
  assigned_to: string | null; execution_task_id: string | null;
};

function privacyRequest(row: PrivacyRow): PrivacyRequestRecord {
  return {
    id: row.id, type: row.request_type, status: row.status, identityStatus: row.identity_status,
    note: row.request_note, decisionNote: row.decision_note ?? "", dueAt: row.due_at,
    createdAt: row.created_at, assignedTo: row.assigned_to ?? "", executionTaskId: row.execution_task_id ?? "",
  };
}

export async function listPrivacyRequests(options: PageOptions = {}): Promise<PageResult<PrivacyRequestRecord>> {
  const params = new URLSearchParams({
    select: "id,request_type,status,identity_status,request_note,decision_note,due_at,created_at,assigned_to,execution_task_id",
    order: "created_at.desc",
  });
  if (options.status && options.status !== "all") params.set("status", `eq.${options.status}`);
  const result = await exactPage<PrivacyRow>(`/rest/v1/privacy_requests?${params}`, options);
  return { ...result, items: result.items.map(privacyRequest) };
}

export async function createPrivacyRequest(input: { type: string; note: string; contactId?: string | null }) {
  const rows = await supabaseJson<PrivacyRow[]>("/rest/v1/privacy_requests", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ request_type: input.type, request_note: input.note, requester_contact_id: input.contactId || null }),
  });
  return rows[0];
}

export async function managePrivacyRequest(input: {
  id: string; status: string; identityStatus: string; decision: string;
}) {
  const row = await supabaseJson<PrivacyRow>("/rest/v1/rpc/manage_privacy_request", {
    method: "POST",
    body: JSON.stringify({
      target_request: input.id,
      next_status: input.status,
      identity_result: input.identityStatus,
      decision: input.decision,
    }),
  });
  return privacyRequest(row);
}

export type SuggestionRecord = {
  id: string; subjectType: string; recommendationZh: string; recommendationEn: string;
  evidence: Array<Record<string, unknown>>; confidence: number; status: string; expiresAt: string; createdAt: string;
};
type SuggestionRow = {
  id: string; subject_type: string; recommendation_zh: string; recommendation_en: string;
  evidence: Array<Record<string, unknown>>; confidence: number; status: string; expires_at: string; created_at: string;
};

function suggestion(row: SuggestionRow): SuggestionRecord {
  return {
    id: row.id, subjectType: row.subject_type, recommendationZh: row.recommendation_zh,
    recommendationEn: row.recommendation_en, evidence: row.evidence ?? [],
    confidence: Number(row.confidence), status: row.status, expiresAt: row.expires_at, createdAt: row.created_at,
  };
}

export async function listSuggestions(options: PageOptions = {}): Promise<PageResult<SuggestionRecord>> {
  const status = options.status === "history"
    ? "&status=in.(ACCEPTED,EDITED,REJECTED,EXPIRED)"
    : options.status === "all" || !options.status ? "" : `&status=eq.${encodeURIComponent(options.status.toUpperCase())}`;
  const result = await exactPage<SuggestionRow>(
    `/rest/v1/ai_suggestions?select=id,subject_type,recommendation_zh,recommendation_en,evidence,confidence,status,expires_at,created_at${status}&order=created_at.desc`,
    options,
  );
  return { ...result, items: result.items.map(suggestion) };
}

export async function generateSuggestions(): Promise<SuggestionRecord[]> {
  const rows = await supabaseJson<SuggestionRow[]>("/rest/v1/rpc/generate_rule_suggestions", { method: "POST", body: "{}" });
  return rows.map(suggestion);
}

export function decideSuggestion(input: {
  id: string; decision: "ACCEPTED" | "EDITED" | "REJECTED"; finalZh: string; finalEn: string;
  reason: string; createTask: boolean; requestKey: string;
}) {
  return supabaseJson("/rest/v1/rpc/decide_ai_suggestion", {
    method: "POST", body: JSON.stringify({
      target_suggestion: input.id, decision_value: input.decision, final_zh: input.finalZh,
      final_en: input.finalEn, decision_reason: input.reason, create_task: input.createTask,
      p_idempotency_key: input.requestKey,
    }),
  });
}
