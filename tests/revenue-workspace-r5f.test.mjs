import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const sql=read('db/migrations/202610080120_revenue_workspace_reads.sql');
const ui=read('components/revenue-workspace.tsx');
const api=read('app/api/revenue/route.ts');
test('read migration has no persistent owner or accounting mutation',()=>{
 assert.doesNotMatch(sql,/create\s+table|insert\s+into|update\s+public\.|delete\s+from/i);
 assert.match(sql,/sum\(f.amount\).*from public.recognized_revenue_facts/s);assert.match(sql,/group by f.currency/);
 assert.match(sql,/contract_finance_snapshot/);assert.match(sql,/sum\(commission_amount\)/);
});
test('bounded read eligibility requires designation, contract scope and three actors',()=>{
 assert.match(sql,/revenue_has_authority/);assert.match(sql,/public.cash_contract_access/);
 assert.match(sql,/c.created_by<>actor and c.reviewed_by<>actor/);assert.match(sql,/health->>'health'='CURRENT' and c.period_status='OPEN'/);
 assert.match(sql,/limit 25 offset/);assert.match(sql,/revoke all on function public.revenue_ui_health/);
});
test('pending totals exclude consumed candidates and cumulative originals',()=>{
 assert.match(sql,/q->>'fact_id' is null/);assert.match(sql,/q->>'candidate_kind'='ORIGINAL' and exists/);assert.match(sql,/f.fact_kind='ORIGINAL'/);
 assert.match(sql,/newer.created_at,newer.id/);assert.match(sql,/newer.recognition_unit_key=q->>'recognition_unit_key'/);
});
test('frontend renders server decimal strings; no financial arithmetic or role bypass',()=>{
 assert.doesNotMatch(ui,/parseFloat|Number\([^)]*(?:amount|balance)|role\s*===\s*['"](?:ADMIN|SUPER_ADMIN)/);
 assert.match(ui,/r.actions.map/);assert.match(ui,/r.can_review/);
 assert.doesNotMatch(api,/recognized_revenue_facts.*(?:insert|update)|revenue\.admin/i);
 assert.match(api,/revenue_post_candidate/);assert.match(api,/mutationIsTrusted/);assert.match(api,/user.aal!==['"]aal2/);
});
test('accepted refresh failures never replay writes; unknown outcome retains identity',()=>{
 assert.match(ui,/settleMutation/);assert.match(ui,/setRetry\(payload\)/);assert.match(ui,/sessionStorage.setItem\(receiptStorage/);
 assert.match(ui,/accepted:true/);assert.match(ui,/saved-refresh-failed|refreshFailed/);assert.match(ui,/onClick=\{refresh\}/);
});
test('synthetic values intentionally distinguish financial concepts and currencies',()=>{
 const f=JSON.parse(read('tests/fixtures/revenue-workspace-r5f.json'));assert.equal(f.synthetic,true);
 assert.equal(f.contracts[0].contracted,'1000.00');assert.equal(f.contracts[0].receivable,'1000.00');assert.equal(f.contracts[0].collected,'700.00');assert.equal(f.recognized[0].amount,'400.00');assert.equal(f.commissions[0].amount,'100.00');
 assert.deepEqual(f.recognized.map(x=>x.currency),['CNY','USD']);assert.equal(f.cash[0].amount,'100.00');assert.equal(f.cash[0].applied,'60.00');assert.equal(f.cash[0].available,'40.00');
 assert.equal(f.facts[0].amount,'100.00');assert.equal(f.facts[1].amount,'-30.00');
});
