import { NextResponse } from "next/server";
import { ApiError, apiRoute } from "@/lib/api";
import {
  createEnterpriseSsoState,
  enterpriseSsoConfiguration,
  enterpriseSsoCookie,
  enterpriseSsoMaxAge,
} from "@/lib/enterprise-identity";
import {
  checkLoginRateLimit,
  loginThrottleIdentity,
  recordLoginFailure,
} from "@/lib/login-rate-limit";
import { mutationIsTrusted } from "@/lib/request-security";
import { verifyCaptchaProof } from "@/lib/captcha";
import { applicationOrigin } from "@/lib/application-origin.mjs";
import { ssoStartSchema } from "@/lib/validation";

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = ssoStartSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_SSO_EMAIL", 400, "INVALID_SSO_EMAIL", { field: "email" });
  const email = parsed.data.email.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const configuration = enterpriseSsoConfiguration();
  if (!configuration.enabled) throw new ApiError("SSO_NOT_CONFIGURED", 503);
  if (!configuration.domains.includes(domain)) throw new ApiError("SSO_DOMAIN_NOT_ALLOWED", 403);
  const identity = await loginThrottleIdentity(request, email);
  const limit = await checkLoginRateLimit(identity);
  if (!limit.allowed) {
    throw new ApiError("TOO_MANY_ATTEMPTS", 429, "TOO_MANY_ATTEMPTS", undefined, {
      "Retry-After": String(limit.retryAfter),
    });
  }
  const captcha = await verifyCaptchaProof(parsed.data.captchaProof, request, "staff_login");
  if (!captcha.ok) {
    await recordLoginFailure(identity);
    throw new ApiError(captcha.code, captcha.status, captcha.code, {
      field: "captcha",
      provider: parsed.data.captchaProof.provider,
      ...(captcha.fallbackReason ? { fallbackReason: captcha.fallbackReason } : {}),
    });
  }

  const state = await createEnterpriseSsoState(email);
  const callback = new URL("/api/auth/sso/callback", applicationOrigin(request.url)).toString();
  const providerUrl = new URL(configuration.authorizationUrl);
  providerUrl.searchParams.set("client_id", configuration.clientId);
  providerUrl.searchParams.set("redirect_uri", callback);
  providerUrl.searchParams.set("response_type", "code");
  providerUrl.searchParams.set("scope", "openid email profile");
  providerUrl.searchParams.set("state", state.state);
  providerUrl.searchParams.set("nonce", state.nonce);
  providerUrl.searchParams.set("code_challenge", state.challenge);
  providerUrl.searchParams.set("code_challenge_method", "S256");
  providerUrl.searchParams.set("login_hint", email);
  const response = NextResponse.json({ url: providerUrl.toString() });
  response.cookies.set(enterpriseSsoCookie, state.cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/sso/callback",
    maxAge: enterpriseSsoMaxAge,
  });
  return response;
}

export const POST = apiRoute(post, "SSO_START_FAILED");
