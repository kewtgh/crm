import { ApiClientError } from "./api-client";

type Translator = (key: string, values?: Record<string, string | number>) => string;

const codeKeys: Record<string, string> = {
  CAPABILITY_FORBIDDEN: "permission.denied",
  ROLE_FORBIDDEN: "permission.denied",
  MFA_REQUIRED: "permission.mfaRequired",
  INVALID_INPUT: "error.invalidInput",
  INVALID_ID: "error.invalidInput",
  REQUEST_TIMEOUT: "error.timeout",
  NETWORK_ERROR: "error.network",
  SESSION_REFRESH_REQUIRED: "error.session",
  AUTH_REQUIRED: "error.session",
  RECORD_CONFLICT: "error.conflict",
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
