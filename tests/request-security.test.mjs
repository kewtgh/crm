import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

import { clearAuthSessionCookies } from "../lib/auth-session.ts";
import { loadCaptchaProviderConfiguration } from "../lib/captcha-configuration.ts";
import {
  mutationIsTrusted,
  originIsTrusted,
  preAuthMutationIsTrusted,
  sessionCsrfIsTrusted,
} from "../lib/request-security.ts";

const productionEnvironment = {
  NODE_ENV: "production",
  APP_URL: "https://crm.example.net",
};
const csrfToken = "csrf_token_value_that_is_at_least_32_chars";

function request({
  origin = "https://crm.example.net",
  fetchSite = "same-origin",
  omitOrigin = false,
  cookie,
  csrfHeader,
} = {}) {
  const headers = new Headers();
  if (!omitOrigin) headers.set("origin", origin);
  if (fetchSite !== undefined) headers.set("sec-fetch-site", fetchSite);
  if (cookie) headers.set("cookie", cookie);
  if (csrfHeader) headers.set("x-csrf-token", csrfHeader);
  return new Request("https://untrusted-forwarded-host.example/api/mutation", {
    method: "POST",
    headers,
  });
}

test("pre-auth mutations require the configured canonical production origin", () => {
  assert.equal(preAuthMutationIsTrusted(request(), productionEnvironment), true);
  assert.equal(originIsTrusted(request({ fetchSite: "cross-site" }), productionEnvironment), false);
  assert.equal(preAuthMutationIsTrusted(request({ origin: "https://attacker.example" }), productionEnvironment), false);
  assert.equal(preAuthMutationIsTrusted(request({ omitOrigin: true }), productionEnvironment), false);
  assert.equal(preAuthMutationIsTrusted(request({ origin: "null" }), productionEnvironment), false);
  assert.equal(preAuthMutationIsTrusted(request({ origin: "http://crm.example.net" }), productionEnvironment), false);
});

test("stale session cookies do not change the pre-auth trust boundary", () => {
  const stale = request({ cookie: "crm_session=fake-or-expired" });
  assert.equal(preAuthMutationIsTrusted(stale, productionEnvironment), true);
  assert.equal(sessionCsrfIsTrusted(stale), false);
  assert.equal(mutationIsTrusted(stale, productionEnvironment), false);
});

test("authenticated mutations require a valid matching CSRF cookie and header", () => {
  const matching = request({
    cookie: `crm_session=session-value; crm_csrf=${csrfToken}`,
    csrfHeader: csrfToken,
  });
  assert.equal(sessionCsrfIsTrusted(matching), true);
  assert.equal(mutationIsTrusted(matching, productionEnvironment), true);

  assert.equal(mutationIsTrusted(request({
    cookie: `crm_session=session-value; crm_csrf=${csrfToken}`,
    csrfHeader: `${csrfToken}x`,
  }), productionEnvironment), false);
  assert.equal(mutationIsTrusted(request({
    cookie: "crm_session=session-value; crm_csrf=short",
    csrfHeader: "short",
  }), productionEnvironment), false);
});

test("CAPTCHA provider configuration distinguishes disabled from unavailable", async () => {
  assert.deepEqual(await loadCaptchaProviderConfiguration(async () => false), {
    status: "ready",
    turnstileEnabled: false,
  });
  assert.deepEqual(await loadCaptchaProviderConfiguration(async () => true), {
    status: "ready",
    turnstileEnabled: true,
  });
  assert.deepEqual(await loadCaptchaProviderConfiguration(async () => {
    throw new Error("database details must not escape");
  }), {
    status: "unavailable",
    code: "CAPTCHA_CONFIGURATION_UNAVAILABLE",
  });
});

test("session cookie clearing matches the production issuance attributes", () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = NextResponse.json({ ok: true });
    clearAuthSessionCookies(response);
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 3);
    for (const name of ["crm_session", "crm_csrf", "crm_session_persistent"]) {
      const value = cookies.find((entry) => entry.startsWith(`${name}=`));
      assert.ok(value);
      assert.match(value, /Path=\//i);
      assert.match(value, /Max-Age=0/i);
      assert.match(value, /SameSite=lax/i);
      assert.match(value, /Secure/i);
    }
    assert.match(cookies.find((entry) => entry.startsWith("crm_session=")), /HttpOnly/i);
    assert.doesNotMatch(cookies.find((entry) => entry.startsWith("crm_csrf=")), /HttpOnly/i);
  } finally {
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
});
