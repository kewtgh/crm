import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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
  assert.match(packageJson, /"version": "1\.0\.0"/);
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
  assert.match(packageJson, /"version": "1\.0\.0"/);
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
  for (const hidden of ["nav.students", "nav.households", "nav.progression", "nav.ai", "nav.leads"]) assert.doesNotMatch(shell, new RegExp(hidden));
  for (const removed of ["students", "households", "progression", "ai", "leads"]) await assert.rejects(access(new URL(`../app/(crm)/${removed}/page.tsx`, import.meta.url)));
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
  assert.match(mfaRoute, /session\.access_token/);
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
