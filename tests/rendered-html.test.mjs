import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
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
  const [authForm, loginRoute] = await Promise.all([
    readFile(new URL("../components/auth-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(authForm, /role="alert"/);
  assert.match(authForm, /fieldErrors/);
  assert.match(authForm, /auth\.staffOnly/);
  assert.doesNotMatch(authForm, /register/i);
  assert.match(authForm, /TurnstileWidget/);
  assert.match(loginRoute, /verifyTurnstileToken/);
  assert.match(loginRoute, /INVALID_CREDENTIALS/);
  assert.doesNotMatch(loginRoute, /searchParams|URLSearchParams/);
  await assert.rejects(access(new URL("../app/(auth)/register/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/auth/register/route.ts", import.meta.url)));
});

test("implements role-scoped MFA and revocable trusted-device verification", async () => {
  const [auth, login, verification, trusted, migration, settings, environment] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/device-verification/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/trusted-devices.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607200042_identity_device_trust.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/settings-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/runtime-environment.ts", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /role === "SUPER_ADMIN" \|\| role === "ADMIN"/);
  assert.match(auth, /isMfaRequiredRole\(user\.role\) \|\| user\.mfaEnabled/);
  assert.doesNotMatch(auth, /\["SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR", "SALES_MANAGER"\]/);
  assert.match(login, /resolveStaffLoginEmail\(identifier\)/);
  assert.match(login, /verifyTurnstileToken/);
  assert.match(login, /auth\/v1\/otp/);
  assert.match(login, /consumeTrustedDevice/);
  assert.match(verification, /auth\/v1\/verify/);
  assert.match(verification, /registerTrustedDevice/);
  assert.match(trusted, /HMAC/);
  assert.match(trusted, /crypto\.getRandomValues/);
  assert.doesNotMatch(trusted, /localStorage|sessionStorage/);
  assert.match(migration, /revoke all on public\.trusted_login_devices from public,anon,authenticated/);
  assert.match(migration, /TRUSTED_DEVICE_REGISTERED/);
  assert.match(settings, /api\/settings\/trusted-devices/);
  assert.match(environment, /TRUSTED_DEVICE_HASH_SECRET/);
  await access(new URL("../app/(auth)/verify-device/page.tsx", import.meta.url));
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
  assert.match(authForm, /method="post" action="\/api\/auth\/login"/);
  assert.doesNotMatch(authForm, /demoMode|Demo123|CRM_DEMO_MODE/);
  assert.match(authForm, /<div className="login-extras">/);
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
  assert.match(packageJson, /"version": "2\.3\.0"/);
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
  assert.match(packageJson, /"version": "2\.3\.0"/);
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
    ["phase2-pages.ts", "zhPhase2", "enPhase2"],
    ["operations-v09.ts", "zhOperationsV09", "enOperationsV09"],
  ].map(async ([file, zhExport, enExport]) => ({ source: await readFile(new URL(`../lib/i18n/locales/${file}`, import.meta.url), "utf8"), zhExport, enExport })));
  const block = (source, name) => { const start = source.indexOf(`export const ${name}`); const next = source.indexOf("export const ", start + 13); return source.slice(start, next === -1 ? source.length : next); };
  const keys = (source) => [...source.matchAll(/"([a-z][^"]+)"\s*:/g)].map((match) => match[1]).sort();
  for (const { source, zhExport, enExport } of pairs) {
    const zhBlock = block(source, zhExport); const enBlock = block(source, enExport);
    assert.deepEqual(keys(zhBlock), keys(enBlock));
    assert.doesNotMatch(enBlock, /Object\.fromEntries|\[key,\s*key\]/);
  }
});

test("implements customer 360, consent, financial state, import quality, and real calendar delivery", async () => {
  const [migration, consentMigration, quoteFix, importFix, timeline, consent, finance, imports, quality, calendar, calendarWorker, exportWorker, shell] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607170021_phase2_operational_closures.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170022_consent_enforced_marketing_exports.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170023_fix_quote_version_ambiguity.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170024_normalize_import_row_arrays.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/customer-360-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/contact-consent-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/finance-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/imports-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/data-quality-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/calendar-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/process-calendar-deliveries.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/process-generated-jobs.mjs", import.meta.url), "utf8"),
    readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /customer_timeline/);
  assert.match(migration, /contact_channel_allowed/);
  assert.match(migration, /refund_exceeds_payment/);
  assert.match(migration, /import_rollback_conflict/);
  assert.match(migration, /claim_calendar_deliveries/);
  assert.match(consentMigration, /MARKETING_CONTACT_EXPORT/);
  assert.match(consentMigration, /marketing_export_rows/);
  assert.match(quoteFix, /selected_version/);
  assert.match(importFix, /normalize_import_row_arrays/);
  assert.match(timeline, /Pagination/);
  assert.match(consent, /doNotContact/);
  assert.doesNotMatch(consent, /window\.prompt/);
  assert.match(finance, /saveReceivables/);
  assert.match(finance, /searchQuotes/);
  assert.match(imports, /chosen_action/);
  assert.match(imports, /rowPage/);
  assert.match(quality, /run/);
  assert.doesNotMatch(quality, /window\.prompt/);
  assert.match(calendar, /attendeeConsent/);
  assert.match(calendarWorker, /idempotencyKey/);
  assert.match(exportWorker, /marketingContactsExport/);
  assert.match(shell, /nav\.finance/);
  for (const visible of ["nav.students", "nav.households", "nav.progression", "nav.ai", "nav.leads"]) assert.match(shell, new RegExp(visible));
  for (const added of ["students", "households", "progression", "ai", "leads", "privacy-requests"]) await access(new URL(`../app/(crm)/${added}/page.tsx`, import.meta.url));
});

