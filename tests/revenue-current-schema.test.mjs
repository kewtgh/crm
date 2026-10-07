import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
const read=p=>readFileSync(p,'utf8');
const migrations=readdirSync('db/migrations').filter(p=>/\.sql$/.test(p)).sort();
const chain=migrations.filter(p=>/^2026100[78]01(1[5-9]|20)_/.test(p)).map(p=>read(`db/migrations/${p}`)).join('\n');
test('CURRENT_SCHEMA release metadata is 3.32.0 without rewriting phase reports',()=>{
 assert.equal(JSON.parse(read('package.json')).version,'3.32.0');assert.equal(JSON.parse(read('package-lock.json')).version,'3.32.0');assert.match(read('lib/version.ts'),/"3\.32\.0"/);
 assert.match(read('docs/REVENUE_R5F_READ_UI_VERIFICATION.md'),/3\.31\.0/);
});
test('CURRENT_SCHEMA has exactly the approved persistent foundation owners',()=>{
 assert.equal(migrations.length,125);assert.match(migrations.at(-1),/0120_/);
 const tables=[...chain.matchAll(/create table public\.(\w+)/g)].map(m=>m[1]);
 assert.deepEqual(tables,['revenue_reporting_profiles','revenue_authority_assignments','revenue_accounting_periods','revenue_policy_versions','contract_specified_services','revenue_service_bindings','revenue_fulfillment_attestations','revenue_recognition_candidates','recognized_revenue_facts','cash_applications']);
 assert.doesNotMatch(chain,/create table public\.(revenue_payments|revenue_refunds|revenue_receivables|revenue_contracts|revenue_commissions|.*journal)/);
});
test('CURRENT_SCHEMA compatibility preserves historical test entry points',()=>{
 assert.match(read('scripts/test-revenue-candidate-postgres.mjs'),/to_regclass\('public.recognized_revenue_facts'\) x"\)\)\.x,null/);
 assert.match(read('scripts/test-revenue-fact-postgres.mjs'),/to_regclass\('public.cash_applications'\) x"\)\)\.x,null/);
 const current=read('scripts/test-revenue-current-postgres.mjs');assert.match(current,/CURRENT_SCHEMA/);assert.match(current,/test-revenue-upgrade-postgres/);assert.match(current,/test-revenue-integrated-postgres/);
});
test('read security functions have fixed search paths and explicit grants',()=>{
 const sql=read('db/migrations/202610080120_revenue_workspace_reads.sql');
 assert.equal((sql.match(/security definer/g)||[]).length,(sql.match(/security definer set search_path=/g)||[]).length);
 assert.match(sql,/revenue_has_authority/);assert.match(sql,/revenue_ui_contract_read/);assert.match(sql,/revoke all on function/);
 assert.match(sql,/limit 25 offset/);assert.match(sql,/limit 100 offset/);assert.match(sql,/group by f.currency/);
 assert.doesNotMatch(sql,/create table|insert into|update public\.|delete from/i);
});
test('the integrated API test uses real authentication and user-scoped database access',()=>{
 const testSource=read('scripts/test-revenue-api-current.mjs');assert.match(testSource,/createSession/);assert.match(testSource,/app\/api\/revenue\/route.ts/);assert.match(testSource,/127\.0\.0\.1/);assert.match(testSource,/MFA_REQUIRED/);
 assert.doesNotMatch(testSource,/mock.*requireApiCapability|mock.*databaseJson/);
 const api=read('app/api/revenue/route.ts');assert.match(api,/requireApiCapability/);assert.match(api,/MFA_REQUIRED/);assert.match(api,/mutationIsTrusted/);assert.doesNotMatch(api,/databaseSystemJson/);
});
