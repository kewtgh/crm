import { NextResponse } from "next/server";
import { AltchaConfigurationError, issueAltchaChallenge } from "@/lib/altcha-captcha";
import {
  captchaActions,
  captchaFallbackReasons,
  type CaptchaAction,
  type CaptchaFallbackReason,
} from "@/lib/captcha-types";
import { ApiError, apiRoute } from "@/lib/api";

async function get(request: Request) {
  const search = new URL(request.url).searchParams;
  const action = search.get("action");
  const fallbackReason = search.get("reason");
  if (!action || !(captchaActions as readonly string[]).includes(action)) {
    throw new ApiError("CAPTCHA_ACTION_INVALID", 400);
  }
  if (!fallbackReason || !(captchaFallbackReasons as readonly string[]).includes(fallbackReason)) {
    throw new ApiError("CAPTCHA_FALLBACK_REASON_INVALID", 400);
  }
  try {
    const challenge = await issueAltchaChallenge(
      request,
      action as CaptchaAction,
      fallbackReason as CaptchaFallbackReason,
    );
    if (!challenge) {
      throw new ApiError("CAPTCHA_CHALLENGE_RATE_LIMITED", 429, "CAPTCHA_CHALLENGE_RATE_LIMITED", undefined, {
        "Retry-After": "60",
      });
    }
    return NextResponse.json(challenge, {
      headers: {
        "cache-control": "no-store, max-age=0",
        pragma: "no-cache",
      },
    });
  } catch (error) {
    if (error instanceof AltchaConfigurationError) {
      throw new ApiError("CAPTCHA_NOT_CONFIGURED", 503);
    }
    throw error;
  }
}

export const GET = apiRoute(get, "CAPTCHA_CHALLENGE_FAILED");
