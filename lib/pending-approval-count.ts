import { databaseRequest } from "./db/gateway";

/** Count through the same RLS boundary as the approval list, never the legacy definer aggregate. */
export async function pendingApprovalCount(request = databaseRequest): Promise<number> {
  const response = await request("/db/rpc/approval_pending_count", {method:"POST",body:"{}"});
  const result=await response.json().catch(()=>null) as {count?:unknown}|null;
  if(!response.ok||!result||!Number.isSafeInteger(result.count)||Number(result.count)<0)throw new Error("COUNT_UNAVAILABLE");
  return Number(result.count);
}

export function exactCount(response: Response): number {
  const match = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  const count = match ? Number(match[1]) : NaN;
  if (!response.ok || !Number.isSafeInteger(count) || count < 0) throw new Error("COUNT_UNAVAILABLE");
  return count;
}
