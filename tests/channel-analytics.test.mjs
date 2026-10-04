import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {channelAnalyticsFilters,formatChannelCommissionAmount} from '../lib/channel-analytics-input.ts';
import {getChannelAnalytics} from '../lib/channel-analytics-repository.ts';
import {enChannelAnalytics,zhCNChannelAnalytics} from '../lib/i18n/locales/channel-analytics.ts';
test('analytics periods and explicit filters reject reversed, invalid and unbounded inputs',()=>{
 assert.ok(channelAnalyticsFilters.safeParse({from:'2026-01-01',to:'2026-12-31',tier:'UNKNOWN',product:randomUUID(),sort:'primary',page:'2'}).success);
 for(const bad of [{from:'2026-02-30'},{from:'2027-01-01',to:'2026-01-01'},{from:'2000-01-01',to:'2026-01-01'},{tier:'0'},{sort:'revenue'},{page:0},{score:50}])assert.equal(channelAnalyticsFilters.safeParse(bad).success,false);
});
test('repository sends validated filters to caller-scoped read-only projection without system credentials or client money arithmetic',async()=>{
 const filters={organization:randomUUID(),cohort:randomUUID(),tier:'UNKNOWN',from:'2026-01-01',to:'2026-12-31'},response={snapshot:{visibleAccounts:1},commissionByCurrency:[{currency:'CNY',net:'8000.00'},{currency:'USD',net:'1000.00'}],items:[{commercialTier:null,partnershipPotential:null}]};
 const result=await getChannelAnalytics(filters,async(path,init)=>{assert.equal(path,'/db/rpc/channel_analytics');assert.deepEqual(JSON.parse(init.body),{p_filters:filters});return response;});
 assert.equal(result,response);assert.equal(result.items[0].commercialTier,null);assert.equal(result.items[0].partnershipPotential,null);assert.equal(result.commissionByCurrency.length,2);
});
test('every analytics label has both languages with independent snapshot/period and currency terminology',()=>{
 assert.deepEqual(Object.keys(enChannelAnalytics).sort(),Object.keys(zhCNChannelAnalytics).sort());for(const value of Object.values(zhCNChannelAnalytics))assert.ok(value);
 assert.notEqual(enChannelAnalytics['channelAnalytics.snapshot'],enChannelAnalytics['channelAnalytics.period']);
});
test('negative refunds and open credit balances format exactly without changing nonnegative Finance facts',()=>{
 assert.equal(formatChannelCommissionAmount('-2000.00','en'),'−2,000.00');assert.equal(formatChannelCommissionAmount('-0.01','en'),'−0.01');
 assert.equal(formatChannelCommissionAmount('9007199254740993.12','en'),'9,007,199,254,740,993.12');
 assert.throws(()=>formatChannelCommissionAmount('NaN','en'),/FINANCE_AMOUNT_INVALID/);
});
