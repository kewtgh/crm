import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(new URL("../db/migrations/202610070115_revenue_foundation.sql", import.meta.url), "utf8");
test("R5A adds exactly six owners and no recognition or duplicate cash owner", () => {
  const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map(m => m[1]);
  assert.deepEqual(tables, ["revenue_reporting_profiles", "revenue_authority_assignments", "revenue_accounting_periods", "revenue_policy_versions", "contract_specified_services", "revenue_service_bindings"]);
  for (const name of ["recognized_revenue_facts", "revenue_recognition_candidates", "revenue_fulfillment_attestations", "cash_applications", "revenue_payments", "revenue_refunds", "revenue_contracts"]) assert.ok(!tables.includes(name));
});
test("foundation protects scopes, review basis, prices and source history", () => {
  for (const invariant of ["numeric(14,2)", "numeric(18,6)", "revenue_stale_approval", "revenue_accepted_version_immutable", "revenue_quote_provenance_immutable", "revenue_service_immutable", "revenue_test_only_forbidden", "revenue_aal2_required", "revenue_authority_required", "revenue_self_approval_forbidden", "revenue_period_overlap", "commission_receipt", "commission_finish", "enable row level security"]) assert.ok(sql.includes(invariant), invariant);
  assert.match(sql, /grant execute on function public\.provision_revenue_profile.*to crm_migrator/);
  assert.match(sql, /create trigger revenue_approval_guard before update/);
  assert.match(sql, /foreign key\(workspace_id,reporting_entity_id,policy_version_id\)/);
});
test("test runner creates disposable local database and never loads application environment", () => {
  const runner = readFileSync(new URL("../scripts/test-revenue-foundation-postgres.mjs", import.meta.url), "utf8");
  for (const guard of ["--tmpfs", "127.0.0.1::5432", "--pull=never", "finally", '"rm", "--force", name']) assert.ok(runner.includes(guard));
  assert.ok(!runner.includes("--env-file"));
});
