import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, parsePagination, requireApiCapability, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { createPrivacyRequest, listPrivacyRequests, managePrivacyRequest } from "@/lib/v200-repository";

const createSchema = z.object({
  operation: z.literal("create").default("create"),
  type: z.enum(["ACCESS", "EXPORT", "CORRECTION", "RESTRICTION", "DELETION"]),
  note: z.string().trim().min(10).max(2000),
  contactId: z.uuid(),
});
const manageSchema = z.object({
  operation: z.literal("manage"),
  id: z.uuid(),
  status: z.enum(["IDENTITY_REVIEW", "IN_PROGRESS", "WAITING_APPROVAL", "FULFILLED", "REJECTED", "CANCELLED"]),
  identityStatus: z.enum(["PENDING", "VERIFIED", "FAILED"]),
  decision: z.string().trim().min(3).max(2000),
});

async function get(request: Request) {
  await requireApiUser();
  const url = new URL(request.url);
  const pagination = parsePagination(url.searchParams);
  return NextResponse.json(await listPrivacyRequests({
    ...pagination,
    status: url.searchParams.get("status") ?? undefined,
  }));
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiUser();
  const body = await request.json().catch(() => ({}));
  if (body?.operation === "manage") {
    await requireApiCapability("privacyRequests.manage");
    const parsed = manageSchema.safeParse(body);
    if (!parsed.success) throw new ApiError("INVALID_PRIVACY_DECISION", 400, "INVALID_PRIVACY_DECISION", { field: String(parsed.error.issues[0]?.path[0] ?? "form") });
    return NextResponse.json({ item: await managePrivacyRequest(parsed.data) });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("INVALID_PRIVACY_REQUEST", 400, "INVALID_PRIVACY_REQUEST", { field: String(parsed.error.issues[0]?.path[0] ?? "form") });
  return NextResponse.json({ item: await createPrivacyRequest(parsed.data) }, { status: 201 });
}

export const GET = apiRoute(get, "PRIVACY_REQUEST_LOAD_FAILED");
export const POST = apiRoute(post, "PRIVACY_REQUEST_CREATE_FAILED");
