import assert from "node:assert/strict";
import test from "node:test";

import { POST as login } from "../app/api/auth/login/route.ts";
import { POST as deviceVerification } from "../app/api/auth/device-verification/route.ts";
import { POST as passwordReset } from "../app/api/auth/password-reset/route.ts";
import { POST as sso } from "../app/api/auth/sso/route.ts";

process.env.APP_URL = "https://crm.example.net";

function staleSessionRequest(path, body = {}) {
  return new Request(`https://crm.example.net${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "crm_session=fake-or-expired",
      origin: "https://crm.example.net",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

test("stale session cookies do not block login before request validation", async () => {
  const response = await login(staleSessionRequest("/api/auth/login", {
    identifier: "staff@example.net",
    password: "password-value",
  }));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "CAPTCHA_REQUIRED");
  assert.notEqual(payload.code, "UNTRUSTED_ORIGIN");
});

test("stale session cookies do not block password recovery or reset", async () => {
  const recovery = await passwordReset(staleSessionRequest("/api/auth/password-reset", {
    email: "staff@example.net",
  }));
  assert.equal(recovery.status, 400);
  const recoveryPayload = await recovery.json();
  assert.equal(recoveryPayload.code, "CAPTCHA_REQUIRED");
  assert.notEqual(recoveryPayload.code, "UNTRUSTED_ORIGIN");

  const completion = await passwordReset(staleSessionRequest("/api/auth/password-reset", {
    token: "invalid-but-long-enough-reset-token",
    password: "invalid",
  }));
  assert.equal(completion.status, 400);
  assert.notEqual((await completion.json()).code, "UNTRUSTED_ORIGIN");
});

test("stale session cookies do not block SSO start or pending device verification", async () => {
  const ssoResponse = await sso(staleSessionRequest("/api/auth/sso", {
    email: "staff@example.net",
  }));
  assert.equal(ssoResponse.status, 400);
  assert.notEqual((await ssoResponse.json()).code, "UNTRUSTED_ORIGIN");

  const deviceResponse = await deviceVerification(staleSessionRequest(
    "/api/auth/device-verification",
    { code: "invalid" },
  ));
  assert.equal(deviceResponse.status, 400);
  assert.notEqual((await deviceResponse.json()).code, "UNTRUSTED_ORIGIN");
});
