import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ApiError, apiRoute } from "@/lib/api";
import { isMfaRequiredRole, nextAuthenticatedPath } from "@/lib/auth";
import { setAuthSessionCookies } from "@/lib/auth-session";
import {
  appUserFromIdentity,
  authenticateAccount,
  recordLoginEvent,
} from "@/lib/auth/accounts";
import { issueEmailToken } from "@/lib/auth/email-tokens";
import { createSession } from "@/lib/auth/session-store";
import { verifyCaptchaProof } from "@/lib/captcha";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  loginThrottleIdentity,
  recordLoginFailure,
} from "@/lib/login-rate-limit";
import { preAuthMutationIsTrusted } from "@/lib/request-security";
import {
  consumeTrustedDevice,
  createPendingDeviceVerification,
  pendingDeviceVerificationMaxAge,
  securityCookieNames,
} from "@/lib/trusted-devices";
import { loginSchema } from "@/lib/validation";

async function post(request: Request) {
  if (!preAuthMutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = loginSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0]?.message ?? "INVALID_INPUT", 400, "INVALID_INPUT", {
      field: String(parsed.error.issues[0]?.path[0] ?? "form"),
    });
  }

  const { identifier, password, remember, captchaProof } = parsed.data;
  const throttleIdentity = await loginThrottleIdentity(request, identifier);
  const limit = await checkLoginRateLimit(throttleIdentity);
  if (!limit.allowed) {
    throw new ApiError("TOO_MANY_ATTEMPTS", 429, "TOO_MANY_ATTEMPTS", undefined, {
      "Retry-After": String(limit.retryAfter),
    });
  }
  const captcha = await verifyCaptchaProof(captchaProof, request, "staff_login");
  if (!captcha.ok) {
    await recordLoginFailure(throttleIdentity);
    throw new ApiError(captcha.code, captcha.status, captcha.code, {
      field: "captcha",
      provider: captchaProof.provider,
      ...(captcha.fallbackReason ? { fallbackReason: captcha.fallbackReason } : {}),
    });
  }

  const identity = await authenticateAccount(identifier, password).catch(() => null);
  if (!identity) {
    await recordLoginFailure(throttleIdentity);
    await recordLoginEvent({ outcome: "FAILED", reason: "INVALID_CREDENTIALS", request }).catch(() => undefined);
    throw new ApiError("INVALID_CREDENTIALS", 401);
  }
  await clearLoginFailures(throttleIdentity);
  const user = appUserFromIdentity(identity);

  if (isMfaRequiredRole(user.role) || user.mfaEnabled) {
    const session = await createSession({
      userId: identity.id,
      passwordVersion: identity.passwordVersion,
      role: identity.role,
      persistent: remember,
      request,
    });
    const response = NextResponse.json({ ok: true, next: nextAuthenticatedPath(user) });
    setAuthSessionCookies(response, session);
    await recordLoginEvent({
      userId: identity.id,
      sessionId: session.id,
      outcome: "MFA_REQUIRED",
      request,
    }).catch(() => undefined);
    return response;
  }

  const cookieStore = await cookies();
  const trustedCookie = cookieStore.get(securityCookieNames.trustedDevice)?.value;
  if (await consumeTrustedDevice(identity.id, trustedCookie)) {
    const session = await createSession({
      userId: identity.id,
      passwordVersion: identity.passwordVersion,
      role: identity.role,
      persistent: remember,
      request,
    });
    const response = NextResponse.json({ ok: true, next: nextAuthenticatedPath(user) });
    setAuthSessionCookies(response, session);
    await recordLoginEvent({
      userId: identity.id,
      sessionId: session.id,
      outcome: "SUCCESS",
      reason: "TRUSTED_DEVICE",
      request,
    }).catch(() => undefined);
    return response;
  }

  await issueEmailToken({
    userId: identity.id,
    email: identity.email,
    purpose: "DEVICE_VERIFICATION",
    payload: { remember },
  }).catch(() => {
    throw new ApiError("EMAIL_VERIFICATION_UNAVAILABLE", 503);
  });
  const response = NextResponse.json({ ok: true, next: "/verify-device" });
  response.cookies.set(
    securityCookieNames.pendingDeviceVerification,
    await createPendingDeviceVerification(identity.id, remember),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: pendingDeviceVerificationMaxAge,
    },
  );
  if (trustedCookie) response.cookies.delete(securityCookieNames.trustedDevice);
  await recordLoginEvent({
    userId: identity.id,
    outcome: "DEVICE_VERIFICATION_REQUIRED",
    request,
  }).catch(() => undefined);
  return response;
}

export const POST = apiRoute(post, "LOGIN_FAILED");
