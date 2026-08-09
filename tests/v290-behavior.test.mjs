import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applicationOrigin,
  configuredObjectStorageOrigin,
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
  ALTCHA_HMAC_SECRET: "a".repeat(40),
  DATABASE_URL: "postgresql://crm_app:app-password@127.0.0.1:5432/lumina_crm",
  SYSTEM_DATABASE_URL: "postgresql://crm_system:system-password@127.0.0.1:5432/lumina_crm",
  CRM_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
  LOGIN_THROTTLE_HASH_SECRET: "l".repeat(40),
  TRUSTED_DEVICE_HASH_SECRET: "d".repeat(40),
  TOTP_ENCRYPTION_KEY: "m".repeat(40),
  INVITATION_CREDENTIAL_ENCRYPTION_KEY: "i".repeat(40),
  OBJECT_STORAGE_SIGNING_SECRET: "o".repeat(40),
};

test("accepts only HTTPS or loopback endpoint origins", () => {
  assert.equal(secureEndpointOrigin("https://crm.example.net"), "https://crm.example.net");
  assert.equal(secureEndpointOrigin("http://127.0.0.1:3200"), "http://127.0.0.1:3200");
  assert.equal(secureEndpointOrigin("http://localhost:55432/"), "http://localhost:55432");
  for (const rejected of [
    "http://crm.example.net",
    "https://user:password@crm.example.net",
    "https://crm.example.net/path",
    "https://crm.example.net?tenant=other",
    "javascript:alert(1)",
  ]) assert.equal(secureEndpointOrigin(rejected), null);
  assert.equal(
    configuredObjectStorageOrigin({ S3_ENDPOINT: "https://objects.example.net" }),
    "https://objects.example.net",
  );
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

test("core runtime requires independent PostgreSQL, authentication, and storage secrets", () => {
  assert.equal(inspectCoreRuntimeEnvironment(validEnvironment).valid, true);
  for (const patch of [
    { APP_URL: "http://crm.example.net" },
    { DATABASE_URL: "https://database.example.net" },
    { SYSTEM_DATABASE_URL: "" },
    { TOTP_ENCRYPTION_KEY: validEnvironment.TRUSTED_DEVICE_HASH_SECRET },
    { OBJECT_STORAGE_SIGNING_SECRET: "replace-with-secret" },
  ]) {
    assert.equal(inspectCoreRuntimeEnvironment({ ...validEnvironment, ...patch }).valid, false);
  }
});

test("coalesces concurrent session refresh rotation into one operation", async () => {
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

test("self-managed identity boundaries retain compensation, CSRF, and session revocation", async () => {
  const [scim, password, proxy, apiClient, adminUsers, staffUi, staffApi, refresh, sessions] = await Promise.all([
    readFile(new URL("../lib/scim.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/api-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/admin-users-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/staff-users-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/refresh/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/session-store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(scim, /compensatedScimVersion/);
  assert.match(scim, /SCIM_USER_COMPENSATED/);
  assert.match(password, /reauthenticate: true/);
  assert.match(password, /clearAuthSessionCookies\(response\)/);
  assert.match(proxy, /configuredObjectStorageOrigin/);
  assert.match(apiClient, /createSingleFlight/);
  assert.match(apiClient, /INVALID_API_RESPONSE/);
  assert.match(adminUsers, /app_auth\.accounts/);
  assert.match(adminUsers, /AWAITING_EMAIL_CONFIRMATION/);
  assert.match(adminUsers, /INVITATION_QUEUED/);
  assert.match(adminUsers, /notification_outbox/);
  assert.doesNotMatch(adminUsers, /fetch\(endpoint/);
  assert.doesNotMatch(adminUsers, /CREATE_ROLLED_BACK/);
  assert.doesNotMatch(adminUsers, /delete from app_auth\.accounts/);
  assert.match(staffApi, /emailDeliveryStatus === "SENT" \? 201 : 202/);
  assert.match(staffUi, /onCreated\(result\.item, result\.emailDeliveryStatus\)/);
  assert.match(staffUi, /setInviteOpen\(false\)/);
  assert.match(staffUi, /admin\.users\.awaitingEmailConfirmation/);
  assert.match(staffUi, /admin\.users\.createdDeliveryUnconfirmed/);
  assert.match(refresh, /rotateSessionToken/);
  assert.match(sessions, /createHash\("sha256"\)/);
});

test("nested relation cardinality ignores composite and partial unique indexes", async () => {
  const gateway = await readFile(new URL("../lib/db/gateway.ts", import.meta.url), "utf8");
  const uniquenessProbe = gateway.slice(
    gateway.indexOf("exists(\n        select 1 from pg_index"),
    gateway.indexOf('as "childUnique"'),
  );
  assert.match(uniquenessProbe, /index_record\.indisunique/);
  assert.match(uniquenessProbe, /index_record\.indisvalid/);
  assert.match(uniquenessProbe, /index_record\.indpred is null/);
  assert.match(uniquenessProbe, /index_record\.indnkeyatts = 1/);
  assert.match(gateway, /baseIsChild \|\| relation\.childUnique \? matches\[0\] \?\? null : matches/);
});
