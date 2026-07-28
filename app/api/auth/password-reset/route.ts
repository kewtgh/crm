import { NextResponse } from "next/server";
import { passwordResetRequestSchema } from "@/lib/validation";
import { mutationIsTrusted } from "@/lib/request-security";
import { ApiError, apiRoute } from "@/lib/api";
import { loginThrottleIdentity } from "@/lib/login-rate-limit";
import { applyAccountRecoveryRateLimit } from "@/lib/account-recovery-rate-limit";
import { verifyCaptchaProof } from "@/lib/captcha";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { applicationOrigin } from "@/lib/application-origin.mjs";

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = passwordResetRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    const issue=parsed.error.issues[0];
    throw new ApiError(issue?.message ?? "INVALID_EMAIL", 400, issue?.message ?? "INVALID_EMAIL", { field: String(issue?.path[0]??"form") });
  }
  const identity=await loginThrottleIdentity(request,parsed.data.email);
  const limit=await applyAccountRecoveryRateLimit(identity);
  if(!limit.allowed)throw new ApiError("TOO_MANY_ATTEMPTS",429,"TOO_MANY_ATTEMPTS",undefined,{"Retry-After":String(limit.retryAfter)});
  const captcha=await verifyCaptchaProof(parsed.data.captchaProof,request,"password_recovery");
  if(!captcha.ok)throw new ApiError(captcha.code,captcha.status,captcha.code,{
    field:"captcha",
    provider:parsed.data.captchaProof.provider,
    ...(captcha.fallbackReason?{fallbackReason:captcha.fallbackReason}:{}),
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new ApiError("AUTH_NOT_CONFIGURED", 503);
  }

  const origin = applicationOrigin(request.url);
  try {
    const upstream = await fetchWithTimeout(`${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(`${origin}/reset-password`)}`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: parsed.data.email }),
    }, 10_000);
    if(upstream.status===429){
      const retryAfter=upstream.headers.get("retry-after")??"60";
      throw new ApiError("TOO_MANY_ATTEMPTS",429,"TOO_MANY_ATTEMPTS",undefined,{"Retry-After":retryAfter});
    }
    if (upstream.status >= 500) throw new Error("AUTH_UNAVAILABLE");
  } catch(error) {
    if(error instanceof ApiError)throw error;
    throw new ApiError("AUTH_UNAVAILABLE", 502);
  }

  return NextResponse.json({
    ok: true,
    code: "RESET_SENT",
  });
}

export const POST = apiRoute(post, "PASSWORD_RESET_FAILED");
