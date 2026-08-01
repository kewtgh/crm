import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { dateKeyFor } from "../lib/timezone.ts";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);
const source = (path) => readFile(repositoryFile(path), "utf8");

test("derives date-only business rules from the configured workspace timezone", () => {
  const boundary = new Date("2026-07-30T00:30:00.000Z");
  assert.equal(dateKeyFor(boundary, "Asia/Taipei"), "2026-07-30");
  assert.equal(dateKeyFor(boundary, "America/New_York"), "2026-07-29");
});

test("stores, validates, and audits the workspace business timezone", async () => {
  const [migration, workerPermissions, dateContract, context, worker, generatedJobs, contracts] = await Promise.all([
    source("db/migrations/202607300065_workspace_business_timezone.sql"),
    source("db/migrations/202607300066_worker_business_timezone_permissions.sql"),
    source("db/migrations/202607300067_business_date_text_contract.sql"),
    source("lib/db/context.ts"),
    source("scripts/lib/worker-database.mjs"),
    source("scripts/process-generated-jobs.mjs"),
    source("lib/contract-repository.ts"),
  ]);
  assert.match(migration, /add column if not exists business_timezone/);
  assert.match(migration, /workspaces_business_timezone_check/);
  assert.match(migration, /coalesce\(app_auth\.current_claims\(\)->>'aal', 'aal1'\) <> 'aal2'/);
  assert.match(migration, /WORKSPACE_BUSINESS_TIMEZONE_CHANGED/);
  assert.match(migration, /grant execute on function public\.set_workspace_business_timezone/);
  assert.match(workerPermissions, /grant select \(id, business_timezone\) on public\.workspaces to crm_worker/);
  assert.match(dateContract, /returns text/);
  assert.match(dateContract, /to_char\(current_date, 'YYYY-MM-DD'\)/);
  assert.match(context, /select business_timezone[\s\S]*from public\.workspaces/);
  assert.match(context, /set_config\('TimeZone', \$1, true\)/);
  assert.match(worker, /options\.workspaceId/);
  assert.match(worker, /set_config\('TimeZone',\$1,true\)/);
  assert.match(generatedJobs, /workspaceId:job\.workspace_id/);
  assert.match(contracts, /current_business_date/);
  assert.doesNotMatch(contracts, /setHours\(0,0,0,0\)/);
});

test("exposes organization settings behind admin AAL2 and trusted-origin checks", async () => {
  const [migration, route, page, component, shell, styles, captcha, widget, loginPage, recoveryPage, browserQa, proxy] = await Promise.all([
    source("db/migrations/202607300068_workspace_turnstile_policy.sql"),
    source("app/api/admin/workspace/route.ts"),
    source("app/(crm)/admin/workspace/page.tsx"),
    source("components/workspace-settings-page.tsx"),
    source("components/app-shell.tsx"),
    source("app/globals.css"),
    source("lib/captcha.ts"),
    source("components/captcha-widget.tsx"),
    source("app/(auth)/login/page.tsx"),
    source("app/(auth)/forgot-password/page.tsx"),
    source("scripts/browser-qa-chromium-1228.cjs"),
    source("proxy.ts"),
  ]);
  assert.match(migration, /add column if not exists turnstile_enabled boolean not null default true/);
  assert.match(migration, /WORKSPACE_TURNSTILE_POLICY_CHANGED/);
  assert.match(migration, /set_workspace_turnstile_enabled/);
  assert.match(route, /mutationIsTrusted\(request\)/);
  assert.match(route, /requireApiRole\("SUPER_ADMIN", "ADMIN"\)/);
  assert.match(route, /requireApiAal2\(\)/);
  assert.match(route, /z\.enum\(SUPPORTED_TIMEZONES\)/);
  assert.match(route, /turnstileEnabled: z\.boolean\(\)/);
  assert.match(page, /requireRole\("SUPER_ADMIN", "ADMIN"\)/);
  assert.match(component, /dateKeyFor\(new Date\(\), businessTimezone\)/);
  assert.match(component, /personalDifference/);
  assert.match(component, /workspaceSettings\.turnstile/);
  assert.match(shell, /nav\.workspaceSettings/);
  assert.match(shell, /"\/admin\/workspace": "admin\.access"/);
  assert.match(styles, /\.workspace-settings-page \.quick-summary[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(styles, /\.switch span \{[\s\S]*pointer-events: none/);
  assert.match(captcha, /TURNSTILE_DISABLED/);
  assert.match(captcha, /administrator_disabled/);
  assert.match(widget, /turnstileEnabled[\s\S]*administrator_disabled/);
  assert.match(loginPage, /loadCaptchaProviderConfiguration/);
  assert.match(recoveryPage, /loadCaptchaProviderConfiguration/);
  assert.match(browserQa, /QA_VALIDATE_TURNSTILE_POLICY/);
  assert.match(browserQa, /data-captcha-provider="altcha"/);
  assert.match(browserQa, /update public\.audit_events set actor_id=null/);
  assert.match(proxy, /worker-src 'self' blob:/);
});

test("prevents pending drawers from being dismissed through every close surface", async () => {
  const ui = await source("components/ui.tsx");
  assert.match(ui, /pendingRef\.current = pending/);
  assert.match(ui, /event\.key === "Escape" && !pendingRef\.current/);
  assert.match(ui, /className="drawer-overlay"[\s\S]*disabled=\{pending\}/);
  assert.match(ui, /aria-busy=\{pending\}/);
  assert.match(ui, /ref=\{closeRef\}[\s\S]*disabled=\{pending\}/);

  for (const file of [
    "components/calendar-page.tsx",
    "components/communications-inbox-page.tsx",
    "components/customer-360-page.tsx",
    "components/growth-workspace.tsx",
    "components/imports-page.tsx",
    "components/module-page.tsx",
    "components/pipeline-page.tsx",
    "components/portal-workspace.tsx",
    "components/privacy-requests-workspace.tsx",
    "components/task-workspace.tsx",
  ]) {
    assert.match(await source(file), /<AccessibleDrawer[\s\S]{0,220}pending=\{/);
  }
});

test("makes task truncation and legacy timestamps explicit and timezone-aware", async () => {
  const [tasks, table, communications, automation, portal, recycle, finance] = await Promise.all([
    source("components/task-workspace.tsx"),
    source("components/data-table.tsx"),
    source("components/communications-inbox-page.tsx"),
    source("components/automation-workspace.tsx"),
    source("components/portal-workspace.tsx"),
    source("components/recycle-bin-page.tsx"),
    source("components/finance-page.tsx"),
  ]);
  assert.match(tasks, /tasks\.queueTruncated/);
  assert.match(tasks, /href="#record-list"/);
  assert.match(table, /id="record-list"/);
  for (const value of [communications, automation, portal, recycle]) {
    assert.match(value, /formatDate/);
    assert.doesNotMatch(value, /\.toLocaleString\(/);
  }
  assert.doesNotMatch(finance, /2026-08-01:50000/);
  assert.match(finance, /finance\.installmentsPlaceholder/);
});
