import { importFieldsByResource } from "./import-fields";
import { businessConfig } from "./education-business";

// Frozen field contract. Phase 2 v2 templates/adapters consume it; legacy headers stay unchanged.
export const importContractVersion = "V325_PHASE1";
export type ImportResource = keyof typeof importFieldsByResource;
export type ImportSupport = "SUPPORTED_IMPORT" | "SUPPORTED_READ_ONLY" | "REQUIRES_DOMAIN_EXTENSION" | "UNSUPPORTED" | "DERIVED";
export type ImportValueType = "text" | "enum" | "array" | "integer" | "decimal" | "currency" | "date" | "timestamp" | "reference" | "boolean";
export type FieldContract = {
  resource: ImportResource;
  key: string;
  table: string | null;
  column: string | null;
  type: ImportValueType;
  create: boolean;
  update: boolean;
  required: string;
  sensitive: boolean;
  support: ImportSupport;
  currentHeader: boolean;
  mutation: string;
  validation: string;
  scope: "CORE" | "PROFILE";
};
type Definition = [key: string, column: string, type: ImportValueType, validation: string, required?: string];
const owners: Record<ImportResource, string> = {
  ORGANIZATIONS: "lib/crm-repository.ts#createCrmRecord / updateCrmRecord → update_school_customer_profile",
  HOUSEHOLDS: "lib/v200-repository.ts#createHousehold / updateHousehold → update_household_profile",
  CONTACTS: "lib/crm-repository.ts#createCrmRecord → create_customer_contact / updateCrmRecord → update_contact_profile",
  STUDENTS: "lib/v200-repository.ts#createStudent / updateStudent → update_student_profile",
  COHORTS: "lib/cohort-repository.ts#saveProductCohort → save_product_cohort",
  ENROLLMENTS: "lib/enrollment-repository.ts#saveEnrollment → save_student_enrollment",
};
const tables: Record<ImportResource, string> = { ORGANIZATIONS: "organizations", HOUSEHOLDS: "households", CONTACTS: "contacts", STUDENTS: "students", COHORTS: "product_cohorts", ENROLLMENTS: "student_enrollments" };
function fields(resource: ImportResource, definitions: Definition[], sensitive: string[] = []): FieldContract[] {
  return definitions.map(([key, column, type, validation, required = "optional"]) => ({
    resource, key, table: tables[resource], column, type, validation, required,
    create: true, update: true, sensitive: sensitive.includes(key), support: "SUPPORTED_IMPORT",
    currentHeader: (importFieldsByResource[resource] as readonly string[]).includes(key), mutation: owners[resource], scope: "CORE",
  }));
}
const contactMethods = "EMAIL|PHONE|SMS|WECHAT|WHATSAPP|IN_PERSON";
export const importFieldContract: FieldContract[] = [
  ...fields("ORGANIZATIONS", [
    ["nameZh","name_zh","text","max 120; bilingual normalization","one-of(nameZh,nameEn)"],
    ["nameEn","name_en","text","max 160; bilingual normalization","one-of(nameZh,nameEn)"],
    ["shortName","short_name","text","max 80"],
    ["organizationType","organization_type","enum","SCHOOL|PARTNER|OTHER; profile FAMILY is not a core enum"],
    ["city","city","text","1–80","required"], ["curriculum","curriculum","text","max 120"],
    ["courseCategories","course_categories","array","max 40; each 1–100; explicit delimiter"],
    ["affiliationType","affiliation_type","enum","INDEPENDENT|EDUCATION_GROUP|GOVERNMENT|UNIVERSITY|RELIGIOUS|OTHER"],
    ["parentOrganizationId","parent_organization_id","reference","visible same-workspace Organization; no self/invalid hierarchy"],
    ["address","address","text","max 1000"], ["website","website","text","URL or empty"],
    ["foundedYear","founded_year","integer","1000–9999"],
    ["studentCount","student_count","integer","nonnegative"], ["facultyCount","faculty_count","integer","nonnegative"],
    ["campusCount","campus_count","integer","nonnegative"],
    ["organizationOverviewMarkdown","organization_overview_markdown","text","max 10000"],
    ["structureOverviewMarkdown","structure_overview_markdown","text","max 10000"],
    ["status","status","enum","HEALTHY|ATTENTION|DEVELOPING|RISK|UNVERIFIED; update only"],
    ["ownerId","owner_id","reference","server default on create; no generic import assignment"],
  ], ["organizationOverviewMarkdown","structureOverviewMarkdown"]),
  ...fields("HOUSEHOLDS", [
    ["nameZh","name_zh","text","max 120; bilingual normalization","one-of(nameZh,nameEn)"],
    ["nameEn","name_en","text","max 160; bilingual normalization","one-of(nameZh,nameEn)"],
    ["address","address","text","max 1000"],
    ["primaryParentOccupation","primary_parent_occupation","text","max 160"],
    ["secondaryParentOccupation","secondary_parent_occupation","text","max 160"],
    ["annualIncomeAmount","annual_income_amount","decimal","nonnegative decimal string; numeric storage; Number adapter parity gap"],
    ["incomeCurrency","income_currency","currency","ISO-style uppercase 3-letter code; separate from amount"],
    ["preferredContactMethod","preferred_contact_method","enum",contactMethods],
    ["preferredLanguage","preferred_language","text","max 80; no inferred translation"],
    ["educationExpectationsMarkdown","education_expectations_markdown","text","max 10000"],
    ["familyBackgroundMarkdown","family_background_markdown","text","max 10000"],
    ["status","status","enum","ACTIVE|INACTIVE|ARCHIVED; update only"],
    ["ownerId","owner_id","reference","server default; no owner editor on Household form"],
  ], ["nameZh","nameEn","address","primaryParentOccupation","secondaryParentOccupation","annualIncomeAmount","educationExpectationsMarkdown","familyBackgroundMarkdown"]),
  ...fields("CONTACTS", [
    ["nameZh","name_zh","text","max 120; bilingual normalization","one-of(nameZh,nameEn)"],
    ["nameEn","name_en","text","max 160; bilingual normalization","one-of(nameZh,nameEn)"],
    ["email","email","text","email or empty; candidate lookup only","one-of(email,phone)"],
    ["phone","phone","text","max 40; formatting is not identity","one-of(email,phone)"],
    ["title","title","text","max 120"],
    ["contactType","contact_type","enum","CONTACT|PARENT|STUDENT|SCHOOL_STAFF|PAYER"],
    ["contactStatus","contact_status","enum","NEW|ATTEMPTING|CONNECTED|FOLLOW_UP|DORMANT"],
    ["communicationLevel","communication_level","integer","1–4"],
    ["notesMarkdown","notes_markdown","text","max 20000"],
    ["preferredContactMethod","preferred_contact_method","enum",contactMethods],
    ["preferredLanguage","preferred_language","text","max 80"],
    ["acquisitionSource","acquisition_source","text","max 160"],
    ["decisionRole","decision_role","enum","UNKNOWN|DECISION_MAKER|INFLUENCER|USER|GATEKEEPER|OTHER"],
    ["tags","tags","array","max 30; each 1–60"],
    ["nextFollowUpAt","next_follow_up_at","timestamp","ISO timestamp with explicit offset; workspace business timezone input"],
    ["ownerId","owner_id","reference","active assignable visible same-workspace staff"],
    ["status","status","enum","ACTIVE|FOLLOW_UP|VERIFIED|PROTECTED|UNVERIFIED; record status differs from contactStatus"],
    ["organizationId","organization_id","reference","association only; create_customer_contact; reassignment lacks general mutation"],
    ["wechatId","wechat_id","text","max 100; separate save_contact_communication with expectedUpdatedAt"],
  ], ["nameZh","nameEn","email","phone","notesMarkdown","tags","wechatId"]),
  ...fields("STUDENTS", [
    ["personId","person_id","reference","visible Contact; unique per workspace; immutable identity","required"],
    ["householdId","household_id","reference","visible Household; not guardian authority"],
    ["studentNumber","student_number","text","max 60; workspace unique when non-null"],
    ["birthDate","birth_date","date","strict YYYY-MM-DD; calendar validation"],
    ["currentGrade","current_grade","text","1–40; domain input key grade","required"],
    ["currentClass","current_class","text","max 80"],
    ["academicYear","academic_year","text","4–20","required"],
    ["interests","interests","array","max 30; each 1–80; explicit delimiter"],
    ["preferredLearningStyle","preferred_learning_style","enum","UNSPECIFIED|VISUAL|AUDITORY|READ_WRITE|KINESTHETIC|MIXED"],
    ["personalityMarkdown","personality_markdown","text","max 10000"],
    ["learningExpectationsMarkdown","learning_expectations_markdown","text","max 10000"],
    ["strengthsMarkdown","strengths_markdown","text","max 10000"],
    ["supportNeedsMarkdown","support_needs_markdown","text","max 10000"],
    ["status","status","enum","ACTIVE|ON_LEAVE|ALUMNI|WITHDRAWN|ARCHIVED; profile mutation only"],
  ], ["birthDate","interests","personalityMarkdown","learningExpectationsMarkdown","strengthsMarkdown","supportNeedsMarkdown"]),
  ...fields("COHORTS", [
    ["productCode","product_id","reference","visible unique Product.code; resolved to id","required"],
    ["cohortCode","code","text","workspace unique; canonical cohort-input validation","required"],
    ["nameZh","name_zh","text","cohort-input bilingual validation","one-of(nameZh,nameEn)"],
    ["nameEn","name_en","text","cohort-input bilingual validation","one-of(nameZh,nameEn)"],
    ["intakeType","intake_type","enum","SPRING|SUMMER|FALL|WINTER|CUSTOM"], ["academicYear","academic_year","text","max 40"],
    ["applicationOpenOn","application_open_on","date","strict calendar date; domain ordering/readiness"],
    ["applicationDeadline","application_deadline","date","strict calendar date; domain ordering/readiness"],
    ["startOn","start_on","date","strict calendar date; domain ordering/readiness"],
    ["endOn","end_on","date","strict calendar date; domain ordering/readiness"],
    ["targetEnrollment","target_enrollment","integer","nonnegative; cohort-input limits"],
    ["capacity","capacity","integer","nonnegative; domain capacity/readiness"],
    ["currency","default_currency","currency","3-letter uppercase; current import header maps defaultCurrency"],
    ["ownerEmail","owner_id","reference","unique active assignable staff; email lookup not identity"],
    ["status","status","enum","DRAFT|RECRUITING|CLOSED|ACTIVE|COMPLETED|CANCELLED; save_product_cohort only"],
  ]),
  ...fields("ENROLLMENTS", [
    ["studentNumber","student_id","reference","visible unique Student.student_number","required"],
    ["cohortCode","cohort_id","reference","visible unique Cohort.code","required"],
    ["status","status","enum","LEAD|INTERESTED|REGISTERING|ACTIVE|COMPLETED|WITHDRAWN|CANCELLED; history via save_student_enrollment only"],
    ["ownerEmail","owner_id","reference","unique active assignable staff","required"],
    ["salesOwnerEmail","sales_owner_id","reference","unique active assignable staff"],
    ["householdReference","household_id","reference","visible Household; legacy UUID; future selected token/alias"],
    ["opportunityReference","opportunity_id","reference","visible Opportunity; legacy UUID; future selected token/alias"],
    ["enrolledAt","enrolled_at","timestamp","ISO offset; lifecycle validation"],
    ["completedAt","completed_at","timestamp","ISO offset; lifecycle validation"],
    ["withdrawnAt","withdrawn_at","timestamp","ISO offset; lifecycle validation"],
    ["withdrawalReason","withdrawal_reason","text","domain withdrawal requirement"],
  ], ["withdrawalReason"]),
];

