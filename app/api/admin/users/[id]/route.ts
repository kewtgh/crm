import { NextResponse } from "next/server";
import { z } from "zod";
import { getStaffUser, updateStaffUser } from "@/lib/admin-users-repository";
import { AuthSecurityError, requireAal2, requireRole } from "@/lib/auth";
import { mutationIsTrusted } from "@/lib/request-security";
import { APP_ROLES } from "@/lib/roles";
import { SupabaseRequestError } from "@/lib/supabase-server";

const schema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  role: z.enum(APP_ROLES.filter((role) => role !== "SUPER_ADMIN") as ["ADMIN", "SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"]).optional(),
}).refine((value) => value.status || value.role, { message: "EMPTY_UPDATE" });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: parsed.error.issues[0]?.message ?? "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 });
  try {
    const actor = await requireRole("SUPER_ADMIN", "ADMIN");
    await requireAal2();
    const target = await getStaffUser((await context.params).id);
    await updateStaffUser(target, parsed.data, actor);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthSecurityError) return NextResponse.json({ code: error.code }, { status: error.status });
    if (error instanceof SupabaseRequestError) return NextResponse.json({ code: error.code }, { status: error.status });
    return NextResponse.json({ code: "STAFF_USER_UPDATE_FAILED" }, { status: 500 });
  }
}
