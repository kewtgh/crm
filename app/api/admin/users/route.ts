import { NextResponse } from "next/server";
import { z } from "zod";
import { createStaffUser, listStaffUsers } from "@/lib/admin-users-repository";
import { apiRoute, parsePagination, requireApiAal2, requireApiRole } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { APP_ROLES } from "@/lib/roles";
import { SupabaseRequestError } from "@/lib/supabase-server";

const createSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z][a-z0-9._-]+$/),
  displayNameZh: z.string().trim().min(1).max(80),
  displayNameEn: z.string().trim().min(1).max(80),
  email: z.email(),
  role: z.enum(APP_ROLES.filter((role) => role !== "SUPER_ADMIN") as ["ADMIN", "SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"]),
  team: z.string().trim().min(1).max(80),
  managerMemberId: z.uuid().nullable().optional(),
});

function failure(error: unknown) {
  if (error instanceof SupabaseRequestError) return NextResponse.json({ code: error.code }, { status: error.status });
  return NextResponse.json({ code: "STAFF_USERS_FAILED" }, { status: 500 });
}

async function get(request: Request) {
  await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  try {
    const url = new URL(request.url);
    const {page,pageSize}=parsePagination(url.searchParams,20);
    return NextResponse.json(await listStaffUsers({ query: url.searchParams.get("query") ?? "", page, pageSize }));
  } catch (error) { return failure(error); }
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 });
  const actor = await requireApiRole("SUPER_ADMIN", "ADMIN");
  await requireApiAal2();
  try {
    return NextResponse.json({ item: await createStaffUser(parsed.data, actor) }, { status: 201 });
  } catch (error) { return failure(error); }
}
export const GET=apiRoute(get,"STAFF_USERS_FAILED");
export const POST=apiRoute(post,"STAFF_USER_CREATE_FAILED");
