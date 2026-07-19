type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(token: string, request: Request, expectedAction?:string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim();
  if (!secret || (process.env.NODE_ENV === "production" && !expectedHostname)) return { ok: false as const, code: "TURNSTILE_NOT_CONFIGURED" };

  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  body.set("idempotency_key", crypto.randomUUID());
  const remoteIp = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false as const, code: "TURNSTILE_FAILED" };
    const result = (await response.json()) as TurnstileResult;
    if (!result.success || (expectedHostname && result.hostname !== expectedHostname) || (expectedAction&&result.action!==expectedAction)) {
      return { ok: false as const, code: "TURNSTILE_FAILED" };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, code: "TURNSTILE_UNAVAILABLE" };
  }
}