// Existing profile forms own these fields; never store profile values on the core record.
for (const [resource, configKey] of [["ORGANIZATIONS","organizations"],["HOUSEHOLDS","needs"]] as const) {
  const config = businessConfig[configKey];
  for (const field of config.fields) importFieldContract.push({
    resource, key: `profile.${field.key}`, table: config.table, column: field.key,
    type: field.kind === "multi" ? "array" : field.kind === "relation" ? "reference" : field.kind === "number" ? field.integer ? "integer" : "decimal" : field.kind,
    create: true, update: true, required: field.required ? "profile schema required/default" : "optional",
    sensitive: resource === "HOUSEHOLDS" || field.key.endsWith("markdown"), support: "SUPPORTED_IMPORT", currentHeader: false,
    mutation: "lib/education-business-repository.ts#saveEducationBusiness → save_education_business",
    validation: `businessFieldsSchema / commercialProfileSchema; ${field.options?.join("|") ?? (field.kind === "number" ? `${field.min}–${field.max}; paired range/currency checks` : `max ${field.max ?? "domain"}`)}`,
    scope: "PROFILE",
  });
}
for (const field of importFieldContract) {
  if (field.key === "status" && ["ORGANIZATIONS","HOUSEHOLDS","CONTACTS","STUDENTS"].includes(field.resource)) field.create = false;
  if (field.resource === "ORGANIZATIONS" && field.key === "organizationType") field.update = false;
  if (field.key === "ownerId" && ["ORGANIZATIONS","HOUSEHOLDS"].includes(field.resource)) {
    field.create = false; field.update = false; field.support = "SUPPORTED_READ_ONLY";
  }
  if (field.key === "personId") field.update = false;
  if (field.key === "organizationId") field.update = false;
  if (field.key === "wechatId") { field.create = false; field.mutation = "app/api/contacts/[id]/communication/route.ts#POST → save_contact_communication"; }
  // Compatibility review only: existing Cohort/Enrollment imports remain CREATE/SKIP.
  if (["COHORTS","ENROLLMENTS"].includes(field.resource)) field.update = false;
}
for (const key of ["nameZh","nameEn"] as const) importFieldContract.push({
  resource:"STUDENTS",key,table:"contacts",column:key === "nameZh" ? "name_zh" : "name_en",type:"text",
  create:false,update:false,required:"derived from personId",sensitive:true,support:"DERIVED",currentHeader:true,
  mutation:"lib/v200-repository.ts#createStudent; identity edited only via Contact mutation",validation:"legacy headers are compatibility input, not Student identity storage",scope:"CORE",
});
for (const [resource, keys] of [["ORGANIZATIONS",["country","province","region","email","phone","tags","classification","teamId"]],["HOUSEHOLDS",["country","region","teamId"]],["CONTACTS",["country","region","address","teamId"]]] as const) {
  for (const key of keys) importFieldContract.push({resource,key,table:null,column:null,type:"text",create:false,update:false,required:"not applicable",sensitive:resource !== "ORGANIZATIONS",support:"REQUIRES_DOMAIN_EXTENSION",currentHeader:false,mutation:"NONE",validation:"no equivalent core field/form mutation found; do not add JSON storage for import",scope:"CORE"});
}

