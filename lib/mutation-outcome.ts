import { ApiClientError } from "./api-client";

/** Transport loss is status 0, not a confirmed rejection. Preserve its receipt identity. */
export function isDefinitiveMutationFailure(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError && error.status >= 400 && error.status < 500 && error.status !== 408;
}

export type MutationOutcome =
  | { state: "failed"; error: unknown }
  | { state: "saved" }
  | { state: "saved-refresh-failed"; error: unknown };

/** A successful write and a subsequent read have different recovery actions. No automatic retry. */
export async function settleMutation(write: () => Promise<unknown>, refresh: () => Promise<unknown>): Promise<MutationOutcome> {
  try { await write(); }
  catch (error) { return { state: "failed", error }; }
  try { await refresh(); return { state: "saved" }; }
  catch (error) { return { state: "saved-refresh-failed", error }; }
}
