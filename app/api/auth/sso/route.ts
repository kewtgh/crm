import { NextResponse } from "next/server";
import { ApiError, apiRoute } from "@/lib/api";
import { createEnterpriseSsoState, enterpriseSsoConfiguration, enterpriseSsoCookie, enterpriseSsoMaxAge } from "@/lib/enterprise-identity";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { checkLoginRateLimit, loginThrottleIdentity, recordLoginFailure } from "@/lib/login-rate-limit";
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
  if (!limit.allowed) throw new ApiError("TOO_MANY_ATTEMPTS", 429, "TOO_MANY_ATTEMPTS", undefined, { "Retry-After": String(limit.retryAfter) });
  // Password and SSO share one visible login challenge, so both verify the
  // widget's stable staff_login action while remaining separate server flows.
  const captcha = await verifyCaptchaProof(parsed.data.captchaProof, request, "staff_login");
  if (!captcha.ok) {
    await recordLoginFailure(identity);
    throw new ApiError(captcha.code, captcha.status, captcha.code, {
      field: "captcha",
      provider: parsed.data.captchaProof.provider,
      ...(captcha.fallbackReason ? { fallbackReason: captcha.fallbackReason } : {}),
    });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const appUrl = applicationOrigin(request.url);
  if (!supabaseUrl || !anonKey) throw new ApiError("SSO_NOT_CONFIGURED", 503);
  const state = await createEnterpriseSsoState();
  const upstream = await fetchWithTimeout(`${supabaseUrl}/auth/v1/sso`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({
      domain,
      redirect_to: `${appUrl}/api/auth/sso/callback`,
      skip_http_redirect: true,
      code_challenge: state.challenge,
      code_challenge_method: "s256",
    }),
  }, 10_000).catch(() => { throw new ApiError("SSO_UNAVAILABLE", 503); });
  const result = await upstream.json().catch(() => ({})) as { url?: string };
  if (!upstream.ok || !result.url) {
    await recordLoginFailure(identity);
    throw new ApiError("SSO_PROVIDER_REJECTED", upstream.status >= 500 ? 503 : 403);
  }
  const providerUrl = new URL(result.url);
  if (providerUrl.protocol !== "https:") throw new ApiError("SSO_PROVIDER_REJECTED", 502);
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
