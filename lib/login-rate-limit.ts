type Attempt = { count: number; resetAt: number };

const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function loginRateLimitKey(request: Request, email: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("cf-connecting-ip") ?? forwarded ?? "unknown";
  return `${ip}:${email.trim().toLowerCase()}`;
}

export function checkLoginRateLimit(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) { attempts.set(key, { count: 0, resetAt: now + WINDOW_MS }); return { allowed: true, retryAfter: 0 }; }
  return { allowed: current.count < MAX_ATTEMPTS, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

export function recordLoginFailure(key: string) {
  const current = attempts.get(key) ?? { count: 0, resetAt: Date.now() + WINDOW_MS };
  current.count += 1; attempts.set(key, current);
}

export function clearLoginFailures(key: string) { attempts.delete(key); }
