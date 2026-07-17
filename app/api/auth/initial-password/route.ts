import { NextResponse } from "next/server";
import { getCurrentUser, nextAuthenticatedPath } from "@/lib/auth";
import { mutationIsTrusted } from "@/lib/request-security";
import { getAccessToken, supabaseJson, supabaseRequest, SupabaseRequestError } from "@/lib/supabase-server";
import { initialPasswordSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = initialPasswordSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ code: parsed.error.issues[0]?.message ?? "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  if (!user.mustChangePassword) return NextResponse.json({ ok: true, next: nextAuthenticatedPath(user) });
  try {
    const token = await getAccessToken();
    await supabaseJson("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password: parsed.data.newPassword }) }, token);
    await supabaseRequest("/auth/v1/logout?scope=others", { method: "POST" }, token);
    await supabaseJson("/rest/v1/rpc/complete_initial_password_change", { method: "POST", body: "{}" }, token);
    return NextResponse.json({ ok: true, next: user.role === "SUPER_ADMIN" || user.role === "ADMIN" ? (user.mfaEnabled ? "/mfa-challenge" : "/mfa-setup") : "/dashboard" });
  } catch (error) {
    return NextResponse.json({ code: error instanceof SupabaseRequestError ? error.code : "PASSWORD_UPDATE_FAILED" }, { status: 400 });
  }
}
