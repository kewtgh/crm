import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const sql = readFileSync(new URL("../db/migrations/202610070116_revenue_fulfillment.sql", import.meta.url), "utf8");
test("R5B adds one evidence owner without money, recognition or cash owners", () => {
  assert.deepEqual([...sql.matchAll(/create table public\.(\w+)/g)].map(m => m[1]), ["revenue_fulfillment_attestations"]);
  const table = sql.slice(sql.indexOf("create table"), sql.indexOf("create index"));
  assert.doesNotMatch(table, /\b(amount|currency|recognized_amount|revenue_amount)\b/);
  assert.doesNotMatch(sql, /create table public\.(revenue_recognition_candidates|recognized_revenue_facts|cash_applications)/);
});
test("resolver is explicit and status alone cannot qualify", () => {
  const resolver = sql.slice(sql.indexOf("create function public.revenue_resolve_evidence"), sql.indexOf("create function public.revenue_set_fulfillment_requirements"));
  assert.doesNotMatch(resolver, /\bexecute\b/i);
  for (const guard of ["CRM_ACTIVITY", "STUDENT_ENROLLMENT", "revenue_source_domain_unsupported", "revenue_source_unavailable", "for share"]) assert.ok(resolver.includes(guard));
  for (const guard of ["revenue_evidence_rule_required", "source_ids", "fulfillment_requirements", "revenue_business_date_invalid", "revenue_source_changed"]) assert.ok(sql.includes(guard));
});
test("review authority, immutable material basis, unit continuity and withdrawal are explicit", () => {
  for (const guard of ["EVIDENCE_VERIFIER", "actor=item.attested_by", "revenue_evidence_immutable", "revenue_retention_required", "revenue_binding_not_approved", "p.test_only", "revenue_digest", "revenue_unit_already_satisfied", "revenue_coverage_overlap", "x.stable_service_key=s.stable_service_key", "withdrawal_reference", "supersedes_attestation_id", "commission_receipt", "commission_finish", "enable row level security"]) assert.ok(sql.includes(guard), guard);
  assert.doesNotMatch(sql, /command='(?:POST|EVALUATE_RECOGNITION|APPROVE_RECOGNITION)'/);
});
