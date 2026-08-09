import { NextResponse } from "next/server";
import { z } from "zod";
import { createStaffUser, listStaffUsers } from "@/lib/admin-users-repository";
import { apiRequestId, apiRoute, parsePagination, requireApiAal2, requireApiRole } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { APP_ROLES } from "@/lib/roles";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { emitObservabilityEvent } from "@/lib/observability";

const createSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z][a-z0-9._-]+$/),
  displayNameZh: z.string().trim().min(1).max(80),
  displayNameEn: z.string().trim().min(1).max(80),
  email: z.email(),
  role: z.enum(APP_ROLES.filter((role) => role !== "SUPER_ADMIN") as ["ADMIN", "SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"]),
  team: z.string().trim().min(1).max(80),
  managerMemberId: z.uuid().nullable().optional(),
});
const directoryStatusSchema = z.enum(["ALL", "ACTIVE", "PENDING", "SUSPENDED"]);
const directoryRoleSchema = z.enum(["ALL", ...APP_ROLES]);

function failure(error: unknown) {
  if (error instanceof DatabaseRequestError) return NextResponse.json({ code: error.code }, { status: error.status });
  return NextResponse.json({ code: "STAFF_USERS_FAILED" }, { status: 500 });
}

async function get(request: Request) {
  await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  try {
    const url = new URL(request.url);
    const {page,pageSize}=parsePagination(url.searchParams,20);
    const status=directoryStatusSchema.safeParse((url.searchParams.get("status")??"ALL").toUpperCase());
    const role=directoryRoleSchema.safeParse((url.searchParams.get("role")??"ALL").toUpperCase());
    if(!status.success||!role.success)return NextResponse.json({code:"INVALID_STAFF_DIRECTORY_FILTER"},{status:400});
    return NextResponse.json(await listStaffUsers({
      query: url.searchParams.get("query") ?? "", page, pageSize,
      status:status.data,role:role.data,
    }));
  } catch (error) { return failure(error); }
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 });
  const actor = await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  try {
    const result = await createStaffUser(parsed.data, actor);
    const status = result.emailDeliveryStatus === "SENT" ? 201 : 202;
    await emitObservabilityEvent({
      name:"admin.staff_account.create",requestId:apiRequestId(request),status,
      result:"created",deliveryStatus:result.emailDeliveryStatus,
    });
    return NextResponse.json(result, { status });
  } catch (error) {
    const response = failure(error);
    const code = error instanceof DatabaseRequestError ? error.code : "STAFF_USERS_FAILED";
    await emitObservabilityEvent({
      name:"admin.staff_account.create",requestId:apiRequestId(request),status:response.status,
      result:response.status<500?"rejected":"failed",errorCode:code,
    });
    return response;
  }
}
export const GET=apiRoute(get,"STAFF_USERS_FAILED");
export const POST=apiRoute(post,"STAFF_USER_CREATE_FAILED");
