import { ApiClientError } from "./api-client";

export type ReadFailure = { kind: "session" | "permission" | "scope" | "migration" | "timeout" | "network" | "response" | "unavailable"; requestId?: string };
/** Only bounded opaque references leave this classifier; never SQL, payloads or raw messages. */
export function classifyReadFailure(error: unknown): ReadFailure {
  if (!(error instanceof ApiClientError)) return {kind:"response"};
  const requestId = error.requestId && /^[a-zA-Z0-9_-]{8,80}$/.test(error.requestId) ? error.requestId : undefined;
  const kind = error.status===401 ? "session" : error.status===403 ? "permission" : error.code==="DATABASE_MIGRATION_REQUIRED" ? "migration" : ["DATABASE_TIMEOUT","REQUEST_TIMEOUT"].includes(error.code) ? "timeout" : error.status===0 ? "network" : error.code==="INVALID_API_RESPONSE" ? "response" : error.status===400 ? "scope" : "unavailable";
  return {kind,requestId};
}
