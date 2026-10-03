import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiUser, requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { cohortStatuses, saveCohortSchema } from "@/lib/cohort-input";
import { listProductCohorts, getProductCohort, saveProductCohort } from "@/lib/cohort-repository";

const querySchema = z.object({productId: z.uuid(), status: z.enum(cohortStatuses).optional(), page: z.coerce.number().int().min(1).max(100000).default(1),query:z.string().max(80).optional(),usage:z.enum(["OPPORTUNITY","EVENT","QUOTE"]).optional()});
function fail(error: unknown) {
  if (!(error instanceof DatabaseRequestError)) throw error;
  const code = error.code === "RECORD_CONFLICT" ? "COHORT_CODE_CONFLICT" : error.code;
  const status = ["COHORT_CODE_CONFLICT", "COHORT_VERSION_CONFLICT", "COHORT_REQUEST_CONFLICT", "COHORT_PARENT_IMMUTABLE"].includes(code) ? 409
    : ["COHORT_NOT_FOUND", "COHORT_PRODUCT_NOT_FOUND"].includes(code) ? 404
    : code === "COHORT_UPDATE_FORBIDDEN" ? 403
    : ["COHORT_INPUT_INVALID", "COHORT_OWNER_INVALID", "CONSTRAINT_VIOLATION", "RELATED_RECORD_CONFLICT", "INVALID_INPUT"].includes(code) ? 400 : error.status;
  return NextResponse.json({code}, {status});
}
async function get(request: Request) {
  await requireApiUser();
  const params = new URL(request.url).searchParams;
  try {
    if (params.has("id")) {
      const id = z.uuid().safeParse(params.get("id"));
      if (!id.success) return NextResponse.json({code: "INVALID_INPUT"}, {status: 400});
      const item = await getProductCohort(id.data);
      return item ? NextResponse.json({item}) : NextResponse.json({code: "COHORT_NOT_FOUND"}, {status: 404});
    }
    const parsed = querySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return NextResponse.json({code: "INVALID_INPUT"}, {status: 400});
    return NextResponse.json({items: await listProductCohorts(parsed.data.productId, parsed.data)});
  } catch (error) { return fail(error); }
}
async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({code: "UNTRUSTED_ORIGIN"}, {status: 403});
  await requireApiCapability("catalog.manage");
  const parsed = saveCohortSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({code: "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form")}, {status: 400});
  try { return NextResponse.json({item: await saveProductCohort(parsed.data)}); }
  catch (error) { return fail(error); }
}
export const GET = apiRoute(get, "COHORT_LOAD_FAILED");
export const POST = apiRoute(post, "COHORT_SAVE_FAILED");
