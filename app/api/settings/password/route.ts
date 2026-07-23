import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiUser } from "@/lib/api";
import { authCookieNames } from "@/lib/auth";
import { getAccessToken, supabaseJson } from "@/lib/supabase-server";
import { mutationIsTrusted } from "@/lib/request-security";
import { revokeUserTrustedDevices, securityCookieNames } from "@/lib/trusted-devices";
import { passwordValueSchema } from "@/lib/validation";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: passwordValueSchema });

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_PASSWORD" }, { status: 400 });
  const user = await requireApiUser();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ code: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  const verification = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: parsed.data.currentPassword }), cache: "no-store" });
  if (!verification.ok) return NextResponse.json({ code: "CURRENT_PASSWORD_INCORRECT" }, { status: 400 });
  try {
    await supabaseJson("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password: parsed.data.newPassword }) }, await getAccessToken());
    await revokeUserTrustedDevices(user.id, "PASSWORD_CHANGED");
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(authCookieNames.refresh);
    response.cookies.delete(authCookieNames.persistence);
    response.cookies.delete(securityCookieNames.trustedDevice);
    return response;
  } catch { return NextResponse.json({ code: "PASSWORD_UPDATE_FAILED" }, { status: 500 }); }
}
export const POST=apiRoute(post,"PASSWORD_UPDATE_FAILED");
