import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  IMPORT_EXECUTION_BATCH_SIZE,
  importExecutionPassLimit,
  isImportExecutionTerminal,
} from "../lib/import-execution.ts";
import {
  detailedReadinessAllowed,
  isLoopbackHostname,
} from "../lib/readiness-request.ts";
import { calendarMonthRange } from "../lib/timezone.ts";
import { qaTotp } from "../scripts/lib/qa-totp.mjs";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);

test("sizes import execution for the full supported upload and recognizes only terminal states", () => {
  assert.equal(IMPORT_EXECUTION_BATCH_SIZE, 100);
  assert.equal(importExecutionPassLimit(10_000), 101);
  assert.equal(importExecutionPassLimit(1), 2);
  assert.equal(isImportExecutionTerminal("PROCESSING"), false);
  assert.equal(isImportExecutionTerminal("COMPLETED"), true);
  assert.equal(isImportExecutionTerminal("PARTIAL_FAILED"), true);
});

test("allows detailed readiness only through a loopback request authority", () => {
  for (const hostname of ["localhost", "127.0.0.1", "127.42.0.8", "::1"]) {
    assert.equal(isLoopbackHostname(hostname), true);
  }
  for (const hostname of ["crm.example.net", "0.0.0.0", "192.168.1.2", "127.example.net"]) {
    assert.equal(isLoopbackHostname(hostname), false);
  }
  assert.equal(detailedReadinessAllowed(new Request("http://127.0.0.1:3200/api/health?mode=ready")), true);
  assert.equal(detailedReadinessAllowed(new Request("https://crm.example.net/api/health?mode=ready")), false);
  assert.equal(detailedReadinessAllowed(new Request("http://127.0.0.1:3200/api/health?mode=ready", {
    headers: { host: "crm.example.net" },
  })), false);
});

test("derives calendar month boundaries from the user's timezone", () => {
  assert.deepEqual(calendarMonthRange(2026, 5, 2, "Asia/Taipei"), {
    from: "2026-05-31T16:00:00.000Z",
    to: "2026-07-31T16:00:00.000Z",
  });
  assert.deepEqual(calendarMonthRange(2026, 2, 2, "America/New_York"), {
    from: "2026-03-01T05:00:00.000Z",
    to: "2026-05-01T04:00:00.000Z",
  });
});

test("keeps the self-hosted browser MFA helper on the standard TOTP vector", () => {
  assert.equal(
    qaTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000),
    "287082",
  );
});

test("keeps profile updates atomic and avatar replacement recoverable", async () => {
  const [migration, settings, avatar] = await Promise.all([
    readFile(repositoryFile("db/migrations/202607290061_v310_profile_atomicity.sql"), "utf8"),
    readFile(repositoryFile("lib/settings-repository.ts"), "utf8"),
    readFile(repositoryFile("app/api/settings/avatar/route.ts"), "utf8"),
  ]);
  assert.match(migration, /function public\.update_own_profile/);
  assert.match(migration, /update public\.user_profiles[\s\S]*update public\.user_preferences/);
  assert.match(settings, /\/db\/rpc\/update_own_profile/);
  assert.match(avatar, /crypto\.randomUUID\(\)/);
  assert.match(avatar, /catch \(error\)[\s\S]*objectStore\(\)\.delete/);
});

test("reports calendar truncation and blocks duplicate schedule submission", async () => {
  const [repository, calendar] = await Promise.all([
    readFile(repositoryFile("lib/calendar-repository.ts"), "utf8"),
    readFile(repositoryFile("components/calendar-page.tsx"), "utf8"),
  ]);
  assert.match(repository, /Prefer:"count=exact"/);
  assert.match(repository, /truncated:total>items\.length/);
  assert.match(calendar, /if\(scheduleLock\.current\)return/);
  assert.match(calendar, /scheduleLock\.current=true/);
  assert.match(calendar, /scheduleLock\.current=false/);
  assert.match(calendar, /aria-busy=\{schedulePending\}/);
  assert.match(calendar, /calendar\.truncated/);
});

test("logs allow-listed uncaught API failure diagnostics and mobile modal semantics", async () => {
  const [api, observability, shell] = await Promise.all([
    readFile(repositoryFile("lib/api.ts"), "utf8"),
    readFile(repositoryFile("lib/observability.ts"), "utf8"),
    readFile(repositoryFile("components/app-shell.tsx"), "utf8"),
  ]);
  assert.match(api, /name:"api\.request\.failed"/);
  assert.match(api, /errorType:safeErrorType\(error\)/);
  assert.doesNotMatch(api, /stack:/);
  assert.match(observability, /name: "api\.request\.failed"/);
  assert.match(shell, /role=\{mobileOpen\?"dialog":undefined\}/);
  assert.match(shell, /aria-modal=\{mobileOpen\|\|undefined\}/);
});
