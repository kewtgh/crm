import assert from "node:assert/strict";
import test from "node:test";
import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";

import {
  consumeAltchaAttestation,
  issueAltchaChallenge,
  verifyAltchaPayload,
} from "../lib/altcha-captcha.ts";
import { verifyCaptchaProof } from "../lib/captcha.ts";
import { fallbackFromTurnstile } from "../lib/captcha-types.ts";
import { verifyTurnstileToken } from "../lib/turnstile.ts";
import { POST as verifyCaptchaRoute } from "../app/api/captcha/verify/route.ts";

process.env.ALTCHA_HMAC_SECRET = "altcha-test-secret-is-independent-and-at-least-32-bytes";
process.env.LOGIN_THROTTLE_HASH_SECRET = "captcha-source-hash-secret-is-also-independent";
process.env.OBSERVABILITY_SAMPLE_RATE = "0";
process.env.APP_URL = "https://crm.example.net";

function request(ip = "203.0.113.20") {
  return new Request("https://crm.example.net/api/captcha/verify", {
    headers: {
      "cf-connecting-ip": ip,
      origin: "https://crm.example.net",
    },
  });
}

function lifecycle() {
  const rows = new Map();
  return {
    rows,
    async issue(challengeId, action, sourceHash, expiresAt) {
      if (rows.has(challengeId)) return false;
      rows.set(challengeId, { action, sourceHash, expiresAt, attestationId: null, consumed: false });
      return true;
    },
    async markVerified(challengeId, action, sourceHash, attestationId, expiresAt) {
      const row = rows.get(challengeId);
      if (!row || row.action !== action || row.sourceHash !== sourceHash || row.attestationId) return false;
      row.attestationId = attestationId;
      row.attestationExpiresAt = expiresAt;
      return true;
    },
    async consume(challengeId, action, sourceHash, attestationId) {
      const row = rows.get(challengeId);
      if (
        !row
        || row.action !== action
        || row.sourceHash !== sourceHash
        || row.attestationId !== attestationId
        || row.consumed
      ) return false;
      row.consumed = true;
      return true;
    },
  };
}

async function solvedPayload(challenge) {
  const solution = await solveChallenge({
    challenge,
    deriveKey,
    timeout: 10_000,
  });
  assert.ok(solution, "ALTCHA test challenge should be solvable");
  return btoa(JSON.stringify({
    challenge: {
      parameters: challenge.parameters,
      signature: challenge.signature,
    },
    solution,
  }));
}

test("accepts a successful Turnstile verification", async () => {
  process.env.TURNSTILE_SECRET_KEY = "turnstile-test-secret";
  process.env.TURNSTILE_EXPECTED_HOSTNAME = "crm.example.net";
  const result = await verifyTurnstileToken("turnstile-token", request(), "staff_login", {
    fetchImpl: async () => Response.json({
      success: true,
      hostname: "crm.example.net",
      action: "staff_login",
    }),
  });
  assert.deepEqual(result, { ok: true });
});

test("fails closed and requests local fallback when Turnstile is unreachable", async () => {
  const result = await verifyCaptchaProof(
    { provider: "turnstile", token: "turnstile-token" },
    request(),
    "staff_login",
    {
      turnstileEnabled: true,
      turnstileFetch: async () => { throw new Error("network unavailable"); },
    },
  );
  assert.deepEqual(result, {
    ok: false,
    code: "TURNSTILE_UNAVAILABLE",
    status: 503,
    fallbackReason: "service_unavailable",
  });
});

test("rejects stale Turnstile proofs when administrators enforce ALTCHA", async () => {
  const result = await verifyCaptchaProof(
    { provider: "turnstile", token: "turnstile-token" },
    request(),
    "staff_login",
    { turnstileEnabled: false },
  );
  assert.deepEqual(result, {
    ok: false,
    code: "TURNSTILE_DISABLED",
    status: 400,
    fallbackReason: "administrator_disabled",
  });
});

test("maps Turnstile script failures and seven-second load timeout to ALTCHA", () => {
  assert.deepEqual(fallbackFromTurnstile("script_error"), {
    provider: "altcha",
    fallbackReason: "script_load_failed",
  });
  assert.deepEqual(fallbackFromTurnstile("load_timeout"), {
    provider: "altcha",
    fallbackReason: "load_timeout",
  });
});

