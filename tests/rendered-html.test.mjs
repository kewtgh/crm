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
  assert.match(loginRoute, /INVALID_CREDENTIALS/);
  assert.match(registerRoute, /TURNSTILE_FAILED/);
  assert.doesNotMatch(loginRoute, /searchParams|URLSearchParams/);
  assert.doesNotMatch(registerRoute, /searchParams|URLSearchParams/);
});

test("keeps authentication and user context safe across hydration and client bundles", async () => {
  const [authForm, shell, context, settings, governance, switcher, loginPage] = await Promise.all([
    readFile(new URL("../components/auth-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/app-user-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/settings-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/governance-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/locale-switcher.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(auth)/login/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(authForm, /method="post" action=\{`\/api\/auth\/\$\{mode\}`\}/);
  assert.match(authForm, /\{isLogin && demoMode && \(\s*<div className="demo-note">/s);
  assert.match(authForm, /\{isLogin && \(\s*<div className="login-extras">/s);
  for (const source of [shell, settings, governance]) assert.doesNotMatch(source, /from "@\/lib\/auth"/);
  assert.match(context, /AppUserProvider/);
  assert.match(switcher, /router\.refresh\(\)/);
  assert.match(loginPage, /localizedPageMetadata\("meta\.login"\)/);
});

test("enforces server-owned roles and administrator boundaries", async () => {
  const [auth, roles, adminLayout, loginRoute, resetRoute, packageJson] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/roles.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(crm)/admin/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password-reset/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /app_metadata/);
  for (const role of ["SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"]) assert.match(roles, new RegExp(role));
  assert.doesNotMatch(auth, /metadata\.role/);
  assert.match(adminLayout, /requireRole\("SUPER_ADMIN", "ADMIN"\)/);
  assert.match(loginRoute, /STAFF_ACCESS_DENIED/);
  assert.match(resetRoute, /auth\/v1\/recover/);
  assert.match(packageJson, /"version": "0\.4\.1"/);
});

test("includes calendar scheduling and sales performance workspaces", async () => {
  const [calendar, sales, navigation, packageJson] = await Promise.all([
    readFile(new URL("../components/calendar-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/sales-performance-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(calendar, /double-calendar/);
  assert.match(calendar, /calendar\.new/);
  assert.match(calendar, /calendar\.reminders/);
  assert.match(sales, /sales\.targetTrend/);
  assert.match(sales, /sales\.funnel/);
  assert.match(navigation, /\/sales\/performance/);
  assert.match(packageJson, /"version": "0\.4\.1"/);
});

test("keeps locale catalogs aligned and renders a persistent language switch", async () => {
  const [zh, en, provider, switcher, shell, authForm] = await Promise.all([
    readFile(new URL("../lib/i18n/locales/zh-CN.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n/locales/en.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/i18n-provider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/locale-switcher.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth-form.tsx", import.meta.url), "utf8"),
  ]);
  const keys = (source) => [...source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]).sort();
  assert.deepEqual(keys(zh), keys(en));
  assert.match(provider, /lumina-locale/);
  assert.match(provider, /document\.documentElement\.lang/);
  assert.match(switcher, /locale\.switch/);
  assert.match(shell, /LocaleSwitcher/);
  assert.match(authForm, /LocaleSwitcher/);
});

test("keeps every split locale catalog aligned and avoids key-shaped English fallbacks", async () => {
  const pairs = await Promise.all([
    ["sales-playbook.ts", "zhSalesPlaybook", "enSalesPlaybook"],
    ["workspace-pages.ts", "zhWorkspacePages", "enWorkspacePages"],
    ["analysis-pages.ts", "zhAnalysisPages", "enAnalysisPages"],
    ["governance-pages.ts", "zhGovernancePages", "enGovernancePages"],
    ["ui-eyebrows.ts", "zhUiEyebrows", "enUiEyebrows"],
  ].map(async ([file, zhExport, enExport]) => ({ source: await readFile(new URL(`../lib/i18n/locales/${file}`, import.meta.url), "utf8"), zhExport, enExport })));
  const block = (source, name) => { const start = source.indexOf(`export const ${name}`); const next = source.indexOf("export const ", start + 13); return source.slice(start, next === -1 ? source.length : next); };
  const keys = (source) => [...source.matchAll(/"([a-z][^"]+)"\s*:/g)].map((match) => match[1]).sort();
  for (const { source, zhExport, enExport } of pairs) {
    const zhBlock = block(source, zhExport); const enBlock = block(source, enExport);
    assert.deepEqual(keys(zhBlock), keys(enBlock));
    assert.doesNotMatch(enBlock, /Object\.fromEntries|\[key,\s*key\]/);
  }
});

test("routes visible eyebrow labels through the locale catalog", async () => {
  const files = ["admin-pages.tsx", "calendar-page.tsx", "dashboard-page.tsx", "module-page.tsx", "operations-pages.tsx", "password-reset-forms.tsx", "pipeline-page.tsx", "sales-performance-page.tsx", "settings-page.tsx"];
  for (const file of files) {
    const source = await readFile(new URL(`../components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /className="eyebrow">[^<{]+/);
  }
});

test("adds tiered approvals and non-duplicating manager performance allocation", async () => {
  const [governance, allocationRoute, migration, shell, bootstrap] = await Promise.all([
    readFile(new URL("../components/governance-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(crm)/sales/allocation/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607160004_approvals_and_performance_allocations.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/bootstrap-admin.mjs", import.meta.url), "utf8"),
  ]);
  for (const workflow of ["contractSign", "contractExport", "performanceSummary"]) assert.match(governance, new RegExp(workflow));
  assert.match(governance, /allocation\.noDoubleCount/);
  assert.match(governance, /Pagination/);
  assert.match(allocationRoute, /SALES_DIRECTOR", "SALES_MANAGER/);
  assert.match(migration, /allocation_total_exceeds_target/);
  assert.match(migration, /requester_id <> auth\.uid\(\)/);
  assert.match(shell, /nav\.approvals/);
  assert.match(shell, /nav\.allocation/);
  assert.match(bootstrap, /role: "SUPER_ADMIN"/);
});

test("separates immutable user IDs, usernames, and bilingual names", async () => {
  const [userModel, registration, usernameRoute, migration, settings] = await Promise.all([
    readFile(new URL("../lib/user.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/check-username/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607160001_user_identity.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/settings-page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(userModel, /id: string/);
  assert.match(userModel, /username: string/);
  assert.match(userModel, /displayNameZh/);
  assert.match(registration, /username_available/);
  assert.match(usernameRoute, /USERNAME_CHECK_UNAVAILABLE/);
  assert.match(migration, /username citext not null unique/);
  assert.match(settings, /settings\.internalId/);
});

test("includes contracts, custom products, consumption reporting, and exact relationship goals", async () => {
  const [contracts, products, consumption, zh, sales, playbook] = await Promise.all([
    readFile(new URL("../components/contracts-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/products-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/consumption-analysis-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n/locales/zh-CN.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/sales-performance-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n/locales/sales-playbook.ts", import.meta.url), "utf8"),
  ]);
  assert.match(contracts, /90、60、30、14、7|contracts\.prototypeWarning/);
  for (const name of ["夏令营", "升学", "竞赛", "夏校", "预科"]) assert.match(products, new RegExp(name));
  assert.match(consumption, /month/);
  assert.match(consumption, /quarter/);
  assert.match(consumption, /year/);
  for (const goal of ["拿到客户联系方式", "和客户吃过一餐饭", "可以和客户聊家长里短", "随时可以让客户帮忙在学校做宣传"]) assert.match(zh, new RegExp(goal));
  assert.match(sales, /relationshipPlaybook/);
  assert.match(sales, /closingPlaybook/);
  assert.match(playbook, /初步了解/);
  assert.match(playbook, /付款执行/);
  assert.match(playbook, /不得使用虚假折扣/);
});
