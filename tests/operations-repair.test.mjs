import test from 'node:test';
import assert from 'node:assert/strict';
import {commissionListQuery,listCommissionAccruals,listCommissionSettlements} from '../lib/commission-repository.ts';
import {deletionResources} from '../lib/record-deletion-contract.ts';
import {en} from '../lib/i18n/locales/en.ts';
import {zhCN} from '../lib/i18n/locales/zh-CN.ts';
import {hasCapability} from '../lib/capabilities.ts';

test('commission filters precede bounded server paging and dates include the whole UTC end day',async()=>{
  const filters={currency:'USD',status:'OPEN',from:'2026-10-01',to:'2026-10-07'};
  const params=commissionListQuery('example-id','accruals',filters);
  assert.equal(params.get('currency'),'eq.USD');
  assert.equal(params.get('settlement_status'),'is.null');
  assert.equal(params.get('limit'),'100');
  assert.deepEqual(params.getAll('accrued_at'),['gte.2026-10-01T00:00:00Z','lt.2026-10-08T00:00:00.000Z']);
  const calls=[];const adapter=async(path)=>{calls.push(path);return [];};
  await listCommissionAccruals('example-id',adapter,filters);
  await listCommissionSettlements('example-id',adapter,{status:'CANCELLED',currency:'CNY'});
  assert.ok(calls[0].startsWith('/db/table/commission_accrual_listing?'));
  assert.equal(new URL('http://example.test'+calls[1]).searchParams.get('status'),'eq.CANCELLED');
  // The editor still requests its independent unfiltered canonical candidate set.
  await listCommissionAccruals('example-id',adapter);
  assert.equal(new URL('http://example.test'+calls[2]).searchParams.has('currency'),false);
});

test('cleanup resources are distinct, bilingual and use existing capability names',()=>{
  assert.equal(new Set(deletionResources.map(resource=>resource.kind)).size,44);
  for(const resource of deletionResources){
    assert.ok(en[resource.label],resource.label);
    assert.ok(zhCN[resource.label],resource.label);
    assert.ok(hasCapability('SUPER_ADMIN',resource.capability),resource.kind);
  }
  const product=deletionResources.find(resource=>resource.kind==='PRODUCT');
  assert.equal(hasCapability('SALES_SUPPORT',product.capability),false);
  assert.equal(deletionResources.some(resource=>/PAYMENT|ACCRUAL|RECEIPT|AUDIT/.test(resource.kind)),false);
});