export const importRelations = [
  {key:"ORGANIZATION_CONTACT",table:"contacts",identity:["id"],parents:["organization_id"],roles:[],mutation:"create_customer_contact",concurrency:"create only; general reassignment deferred",note:"one optional Organization per Contact; not a many-to-many membership"},
  {key:"HOUSEHOLD_MEMBER",table:"household_members",identity:["household_id","contact_id"],parents:["household_id","contact_id"],roles:["PARENT","GUARDIAN","STUDENT","PAYER","OTHER"],mutation:"save_household_member",concurrency:"legacy upsert lacks expected revision/receipt; Phase 3 gate",note:"pair is unique; changing role updates same relation; primary selection affects other members"},
  {key:"STUDENT_GUARDIAN",table:"student_guardian_relationships",identity:["student_id","guardian_contact_id"],parents:["student_id","guardian_contact_id"],roles:["MOTHER","FATHER","GUARDIAN","RELATIVE","OTHER"],mutation:"save_student_guardian",concurrency:"legacy upsert lacks expected revision/receipt; Phase 3 gate",note:"legal_authority is explicit; never infer signing authority"},
  {key:"ORGANIZATION_CONTACT_INTELLIGENCE",table:"organization_contact_intelligence",identity:["workspace_id","contact_id"],parents:["organization_id","contact_id"],roles:[],mutation:"save_organization_contact_intelligence",concurrency:"revision + payload-bound request",note:"contact must belong to Organization; scores are existing domain fields"},
  {key:"CONTACT_CONTACT",table:"organization_contact_relationships",identity:["organization_id","source_contact_id","target_contact_id","relationship_type"],parents:["organization_id","source_contact_id","target_contact_id"],roles:["REPORTS_TO","INFLUENCES","ASSISTANT_TO","PEER","WORKS_WITH","OTHER"],mutation:"save_organization_contact_relationship",concurrency:"revision + payload-bound request",note:"PEER/WORKS_WITH unordered pair; other roles directed; active uniqueness"},
] as const;

