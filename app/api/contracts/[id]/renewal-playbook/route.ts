import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parseUuid, requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { supabaseJson } from "@/lib/supabase-server";

const schema = z.object({
  stage: z.enum(["NOT_STARTED", "DISCOVERY", "PROPOSAL", "NEGOTIATION", "COMMITTED", "RENEWED", "LOST"]),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  actionZh: z.string().trim().min(2).max(1000),
  actionEn: z.string().trim().min(2).max(1000),
  dueAt: z.iso.datetime(),
  outcome: z.string().trim().max(1000).default(""),
});

async function get(_: Request, routeContext: { params: Promise<{ id: string }> }) {
  await requireApiCapability("contracts.view");
  const { id } = await routeContext.params;
  const playbookContext = await supabaseJson<Record<string, unknown>>(
    "/rest/v1/rpc/renewal_playbook_context",
    { method: "POST", body: JSON.stringify({ target_contract: parseUuid(id) }) },
  );
  return NextResponse.json({ context: playbookContext });
}

async function post(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiCapability("contracts.manage");
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_RENEWAL_PLAYBOOK", 400);
  if (["RENEWED", "LOST"].includes(parsed.data.stage) && !parsed.data.outcome) {
    throw new ApiError("RENEWAL_OUTCOME_REQUIRED", 400);
  }
  const item = await supabaseJson<Record<string, unknown>>("/rest/v1/rpc/save_renewal_playbook", {
    method: "POST",
    body: JSON.stringify({
      target_contract: parseUuid(id),
      playbook_stage: parsed.data.stage,
      risk: parsed.data.risk,
      action_zh: parsed.data.actionZh,
      action_en: parsed.data.actionEn,
      action_due: parsed.data.dueAt,
      outcome: parsed.data.outcome,
    }),
  });
  return NextResponse.json({ item });
}

export const GET = apiRoute(get, "RENEWAL_PLAYBOOK_LOAD_FAILED");
export const POST = apiRoute(post, "RENEWAL_PLAYBOOK_SAVE_FAILED");
