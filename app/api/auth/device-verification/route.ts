import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ApiError, apiRoute } from "@/lib/api";
import { hydrateStaffUser, isMfaRequiredRole, nextAuthenticatedPath, userFromSupabase } from "@/lib/auth";
import { getStaffAccountEmail } from "@/lib/login-identity";
import { checkLoginRateLimit, clearLoginFailures, loginThrottleIdentity, recordLoginFailure } from "@/lib/login-rate-limit";
import { mutationIsTrusted } from "@/lib/request-security";
import {
  describeLoginDevice,
  readPendingDeviceVerification,
  registerTrustedDevice,
  securityCookieNames,
  trustedDeviceMaxAge,
} from "@/lib/trusted-devices";
import { deviceVerificationSchema } from "@/lib/validation";
import { setAuthSessionCookies } from "@/lib/auth-session";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

type OtpResult = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: Record<string, unknown>;
};

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = deviceVerificationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError("INVALID_DEVICE_CODE", 400, "INVALID_DEVICE_CODE", { field: "code" });
  }

  const cookieStore = await cookies();
  const pending = await readPendingDeviceVerification(
    cookieStore.get(securityCookieNames.pendingDeviceVerification)?.value,
  );
  if (!pending) throw new ApiError("DEVICE_VERIFICATION_EXPIRED", 401);

  const throttleIdentity = await loginThrottleIdentity(request, `device:${pending.userId}`);
  const limit = await checkLoginRateLimit(throttleIdentity);
  if (!limit.allowed) {
    throw new ApiError("TOO_MANY_ATTEMPTS", 429, "TOO_MANY_ATTEMPTS", undefined, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new ApiError("AUTH_NOT_CONFIGURED", 503);
  const email = await getStaffAccountEmail(pending.userId).catch(() => null);
  if (!email) throw new ApiError("DEVICE_VERIFICATION_EXPIRED", 401);

  const upstream = await fetchWithTimeout(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ type: "email", email, token: parsed.data.code }),
  }, 10_000).catch(() => {
    throw new ApiError("EMAIL_VERIFICATION_UNAVAILABLE", 503);
  });
  const result = (await upstream.json().catch(() => ({}))) as OtpResult;
  if (!upstream.ok || !result.access_token || !result.refresh_token) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError("INVALID_DEVICE_CODE", 400, "INVALID_DEVICE_CODE", { field: "code" });
  }

  const baseUser = userFromSupabase(result.user ?? {});
  const user = baseUser ? await hydrateStaffUser(baseUser, result.access_token) : null;
  if (!user || user.id !== pending.userId || isMfaRequiredRole(user.role)) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError("STAFF_ACCESS_DENIED", 403);
  }

  await clearLoginFailures(throttleIdentity);
  const response = NextResponse.json({ ok: true, next: nextAuthenticatedPath(user) });
  const cookieBase = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  setAuthSessionCookies(response, result, pending.remember);
  response.cookies.delete(securityCookieNames.pendingDeviceVerification);

  if (pending.remember && !user.mfaEnabled) {
    const trusted = await registerTrustedDevice(user.id, describeLoginDevice(request));
    response.cookies.set(securityCookieNames.trustedDevice, trusted.cookieValue, {
      ...cookieBase,
      maxAge: trustedDeviceMaxAge,
    });
  }
  return response;
}

export const POST = apiRoute(post, "DEVICE_VERIFICATION_FAILED");
