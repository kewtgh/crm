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