test("routes visible eyebrow labels through the locale catalog", async () => {
  const files = ["admin-pages.tsx", "calendar-page.tsx", "dashboard-page.tsx", "feature-status-page.tsx", "help-page.tsx", "module-page.tsx", "password-reset-forms.tsx", "pipeline-page.tsx", "sales-performance-page.tsx", "settings-page.tsx"];
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
  const [userModel, bootstrap, identityMigration, boundaryMigration, settings] = await Promise.all([
    readFile(new URL("../lib/user.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/bootstrap-admin.mjs", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607160001_user_identity.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170008_staff_only_identity.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/settings-page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(userModel, /id: string/);
  assert.match(userModel, /username: string/);
  assert.match(userModel, /displayNameZh/);
  assert.match(bootstrap, /username/);
  assert.match(identityMigration, /username citext not null unique/);
  assert.match(boundaryMigration, /revoke all.*username_available.*anon/is);
  assert.match(settings, /settings\.internalId/);
});

test("includes contracts, custom products, consumption reporting, and exact relationship goals", async () => {
  const [contracts, products, consumption, zh, sales, playbook, coreMigration] = await Promise.all([
    readFile(new URL("../components/contracts-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/products-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/consumption-analysis-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n/locales/zh-CN.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/sales-performance-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n/locales/sales-playbook.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170001_core_crm_architecture.sql", import.meta.url), "utf8"),
  ]);
  assert.match(contracts, /contracts\.loading/);
  assert.match(coreMigration, /array\[90,60,30,14,7\]/);
  for (const name of ["夏令营", "升学", "竞赛", "夏校", "预科"]) assert.match(coreMigration, new RegExp(name));
  assert.match(products, /products\.managePrice/);
  assert.match(consumption, /month/);
  assert.match(consumption, /quarter/);
  assert.match(consumption, /year/);
  for (const goal of ["拿到客户联系方式", "和客户吃过一餐饭", "建立可信的业务语境", "随时可以让客户帮忙在学校做宣传"]) assert.match(zh, new RegExp(goal));
  assert.match(sales, /relationshipPlaybook/);
  assert.match(sales, /closingPlaybook/);
  assert.match(playbook, /初步了解/);
  assert.match(playbook, /付款执行/);
  assert.match(playbook, /不得使用虚假折扣/);
});

test("has no demo authentication bypass or public customer registration", async () => {
  const [auth, login, reset, env, crmData, shell, translator] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password-reset/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../lib/crm-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n/index.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [auth, login, reset, env]) assert.doesNotMatch(source, /CRM_DEMO_MODE|Demo123|demo-admin/);
  assert.doesNotMatch(crmData, /guardian|监护人|crmUsers|acceptance data/i);
  assert.doesNotMatch(shell, /Taipei European School|台北欧洲学校|Wu Household|吴氏家庭/);
  assert.doesNotMatch(translator, /dictionaries\["zh-CN"\]\[key\]/);
  await assert.rejects(access(new URL("../app/(auth)/register/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/auth/register/route.ts", import.meta.url)));
});

test("completes approved export generation and secure delivery", async () => {
  const [worker, migration, repository, page, packageJson] = await Promise.all([
    readFile(new URL("../scripts/process-generated-jobs.mjs", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170015_secure_exports.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/generated-jobs-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/exports-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /CONTRACT_EXPORT/);
  assert.match(worker, /performanceExport/);
  assert.match(worker, /crm-exports/);
  assert.match(worker, /\^\[=\+@-\]/);
  assert.match(migration, /values\('crm-exports','crm-exports',false/);
  assert.match(repository, /signedURL/);
  assert.match(page, /Pagination/);
  assert.match(packageJson, /exports:process/);
});

test("enforces administrator-created accounts, temporary-password replacement, Turnstile, and privileged MFA", async () => {
  const [staffRepository, staffRoute, loginRoute, turnstile, auth, mfaRoute, crmLayout, firstLoginMigration, mfaMigration, env] = await Promise.all([
    readFile(new URL("../lib/admin-users-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/turnstile.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/mfa/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(crm)/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170017_first_login_security.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170020_privileged_mfa_gate.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(staffRepository, /generateTemporaryPassword/);
  assert.match(staffRepository, /staff-account-created/);
  assert.match(staffRepository, /email_confirm: true/);
  assert.doesNotMatch(staffRepository, /auth\/v1\/invite/);
  assert.match(staffRepository, /actor\.role === "ADMIN" && input\.role === "ADMIN"/);
  assert.match(staffRoute, /requireApiAal2/);
  assert.match(loginRoute, /verifyTurnstileToken/);
  assert.match(turnstile, /siteverify/);
  assert.match(turnstile, /idempotency_key/);
  assert.match(auth, /nextAuthenticatedPath/);
  assert.match(mfaRoute, /setAuthSessionCookies\(response, session, remember\)/);
  assert.match(crmLayout, /mfa-challenge/);
  assert.match(firstLoginMigration, /must_change_password/);
  assert.match(firstLoginMigration, /complete_initial_password_change/);
  assert.match(mfaMigration, /auth\.jwt\(\)->>'aal'/);
  assert.match(env, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(env, /TURNSTILE_SECRET_KEY/);
});

test("closes the v0.9.0 audit findings and exposes real operational product foundations", async () => {
  const [
    api,
    apiClient,
    boundary,
    operationsMigration,
    identityMigration,
    importGuardMigration,
    shell,
    settings,
    table,
    operations,
    customer360,
    imports,
    products,
    worker,
    proxy,
    audit,
    plan,
  ] = await Promise.all([
    readFile(new URL("../lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/api-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170025_security_boundary_hardening.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170026_operational_product_foundations.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170027_identity_rate_limit_and_readiness.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607170029_import_execution_workspace_guards.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/settings-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/data-table.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-center-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/customer-360-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/imports-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/products-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/worker-heartbeat.mjs", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/AUDIT_2026-07-17_FINAL.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/REMEDIATION_AND_PRODUCT_PLAN_V0.9.0.md", import.meta.url), "utf8"),
  ]);
  assert.match(api, /requireApiUser/);
  assert.match(api, /response\.status >= 300 && response\.status < 400/);
  assert.match(apiClient, /SESSION_REFRESH_REQUIRED/);
  assert.match(boundary, /drop function if exists public\.refund_payment/);
  assert.match(boundary, /revoke insert on public\.approval_requests,public\.approval_actions/);
  assert.match(boundary, /quote_product_invalid/);
  assert.match(operationsMigration, /workspace_relationship_health/);
  assert.match(operationsMigration, /explain_record_access/);
  assert.match(operationsMigration, /record_customer_activity/);
  assert.match(operationsMigration, /contract_renewal_playbooks/);
  assert.match(operationsMigration, /change_opportunity_stage/);
  assert.match(operationsMigration, /duplicate_merge_preview/);
  assert.match(operationsMigration, /import_dry_run/);
  assert.match(operationsMigration, /worker_heartbeats/);
  assert.match(operationsMigration, /webhook_inbox/);
  assert.match(operationsMigration, /create_product_bundle/);
  assert.match(operationsMigration, /next_best_actions/);
  assert.match(identityMigration, /apply_login_throttle/);
  assert.match(identityMigration, /pg_advisory_xact_lock/);
  assert.match(identityMigration, /staff_identity_changes/);
  assert.match(identityMigration, /service_readiness_snapshot/);
  assert.match(importGuardMigration, /workspace_id=batch\.workspace_id/);
  assert.match(shell, /metaKey \|\| event\.ctrlKey/);
  assert.match(shell, /role="combobox"/);
  assert.doesNotMatch(shell, /87%|3\.2%/);
  assert.match(settings, /loadState === "error"/);
  assert.match(settings, /emailIsVerified/);
  assert.match(table, /data-label/);
  assert.match(table, /common\.retry/);
  assert.match(operations, /operations\.permission/);
  assert.match(operations, /operations\.nextActions/);
  assert.match(customer360, /customer360\.recordActivity/);
  assert.match(imports, /imports\.dryRun/);
  assert.match(imports, /duplicates\.mergePreview/);
  assert.match(products, /catalog\.bundles/);
  assert.match(products, /catalog\.exchangeRates/);
  assert.match(worker, /record_worker_heartbeat/);
  assert.match(proxy, /strict-dynamic/);
  assert.doesNotMatch(proxy, /script-src[^"\n]*unsafe-inline/);
  assert.match(audit, /P0：发布阻断/);
  assert.match(plan, /第七阶段：测试、发布与运维/);
});

test("closes the v1.0 release audit with executable security and business boundaries", async () => {
  const [
    securityMigration,
    productMigration,
    releaseMigration,
    webhookRoute,
    apiClient,
    operations,
    imports,
    finance,
    ui,
    env,
    audit,
    plan,
  ] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607180031_security_reliability_closure.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607180032_product_and_insight_closure.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607180033_v100_release_boundary.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/webhooks/[provider]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/api-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-center-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/imports-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/finance-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../docs/AUDIT_2026-07-18_V091.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/REMEDIATION_AND_PRODUCT_PLAN_V0.9.1.md", import.meta.url), "utf8"),
  ]);
  assert.match(securityMigration, /queue_failed_identity_repair/);
  assert.match(securityMigration, /claim_webhook_events_leased/);
  assert.match(securityMigration, /duplicate_field_choice_invalid/);
  assert.match(productMigration, /renewal_playbook_context/);
  assert.match(productMigration, /business_improvement_snapshot/);
  assert.match(productMigration, /next_action_evaluations/);
  assert.match(releaseMigration, /create_quote_v100/);
  assert.match(releaseMigration, /quote_product_or_bundle_required/);
  assert.match(releaseMigration, /confirm_integration_connection/);
  assert.match(webhookRoute, /canonicalEnvelope/);
  assert.match(webhookRoute, /WEBHOOK_REPLAY_WINDOW_EXCEEDED/);
  assert.match(apiClient, /AbortSignal\.any/);
  assert.match(apiClient, /REQUEST_TIMEOUT/);
  for (const page of [operations, imports, finance]) assert.match(page, /apiFetch/);
  assert.match(operations, /operations\.businessInsights/);
  assert.match(imports, /editableFields/);
  assert.match(finance, /productOrBundleRequired/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(env, /INTEGRATION_SYNC_PROCESSOR_URL/);
  assert.match(audit, /P0：发布阻断/);
  assert.match(plan, /全量自动化、浏览器和 Sites 发布门禁/);
});

test("closes the v1.1 post-release audit with exact metrics and guided workflows", async () => {
  const [
    opportunitySchema,
    pipeline,
    finance,
    modulePage,
    dataTable,
    preferences,
    remediation,
    environment,
    localSetup,
    smoke,
    operations,
    audit,
    plan,
    version,
  ] = await Promise.all([
    readFile(new URL("../lib/opportunity-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/pipeline-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/finance-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/module-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/data-table.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/user-preferences-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607180037_v110_remediation.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/runtime-environment.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/configure-local-environment.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/smoke-v09.mjs", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-center-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/AUDIT_2026-07-18_POST_RELEASE.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/REMEDIATION_AND_PRODUCT_PLAN_V1.1.0.md", import.meta.url), "utf8"),
    readFile(new URL("../lib/version.ts", import.meta.url), "utf8"),
  ]);
  assert.match(opportunitySchema, /WON_EVIDENCE_REQUIRED/);
  assert.match(opportunitySchema, /LOST_REASON_REQUIRED/);
  assert.match(pipeline, /transitionOpportunitySchema/);
  assert.match(pipeline, /pipeline\.transition\.evidence/);
  assert.match(finance, /finance-risk-center/);
  assert.match(finance, /reconciliationExceptions/);
  assert.match(modulePage, /curriculum/);
  assert.match(modulePage, /organizationId/);
  assert.match(modulePage, /dueAt/);
  assert.match(dataTable, /lumina-saved-views/);
  assert.match(dataTable, /onPageSize/);
  assert.match(preferences, /localDateTimeToUtc/);
  assert.match(remediation, /crm_resource_metrics/);
  assert.match(remediation, /PAYMENT_OVERDUE/);
  assert.match(remediation, /reporting_timezone/);
  assert.match(environment, /coreRuntimeEnvironmentSchema/);
  assert.match(environment, /LOGIN_THROTTLE_HASH_SECRET_NOT_CONFIGURED/);
  assert.match(localSetup, /GetEnumerator/);
  assert.match(localSetup, /Existing and unknown keys are preserved/);
  assert.match(smoke, /previousWebhookHeartbeat/);
  assert.match(smoke, /worker_heartbeats\?on_conflict=worker_key/);
  assert.match(operations, /release-readiness/);
  assert.match(audit, /P0/);
  assert.match(plan, /最终反查/);
  assert.match(version, /2\.3\.0/);
});

test("closes the v1.2 CRM, resilience, accessibility, and product audit", async () => {
  const [
    migration,
    csv,
    pagedHook,
    remoteSearchHook,
    recordEditor,
    taskWorkspace,
    appShell,
    searchableSelect,
    resetRoute,
    duplicateRoute,
    workerCycle,
    generatedWorker,
    releaseGate,
    audit,
    plan,
    version,
  ]=await Promise.all([
    readFile(new URL("../supabase/migrations/202607190039_v120_business_closure.sql",import.meta.url),"utf8"),
    readFile(new URL("../lib/csv.ts",import.meta.url),"utf8"),
    readFile(new URL("../hooks/use-paged-resource.ts",import.meta.url),"utf8"),
    readFile(new URL("../hooks/use-remote-search.ts",import.meta.url),"utf8"),
    readFile(new URL("../components/crm-record-editor.tsx",import.meta.url),"utf8"),
    readFile(new URL("../components/task-workspace.tsx",import.meta.url),"utf8"),
    readFile(new URL("../components/app-shell.tsx",import.meta.url),"utf8"),
    readFile(new URL("../components/ui.tsx",import.meta.url),"utf8"),
    readFile(new URL("../app/api/auth/password-reset/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/api/duplicates/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../scripts/process-worker-cycle.mjs",import.meta.url),"utf8"),
    readFile(new URL("../scripts/process-generated-jobs.mjs",import.meta.url),"utf8"),
    readFile(new URL("../scripts/release-gate.mjs",import.meta.url),"utf8"),
    readFile(new URL("../docs/AUDIT_2026-07-19_V1.2.0.md",import.meta.url),"utf8"),
    readFile(new URL("../docs/IMPLEMENTATION_PLAN_V1.2.0.md",import.meta.url),"utf8"),
    readFile(new URL("../lib/version.ts",import.meta.url),"utf8"),
  ]);
  assert.match(migration,/can_assign_crm_task/);
  assert.match(migration,/crm_version_conflict/);
  assert.match(migration,/idempotent_merge_duplicate_records/);
  assert.match(migration,/create_crm_export_approval/);
  assert.match(migration,/recovery_throttle_buckets/);
  assert.match(csv,/UNCLOSED_QUOTE/);
  assert.match(csv,/TOO_MANY_ROWS/);
  assert.match(pagedHook,/AbortController/);
  assert.match(pagedHook,/router\.replace/);
  assert.match(remoteSearchHook,/sequence/);
  assert.match(recordEditor,/expectedUpdatedAt/);
  assert.match(taskWorkspace,/tasks\.teamCapacity/);
  assert.match(appShell,/nav\.skipContent/);
  assert.match(appShell,/searchHref/);
  assert.match(searchableSelect,/aria-activedescendant/);
  assert.match(searchableSelect,/scrollIntoView/);
  assert.match(resetRoute,/applyAccountRecoveryRateLimit/);
  assert.match(resetRoute,/Retry-After/);
  assert.match(duplicateRoute,/idempotent_merge_duplicate_records/);
  assert.match(workerCycle,/GENERATED_JOBS/);
  assert.match(generatedWorker,/WORKER_ID\?\.trim\(\)\|\|/);
  assert.match(releaseGate,/supabase.*test.*db/s);
  assert.match(releaseGate,/npm_execpath/);
  assert.match(audit,/CRM-01/);
  assert.match(plan,/RELEASE-02/);
  assert.match(version,/2\.3\.0/);
});

test("implements the v2 education, privacy, capability, import/export, and browser QA closure", async () => {
  const [migration, capabilities, shell, workspaces, xlsx, imports, exportWorker, releaseGate, browserQa, health, packageJson] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607190040_v200_education_privacy_intelligence.sql",import.meta.url),"utf8"),
    readFile(new URL("../lib/capabilities.ts",import.meta.url),"utf8"),
    readFile(new URL("../components/app-shell.tsx",import.meta.url),"utf8"),
    readFile(new URL("../components/v200-workspaces.tsx",import.meta.url),"utf8"),
    readFile(new URL("../lib/xlsx.ts",import.meta.url),"utf8"),
    readFile(new URL("../components/imports-page.tsx",import.meta.url),"utf8"),
    readFile(new URL("../scripts/process-generated-jobs.mjs",import.meta.url),"utf8"),
    readFile(new URL("../scripts/release-gate.mjs",import.meta.url),"utf8"),
    readFile(new URL("../scripts/browser-qa-chromium-1228.cjs",import.meta.url),"utf8"),
    readFile(new URL("../app/api/health/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../package.json",import.meta.url),"utf8"),
  ]);
  for(const table of ["households","students","progression_batches","leads","privacy_requests","ai_suggestions","import_mapping_profiles"]) assert.match(migration,new RegExp(table));
  assert.match(migration,/product_catalog_snapshot/);
  assert.match(migration,/create_crm_export_approval\([\s\S]*export_format/);
  for(const capability of ["education.manage","progression.manage","privacyRequests.manage","ai.review","workers.run"]) assert.match(capabilities,new RegExp(capability.replace(".","\\.")));
  for(const route of ["/students","/households","/progression","/leads","/ai","/privacy-requests"]) assert.match(shell,new RegExp(route));
  assert.match(workspaces,/presentApiError/);
  assert.match(xlsx,/readSheet/);
  assert.match(imports,/mappingProfiles/);
  assert.match(imports,/10_000/);
  assert.match(exportWorker,/writeXlsxFile/);
  assert.match(exportWorker,/PDFDocument/);
  assert.match(exportWorker,/@fontsource\/noto-sans-sc/);
  assert.match(releaseGate,/qa:assets/);
  assert.match(releaseGate,/qa:chromium-1228/);
  assert.match(browserQa,/ms-playwright\/chromium-1228/);
  assert.match(browserQa,/chromium-1228\/chrome-win64\/chrome\.exe/);
  assert.match(health,/SCHEDULE_WORKERS/);
  assert.match(packageJson,/"version": "2\.3\.0"/);
});

test("closes the v2.1 workflow, tenant-integrity, discovery, and UX audit", async () => {
  const [migration, behavior, workspaces, relatedSearch, dashboard, opportunitySchema, pipeline, supabaseServer, imports, audit, plan, version] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607200041_v210_workflow_closure.sql",import.meta.url),"utf8"),
    readFile(new URL("../supabase/tests/v210_workflow_closure.sql",import.meta.url),"utf8"),
    readFile(new URL("../components/v200-workspaces.tsx",import.meta.url),"utf8"),
    readFile(new URL("../lib/related-search-repository.ts",import.meta.url),"utf8"),
    readFile(new URL("../lib/dashboard-repository.ts",import.meta.url),"utf8"),
    readFile(new URL("../lib/opportunity-schema.ts",import.meta.url),"utf8"),
    readFile(new URL("../components/pipeline-page.tsx",import.meta.url),"utf8"),
    readFile(new URL("../lib/supabase-server.ts",import.meta.url),"utf8"),
    readFile(new URL("../components/imports-page.tsx",import.meta.url),"utf8"),
    readFile(new URL("../docs/AUDIT_2026-07-20_V2.1.0.md",import.meta.url),"utf8"),
    readFile(new URL("../docs/REMEDIATION_AND_PRODUCT_PLAN_V2.1.0.md",import.meta.url),"utf8"),
    readFile(new URL("../lib/version.ts",import.meta.url),"utf8"),
  ]);
  assert.match(migration,/apply_idempotency_key/);
  assert.match(migration,/grade_progression_rules/);
  assert.match(migration,/student_updated_at/);
  assert.match(migration,/subject_type='HOUSEHOLD'/);
  assert.match(migration,/workspace_household_fk/);
  assert.match(migration,/ai_suggestions_owner_open_uidx/);
  assert.match(behavior,/preview_student_progression/);
  assert.match(behavior,/Household opportunity/);
  assert.match(workspaces,/updateProgressionItem/);
  assert.match(workspaces,/saveStudentGuardian/);
  assert.match(workspaces,/saveHouseholdMember/);
  assert.match(workspaces,/status=\$\{status\}/);
  for(const type of ["STUDENT","HOUSEHOLD","LEAD"]) assert.match(relatedSearch,new RegExp(type));
  assert.match(dashboard,/pendingProgression/);
  assert.match(opportunitySchema,/HOUSEHOLD/);
  assert.match(pipeline,/subjectType === "HOUSEHOLD"/);
  assert.match(supabaseServer,/normalizeSupabaseErrorCode/);
  assert.match(imports,/import-source-file/);
  assert.match(audit,/PROG-01/);
  assert.match(plan,/REVIEW-01/);
  assert.match(version,/2\.3\.0/);
});

test("closes the v2.2 execution-integrity and business-expansion audit", async () => {
  const [
    readiness,
    privacy,
    exportIntegrity,
    expansion,
    completion,
    privacyExportFix,
    capabilities,
    workerCycle,
    generatedJobs,
    operations,
    v220Repository,
    navigation,
    metadata,
    audit,
    plan,
  ] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607200043_worker_readiness_hardening.sql",import.meta.url),"utf8"),
    readFile(new URL("../supabase/migrations/202607200044_privacy_execution_closure.sql",import.meta.url),"utf8"),
    readFile(new URL("../supabase/migrations/202607200046_multicurrency_export_integrity.sql",import.meta.url),"utf8"),
    readFile(new URL("../supabase/migrations/202607200048_business_expansion_v220.sql",import.meta.url),"utf8"),
    readFile(new URL("../supabase/migrations/202607200051_expansion_completion.sql",import.meta.url),"utf8"),
    readFile(new URL("../supabase/migrations/202607200050_privacy_export_completion_disambiguation.sql",import.meta.url),"utf8"),
    readFile(new URL("../lib/capabilities.ts",import.meta.url),"utf8"),
    readFile(new URL("../scripts/process-worker-cycle.mjs",import.meta.url),"utf8"),
    readFile(new URL("../scripts/process-generated-jobs.mjs",import.meta.url),"utf8"),
    readFile(new URL("../lib/operations-repository.ts",import.meta.url),"utf8"),
    readFile(new URL("../lib/v220-repository.ts",import.meta.url),"utf8"),
    readFile(new URL("../components/app-shell.tsx",import.meta.url),"utf8"),
    readFile(new URL("../app/layout.tsx",import.meta.url),"utf8"),
    readFile(new URL("../docs/AUDIT_2026-07-20_V2.1.1.md",import.meta.url),"utf8"),
    readFile(new URL("../docs/REMEDIATION_AND_EXPANSION_PLAN_V2.2.0.md",import.meta.url),"utf8"),
  ]);
  assert.match(readiness,/service_readiness_snapshot\(/);
  assert.match(privacy,/privacy_executions/);
  assert.match(privacy,/privacy_restrictions/);
  assert.match(exportIntegrity,/expected_row_count/);
  assert.match(exportIntegrity,/currency_scope/);
  for(const entity of ["automation_rules","growth_campaigns","portal_invitations","communication_threads","data_quality_daily_snapshots","PAYMENT"]) assert.match(expansion,new RegExp(entity));
  for(const closure of ["preview_automation_rule","retry_automation_run","portal_access_consents","record_inbound_communication","retry_communication_message","data_quality_rule_configs","connector_reconciliation_receipts","growth_performance_snapshot"]) assert.match(completion,new RegExp(closure));
  assert.match(completion,/portal_consent_required/);
  assert.match(completion,/communication_idempotency_conflict/);
  assert.match(privacyExportFix,/artifact_expires_at=\$4/);
  for(const capability of ["automation.manage","portal.manage","portal.decide","messages.manage"]) assert.match(capabilities,new RegExp(capability.replace(".","\\.")));
  assert.match(workerCycle,/featureEnabled/);
  assert.match(generatedJobs,/EXPORT_MAX_ROWS/);
  assert.match(generatedJobs,/complete_privacy_export_execution/);
  assert.match(operations,/INTEGRATION_SYNC/);
  assert.match(v220Repository,/loadAutomationWorkspace/);
  assert.match(v220Repository,/loadGrowthSnapshot/);
  assert.match(v220Repository,/retryCommunicationMessage/);
  assert.match(v220Repository,/configureQualityRule/);
  for(const route of ["/automation","/growth","/guardian-portal","/messages"]) assert.match(navigation,new RegExp(route));
  assert.match(metadata,/og-v220\.png/);
  assert.match(navigation,/mobileSearchOpen/);
  assert.match(audit,/P0/);
  assert.match(plan,/REL-01/);
  for(const page of [
    "../app/(crm)/automation/page.tsx",
    "../app/(crm)/growth/page.tsx",
    "../app/(crm)/guardian-portal/page.tsx",
    "../app/portal/invite/[token]/page.tsx",
  ]) await access(new URL(page,import.meta.url));
  await access(new URL("../public/og-v220.png",import.meta.url));
});

test("closes the v2.3.0 dependency, session, API-cache, and environment audit", async () => {
  const [
    packageJson,
    auth,
    session,
    login,
    deviceVerification,
    mfa,
    refresh,
    logout,
    password,
    api,
    localEnvironment,
    validation,
    settingsPage,
    passwordReset,
    mfaGuide,
    workspaceMessages,
    browserQa,
    authDeviceQa,
    audit,
    plan,
    finalReview,
    implementationStatus,
    version,
  ] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth-session.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/device-verification/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/mfa/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/refresh/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/configure-local-environment.ps1", import.meta.url), "utf8"),
    readFile(new URL("../lib/validation.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/settings-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/password-reset-forms.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/mfa-authenticator-guide.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n/locales/workspace-pages.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/browser-qa-chromium-1228.cjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/smoke-auth-device.cjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/AUDIT_2026-07-23_V2.2.1.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/REMEDIATION_PLAN_2026-07-23_V2.3.0.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/FINAL_REAUDIT_2026-07-23_V2.3.0.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/IMPLEMENTATION_STATUS.md", import.meta.url), "utf8"),
    readFile(new URL("../lib/version.ts", import.meta.url), "utf8"),
  ]);
  assert.match(packageJson, /"next": "16\.2\.11"/);
  assert.match(packageJson, /"sharp": "0\.35\.3"/);
  assert.match(packageJson, /"postcss": "8\.5\.14"/);
  assert.match(auth, /persistence: "crm_session_persistent"/);
  assert.match(session, /persistentSessionMaxAge/);
  assert.match(session, /persistent \? \{ \.\.\.base, maxAge:/);
  for (const source of [login, deviceVerification, mfa, refresh]) {
    assert.match(source, /setAuthSessionCookies/);
  }
  assert.match(refresh, /authCookieNames\.persistence/);
  assert.doesNotMatch(refresh, /maxAge:\s*60\s*\*\s*60\s*\*\s*24\s*\*\s*30/);
  assert.match(logout, /clearAuthSessionCookies/);
  assert.match(password, /authCookieNames\.persistence/);
  assert.match(api, /"cache-control": "no-store"/);
  assert.match(api, /headers\.has\("cache-control"\)/);
  for (const key of [
    "WEBHOOK_PAYMENT_SECRET",
    "WEBHOOKS_ENABLED",
    "INTEGRATION_SYNC_ENABLED",
    "AI_PROVIDER_ENABLED",
    "EXPORT_MAX_ROWS",
  ]) assert.match(localEnvironment, new RegExp(key));
  assert.match(validation, /passwordValueSchema/);
  assert.match(password, /newPassword: passwordValueSchema/);
  assert.match(settingsPage, /passwordValueSchema\.safeParse/);
  assert.match(passwordReset, /passwordValueSchema\.safeParse/);
  assert.doesNotMatch(passwordReset, /password\.length < 10/);
  assert.match(settingsPage, /next\.size > 5 \* 1024 \* 1024/);
  assert.match(mfaGuide, /settings\.mfaGuideMicrosoft/);
  assert.match(mfaGuide, /settings\.mfaGuideGoogle/);
  assert.match(mfaGuide, /settings\.mfaGuideOnePassword/);
  assert.match(mfaGuide, /headingLevel = "h3"/);
  assert.match(workspaceMessages, /二维码和手动密钥等同于第二验证因素/);
  assert.match(browserQa, /require\("playwright-core\/package\.json"\)|playwrightCoreVersion/);
  assert.match(browserQa, /process\.env\.PLAYWRIGHT_CORE_PATH\s*(?:\?\?|\|\|)\s*"playwright-core"/);
  assert.match(authDeviceQa, /process\.env\.PLAYWRIGHT_CORE_PATH\s*(?:\?\?|\|\|)\s*"playwright-core"/);
  assert.match(browserQa, /delete from public\.automation_events where actor_id/);
  assert.match(audit, /AUTH-01/);
  assert.match(plan, /完整验收/);
  assert.match(finalReview, /43\/43 页面\/视口/);
  assert.match(finalReview, /计划无遗漏、无未完成实现/);
  assert.match(implementationStatus, /Pinned Chromium matrix \| Pass/);
  assert.doesNotMatch(implementationStatus, /Pending continuation/);
  assert.match(version, /2\.3\.0/);
});

test("closes the v2.3.0 supplemental settings and browser audit", async () => {
  const [settingsRoute, settingsRepository, mfaRoute, settingsPage, firstLogin, browserQa, audit, plan] = await Promise.all([
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/settings-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/mfa/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/settings-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/first-login-security.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/browser-qa-chromium-1228.cjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/SUPPLEMENTAL_AUDIT_2026-07-24_V2.3.0.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/SUPPLEMENTAL_REMEDIATION_PLAN_2026-07-24_V2.3.0.md", import.meta.url), "utf8"),
  ]);
  assert.match(settingsRoute, /SECURITY_NOTIFICATION_REQUIRED/);
  assert.match(settingsRepository, /normalizeNotificationPreferences/);
  assert.match(settingsRepository, /!normalized\.security\.email && !normalized\.security\.inApp/);
  assert.match(settingsPage, /security-notification-policy/);
  assert.match(settingsPage, /setAvatar\(""\)/);
  assert.match(mfaRoute, /staleFactors/);
  assert.match(mfaRoute, /factor\.status === "verified" && isMfaRequiredRole/);
  assert.match(mfaRoute, /deleteFactor\(factor\.id, token\)\.catch/);
  assert.match(settingsPage, /settings\.mfaSetupCancelled/);
  for (const source of [settingsPage, firstLogin]) assert.match(source, /result\.challenge\?\.id/);
  for (const route of ["/forgot-password", "/reset-password", "/settings/account", "/settings/notifications", "/settings/privacy", "/admin/users", "/admin/security"]) {
    assert.match(browserQa, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(browserQa, /The final security notification channel/);
  assert.match(audit, /确认 5 项补充问题/);
  assert.match(plan, /完整验收与最终复核/);
});

test("provides a bounded one-command atomic production deployment", async () => {
  const [packageJson, deploy, webService, workerService, guide] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/deploy-production.mjs", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/lumina-crm.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/lumina-crm-workers.service", import.meta.url), "utf8"),
    readFile(new URL("../docs/DEPLOYMENT.md", import.meta.url), "utf8"),
  ]);
  assert.match(packageJson, /"deploy:production"/);
  assert.match(deploy, /DEPLOY_TOTAL_TIMEOUT_SECONDS/);
  assert.match(deploy, /value > 3600/);
  assert.match(deploy, /git", \["pull", "--ff-only"/);
  assert.match(deploy, /worktree", "add", "--detach"/);
  assert.match(deploy, /production database migration/);
  assert.match(deploy, /await pointCurrent\(releaseDir\)/);
  assert.match(deploy, /await rollback\(error\)/);
  assert.match(deploy, /AbortSignal\.timeout/);
  assert.match(deploy, /terminate\(child\)/);
  for (const unit of [webService, workerService]) {
    assert.match(unit, /TimeoutStartSec=/);
    assert.match(unit, /TimeoutStopSec=/);
    assert.match(unit, /KillMode=mixed/);
  }
  assert.match(guide, /npm run deploy:production/);
  assert.match(guide, /900 秒/);
  assert.match(guide, /不能配置成无限期/);
});

test("uses the shared 10/20/50 pagination contract for every growing list", async () => {
  const [
    ui,
    operationsRepository,
    paginationMigration,
    paginationAudit,
  ] = await Promise.all([
    readFile(new URL("../components/ui.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/operations-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202607180038_unified_pagination.sql", import.meta.url), "utf8"),
    readFile(new URL("../docs/PAGINATION_AUDIT_AND_PLAN_2026-07-18.md", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /PAGE_SIZE_OPTIONS = \[10, 20, 50\] as const/);
  assert.match(ui, /common\.pageSize/);
  assert.match(paginationMigration, /operational_retryable_jobs_page/);
  assert.match(paginationMigration, /page_size not in \(10,20,50\)/);
  assert.match(operationsRepository, /Prefer: "count=exact"/);
  assert.doesNotMatch(operationsRepository, /next_best_actions\?[^\n]*limit=100/);
  assert.match(paginationAudit, /10 \/ 20 \/ 50/);

  const componentDirectory = new URL("../components/", import.meta.url);
  const files = (await readdir(componentDirectory)).filter((name) => name.endsWith(".tsx"));
  let usageCount = 0;
  for (const file of files) {
    const source = await readFile(new URL(file, componentDirectory), "utf8");
    const usages = [...source.matchAll(/<Pagination\b[\s\S]*?\/>/g)];
    usageCount += usages.length;
    for (const [usage] of usages) {
      assert.match(usage, /\bonPageSize=/, `${file} has a Pagination without a page-size handler`);
    }
  }
  assert.ok(usageCount >= 25, `expected broad pagination coverage, found ${usageCount}`);
});

test("keeps component API calls on the shared resilient client except authentication bootstrap", async () => {
  const componentDirectory = new URL("../components/", import.meta.url);
  const files = (await readdir(componentDirectory)).filter((name) => name.endsWith(".tsx"));
  const allowed = new Set(["auth-form.tsx", "password-reset-forms.tsx"]);
  for (const file of files) {
    if (allowed.has(file)) continue;
    const source = await readFile(new URL(file, componentDirectory), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} bypasses apiFetch`);
  }
});

test("defines every static CSS custom property or supplies a fallback", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const definitions = new Set([...css.matchAll(/--([A-Za-z0-9-]+)\s*:/g)].map((match) => match[1]));
  const unresolved = [...css.matchAll(/var\(\s*--([A-Za-z0-9-]+)([^)]*)\)/g)]
    .filter((match) => !definitions.has(match[1]) && !match[2].includes(","))
    .map((match) => match[1]);
  assert.deepEqual([...new Set(unresolved)], []);
});