test("accepts and then atomically consumes a self-hosted ALTCHA proof", async () => {
  const store = lifecycle();
  const challenge = await issueAltchaChallenge(request(), "staff_login", "load_timeout", store, {
    counter: 1,
  });
  assert.ok(challenge);
  const verification = await verifyAltchaPayload(await solvedPayload(challenge), request(), store);
  assert.equal(verification.ok, true);
  const first = await consumeAltchaAttestation(verification.token, request(), "staff_login", store);
  assert.deepEqual(first, { ok: true });
  const replay = await consumeAltchaAttestation(verification.token, request(), "staff_login", store);
  assert.deepEqual(replay, { ok: false, code: "CAPTCHA_REPLAYED" });
});

test("rejects tampered, expired, and repeated ALTCHA challenges", async () => {
  const store = lifecycle();
  const challenge = await issueAltchaChallenge(request(), "password_recovery", "component_error", store, {
    counter: 1,
  });
  assert.ok(challenge);
  const payload = await solvedPayload(challenge);
  const decoded = JSON.parse(atob(payload));
  decoded.solution.derivedKey = `${decoded.solution.derivedKey.slice(0, -1)}${decoded.solution.derivedKey.endsWith("0") ? "1" : "0"}`;
  const tampered = await verifyAltchaPayload(btoa(JSON.stringify(decoded)), request(), store);
  assert.deepEqual(tampered, { ok: false, code: "CAPTCHA_INVALID" });

  const repeatedStore = lifecycle();
  const repeatedChallenge = await issueAltchaChallenge(request(), "staff_login", "load_timeout", repeatedStore, {
    counter: 1,
  });
  const repeatedPayload = await solvedPayload(repeatedChallenge);
  assert.equal((await verifyAltchaPayload(repeatedPayload, request(), repeatedStore)).ok, true);
  assert.deepEqual(await verifyAltchaPayload(repeatedPayload, request(), repeatedStore), {
    ok: false,
    code: "CAPTCHA_REPLAYED",
  });

  const expiredStore = lifecycle();
  const expiredNow = Date.now() - 3 * 60 * 1_000;
  const expiredChallenge = await issueAltchaChallenge(request(), "staff_login", "load_timeout", expiredStore, {
    now: expiredNow,
    counter: 1,
  });
  const expired = await verifyAltchaPayload(await solvedPayload(expiredChallenge), request(), expiredStore);
  assert.deepEqual(expired, { ok: false, code: "CAPTCHA_EXPIRED" });
});

test("ALTCHA HTTP verification ignores stale sessions but still rejects cross-site requests", async () => {
  const sameOrigin = await verifyCaptchaRoute(new Request(
    "https://crm.example.net/api/captcha/verify?action=staff_login&reason=administrator_disabled",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "crm_session=fake-or-expired",
        origin: "https://crm.example.net",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ payload: "invalid-altcha-payload" }),
    },
  ));
  assert.equal(sameOrigin.status, 200);
  assert.deepEqual(await sameOrigin.json(), { verified: false, reason: "CAPTCHA_INVALID" });

  const crossSite = await verifyCaptchaRoute(new Request(
    "https://crm.example.net/api/captcha/verify?action=staff_login&reason=administrator_disabled",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "crm_session=fake-or-expired",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ payload: "invalid-altcha-payload" }),
    },
  ));
  assert.equal(crossSite.status, 403);
  assert.equal((await crossSite.json()).code, "UNTRUSTED_ORIGIN");
});

test("ALTCHA challenge lifecycle succeeds with a stale session cookie and remains single-use", async () => {
  const store = lifecycle();
  const staleSessionRequest = new Request("https://crm.example.net/api/captcha/verify", {
    headers: {
      cookie: "crm_session=fake-or-expired",
      "cf-connecting-ip": "203.0.113.20",
      origin: "https://crm.example.net",
    },
  });
  const challenge = await issueAltchaChallenge(
    staleSessionRequest,
    "staff_login",
    "administrator_disabled",
    store,
    { counter: 1 },
  );
  assert.ok(challenge);
  const verification = await verifyAltchaPayload(
    await solvedPayload(challenge),
    staleSessionRequest,
    store,
  );
  assert.equal(verification.ok, true);
  assert.deepEqual(
    await consumeAltchaAttestation(verification.token, staleSessionRequest, "staff_login", store),
    { ok: true },
  );
  assert.deepEqual(
    await consumeAltchaAttestation(verification.token, staleSessionRequest, "staff_login", store),
    { ok: false, code: "CAPTCHA_REPLAYED" },
  );
});
