import { supabaseAdminJson } from "./supabase-server";
import { requireLoginThrottleSecret } from "./runtime-environment";

type Attempt = { count: number; resetAt: number };
export type LoginThrottleIdentity = {
  accountHash: string;
  sourceHash: string;
  fallbackKey: string;
};
type LoginThrottleResult = { allowed: boolean; retryAfterSeconds?: number };
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

async function protectedHash(value: string) {
  const secret = requireLoginThrottleSecret();
  const encoded = new TextEncoder().encode(value);
  if (!secret) {
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loginThrottleIdentity(request: Request, email: string): Promise<LoginThrottleIdentity> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("cf-connecting-ip") ?? forwarded ?? "unknown";
  const normalizedEmail = email.trim().toLowerCase();
  const [accountHash, sourceHash] = await Promise.all([
    protectedHash(normalizedEmail),
    protectedHash(ip),
  ]);
  return { accountHash, sourceHash, fallbackKey: `${ip}:${normalizedEmail}` };
}

function hasDurableThrottle() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function durableThrottle(identity: LoginThrottleIdentity, action: "CHECK" | "FAILURE" | "SUCCESS") {
  const result = await supabaseAdminJson<LoginThrottleResult>("/rest/v1/rpc/apply_login_throttle", {
    method: "POST",
    body: JSON.stringify({
      account_hash: identity.accountHash,
      source_hash: identity.sourceHash,
      throttle_action: action,
    }),
  });
  return {
    allowed: result.allowed,
    retryAfter: Math.max(0, Number(result.retryAfterSeconds ?? 0)),
  };
}

function checkMemoryThrottle(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) { attempts.set(key, { count: 0, resetAt: now + WINDOW_MS }); return { allowed: true, retryAfter: 0 }; }
  return { allowed: current.count < MAX_ATTEMPTS, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

function recordMemoryFailure(key: string) {
  const current = attempts.get(key) ?? { count: 0, resetAt: Date.now() + WINDOW_MS };
  current.count += 1; attempts.set(key, current);
}

export async function checkLoginRateLimit(identity: LoginThrottleIdentity) {
  return hasDurableThrottle() ? durableThrottle(identity, "CHECK") : checkMemoryThrottle(identity.fallbackKey);
}

export async function recordLoginFailure(identity: LoginThrottleIdentity) {
  if (hasDurableThrottle()) return durableThrottle(identity, "FAILURE");
  recordMemoryFailure(identity.fallbackKey);
  return checkMemoryThrottle(identity.fallbackKey);
}

export async function clearLoginFailures(identity: LoginThrottleIdentity) {
  if (hasDurableThrottle()) {
    await durableThrottle(identity, "SUCCESS");
    return;
  }
  attempts.delete(identity.fallbackKey);
}
