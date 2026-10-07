import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const sql = readFileSync(new URL("../db/migrations/202610080117_revenue_candidates.sql", import.meta.url), "utf8");
test("R5C owns only immutable candidates; approval cannot post or create cash", () => {
  assert.deepEqual([...sql.matchAll(/create table public\.(\w+)/g)].map(x => x[1]), ["revenue_recognition_candidates"]);
  assert.doesNotMatch(sql, /insert into public\.(payments|refunds|receivable_schedules|commission_accruals|recognized_revenue_facts|cash_applications)/);
  for (const invariant of ["revenue_candidate_immutable", "revenue_retention_required", "numeric(14,2)", "R5C_EVALUATOR_V1", "revenue_digest"]) assert.ok(sql.includes(invariant));
});
test("evaluator reads exact approved basis and accepted healthy evidence, never cash or catalog price", () => {
  const evaluator = sql.slice(sql.indexOf("create function public.revenue_candidate_basis"), sql.indexOf("create function public.revenue_candidate_current"));
  assert.doesNotMatch(evaluator, /public\.(payments|refunds|commission_accruals|product_prices)|float|double precision|status='COMPLETED'/);
  for (const invariant of ["b.status<>'APPROVED'", "p.test_only", "commercial_accepted_at", "status='ACCEPTED'", "revenue_resolve_evidence", "revenue_source_changed", "revenue_fulfillment_required", "revenue_period_closed", "revenue_unit_cross_period_unsupported", "APPROVED_AGENT_FEE", "APPROVED_ALLOCATED_CONSIDERATION", "revenue_allocation_required", "revenue_currency_precision_unsupported"]) assert.ok(evaluator.includes(invariant), invariant);
});
test("semantic identity, designated independent review and basis revalidation are database contracts", () => {
  for (const invariant of ["revenue_candidate_live_unit", "recognition_unit_key,basis_digest", "RECOGNITION_PREPARER", "RECOGNITION_REVIEWER", "revenue_require", "c.created_by=app_auth.current_user_id()", "revenue_stale_basis", "revenue_candidate_current", "commission_receipt", "commission_finish", "enable row level security", "foreign key(workspace_id,reporting_entity_id", "approval_actions"]) assert.ok(sql.includes(invariant), invariant);
  assert.match(sql, /div\(numerator,denominator\)/);
  assert.match(sql, /mod\(numerator,denominator\)/);
  assert.match(sql, /fractional_numerator desc,n,key collate "C"/);
});
test("repository evaluation surface cannot accept client financial or evidence fields", () => {
  const repo = readFileSync(new URL("../lib/revenue-candidate-repository.ts", import.meta.url), "utf8");
  const evaluate = repo.slice(0, repo.indexOf("export function review"));
  assert.doesNotMatch(evaluate, /amount|currency|business_date|policy_version|evidence|presentation/);
  const runner = readFileSync(new URL("../scripts/test-revenue-candidate-postgres.mjs", import.meta.url), "utf8");
  for (const safety of ["--tmpfs", "127.0.0.1::5432", "--pull=never", "finally", "POSTGRES_PASSWORD"]) assert.ok(runner.includes(safety));
  assert.doesNotMatch(runner, /dotenv|readFileSync.*env\.local/);
});
