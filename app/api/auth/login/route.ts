import { NextResponse } from "next/server";
import { authCookieNames, hydrateStaffUser, nextAuthenticatedPath, userFromSupabase } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { checkLoginRateLimit, clearLoginFailures, loginThrottleIdentity, recordLoginFailure } from "@/lib/login-rate-limit";
import { mutationIsTrusted } from "@/lib/request-security";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { ApiError, apiRoute } from "@/lib/api";

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = loginSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message ?? "INVALID_INPUT", 400, "INVALID_INPUT", {
      field: String(parsed.error.issues[0]?.path[0] ?? "form"),
    });
  }

  const { email, password, remember, turnstileToken } = parsed.data;
  const throttleIdentity = await loginThrottleIdentity(request, email);
  const limit = await checkLoginRateLimit(throttleIdentity);
  if (!limit.allowed) {
    throw new ApiError("TOO_MANY_ATTEMPTS", 429, "TOO_MANY_ATTEMPTS", undefined, {
      "Retry-After": String(limit.retryAfter),
    });
  }
  const turnstile = await verifyTurnstileToken(turnstileToken, request);
  if (!turnstile.ok) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError(turnstile.code, turnstile.code === "TURNSTILE_NOT_CONFIGURED" ? 503 : 400, turnstile.code, { field: "turnstile" });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new ApiError("AUTH_NOT_CONFIGURED", 503);
  }

  const upstream = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const result = (await upstream.json()) as Record<string, unknown>;
  if (!upstream.ok) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError("INVALID_CREDENTIALS", 401);
  }

  const baseUser = userFromSupabase((result.user ?? {}) as Record<string, unknown>);
  const authorizedUser = baseUser ? await hydrateStaffUser(baseUser, String(result.access_token)) : null;
  if (!authorizedUser) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError("STAFF_ACCESS_DENIED", 403);
  }

  const response = NextResponse.json({ ok: true, next: nextAuthenticatedPath(authorizedUser) });
  await clearLoginFailures(throttleIdentity);
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

export const POST = apiRoute(post, "LOGIN_FAILED");
