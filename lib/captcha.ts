import {
  AltchaConfigurationError,
  consumeAltchaAttestation,
  durableCaptchaLifecycle,
  type CaptchaLifecycle,
} from "./altcha-captcha";
import type { CaptchaAction, CaptchaProof } from "./captcha-types";
import { loadTurnstileEnabled } from "./captcha-configuration";
import { verifyTurnstileToken } from "./turnstile";

export type CaptchaVerification =
  | { ok: true }
  | {
      ok: false;
      code:
        | "TURNSTILE_FAILED"
        | "TURNSTILE_UNAVAILABLE"
        | "TURNSTILE_NOT_CONFIGURED"
        | "TURNSTILE_DISABLED"
        | "CAPTCHA_INVALID"
        | "CAPTCHA_REPLAYED"
        | "CAPTCHA_NOT_CONFIGURED";
      status: 400 | 503;
      fallbackReason?: "service_unavailable" | "not_configured" | "administrator_disabled";
    };

export async function verifyCaptchaProof(
  proof: CaptchaProof,
  request: Request,
  action: CaptchaAction,
  dependencies: {
    lifecycle?: CaptchaLifecycle;
    turnstileFetch?: typeof fetch;
    turnstileEnabled?: boolean;
    now?: number;
  } = {},
): Promise<CaptchaVerification> {
  if (proof.provider === "turnstile") {
    let turnstileEnabled = dependencies.turnstileEnabled;
    if (turnstileEnabled === undefined) {
      try {
        turnstileEnabled = await loadTurnstileEnabled();
      } catch {
        return { ok: false, code: "CAPTCHA_NOT_CONFIGURED", status: 503 };
      }
    }
    if (!turnstileEnabled) {
      return {
        ok: false,
        code: "TURNSTILE_DISABLED",
        status: 400,
        fallbackReason: "administrator_disabled",
      };
    }
    const result = await verifyTurnstileToken(proof.token, request, action, {
      fetchImpl: dependencies.turnstileFetch,
    });
    if (result.ok) return result;
    if (result.code === "TURNSTILE_UNAVAILABLE") {
      return { ...result, status: 503, fallbackReason: "service_unavailable" };
    }
    if (result.code === "TURNSTILE_NOT_CONFIGURED") {
      return { ...result, status: 503, fallbackReason: "not_configured" };
    }
    return { ...result, status: 400 };
  }

  try {
    const result = await consumeAltchaAttestation(
      proof.token,
      request,
      action,
      dependencies.lifecycle ?? durableCaptchaLifecycle,
      dependencies.now,
    );
    return result.ok
      ? result
      : { ...result, status: 400 };
  } catch (error) {
    if (error instanceof AltchaConfigurationError) {
      return { ok: false, code: "CAPTCHA_NOT_CONFIGURED", status: 503 };
    }
    throw error;
  }
}
