import { createChallenge, randomInt, verifySolution, type Challenge, type Payload } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import {
  captchaActions,
  captchaFallbackReasons,
  type CaptchaAction,
  type CaptchaFallbackReason,
} from "./captcha-types";
import { loginThrottleIdentity } from "./login-rate-limit";
import { emitObservabilityEvent } from "./observability";
import { databaseSystemJson } from "./db/gateway";

const CHALLENGE_TTL_MS = 2 * 60 * 1_000;
const ATTESTATION_TTL_MS = 90 * 1_000;
const MAX_PAYLOAD_LENGTH = 32_768;

type AttestationClaims = {
  v: 1;
  provider: "altcha";
  challengeId: string;
  attestationId: string;
  action: CaptchaAction;
  fallbackReason: CaptchaFallbackReason;
  issuedAt: number;
  expiresAt: number;
};

export type CaptchaLifecycle = {
  issue: (challengeId: string, action: CaptchaAction, sourceHash: string, expiresAt: Date) => Promise<boolean>;
  markVerified: (
    challengeId: string,
    action: CaptchaAction,
    sourceHash: string,
    attestationId: string,
    expiresAt: Date,
  ) => Promise<boolean>;
  consume: (
    challengeId: string,
    action: CaptchaAction,
    sourceHash: string,
    attestationId: string,
  ) => Promise<boolean>;
};

export const durableCaptchaLifecycle: CaptchaLifecycle = {
  async issue(challengeId, action, sourceHash, expiresAt) {
    return databaseSystemJson<boolean>("/db/rpc/service_issue_captcha_challenge", {
      method: "POST",
      body: JSON.stringify({
        challenge_identifier: challengeId,
        challenge_action: action,
        challenge_source_hash: sourceHash,
        challenge_expires_at: expiresAt.toISOString(),
      }),
    });
  },
  async markVerified(challengeId, action, sourceHash, attestationId, expiresAt) {
    return databaseSystemJson<boolean>("/db/rpc/service_verify_captcha_challenge", {
      method: "POST",
      body: JSON.stringify({
        challenge_identifier: challengeId,
        challenge_action: action,
        challenge_source_hash: sourceHash,
        target_attestation_id: attestationId,
        target_attestation_expires_at: expiresAt.toISOString(),
      }),
    });
  },
  async consume(challengeId, action, sourceHash, attestationId) {
    return databaseSystemJson<boolean>("/db/rpc/service_consume_captcha_attestation", {
      method: "POST",
      body: JSON.stringify({
        challenge_identifier: challengeId,
        challenge_action: action,
        challenge_source_hash: sourceHash,
        target_attestation_id: attestationId,
      }),
    });
  },
};

export class AltchaConfigurationError extends Error {
  constructor() {
    super("ALTCHA_HMAC_SECRET_NOT_CONFIGURED");
  }
}

function requireMasterSecret() {
  const secret = process.env.ALTCHA_HMAC_SECRET?.trim();
  if (!secret || secret.length < 32) throw new AltchaConfigurationError();
  return secret;
}

