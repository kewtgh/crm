import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FinanceCollectionChart} from '../components/finance-collection-chart.tsx';
import {SupportAnalyticsCharts} from '../components/support-analytics-charts.tsx';
import {I18nProvider} from '../components/i18n-provider.tsx';
import {zhCN} from '../lib/i18n/locales/zh-CN.ts';
import {financeChartFixture,supportChartFixture} from './fixtures/analytics-finance.ts';
const render=node=>renderToStaticMarkup(React.createElement(I18nProvider,{initialLocale:'zh-CN',initialMessages:zhCN},node));
test('collection visualization preserves exact per-currency server values and states their meaning',()=>{
 const data=financeChartFixture(),before=structuredClone(data);
 const html=render(React.createElement(FinanceCollectionChart,{series:data.collectionSeries}));
 assert.equal((html.match(/class="finance-currency-chart"/g)||[]).length,2);
 for(const amount of ['CNY 1000.00','CNY 700.00','USD 200.00','USD 100.00'])assert.ok(html.includes(amount));
 assert.ok(html.includes('这些金额不是已确认收入'));assert.ok(!html.includes('2700.00'));assert.deepEqual(data,before);
});
test('support chart exposes actual series and accessible tabular values; empty data remains empty',()=>{
 const data=supportChartFixture(),html=render(React.createElement(SupportAnalyticsCharts,{data}));
 assert.equal((html.match(/<polyline/g)||[]).length,3);assert.equal((html.match(/<tbody>/g)||[]).length,1);
 assert.ok(html.includes('2026-05'));assert.ok(html.includes('role="img"'));
 assert.equal((render(React.createElement(FinanceCollectionChart,{series:[]})).match(/class="finance-currency-chart"/g)||[]).length,0);
});
test('buyer and student boundaries are enforced beyond frontend labels',()=>{
 const sql=readFileSync('db/migrations/202610080126_personal_financial_buyers.sql','utf8');
 assert.match(sql,/num_nonnulls\(organization_id,household_id,buyer_contact_id\)=1/);
 assert.match(sql,/BUYER_REPRESENTATIVE_MISMATCH/);assert.match(sql,/security_invoker=true/);
 assert.match(sql,/CUSTOMER_QUOTE_CREATE/);assert.match(sql,/group by c.currency/);
 assert.doesNotMatch(sql,/insert into public\.(recognized_revenue_facts|revenue_recognition_candidates)/i);
 const ui=readFileSync('components/enrollment-relation.tsx','utf8');assert.ok(ui.includes('item.value.startsWith(`${type}:`)'));
 const create=readFileSync('components/finance-page.tsx','utf8');assert.match(create,/useReceiptMutation/);assert.match(create,/quoteMutation.uncertain/);
});
