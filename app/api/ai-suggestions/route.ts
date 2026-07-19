import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parsePagination, requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { decideSuggestion, generateSuggestions, listSuggestions } from "@/lib/v200-repository";

const schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("generate") }),
  z.object({
    operation: z.literal("decide"), id: z.uuid(), decision: z.enum(["ACCEPTED", "EDITED", "REJECTED"]),
    finalZh: z.string().trim().max(2000).default(""), finalEn: z.string().trim().max(2000).default(""),
    reason: z.string().trim().min(3).max(1000), createTask: z.boolean().default(false),
    requestKey: z.string().trim().min(8).max(160),
  }),
]);

async function get(request: Request) {
  await requireApiCapability("ai.review");
  return NextResponse.json(await listSuggestions(parsePagination(new URL(request.url).searchParams, 20)));
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiCapability("ai.review");
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_AI_DECISION", 400, "INVALID_AI_DECISION", { field: String(parsed.error.issues[0]?.path[0] ?? "form") });
  const item = parsed.data.operation === "generate" ? await generateSuggestions() : await decideSuggestion(parsed.data);
  return NextResponse.json({ item });
}

export const GET = apiRoute(get, "AI_SUGGESTION_LOAD_FAILED");
export const POST = apiRoute(post, "AI_SUGGESTION_OPERATION_FAILED");
