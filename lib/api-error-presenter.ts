import { ApiClientError } from "./api-client";

type Translator = (key: string, values?: Record<string, string | number>) => string;

const codeKeys: Record<string, string> = {
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
