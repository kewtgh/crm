import { NextResponse } from "next/server";
import { AltchaConfigurationError, verifyAltchaPayload } from "@/lib/altcha-captcha";
import { ApiError, apiRoute } from "@/lib/api";
import {
  captchaActions,
  captchaFallbackReasons,
  type CaptchaAction,
  type CaptchaFallbackReason,
} from "@/lib/captcha-types";
import { mutationIsTrusted } from "@/lib/request-security";

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const search = new URL(request.url).searchParams;
  const action = search.get("action");
  const fallbackReason = search.get("reason");
  if (!action || !(captchaActions as readonly string[]).includes(action)) {
    throw new ApiError("CAPTCHA_ACTION_INVALID", 400);
  }
  if (!fallbackReason || !(captchaFallbackReasons as readonly string[]).includes(fallbackReason)) {
    throw new ApiError("CAPTCHA_FALLBACK_REASON_INVALID", 400);
  }
  const body = await request.json().catch(() => ({})) as { payload?: unknown };
  if (typeof body.payload !== "string") {
    return NextResponse.json({ verified: false, reason: "CAPTCHA_INVALID" });
  }
  try {
    const result = await verifyAltchaPayload(body.payload, request, undefined, undefined, {
      action: action as CaptchaAction,
      fallbackReason: fallbackReason as CaptchaFallbackReason,
    });
    if (!result.ok) {
      return NextResponse.json({ verified: false, reason: result.code });
    }
    return NextResponse.json({
      verified: true,
      payload: result.token,
    });
  } catch (error) {
    if (error instanceof AltchaConfigurationError) {
      throw new ApiError("CAPTCHA_NOT_CONFIGURED", 503);
    }
    throw error;
  }
}

export const POST = apiRoute(post, "CAPTCHA_VERIFICATION_FAILED");
