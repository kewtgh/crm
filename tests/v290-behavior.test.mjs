import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applicationOrigin,
  configuredSupabaseOrigin,
  secureEndpointOrigin,
} from "../lib/application-origin.mjs";
import { createSingleFlight } from "../lib/single-flight.mjs";
import { mutationIsTrusted } from "../lib/request-security.ts";
import { inspectCoreRuntimeEnvironment } from "../lib/runtime-environment.ts";
import { compensatedScimVersion } from "../lib/scim-compensation.mjs";

const validEnvironment = {
  NODE_ENV: "production",
  APP_URL: "https://crm.example.net",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site-key-production",
  TURNSTILE_SECRET_KEY: "t".repeat(40),
  TURNSTILE_EXPECTED_HOSTNAME: "crm.example.net",
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.net",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
  CRM_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
  LOGIN_THROTTLE_HASH_SECRET: "l".repeat(40),
  TRUSTED_DEVICE_HASH_SECRET: "d".repeat(40),
};

test("accepts only HTTPS or loopback endpoint origins", () => {
  assert.equal(secureEndpointOrigin("https://crm.example.net"), "https://crm.example.net");
  assert.equal(secureEndpointOrigin("http://127.0.0.1:3200"), "http://127.0.0.1:3200");
  assert.equal(secureEndpointOrigin("http://localhost:56321/"), "http://localhost:56321");
  for (const rejected of [
    "http://crm.example.net",
    "https://user:password@crm.example.net",
    "https://crm.example.net/path",
    "https://crm.example.net?tenant=other",
    "javascript:alert(1)",
  ]) assert.equal(secureEndpointOrigin(rejected), null);
  assert.equal(configuredSupabaseOrigin(validEnvironment), "https://supabase.example.net");
  assert.equal(applicationOrigin("https://forged.example", validEnvironment), "https://crm.example.net");
  assert.throws(
    () => applicationOrigin("https://forged.example", { NODE_ENV: "production" }),
    /APP_ORIGIN_NOT_CONFIGURED/,
  );
});

test("production mutations trust only the configured canonical origin", () => {
  const canonical = new Request("https://forged-host.example/api/settings", {
    method: "POST",
    headers: { origin: "https://crm.example.net", "sec-fetch-site": "same-origin" },
  });
  const forged = new Request("https://forged-host.example/api/settings", {
    method: "POST",
    headers: { origin: "https://forged-host.example", "sec-fetch-site": "same-origin" },
  });
  assert.equal(mutationIsTrusted(canonical, validEnvironment), true);
  assert.equal(mutationIsTrusted(forged, validEnvironment), false);
  assert.equal(mutationIsTrusted(new Request("https://crm.example.net/api/settings", {
    method: "POST",
    headers: { origin: "https://crm.example.net", "sec-fetch-site": "cross-site" },
  }), validEnvironment), false);
});

test("core runtime configuration rejects insecure or non-origin endpoints", () => {
  assert.equal(inspectCoreRuntimeEnvironment(validEnvironment).valid, true);
  for (const patch of [
    { APP_URL: "http://crm.example.net" },
    { APP_URL: "https://crm.example.net/path" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://supabase.example.net" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.net/rest/v1" },
  ]) {
    assert.equal(inspectCoreRuntimeEnvironment({ ...validEnvironment, ...patch }).valid, false);
  }
});

test("coalesces concurrent refresh rotation into one operation", async () => {
  let operations = 0;
  const refresh = createSingleFlight(async () => {
    operations += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return true;
  });
  assert.deepEqual(await Promise.all([refresh(), refresh(), refresh()]), [true, true, true]);
  assert.equal(operations, 1);
  assert.equal(await refresh(), true);
  assert.equal(operations, 2);
});

test("keeps compensated SCIM versions monotonic", () => {
  assert.equal(compensatedScimVersion(7), 8);
  assert.throws(
    () => compensatedScimVersion(Number.MAX_SAFE_INTEGER),
    (error) => error instanceof Error && error.code === "IDENTITY_COMPENSATION_REQUIRED",
  );
});

test("guards SCIM compensation, password reauthentication, and history state in source", async () => {
  const [scim, password, hook, proxy, portal, scimCollection, scimResource, apiClient, authForm, passwordReset, adminUsers] = await Promise.all([
    readFile(new URL("../lib/scim.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/use-paged-resource.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/invitations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scim/v2/Users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scim/v2/Users/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/api-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/auth-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/password-reset-forms.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-users-repository.ts", import.meta.url), "utf8"),
  ]);
  assert.match(scim, /workspace_id=eq\.\$\{workspace\}&version=eq\.\$\{writtenVersion\}/);
  assert.match(scim, /if\(!restored\[0\]\)/);
  assert.match(scim, /A newer SCIM version prevented unsafe compensation/);
  assert.match(scim, /version:compensatedScimVersion\(writtenVersion\)/);
  assert.match(scim, /SCIM_USER_COMPENSATED/);
  assert.match(password, /logout\?scope=global/);
  assert.match(password, /clearAuthSessionCookies\(response\)/);
  for (const cookie of ["trustedDevice", "pendingDeviceVerification", "mfaRemember"]) {
    assert.match(password, new RegExp(`securityCookieNames\\.${cookie}`));
  }
  assert.match(hook, /syncingFromHistory/);
  assert.match(hook, /parsePagedSearchParams\(new URLSearchParams\(searchParamsKey\)\)/);
  assert.match(proxy, /configuredSupabaseOrigin/);
  assert.doesNotMatch(proxy, /https:\/\/\*\.supabase\.co/);
  for (const source of [portal, scimCollection, scimResource]) {
    assert.match(source, /applicationOrigin\(request\.url\)/);
    assert.doesNotMatch(source, /new URL\(request\.url\)\.origin/);
  }
  assert.match(apiClient, /createSingleFlight/);
  assert.match(apiClient, /INVALID_API_RESPONSE/);
  assert.match(authForm, /submissionInFlight\.current/);
  assert.match(passwordReset, /submissionInFlight\.current/);
  assert.match(adminUsers, /CREATE_COMPENSATION_REQUIRED/);
  assert.match(adminUsers, /ban_duration: "876000h"/);
  assert.match(adminUsers, /IDENTITY_COMPENSATION_REQUIRED/);
});
