import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ApiError, apiRoute } from "@/lib/api";
import { isMfaRequiredRole, nextAuthenticatedPath } from "@/lib/auth";
import { setAuthSessionCookies } from "@/lib/auth-session";
import { appUserFromIdentity, findAccountById, recordLoginEvent } from "@/lib/auth/accounts";
import { consumeEmailToken } from "@/lib/auth/email-tokens";
import { createSession } from "@/lib/auth/session-store";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  loginThrottleIdentity,
  recordLoginFailure,
} from "@/lib/login-rate-limit";
import { mutationIsTrusted } from "@/lib/request-security";
import {
  describeLoginDevice,
  readPendingDeviceVerification,
  registerTrustedDevice,
  securityCookieNames,
  trustedDeviceMaxAge,
} from "@/lib/trusted-devices";
import { deviceVerificationSchema } from "@/lib/validation";

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = deviceVerificationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_DEVICE_CODE", 400, "INVALID_DEVICE_CODE", { field: "code" });

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

  const consumed = await consumeEmailToken(parsed.data.code, "DEVICE_VERIFICATION");
  if (!consumed || consumed.user_id !== pending.userId) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError("INVALID_DEVICE_CODE", 400, "INVALID_DEVICE_CODE", { field: "code" });
  }
  const identity = await findAccountById(pending.userId);
  if (!identity || identity.status !== "ACTIVE" || isMfaRequiredRole(identity.role)) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError("STAFF_ACCESS_DENIED", 403);
  }
  await clearLoginFailures(throttleIdentity);
  const user = appUserFromIdentity(identity);
  const session = await createSession({
    userId: identity.id,
    passwordVersion: identity.passwordVersion,
    persistent: pending.remember,
    request,
  });
  const response = NextResponse.json({ ok: true, next: nextAuthenticatedPath(user) });
  setAuthSessionCookies(response, session);
  response.cookies.delete(securityCookieNames.pendingDeviceVerification);

  if (pending.remember && !user.mfaEnabled) {
    const trusted = await registerTrustedDevice(user.id, describeLoginDevice(request));
    response.cookies.set(securityCookieNames.trustedDevice, trusted.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: trustedDeviceMaxAge,
    });
  }
  await recordLoginEvent({
    userId: identity.id,
    sessionId: session.id,
    outcome: "SUCCESS",
    reason: "DEVICE_VERIFIED",
    request,
  }).catch(() => undefined);
  return response;
}

export const POST = apiRoute(post, "DEVICE_VERIFICATION_FAILED");
