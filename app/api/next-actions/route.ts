import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parseUuid, requireApiUser } from "@/lib/api";
import { decideNextBestAction, generateNextBestActions, listNextBestActions } from "@/lib/operations-repository";
import { mutationIsTrusted } from "@/lib/request-security";

const mutationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("generate"), organizationId: z.uuid().nullable().optional() }),
  z.object({
    operation: z.literal("decide"),
    id: z.uuid(),
    decision: z.enum(["ACCEPTED", "REJECTED"]),
    reason: z.string().trim().max(500).default(""),
  }),
]);

async function get(request: Request) {
  await requireApiUser();
  const rawOrganization = new URL(request.url).searchParams.get("organizationId");
  const organizationId = rawOrganization ? parseUuid(rawOrganization, "organizationId") : null;
  return NextResponse.json({ items: await listNextBestActions(organizationId) });
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiUser();
  const parsed = mutationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_NEXT_ACTION_OPERATION", 400);
  if (parsed.data.operation === "generate") {
    const generated = await generateNextBestActions(parsed.data.organizationId);
    return NextResponse.json({ generated, items: await listNextBestActions(parsed.data.organizationId) });
  }
  if (parsed.data.decision === "REJECTED" && !parsed.data.reason) {
    throw new ApiError("NEXT_ACTION_REJECTION_REASON_REQUIRED", 400);
  }
  const item = await decideNextBestAction(parsed.data.id, parsed.data.decision, parsed.data.reason);
  return NextResponse.json({ item });
}

export const GET = apiRoute(get, "NEXT_ACTIONS_LOAD_FAILED");
export const POST = apiRoute(post, "NEXT_ACTION_OPERATION_FAILED");
