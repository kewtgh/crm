import { NextResponse } from "next/server";
import { nextAuthenticatedPath } from "@/lib/auth";
import { mutationIsTrusted } from "@/lib/request-security";
import { getAccessToken, supabaseJson, supabaseRequest, SupabaseRequestError } from "@/lib/supabase-server";
import { initialPasswordSchema } from "@/lib/validation";
import { ApiError, apiRoute, requireApiUser } from "@/lib/api";

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = initialPasswordSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message ?? "INVALID_INPUT", 400, "INVALID_INPUT", {
      field: String(parsed.error.issues[0]?.path[0] ?? "form"),
    });
  }
  const user = await requireApiUser();
  if (!user.mustChangePassword) return NextResponse.json({ ok: true, next: nextAuthenticatedPath(user) });
  try {
    const token = await getAccessToken();
    await supabaseJson("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password: parsed.data.newPassword }) }, token);
    await supabaseRequest("/auth/v1/logout?scope=others", { method: "POST" }, token);
    await supabaseJson("/rest/v1/rpc/complete_initial_password_change", { method: "POST", body: "{}" }, token);
    return NextResponse.json({
      ok: true,
      next: nextAuthenticatedPath({ ...user, mustChangePassword: false }),
    });
  } catch (error) {
    return NextResponse.json({ code: error instanceof SupabaseRequestError ? error.code : "PASSWORD_UPDATE_FAILED" }, { status: 400 });
  }
}

export const POST = apiRoute(post, "PASSWORD_UPDATE_FAILED");
