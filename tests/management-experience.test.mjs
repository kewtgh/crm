import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { executiveFixture, trendsFixture, supportFixture } from './fixtures/management-experience.ts';
import { executiveKpiKeys, periodChangeKeys, domainSummaryKeys, moduleState, selectMetrics, selectChanges, validateOverview, validateTrends, validateSuccessAnalytics, scopeCount, scopeQuery } from '../lib/management-ux-presentation.ts';
import { metricDefinitions } from '../lib/management-metric-contract.ts';
import { overviewFiltersSchema, metricDrillHref, metricContextHref } from '../lib/management-trend-contract.ts';
import { successAnalyticsFiltersSchema } from '../lib/student-success-outcomes-input.ts';
import { zhManagementUX, enManagementUX } from '../lib/i18n/locales/management-ux.ts';
const source = file => fs.readFileSync(file, 'utf8');

test('explicit KPI/domain priorities keep modes and separate currencies without aggregation', () => {
  const data = validateOverview(executiveFixture()), before = structuredClone(data);
  assert.deepEqual(executiveKpiKeys, ['openOpportunities','activeEnrollments','applicationsInProgress','atRiskCases','outstanding','overdue']);
  assert.deepEqual(selectMetrics(data, executiveKpiKeys).filter(m => m.key === 'outstanding').map(m => [m.currency,m.value]), [['CNY','82000.00'],['USD','5000.00']]);
  for (const keys of Object.values(domainSummaryKeys)) assert.equal(keys.length,3);
  for (const metric of selectMetrics(data, executiveKpiKeys)) assert.equal(metric.mode,metricDefinitions[metric.key][1]);
  assert.deepEqual(data,before);
});
test('PERIOD comparison selection is deterministic, snapshot series never appear; null remains null', () => {
  const data = validateTrends(trendsFixture());
  data.series.reverse();
  data.series.push({ ...data.series[0], key: 'openOpportunities', module: 'commercial', unit:'COUNT', currency:null });
  const selected = selectChanges(data);
  assert.deepEqual(selected.map(s => s.key), ['leadsCreated','leadsConverted','enrollmentsActivated','applicationsSubmitted','payments_in_period','payments_in_period','outcomesRecorded']);
  assert.ok(periodChangeKeys.every(key => metricDefinitions[key][1] === 'PERIOD'));
  assert.equal(selected[1].comparison.percentChange,null);
  assert.deepEqual(selected.filter(s => s.unit==='MONEY').map(s=>s.currency),['CNY','USD']);
  data.permissions.finance = false;
  assert.ok(!selectChanges(data).some(s => s.unit==='MONEY'));
});
test('restricted, unavailable and valid zero are distinct, and unauthorized money is omitted', () => {
  const data = executiveFixture();
  data.permissions.finance=false;
  assert.equal(moduleState(data,'finance'),'restricted');
  assert.ok(!selectMetrics(data,executiveKpiKeys).some(m=>m.unit==='MONEY'));
  data.permissions.finance=true;data.modules.finance.available=false;
  assert.equal(moduleState(data,'finance'),'unavailable');
  assert.ok(!selectMetrics(data,executiveKpiKeys).some(m=>m.unit==='MONEY'));
  data.modules.finance.available=true;data.modules.finance.metrics.find(m=>m.key==='overdue').value='0.00';
  assert.equal(moduleState(data,'finance'),'available');
  assert.equal(selectMetrics(data,['overdue'])[0].value,'0.00');
  data.permissions.commissionMoney=false;
  assert.deepEqual(selectMetrics(data,['commissionNet']),[]);
});
test('malformed required facts fail closed; optional absence is not invented zero', () => {
  for (const [fixture,validate,mutate] of [
    [executiveFixture,validateOverview,d=>delete d.attention.total],
    [trendsFixture,validateTrends,d=>delete d.series[0].comparison.current],
    [supportFixture,validateSuccessAnalytics,d=>delete d.snapshot.activeCases],
    [supportFixture,validateSuccessAnalytics,d=>delete d.period.outcomesRecorded],
  ]) { const data=fixture();mutate(data);assert.throws(()=>validate(data)); }
  const data=supportFixture();data.snapshot.goalAttainment={achieved:0,evaluated:0,rate:null};
  assert.equal(validateSuccessAnalytics(data).snapshot.goalAttainment.rate,null);
  data.snapshot.goalAttainment.rate=0;assert.throws(()=>validateSuccessAnalytics(data));
  const other=supportFixture();delete other.snapshot.distributions.riskType;delete other.trends[0].counts.outcomes;
  assert.equal(validateSuccessAnalytics(other),other);
  assert.equal(other.trends[0].counts.outcomes,undefined);
  const money=executiveFixture();money.modules.finance.metrics[0].currency=null;assert.throws(()=>validateOverview(money));
  const wrongUnit=executiveFixture();wrongUnit.modules.delivery.metrics[0].unit='MONEY';assert.throws(()=>validateOverview(wrongUnit));
  const floatMoney=trendsFixture();floatMoney.series.find(s=>s.unit==='MONEY').comparison.current=20000.01;assert.throws(()=>validateTrends(floatMoney));
});
test('canonical scope validation and counting do not broaden supported query semantics', () => {
  const input={from:'2026-10-01',to:'2026-10-05',productId:'00000000-0000-4000-8000-000000000010'};
  assert.equal(scopeCount(input),2);
  assert.equal(scopeQuery(input),scopeQuery({...input,to:input.to,from:input.from}));
  assert.ok(overviewFiltersSchema.safeParse(input).success);
  assert.ok(!overviewFiltersSchema.safeParse({...input,ownerId:input.productId}).success);
  assert.ok(successAnalyticsFiltersSchema.safeParse({...input,ownerId:input.productId,health:'AT_RISK'}).success);
  assert.ok(!overviewFiltersSchema.safeParse({...input,to:'2026-09-01'}).success);
});
test('exact drilldowns retain supported date/product/cohort/currency; workspace fallback stays honest', () => {
  const filters={from:'2026-10-01',to:'2026-10-05',productId:'00000000-0000-4000-8000-000000000010',cohortId:'00000000-0000-4000-8000-000000000011'};
  const url=new URL(metricDrillHref({key:'payments_in_period',mode:'PERIOD',currency:'USD'},filters),'http://example.test');
  for (const key of ['from','to','productId','cohortId'])assert.equal(url.searchParams.get(key),filters[key]);
  assert.equal(url.searchParams.get('currency'),'USD');
  assert.equal(metricDrillHref({key:'goalAttainment',mode:'SNAPSHOT',currency:null},filters),null);
  assert.equal(metricContextHref('openOpportunities',filters),'/opportunities');
  assert.ok(!metricDrillHref({key:'openOpportunities',mode:'SNAPSHOT',currency:null},filters).includes('from='));
});
test('hierarchy, independent scope-bound loading, disclosure and draft ownership stay presentation-only', () => {
  const executive=source('components/executive-overview-page.tsx'),support=source('components/student-success-analytics.tsx'),hook=source('hooks/use-scope-query.ts');
  assert.ok(executive.indexOf('executive-attention')<executive.indexOf('executive-changes'));
  assert.ok(executive.indexOf('executive-changes')<executive.indexOf('executive-kpis'));
  assert.ok(executive.indexOf('executive-kpis')<executive.indexOf('data-domain-detail'));
  assert.match(executive,/useScopeQuery\("\/api\/management\/overview"/);assert.match(executive,/useScopeQuery\("\/api\/management\/trends"/);
  assert.match(executive,/trends.failure/);assert.match(executive,/trends.retry/);
  assert.match(hook,/stored\?\.key === key/);assert.match(hook,/AbortController/);
  for(const id of ['support-health','support-goals','support-outcomes','support-comparison','support-trends','support-distributions'])assert.ok(support.includes(id));
  assert.match(support,/rate === null/);assert.match(support,/goalAttainment.evaluated/);
  assert.doesNotMatch(executive,/<ManagementTrendsPanel/);
  assert.doesNotMatch(executive,/<details[^>]*\bopen[ =>]/);
  const scope=source('components/management-scope.tsx');assert.match(scope,/cohortId: undefined/);assert.match(scope,/safeParse\(filters\)/);
  const bar=source('components/filter-bar.tsx');assert.match(bar,/onApply\(\{ \.\.\.draft \}\) !== false/);assert.match(bar,/setDraft\(\{ \.\.\.applied \}\)/);
  const workspace=source('components/student-success-workspace.tsx');assert.match(workspace,/<DetailTabs items=/);assert.match(workspace,/active=\{tab\} onChange=\{setTab\}/);
});
test('new bilingual labels, neutral change direction, safe null comparison and no technical fallbacks', () => {
  assert.deepEqual(Object.keys(zhManagementUX).sort(),Object.keys(enManagementUX).sort());
  const trends=source('components/management-trends.tsx');
  assert.match(trends,/comparison.percentChange === null \? t\("ux.management.notComparable"\)/);
  assert.match(trends,/"increased" : .*"decreased" : "unchanged"/);
  assert.doesNotMatch(trends,/messages\[key\] \?\? key|green|red|calculate|comparablePeriod\(/);
});
