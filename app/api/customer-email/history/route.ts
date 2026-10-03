import { NextResponse } from "next/server";
import { ApiError, apiRoute, requireApiCapability } from "@/lib/api";
import { emailHistoryFilters } from "@/lib/customer-email-history";
import { loadCustomerEmailHistory } from "@/lib/customer-email-history-repository";

async function get(request: Request) {
  await requireApiCapability("messages.view");
  const input = emailHistoryFilters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) throw new ApiError("INVALID_EMAIL_HISTORY_FILTER", 400);
  return NextResponse.json(await loadCustomerEmailHistory(input.data), { headers: { "cache-control": "private, no-store" } });
}
export const GET = apiRoute(get, "CUSTOMER_EMAIL_HISTORY_FAILED");
