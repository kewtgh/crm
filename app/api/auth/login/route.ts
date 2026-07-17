import { NextResponse } from "next/server";
import { authCookieNames, hydrateStaffUser, nextAuthenticatedPath, userFromSupabase } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { checkLoginRateLimit, clearLoginFailures, loginRateLimitKey, recordLoginFailure } from "@/lib/login-rate-limit";
import { mutationIsTrusted } from "@/lib/request-security";
import { verifyTurnstileToken } from "@/lib/turnstile";

export async function POST(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = loginSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { code: parsed.error.issues[0]?.message ?? "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") },
      { status: 400 },
    );
  }

  const { email, password, remember, turnstileToken } = parsed.data;
  const rateKey = loginRateLimitKey(request, email);
  const limit = checkLoginRateLimit(rateKey);
  if (!limit.allowed) return NextResponse.json({ code: "TOO_MANY_ATTEMPTS" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const turnstile = await verifyTurnstileToken(turnstileToken, request);
  if (!turnstile.ok) {
    recordLoginFailure(rateKey);
    return NextResponse.json({ code: turnstile.code, field: "turnstile" }, { status: turnstile.code === "TURNSTILE_NOT_CONFIGURED" ? 503 : 400 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { code: "AUTH_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const upstream = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const result = (await upstream.json()) as Record<string, unknown>;
  if (!upstream.ok) {
    recordLoginFailure(rateKey);
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS" },
      { status: 401 },
    );
  }

  const baseUser = userFromSupabase((result.user ?? {}) as Record<string, unknown>);
  const authorizedUser = baseUser ? await hydrateStaffUser(baseUser, String(result.access_token)) : null;
  if (!authorizedUser) {
    recordLoginFailure(rateKey);
    return NextResponse.json(
      { code: "STAFF_ACCESS_DENIED" },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ ok: true, next: nextAuthenticatedPath(authorizedUser) });
  clearLoginFailures(rateKey);
  const cookieBase = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  response.cookies.set(authCookieNames.access, String(result.access_token), {
    ...cookieBase,
    maxAge: Number(result.expires_in ?? 3600),
  });
  response.cookies.set(authCookieNames.refresh, String(result.refresh_token), remember ? {
    ...cookieBase, maxAge: 60 * 60 * 24 * 30,
  } : cookieBase);
  return response;
}
