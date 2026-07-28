import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute } from "@/lib/api";
import { findAccountByIdentifier, updateAccountPassword } from "@/lib/auth/accounts";
import { consumeEmailToken, issueEmailToken } from "@/lib/auth/email-tokens";
import { applyAccountRecoveryRateLimit } from "@/lib/account-recovery-rate-limit";
import { verifyCaptchaProof } from "@/lib/captcha";
import { loginThrottleIdentity } from "@/lib/login-rate-limit";
import { mutationIsTrusted } from "@/lib/request-security";
import { passwordResetRequestSchema, passwordValueSchema } from "@/lib/validation";

const completionSchema = z.object({
  token: z.string().min(20).max(256),
  password: passwordValueSchema,
});

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const body = await request.json().catch(() => ({}));
  if (body && typeof body === "object" && "token" in body) {
    const parsed = completionSchema.safeParse(body);
    if (!parsed.success) throw new ApiError("INVALID_RESET_TOKEN", 400);
    const consumed = await consumeEmailToken(parsed.data.token, "PASSWORD_RESET");
    if (!consumed) throw new ApiError("INVALID_RESET_TOKEN", 400);
    await updateAccountPassword(consumed.user_id, parsed.data.password, {
      clearMustChange: true,
      revokeSessions: true,
    });
    return NextResponse.json({ ok: true, code: "PASSWORD_UPDATED" });
  }

  const parsed = passwordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(issue?.message ?? "INVALID_EMAIL", 400, issue?.message ?? "INVALID_EMAIL", {
      field: String(issue?.path[0] ?? "form"),
    });
  }
  const identity = await loginThrottleIdentity(request, parsed.data.email);
  const limit = await applyAccountRecoveryRateLimit(identity);
  if (!limit.allowed) {
    throw new ApiError("TOO_MANY_ATTEMPTS", 429, "TOO_MANY_ATTEMPTS", undefined, {
      "Retry-After": String(limit.retryAfter),
    });
  }
  const captcha = await verifyCaptchaProof(parsed.data.captchaProof, request, "password_recovery");
  if (!captcha.ok) {
    throw new ApiError(captcha.code, captcha.status, captcha.code, {
      field: "captcha",
      provider: parsed.data.captchaProof.provider,
      ...(captcha.fallbackReason ? { fallbackReason: captcha.fallbackReason } : {}),
    });
  }

  const account = await findAccountByIdentifier(parsed.data.email);
  if (account?.status === "ACTIVE") {
    await issueEmailToken({
      userId: account.id,
      email: account.email,
      purpose: "PASSWORD_RESET",
    }).catch(() => {
      throw new ApiError("AUTH_UNAVAILABLE", 502);
    });
  }
  return NextResponse.json({ ok: true, code: "RESET_SENT" });
}

export const POST = apiRoute(post, "PASSWORD_RESET_FAILED");
