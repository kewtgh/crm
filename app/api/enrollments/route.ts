import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, requireApiCapability } from "@/lib/api";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { mutationIsTrusted } from "@/lib/request-security";
import { attributionSaveSchema, enrollmentSaveSchema, enrollmentStatuses, enrollmentLookupTypes } from "@/lib/enrollment-input";
import { getEnrollment, listEnrollments, listEnrollmentAttributions, listEnrollmentStatusHistory, lookupEnrollmentRelations, saveEnrollment, saveEnrollmentAttribution } from "@/lib/enrollment-repository";
import {listContractEnrollmentLinks} from "@/lib/contract-enrollment-repository";

const filters = z.object({page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20), query: z.string().max(80).optional(), studentId: z.uuid().optional(), cohortId: z.uuid().optional(), ownerId: z.uuid().optional(), status: z.enum(enrollmentStatuses).optional()});
function fail(error: unknown, attribution = false): never {
  if (error instanceof DatabaseRequestError) {
    const code = error.code === "RECORD_CONFLICT" ? attribution ? "ENROLLMENT_PRIMARY_CONFLICT" : "ENROLLMENT_DUPLICATE" : error.code;
    const status = ["ENROLLMENT_DUPLICATE", "ENROLLMENT_PRIMARY_CONFLICT", "ENROLLMENT_VERSION_CONFLICT", "ENROLLMENT_REQUEST_CONFLICT", "ENROLLMENT_PARENT_IMMUTABLE", "ENROLLMENT_COHORT_CLOSED"].includes(code) ? 409
      : ["ENROLLMENT_NOT_FOUND", "ENROLLMENT_STUDENT_NOT_FOUND", "ENROLLMENT_COHORT_NOT_FOUND"].includes(code) ? 404
      : ["ENROLLMENT_UPDATE_FORBIDDEN", "ENROLLMENT_SOURCE_FORBIDDEN", "ENROLLMENT_RELATED_FORBIDDEN"].includes(code) ? 403 : error.status;
    throw new ApiError(code, status);
  }
  throw error;
}
async function get(request: Request) {
  await requireApiCapability("education.view");
  const params = new URL(request.url).searchParams;
  try {
    if (params.get("resource") === "options") {
      const input = z.object({type: z.enum(enrollmentLookupTypes), q: z.string().max(80).default("")}).safeParse(Object.fromEntries(params));
      if (!input.success) throw new ApiError("ENROLLMENT_INPUT_INVALID", 400);
      return NextResponse.json({items: await lookupEnrollmentRelations(input.data.type, input.data.q)});
    }
    if (params.has("id")) {
      const id = z.uuid().safeParse(params.get("id"));
      if (!id.success) throw new ApiError("ENROLLMENT_INPUT_INVALID", 400);
      const item = await getEnrollment(id.data);
      if (!item) throw new ApiError("ENROLLMENT_NOT_FOUND", 404);
      const page = z.coerce.number().int().min(1).max(100000).safeParse(params.get("page") ?? 1);
      if (!page.success) throw new ApiError("ENROLLMENT_INPUT_INVALID", 400);
      if (params.get("resource") === "history") return NextResponse.json({items: await listEnrollmentStatusHistory(id.data, page.data)});
      if (params.get("resource") === "contracts") return NextResponse.json({items:await listContractEnrollmentLinks({enrollmentId:id.data,page:page.data})});
      if (params.get("resource") === "attributions") return NextResponse.json({items: await listEnrollmentAttributions(id.data, page.data)});
      return NextResponse.json({item});
    }
    const parsed = filters.safeParse(Object.fromEntries(params));
    if (!parsed.success) throw new ApiError("ENROLLMENT_INPUT_INVALID", 400);
    return NextResponse.json(await listEnrollments(parsed.data));
  } catch (error) { return fail(error); }
}
async function save(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  await requireApiCapability("education.manage");
  const body = await request.json().catch(() => ({}));
  const attribution = body?.operation === "attribution";
  const parsed = attribution ? attributionSaveSchema.safeParse(body.input) : enrollmentSaveSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("ENROLLMENT_INPUT_INVALID", 400, "ENROLLMENT_INPUT_INVALID", {field: parsed.error.issues[0]?.path.join(".")});
  if (request.method === "PATCH" && (attribution || !("expectedRevision" in parsed.data) || parsed.data.expectedRevision === null)) throw new ApiError("ENROLLMENT_INPUT_INVALID", 400);
  try {
    const item = attribution ? await saveEnrollmentAttribution(attributionSaveSchema.parse(body.input)) : await saveEnrollment(enrollmentSaveSchema.parse(body));
    return NextResponse.json({item});
  } catch (error) { return fail(error, attribution); }
}
export const GET = apiRoute(get, "ENROLLMENT_LOAD_FAILED");
export const POST = apiRoute(save, "ENROLLMENT_SAVE_FAILED");
export const PATCH = apiRoute(save, "ENROLLMENT_SAVE_FAILED");