function bytesToHex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function contextSecret(context: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(requireMasterSecret()),
    new TextEncoder().encode(`lumina-captcha:${context}`),
  );
  return bytesToHex(signature);
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - value.length % 4) % 4)}`;
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function sourceHashFor(request: Request, action: CaptchaAction) {
  return (await loginThrottleIdentity(request, `captcha:${action}`)).sourceHash;
}

function isAction(value: unknown): value is CaptchaAction {
  return typeof value === "string" && (captchaActions as readonly string[]).includes(value);
}

function isFallbackReason(value: unknown): value is CaptchaFallbackReason {
  return typeof value === "string" && (captchaFallbackReasons as readonly string[]).includes(value);
}

function decodeAltchaPayload(value: string): Payload | null {
  if (!value || value.length > MAX_PAYLOAD_LENGTH) return null;
  try {
    const decoded = JSON.parse(atob(value)) as Payload;
    if (
      !decoded
      || typeof decoded !== "object"
      || !decoded.challenge
      || typeof decoded.challenge !== "object"
      || !decoded.challenge.parameters
      || typeof decoded.challenge.parameters !== "object"
      || !decoded.solution
      || typeof decoded.solution !== "object"
    ) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function createAttestation(claims: AttestationClaims) {
  const encoded = encodeBase64Url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(await contextSecret("attestation")),
    new TextEncoder().encode(encoded),
  );
  return `${encoded}.${encodeBase64Url(String.fromCharCode(...new Uint8Array(signature)))}`;
}

async function readAttestation(token: string, now = Date.now()): Promise<AttestationClaims | null> {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || token.length > MAX_PAYLOAD_LENGTH) return null;
  try {
    const signatureBytes = Uint8Array.from(decodeBase64Url(signature), (character) => character.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(await contextSecret("attestation")),
      signatureBytes,
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;
    const claims = JSON.parse(decodeBase64Url(encoded)) as AttestationClaims;
    if (
      claims.v !== 1
      || claims.provider !== "altcha"
      || !isAction(claims.action)
      || !isFallbackReason(claims.fallbackReason)
      || !/^[0-9a-f-]{36}$/i.test(claims.challengeId)
      || !/^[0-9a-f-]{36}$/i.test(claims.attestationId)
      || !Number.isSafeInteger(claims.issuedAt)
      || !Number.isSafeInteger(claims.expiresAt)
      || claims.expiresAt <= now
      || claims.issuedAt > now + 30_000
    ) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function issueAltchaChallenge(
  request: Request,
  action: CaptchaAction,
  fallbackReason: CaptchaFallbackReason,
  lifecycle: CaptchaLifecycle = durableCaptchaLifecycle,
  options: { now?: number; challengeId?: string; counter?: number } = {},
) {
  const now = options.now ?? Date.now();
  const challengeId = options.challengeId ?? crypto.randomUUID();
  const expiresAt = new Date(now + CHALLENGE_TTL_MS);
  const sourceHash = await sourceHashFor(request, action);
  const [signatureSecret, keySignatureSecret] = await Promise.all([
    contextSecret("challenge-signature"),
    contextSecret("challenge-key-signature"),
  ]);
  const challenge = await createChallenge({
    algorithm: "PBKDF2/SHA-256",
    cost: 5_000,
    counter: options.counter ?? randomInt(5_000, 10_000),
    deriveKey,
    expiresAt,
    data: {
      provider: "altcha",
      challengeId,
      action,
      fallbackReason,
    },
    hmacSignatureSecret: signatureSecret,
    hmacKeySignatureSecret: keySignatureSecret,
  });
  if (!await lifecycle.issue(challengeId, action, sourceHash, expiresAt)) return null;
  return challenge;
}

export type AltchaVerificationResult =
  | { ok: true; token: string; action: CaptchaAction; fallbackReason: CaptchaFallbackReason }
  | { ok: false; code: "CAPTCHA_INVALID" | "CAPTCHA_EXPIRED" | "CAPTCHA_REPLAYED" };

export async function verifyAltchaPayload(
  payloadValue: string,
  request: Request,
  lifecycle: CaptchaLifecycle = durableCaptchaLifecycle,
  now = Date.now(),
  expected?: { action: CaptchaAction; fallbackReason: CaptchaFallbackReason },
): Promise<AltchaVerificationResult> {
  const startedAt = performance.now();
  const payload = decodeAltchaPayload(payloadValue);
  const data = payload?.challenge.parameters.data;
  const action = data?.action;
  const fallbackReason = data?.fallbackReason;
  const challengeId = data?.challengeId;
  const metricAction = isAction(action) ? action : expected?.action;
  const metricFallbackReason = isFallbackReason(fallbackReason) ? fallbackReason : expected?.fallbackReason;
  const emit = (result: "success" | "invalid" | "expired" | "replayed") => {
    if (!metricAction) return;
    void emitObservabilityEvent({
      name: "captcha.verification",
      provider: "altcha",
      action: metricAction,
      ...(metricFallbackReason ? { fallbackReason: metricFallbackReason } : {}),
      result,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  };
  if (
    !payload
    || !isAction(action)
    || !isFallbackReason(fallbackReason)
    || typeof challengeId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(challengeId)
    || (expected && (action !== expected.action || fallbackReason !== expected.fallbackReason))
  ) {
    emit("invalid");
    return { ok: false, code: "CAPTCHA_INVALID" };
  }

  const [signatureSecret, keySignatureSecret] = await Promise.all([
    contextSecret("challenge-signature"),
    contextSecret("challenge-key-signature"),
  ]);
  const verification = await verifySolution({
    challenge: payload.challenge,
    solution: payload.solution,
    deriveKey,
    hmacSignatureSecret: signatureSecret,
    hmacKeySignatureSecret: keySignatureSecret,
  });
  if (verification.expired || Number(payload.challenge.parameters.expiresAt ?? 0) * 1_000 <= now) {
    emit("expired");
    return { ok: false, code: "CAPTCHA_EXPIRED" };
  }
  if (!verification.verified) {
    emit("invalid");
    return { ok: false, code: "CAPTCHA_INVALID" };
  }

  const attestationId = crypto.randomUUID();
  const attestationExpiresAt = new Date(now + ATTESTATION_TTL_MS);
  const sourceHash = await sourceHashFor(request, action);
  if (!await lifecycle.markVerified(challengeId, action, sourceHash, attestationId, attestationExpiresAt)) {
    emit("replayed");
    return { ok: false, code: "CAPTCHA_REPLAYED" };
  }
  const token = await createAttestation({
    v: 1,
    provider: "altcha",
    challengeId,
    attestationId,
    action,
    fallbackReason,
    issuedAt: now,
    expiresAt: attestationExpiresAt.getTime(),
  });
  emit("success");
  return { ok: true, token, action, fallbackReason };
}

export async function consumeAltchaAttestation(
  token: string,
  request: Request,
  expectedAction: CaptchaAction,
  lifecycle: CaptchaLifecycle = durableCaptchaLifecycle,
  now = Date.now(),
) {
  const startedAt = performance.now();
  const claims = await readAttestation(token, now);
  const finish = (result: "success" | "invalid" | "expired" | "replayed") => {
    void emitObservabilityEvent({
      name: "captcha.verification",
      provider: "altcha",
      action: expectedAction,
      ...(claims?.fallbackReason ? { fallbackReason: claims.fallbackReason } : {}),
      result,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  };
  if (!claims) {
    finish("expired");
    return { ok: false as const, code: "CAPTCHA_INVALID" as const };
  }
  if (claims.action !== expectedAction) {
    finish("invalid");
    return { ok: false as const, code: "CAPTCHA_INVALID" as const };
  }
  const sourceHash = await sourceHashFor(request, expectedAction);
  if (!await lifecycle.consume(claims.challengeId, expectedAction, sourceHash, claims.attestationId)) {
    finish("replayed");
    return { ok: false as const, code: "CAPTCHA_REPLAYED" as const };
  }
  finish("success");
  return { ok: true as const };
}

export type { Challenge };
