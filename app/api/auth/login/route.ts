import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authCookieNames, hydrateStaffUser, isMfaRequiredRole, nextAuthenticatedPath, userFromSupabase } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { checkLoginRateLimit, clearLoginFailures, loginThrottleIdentity, recordLoginFailure } from "@/lib/login-rate-limit";
import { mutationIsTrusted } from "@/lib/request-security";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { ApiError, apiRoute } from "@/lib/api";
import { resolveStaffLoginEmail } from "@/lib/login-identity";
import {
  consumeTrustedDevice,
  createPendingDeviceVerification,
  pendingDeviceVerificationMaxAge,
  securityCookieNames,
} from "@/lib/trusted-devices";

type PasswordResult = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: Record<string, unknown>;
};

function setSessionCookies(response: NextResponse, result: PasswordResult, persistent: boolean) {
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
  response.cookies.set(authCookieNames.refresh, String(result.refresh_token), persistent ? {
    ...cookieBase, maxAge: 60 * 60 * 24 * 30,
  } : cookieBase);
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = loginSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message ?? "INVALID_INPUT", 400, "INVALID_INPUT", {
      field: String(parsed.error.issues[0]?.path[0] ?? "form"),
    });
  }

  const { identifier, password, remember, turnstileToken } = parsed.data;
  const throttleIdentity = await loginThrottleIdentity(request, identifier);
  const limit = await checkLoginRateLimit(throttleIdentity);
  if (!limit.allowed) {
    throw new ApiError("TOO_MANY_ATTEMPTS", 429, "TOO_MANY_ATTEMPTS", undefined, {
      "Retry-After": String(limit.retryAfter),
    });
  }
  const turnstile = await verifyTurnstileToken(turnstileToken, request,"staff_login");
  if (!turnstile.ok) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError(turnstile.code, turnstile.code === "TURNSTILE_NOT_CONFIGURED" ? 503 : 400, turnstile.code, { field: "turnstile" });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new ApiError("AUTH_NOT_CONFIGURED", 503);
  }
  const email = await resolveStaffLoginEmail(identifier).catch(() => null);

  const upstream = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email: email ?? `${crypto.randomUUID()}@invalid.local`, password }),
  });
  const result = (await upstream.json()) as PasswordResult;
  if (!upstream.ok || !email || !result.access_token || !result.refresh_token) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError("INVALID_CREDENTIALS", 401);
  }

  const baseUser = userFromSupabase(result.user ?? {});
  const authorizedUser = baseUser ? await hydrateStaffUser(baseUser, result.access_token) : null;
  if (!authorizedUser) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError("STAFF_ACCESS_DENIED", 403);
  }

  await clearLoginFailures(throttleIdentity);

  if (isMfaRequiredRole(authorizedUser.role) || authorizedUser.mfaEnabled) {
    const response = NextResponse.json({ ok: true, next: nextAuthenticatedPath(authorizedUser) });
    setSessionCookies(response, result, remember);
    if (remember && authorizedUser.aal !== "aal2") {
      response.cookies.set(securityCookieNames.mfaRemember, "1", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/api/settings/mfa",
        maxAge: pendingDeviceVerificationMaxAge,
      });
    }
    return response;
  }

  const cookieStore = await cookies();
  const trustedCookie = cookieStore.get(securityCookieNames.trustedDevice)?.value;
  if (await consumeTrustedDevice(authorizedUser.id, trustedCookie)) {
    const response = NextResponse.json({ ok: true, next: nextAuthenticatedPath(authorizedUser) });
    setSessionCookies(response, result, remember);
    return response;
  }

  const otpResponse = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, create_user: false }),
  });
  if (!otpResponse.ok) throw new ApiError("EMAIL_VERIFICATION_UNAVAILABLE", 503);

  const response = NextResponse.json({ ok: true, next: "/verify-device" });
  response.cookies.set(
    securityCookieNames.pendingDeviceVerification,
    await createPendingDeviceVerification(authorizedUser.id, remember),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: pendingDeviceVerificationMaxAge,
    },
  );
  response.cookies.delete(authCookieNames.access);
  response.cookies.delete(authCookieNames.refresh);
  if (trustedCookie) response.cookies.delete(securityCookieNames.trustedDevice);
  return response;
}

export const POST = apiRoute(post, "LOGIN_FAILED");
