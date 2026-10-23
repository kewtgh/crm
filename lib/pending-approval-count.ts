import { databaseRequest } from "./db/gateway";

/** Count through the same RLS boundary as the approval list, never the legacy definer aggregate. */
export async function pendingApprovalCount(request = databaseRequest): Promise<number> {
  const response = await request("/db/table/approval_requests?select=id&status=eq.PENDING", {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  return exactCount(response);
}

export function exactCount(response: Response): number {
  const match = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  const count = match ? Number(match[1]) : NaN;
  if (!response.ok || !Number.isSafeInteger(count) || count < 0) throw new Error("COUNT_UNAVAILABLE");
  return count;
}
