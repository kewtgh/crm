import { ApiClientError } from "./api-client";

type Translator = (key: string, values?: Record<string, string | number>) => string;

const codeKeys: Record<string, string> = {
  COMMERCIAL_LINK_DUPLICATE: "commercial.duplicate",
  COMMERCIAL_LINK_FORBIDDEN: "commercial.forbidden",
  COMMERCIAL_QUOTE_FORBIDDEN: "permission.denied",
  COMMERCIAL_OPPORTUNITY_MISMATCH: "commercial.mismatch",
  COMMERCIAL_EVENT_MISMATCH: "commercial.mismatch",
  COMMERCIAL_CONTRACT_MISMATCH: "commercial.mismatch",
  COMMERCIAL_COHORT_MISMATCH: "commercial.mismatch",
  COMMERCIAL_VERSION_CONFLICT: "commercial.versionConflict",
  COMMERCIAL_REQUEST_CONFLICT: "commercial.requestConflict",
  COMMERCIAL_QUOTE_LOCKED: "commercial.quoteLocked",
  COMMERCIAL_INPUT_INVALID: "error.invalidInput",
  ENROLLMENT_INPUT_INVALID: "enrollments.invalid",
  ENROLLMENT_DUPLICATE: "enrollments.duplicate",
  ENROLLMENT_PRIMARY_CONFLICT: "enrollments.primaryConflict",
  ENROLLMENT_VERSION_CONFLICT: "enrollments.versionConflict",
  ENROLLMENT_PARENT_IMMUTABLE: "enrollments.parentImmutable",
  ENROLLMENT_REQUEST_CONFLICT: "enrollments.requestConflict",
  ENROLLMENT_COHORT_CLOSED: "enrollments.closed",
  ENROLLMENT_STUDENT_NOT_FOUND: "enrollments.notFound",
  ENROLLMENT_COHORT_NOT_FOUND: "enrollments.notFound",
  ENROLLMENT_NOT_FOUND: "enrollments.notFound",
  ENROLLMENT_UPDATE_FORBIDDEN: "permission.denied",
  ENROLLMENT_SOURCE_FORBIDDEN: "enrollments.sourceForbidden",
  ENROLLMENT_RELATED_FORBIDDEN: "enrollments.relatedForbidden",
  ENROLLMENT_OWNER_INVALID: "enrollments.ownerInvalid",
  ENROLLMENT_OPPORTUNITY_MISMATCH: "enrollments.opportunityMismatch",
  COHORT_CODE_CONFLICT: "cohorts.codeConflict",
  COHORT_VERSION_CONFLICT: "cohorts.versionConflict",
  COHORT_REQUEST_CONFLICT: "cohorts.requestConflict",
  COHORT_PARENT_IMMUTABLE: "cohorts.parentImmutable",
  COHORT_NOT_FOUND: "cohorts.notFound",
  COHORT_PRODUCT_NOT_FOUND: "cohorts.notFound",
  COHORT_UPDATE_FORBIDDEN: "permission.denied",
  COHORT_INPUT_INVALID: "cohorts.invalid",
  COHORT_OWNER_INVALID: "error.relatedConflict",
  EMAIL_TEMPLATE_VERSION_CONFLICT:"ux.templateConflict",
  EMAIL_TEMPLATE_IDEMPOTENCY_CONFLICT:"ux.templateCreateConflict",
  EMAIL_TEMPLATE_NOT_FOUND:"ux.templateNotFound",
  EMAIL_TEMPLATE_PUBLIC_FORBIDDEN:"permission.denied",
  EMAIL_PREVIEW_CHANGED:"customerOps.previewChanged",
  DATABASE_MIGRATION_REQUIRED:"customerOps.migrationRequired",
  CAPABILITY_FORBIDDEN: "permission.denied",
  DATABASE_PERMISSION_DENIED:"permission.denied",
  CRM_CREATE_FORBIDDEN:"permission.denied",
  CRM_UPDATE_FORBIDDEN:"permission.denied",
  CONTACT_OWNER_NOT_ASSIGNABLE:"customerOps.ownerNotAssignable",
  CONTACT_PROFILE_INVALID:"error.invalidInput",
  RELATED_RECORD_NOT_FOUND:"error.relatedConflict",
  FOLLOW_UP_IDEMPOTENCY_CONFLICT:"error.conflict",
  ROLE_FORBIDDEN: "permission.denied",
  MFA_REQUIRED: "permission.mfaRequired",
  INVALID_INPUT: "error.invalidInput",
  INVALID_LOCAL_TIME: "error.invalidLocalTime",
  INVALID_ID: "error.invalidInput",
  REQUEST_TIMEOUT: "error.timeout",
  NETWORK_ERROR: "error.network",
  SESSION_REFRESH_REQUIRED: "error.session",
  AUTH_REQUIRED: "error.session",
  RECORD_CONFLICT: "error.conflict",
  PRODUCT_CODE_CONFLICT: "products.codeConflict",
  PRODUCT_VERSION_CONFLICT: "products.versionConflict",
  PRODUCT_NOT_FOUND: "products.notFound",
  PRODUCT_ARCHIVED: "products.archived",
  PRODUCT_DELETE_NOT_AUTHORIZED: "permission.denied",
  PRODUCT_UPDATE_FORBIDDEN: "permission.denied",
  PRODUCT_UPDATE_NOT_AUTHORIZED: "permission.denied",
  PRODUCT_PRICE_NOT_AUTHORIZED: "permission.denied",
  DATABASE_SCHEMA_OUTDATED: "products.schemaOutdated",
  APPOINTMENT_IDEMPOTENCY_CONFLICT: "error.conflict",
  RELATED_RECORD_CONFLICT: "error.relatedConflict",
  CONSTRAINT_VIOLATION: "error.invalidInput",
  EDUCATION_VERSION_CONFLICT: "error.versionConflict",
  PROGRESSION_RULE_INVALID: "progression.ruleInvalid",
  PROGRESSION_ITEM_INVALID: "progression.itemInvalid",
  PROGRESSION_NOT_EDITABLE: "progression.notEditable",
  PROGRESSION_NOT_CANCELLABLE: "progression.notCancellable",
  STUDENT_VERSION_CONFLICT: "progression.studentConflict",
  LEAD_NOT_CONVERTIBLE: "leads.notConvertible",
  EDUCATION_RELATIONSHIP_SUBJECT_NOT_FOUND: "education.relationshipSubjectMissing",
  EDUCATION_RELATIONSHIP_NOT_FOUND: "education.relationshipMissing",
  EDUCATION_PRIMARY_REPLACEMENT_REQUIRED: "education.primaryReplacementRequired",
};

export type PresentedApiError = {
  message: string;
  code: string;
  field?: string;
  requestId?: string;
};

export function presentApiError(error: unknown, t: Translator, fallbackKey: string): PresentedApiError {
  if (!(error instanceof ApiClientError)) {
    return { message: t(fallbackKey), code: "UNKNOWN_ERROR" };
  }
  const base = t(codeKeys[error.code] ?? fallbackKey);
  const requestId = error.requestId;
  return {
    code: error.code,
    field: typeof error.details?.field === "string" ? error.details.field : undefined,
    requestId,
    message: `${base}${requestId ? ` · ${t("common.requestId")}: ${requestId}` : ""}`,
  };
}
