import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const sql = readFileSync(new URL("../db/migrations/202610080119_cash_applications.sql", import.meta.url), "utf8");

test("one cash-application owner, existing Payment/Refund/Receivable retain their facts", () => {
  assert.deepEqual([...sql.matchAll(/create table public\.(\w+)/g)].map(x => x[1]), ["cash_applications"]);
  assert.match(sql, /alter table public\.payments add column purpose/);
  assert.match(sql, /default 'TRADE_RECEIPT'/);
  assert.match(sql, /create function public\.record_payment\(/);
  assert.match(sql, /create function public\.request_refund\(/);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) public\.(revenue_recognition_candidates|recognized_revenue_facts|commission_accruals|commission_settlements)/);
  assert.doesNotMatch(sql, /create table.*(?:journal|payable|deposit|revenue_payment)/);
});

test("custody needs accepted scoped terms and has no fabricated trade receivable", () => {
  for (const contract of ["purpose='CUSTODY_RECEIPT' and contract_id is null", "receivable_schedule_id is null", "commercial_accepted_at is not null", "cash_contract_access(s.contract_id,true)", "x.reporting_entity_id=entity", "permitted_service_ids", "cash_one_declaration", "cash_declaration_required", "cash_purpose_immutable"])
    assert.ok(sql.includes(contract), contract);
  assert.match(sql, /foreign key\(workspace_id,reporting_entity_id,source_payment_id\)/);
  assert.match(sql, /foreign key\(workspace_id,target_contract_id,target_receivable_id\)/);
});

test("source capacity includes reserved refunds once; target and reversal ceilings are exact", () => {
  assert.match(sql, /status in \('PENDING_APPROVAL','APPROVED'\)/);
  assert.match(sql, /p\.amount-p\.refunded_amount-reserved-used/);
  assert.match(sql, /reserved\+new\.amount\+public\.cash_net_applied\(p\.id\)>p\.amount/);
  assert.match(sql, /amount_value>t\.amount-t\.paid_amount/);
  assert.match(sql, /amount_value>a\.amount-reversed/);
  assert.match(sql, /s\.currency<>p\.currency/);
  assert.match(sql, /c\.currency<>p\.currency/);
  assert.match(sql, /refresh_receivable\(t\.id\)/);
  assert.match(sql, /numeric\(14,2\)/);
  assert.doesNotMatch(sql, /float|double precision|exchange_rate|recognized_revenue_facts/);
});

test("cash mutations are immutable, designated, AAL2-governed and receipt-backed", () => {
  for (const invariant of ["revenue_require(entity,'CASH_APPLICATION_MANAGER')", "revenue_has_authority(entity,'CASH_APPLICATION_MANAGER')", "pg_advisory_xact_lock", "cash_finance_lock", "commission_receipt", "commission_finish", "cash_intent_conflict", "cash_application_immutable", "before update or delete on public.cash_applications", "cash_refund_approval_guard", "cash_refund_guard", "cash_atomic_receipt", "enable row level security"])
    assert.ok(sql.includes(invariant), invariant);
  assert.match(sql, /revoke all on public\.cash_applications from public,crm_app,crm_system,crm_worker/);
  assert.match(sql, /unique\(workspace_id,reporting_entity_id,source_payment_id,application_intent_key\)/);
});

test("classified reads add applied settlement once and exclude custody from legacy receipt views", () => {
  assert.match(sql, /cash_payment_read_boundary.*restrictive.*purpose='TRADE_RECEIPT'/);
  assert.match(sql, /coalesce\(p\.collected,0\)\+public\.cash_contract_settled\(c\.id\)/);
  assert.match(sql, /cash_contract_settled\(c\.id\)::text applied_cash/);
  const adapter = readFileSync(new URL("../lib/cash-application-repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(adapter, /parseFloat|Number\(|available_cash:|remaining_target:/);
  assert.match(adapter, /amount: string/);
  assert.ok(adapter.includes("/db/rpc/record_payment"));
});

test("R5D compatibility mode changes only the known phase-absence assertion", () => {
  const source = readFileSync(new URL("../scripts/test-revenue-fact-current-compat-postgres.mjs", import.meta.url), "utf8");
  assert.match(source, /financialAssertionsChanged: false/);
  assert.match(source, /historical test bytes remain unchanged/);
  assert.match(source, /assert\.equal\(original\.split\(obsolete\)\.length, 2/);
  assert.match(source, /202610080118_revenue_facts\.sql/);
  assert.match(source, /202610080119_cash_applications\.sql/);
});
