import { NextResponse } from "next/server";
import { z } from "zod";
import { createStaffUser, listStaffUsers } from "@/lib/admin-users-repository";
import { AuthSecurityError, requireAal2, requireRole } from "@/lib/auth";
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
  if (error instanceof AuthSecurityError) return NextResponse.json({ code: error.code }, { status: error.status });
  if (error instanceof SupabaseRequestError) return NextResponse.json({ code: error.code }, { status: error.status });
  return NextResponse.json({ code: "STAFF_USERS_FAILED" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await requireRole("SUPER_ADMIN", "ADMIN");
    await requireAal2();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") ?? 20)));
    return NextResponse.json(await listStaffUsers({ query: url.searchParams.get("query") ?? "", page, pageSize }));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 });
  try {
    const actor = await requireRole("SUPER_ADMIN", "ADMIN");
    await requireAal2();
    return NextResponse.json({ item: await createStaffUser(parsed.data, actor) }, { status: 201 });
  } catch (error) { return failure(error); }
}
