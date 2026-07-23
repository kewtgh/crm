import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { isMfaRequiredRole } from "@/lib/auth";
import { apiRoute, requireApiUser } from "@/lib/api";
import { getAccessToken, supabaseJson, supabaseRequest } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";
import { revokeUserTrustedDevices, securityCookieNames } from "@/lib/trusted-devices";
import { setAuthSessionCookies } from "@/lib/auth-session";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }),
  z.object({ action: z.literal("challenge"), factorId: z.string().uuid() }),
  z.object({ action: z.literal("verify"), factorId: z.string().uuid(), challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("unenroll"), factorId: z.string().uuid() }),
]);

async function get() {
  await requireApiUser();
  try {
    const user = await supabaseJson<{ factors?: Array<{ id: string; factor_type: string; status: string; friendly_name?: string; created_at?: string }> }>("/auth/v1/user", {}, await getAccessToken());
    return NextResponse.json({ factors: user.factors ?? [] });
  } catch { return NextResponse.json({ code: "MFA_LOAD_FAILED" }, { status: 500 }); }
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_MFA_REQUEST" }, { status: 400 });
  const user = await requireApiUser(); const token = await getAccessToken();
  try {
    if (parsed.data.action === "enroll") {
      const factor = await supabaseJson("/auth/v1/factors", { method: "POST", body: JSON.stringify({ factor_type: "totp", friendly_name: "Lumina CRM" }) }, token);
      return NextResponse.json({ factor });
    }
    if (parsed.data.action === "challenge") {
      const challenge = await supabaseJson(`/auth/v1/factors/${parsed.data.factorId}/challenge`, { method: "POST", body: "{}" }, token);
      return NextResponse.json({ challenge });
    }
    if (parsed.data.action === "verify") {
      const session = await supabaseJson<{ access_token?: string; refresh_token?: string; expires_in?: number }>(`/auth/v1/factors/${parsed.data.factorId}/verify`, { method: "POST", body: JSON.stringify({ challenge_id: parsed.data.challengeId, code: parsed.data.code }) }, token);
      const response = NextResponse.json({ ok: true, next: "/dashboard" });
      const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
      const remember = (await cookies()).get(securityCookieNames.mfaRemember)?.value === "1";
      setAuthSessionCookies(response, session, remember);
      await revokeUserTrustedDevices(user.id, "MFA_VERIFIED").catch(() => undefined);
      response.cookies.delete(securityCookieNames.trustedDevice);
      response.cookies.set(securityCookieNames.mfaRemember, "", {
        ...cookieBase,
        path: "/api/settings/mfa",
        maxAge: 0,
      });
      return response;
    }
    if (isMfaRequiredRole(user.role)) return NextResponse.json({ code: "MFA_REQUIRED_FOR_ROLE" }, { status: 409 });
    await supabaseRequest(`/auth/v1/factors/${parsed.data.factorId}`, { method: "DELETE" }, token);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ code: "MFA_OPERATION_FAILED" }, { status: 400 }); }
}
export const GET=apiRoute(get,"MFA_LOAD_FAILED");
export const POST=apiRoute(post,"MFA_OPERATION_FAILED");
