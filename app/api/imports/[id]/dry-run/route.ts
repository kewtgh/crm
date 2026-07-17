import { NextResponse } from "next/server";
import { apiRoute, parseUuid, requireApiRole } from "@/lib/api";
import { supabaseJson } from "@/lib/supabase-server";

async function get(_: Request, context: { params: Promise<{ id: string }> }) {
  await requireApiRole("SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT");
  const { id } = await context.params;
  const summary = await supabaseJson<Record<string, unknown>>("/rest/v1/rpc/import_dry_run", {
    method: "POST",
    body: JSON.stringify({ target_batch: parseUuid(id) }),
  });
  return NextResponse.json({ summary });
}

export const GET = apiRoute(get, "IMPORT_DRY_RUN_FAILED");
