import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(new URL("../db/migrations/202610080118_revenue_facts.sql", import.meta.url), "utf8");
const repository = readFileSync(new URL("../lib/revenue-fact-repository.ts", import.meta.url), "utf8");
const posting = sql.slice(sql.indexOf("create function public.revenue_post_candidate"), sql.indexOf("-- Direct inserts"));
const correction = sql.slice(sql.indexOf("create function public.revenue_correction_basis"), sql.indexOf("create or replace function public.revenue_candidate_current"));

test("R5D adds one fact owner and leaves cash, commissions and ledger outside posting", () => {
  assert.deepEqual([...sql.matchAll(/create table public\.(\w+)/g)].map(x => x[1]), ["recognized_revenue_facts"]);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) public\.(?:payments|refunds|receivable_schedules|commission_accruals|commission_settlements|cash_applications)\b/);
  assert.doesNotMatch(sql, /create (?:table|function).*?(?:journal|auto_post|worker)/);
  assert.doesNotMatch(posting, /status='COMPLETED'|NET_CASH|PRODUCT_CURRENT_PRICE|provider_cost/);
  assert.equal([...sql.matchAll(/insert into public\.recognized_revenue_facts/g)].length, 1);
});

test("only current approved independently reviewed candidates can be posted by designated AAL2 poster", () => {
  for (const invariant of ["revenue_require(entity,'POSTING_AUTHORITY')", "revenue_has_authority(entity,'POSTING_AUTHORITY')", "c.status<>'APPROVED'", "actor=c.created_by or actor=c.reviewed_by", "p.test_only", "approval.status<>'APPROVED'", "approval.request_payload->>'digest'", "revenue_candidate_current(c.id)", "status='OPEN'", "revenue_correction_required"])
    assert.ok(posting.includes(invariant), invariant);
  assert.match(sql, /revoke all on public\.recognized_revenue_facts from public,crm_app,crm_system,crm_worker/);
  assert.match(sql, /enable row level security/);
});

test("facts are immutable, original identity is semantic and candidates can be consumed once", () => {
  assert.match(sql, /candidate_id uuid not null unique/);
  assert.match(sql, /revenue_original_earning_unit.*workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key.*where fact_kind='ORIGINAL'/);
  assert.match(sql, /before update or delete on public\.recognized_revenue_facts/);
  assert.match(sql, /raise exception 'revenue_fact_immutable'/);
  assert.doesNotMatch(sql, /(?:update|delete from) public\.recognized_revenue_facts/);
  assert.match(sql, /constraint trigger revenue_fact_atomic_receipt.*deferrable initially deferred/);
  assert.match(sql, /revenue_posting_receipt_required/);
  assert.match(sql, /foreign key\(workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key,currency,original_fact_id\)/);
});

test("corrections derive signed deltas from approved entitlement and pinned append-only consumption", () => {
  assert.match(correction, /r\.status<>'APPROVED'/);
  assert.match(correction, /revenue_candidate_current\(r\.id\)/);
  assert.match(correction, /delta:=r\.amount-\(consumption->>'current_amount'\)::numeric/);
  assert.match(correction, /kind='REVERSAL' and delta>=0/);
  assert.match(correction, /root_policy\.correction_rule/);
  assert.match(correction, /revenue_prior_period_policy_required/);
  assert.doesNotMatch(correction, /delta:=.*rf\.amount/);
  assert.match(sql, /revenue_fact_correction_intent/);
  assert.match(sql, /revenue_correction_intent_conflict/);
  assert.match(sql, /revenue_correction_balance_conflict/);
  assert.match(sql, /candidate_kind='ORIGINAL' and status in/);
  assert.doesNotMatch(sql, /float|double precision/);
  assert.match(sql, /amount numeric\(14,2\)/);
});

test("repository exposes reference-only posting and correction, without monetary overrides", () => {
  assert.doesNotMatch(repository, /amount:|currency:|business_date:|Number\(|parseFloat/);
  for (const operation of ["revenue_post_candidate", "revenue_evaluate_correction", "revenue_set_correction_rule", "revenue_recognized_lineage"])
    assert.ok(repository.includes(`/db/rpc/${operation}`));
  const capabilities = readFileSync(new URL("../lib/capabilities.ts", import.meta.url), "utf8");
  assert.ok(capabilities.slice(capabilities.indexOf("export const aal2Capabilities")).includes('"revenue.recognition.post"'));
});
