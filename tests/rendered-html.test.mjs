import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("replaces the disposable starter with Lumina CRM", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /dashboard/);
  assert.match(layout, /Lumina Education CRM/);
  assert.match(packageJson, /lumina-education-crm/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project/);
});

test("keeps authentication failures local to their forms", async () => {
  const [authForm, loginRoute, registerRoute] = await Promise.all([
    readFile(new URL("../components/auth-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/register/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(authForm, /role="alert"/);
  assert.match(authForm, /crm:reset-turnstile/);
  assert.match(loginRoute, /Incorrect email or password/);
  assert.match(registerRoute, /TURNSTILE_FAILED/);
  assert.doesNotMatch(loginRoute, /searchParams|URLSearchParams/);
  assert.doesNotMatch(registerRoute, /searchParams|URLSearchParams/);
});

test("enforces server-owned roles and administrator boundaries", async () => {
  const [auth, adminLayout, loginRoute, resetRoute, packageJson] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(crm)/admin/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password-reset/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /app_metadata/);
  assert.doesNotMatch(auth, /metadata\.role/);
  assert.match(adminLayout, /requireRole\("ADMIN"\)/);
  assert.match(loginRoute, /not approved for staff access/);
  assert.match(resetRoute, /auth\/v1\/recover/);
  assert.match(packageJson, /"version": "0\.2\.0"/);
});
