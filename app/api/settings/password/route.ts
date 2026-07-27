import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiUser } from "@/lib/api";
import {authCookieNames} from "@/lib/auth";
import { supabaseJson, supabaseRequest, SupabaseRequestError } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";
import { revokeUserTrustedDevices, securityCookieNames } from "@/lib/trusted-devices";
import { passwordValueSchema } from "@/lib/validation";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: passwordValueSchema });

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_PASSWORD" }, { status: 400 });
  const user = await requireApiUser();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ code: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  const verification = await fetchWithTimeout(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: parsed.data.currentPassword }), cache: "no-store" }, 10_000)
    .catch(() => null);
  if (!verification) return NextResponse.json({ code: "AUTH_UNAVAILABLE" }, { status: 503 });
  if (!verification.ok) return NextResponse.json({ code: verification.status===429?"AUTH_RATE_LIMITED":"CURRENT_PASSWORD_INCORRECT" }, { status: verification.status===429?429:400 });
  const verificationSession=await verification.json().catch(()=>null) as {access_token?:string}|null;
  if(!verificationSession?.access_token)return NextResponse.json({code:"AUTH_UNAVAILABLE"},{status:503});
  try {
    // Use the freshly password-verified session. Reusing a long-lived page
    // session can be rejected by GoTrue's secure-password-change policy.
    await supabaseJson("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password: parsed.data.newPassword }) }, verificationSession.access_token);
    const trustedDevicesRevoked=await revokeUserTrustedDevices(user.id, "PASSWORD_CHANGED").then(()=>true).catch(()=>false);
    const response = NextResponse.json({ ok: true,trustedDevicesRevoked });
    response.cookies.delete(authCookieNames.refresh);
    response.cookies.delete(authCookieNames.persistence);
    response.cookies.delete(securityCookieNames.trustedDevice);
    return response;
  } catch(error) {
    const code=error instanceof SupabaseRequestError?error.code:"PASSWORD_UPDATE_FAILED";
    const status=error instanceof SupabaseRequestError&&error.status<500?error.status:500;
    return NextResponse.json({code},{status});
  } finally {
    // The password grant above is only a reauthentication proof; do not leave
    // it as a second active browser session.
    await supabaseRequest("/auth/v1/logout?scope=local",{method:"POST"},verificationSession.access_token).catch(()=>undefined);
  }
}
export const POST=apiRoute(post,"PASSWORD_UPDATE_FAILED");
