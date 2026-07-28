import type { CaptchaAction } from "./captcha-types";
import { emitObservabilityEvent } from "./observability";

type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(
  token: string,
  request: Request,
  expectedAction: CaptchaAction = "staff_login",
  dependencies: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
) {
  const startedAt = performance.now();
  const finish = <const T extends { ok: boolean; code?: string }>(result: T, metricResult: "success" | "invalid" | "unavailable" | "not_configured") => {
    void emitObservabilityEvent({
      name: "captcha.verification",
      provider: "turnstile",
      action: expectedAction,
      result: metricResult,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return result;
  };
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim();
  if (!secret || (process.env.NODE_ENV === "production" && !expectedHostname)) {
    return finish({ ok: false as const, code: "TURNSTILE_NOT_CONFIGURED" }, "not_configured");
  }

  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  body.set("idempotency_key", crypto.randomUUID());
  const remoteIp = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await (dependencies.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(dependencies.timeoutMs ?? 8_000),
    });
    if (!response.ok) {
      return response.status >= 500
        ? finish({ ok: false as const, code: "TURNSTILE_UNAVAILABLE" }, "unavailable")
        : finish({ ok: false as const, code: "TURNSTILE_FAILED" }, "invalid");
    }
    const result = (await response.json()) as TurnstileResult;
    const localTestKey = secret === "1x0000000000000000000000000000000AA"
      && expectedHostname === "localhost";
    if (
      !result.success
      || (!localTestKey && expectedHostname && result.hostname !== expectedHostname)
      || (!localTestKey && expectedAction && result.action !== expectedAction)
    ) {
      return finish({ ok: false as const, code: "TURNSTILE_FAILED" }, "invalid");
    }
    return finish({ ok: true as const }, "success");
  } catch {
    return finish({ ok: false as const, code: "TURNSTILE_UNAVAILABLE" }, "unavailable");
  }
}