export const importEnumContract = {
  contactType: [["CONTACT","联系人","Contact"],["PARENT","家长","Parent"],["STUDENT","学生","Student"],["SCHOOL_STAFF","学校工作人员","School staff"],["PAYER","付款人","Payer"]],
  contactStatus: [["NEW","新建","New"],["ATTEMPTING","尝试联系","Attempting"],["CONNECTED","已联系","Connected"],["FOLLOW_UP","跟进","Follow-up"],["DORMANT","休眠","Dormant"]],
  preferredContactMethod: [["EMAIL","邮件","Email"],["PHONE","电话","Phone"],["SMS","短信","SMS"],["WECHAT","微信","WeChat"],["WHATSAPP","WhatsApp","WhatsApp"],["IN_PERSON","当面","In person"]],
} as const;
// Display labels are not implicitly accepted aliases. New aliases require a versioned decision.
export function normalizeContractEnum(key: keyof typeof importEnumContract, value: string): string {
  const code = value.trim();
  if (!importEnumContract[key].some(item => item[0] === code)) throw new Error("INVALID_ENUM");
  return code;
}
export function contractField(resource: ImportResource, key: string): FieldContract {
  const field = importFieldContract.find(item => item.resource === resource && item.key === key);
  if (!field || field.support !== "SUPPORTED_IMPORT") throw new Error("UNKNOWN_OR_UNSUPPORTED_FIELD");
  return field;
}
export function requireContractCreateFields(resource: ImportResource, row: Record<string, unknown>): void {
  const present = (key:string) => row[key] !== undefined && row[key] !== null && row[key] !== "" && !(typeof row[key] === "string" && !row[key].trim());
  for (const key of Object.keys(row)) if (!contractField(resource,key).create) throw new Error("FIELD_NOT_CREATEABLE");
  for (const field of importFieldContract.filter(item => item.resource === resource && item.scope === "CORE" && item.create)) {
    const group = field.required.match(/^one-of\(([^)]+)\)$/);
    if (field.required === "required" && !present(field.key) || group && !group[1].split(",").some(present)) throw new Error(`REQUIRED:${field.key}`);
  }
}
export function contractUpdatePatch(resource: ImportResource, row: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const field = contractField(resource,key);
    if (!field.update) throw new Error("FIELD_NOT_UPDATEABLE");
    if (value === undefined || value === null || typeof value === "string" && !value.trim() || Array.isArray(value) && !value.length) continue;
    if (value === "__CLEAR__") throw new Error("EXPLICIT_CLEAR_PROTOCOL_NOT_ENABLED");
    patch[key] = value;
  }
  return patch;
}
export type ReferenceCandidate = {id:string;workspaceId:string;visible:boolean};
export function resolveContractReference(workspaceId:string,candidates:readonly ReferenceCandidate[]): string {
  const visible = [...new Set(candidates.filter(item => item.visible && item.workspaceId === workspaceId).map(item => item.id))];
  if (!visible.length) throw new Error("INVALID_REFERENCE");
  if (visible.length !== 1) throw new Error("AMBIGUOUS_REFERENCE");
  return visible[0];
}
export function requireContractOwner(workspaceId:string,owner:ReferenceCandidate & {active:boolean;assignable:boolean}):string {
  if (!owner.visible || !owner.active || !owner.assignable || owner.workspaceId !== workspaceId) throw new Error("INVALID_REFERENCE");
  return owner.id;
}
export function normalizeContractMoney(value:string):string {
  if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("INVALID_DECIMAL");
  const [whole,fraction = ""] = value.trim().split(".");
  return `${BigInt(whole)}.${fraction.padEnd(2,"0")}`;
}
