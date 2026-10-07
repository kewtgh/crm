import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SafeDiagnostics,diagnosticToken} from '../components/safe-diagnostics.tsx';
import {I18nProvider} from '../components/i18n-provider.tsx';
import {zhCN} from '../lib/i18n/locales/zh-CN.ts';
import {en} from '../lib/i18n/locales/en.ts';
import {uxClosureEn,uxClosureZh} from '../lib/i18n/locales/ux-closure.ts';
import {v2FieldLabel} from '../lib/import-v2-labels.ts';
const read=p=>fs.readFileSync(p,'utf8');
test('diagnostics reject arbitrary server text, object payloads, stack and paths',()=>{
 for(const value of [null,undefined,'undefined','null',{},'SELECT * FROM example','Error: synthetic failure','/srv/example','C:\\Example\\file','https://example.test/path?token=example',-1])assert.equal(diagnosticToken(value),null);
 for(const value of ['INVALID_CELL','nameZh',3,'2026-10-07T00:00:00Z'])assert.equal(diagnosticToken(value),String(value));
 const html=renderToStaticMarkup(React.createElement(I18nProvider,{initialLocale:'zh-CN',initialMessages:zhCN},React.createElement(SafeDiagnostics,{items:[{label:'Code',value:'INVALID_CELL'},{label:'Unsafe',value:'SELECT * FROM example'},{label:'Object',value:{}}]})));
 assert.match(html,/<details/);assert.match(html,/技术详情/);assert.match(html,/INVALID_CELL/);assert.doesNotMatch(html,/SELECT|Unsafe|Object|undefined|\[object Object\]/);
});
test('contract selection reuses canonical owners, keeps both task states and local tab semantics',()=>{
 const source=read('components/contracts-page.tsx');
 assert.match(source,/checked=\{selectedId===contract.id\}/);
 assert.match(source,/id="selected-contract-context"/);
 assert.match(source,/href="#selected-contract-context"/);
 assert.match(source,/initialSelectedId=""/);
 assert.match(source,/DetailTabs label=\{t\("closure.contractSections"\)\}/);
 assert.match(source,/disabled=\{commercialLocked\}/);
 for(const section of ['enrollments','documents'])assert.match(source,new RegExp(`hidden=\\{selectedSection!=="${section}"\\}`));
 assert.match(source,/ContractEnrollmentSection key=\{selectedId\} contractId=\{selectedId\} onLocked=\{setCommercialLocked\}/);
 assert.match(source,/sourceKind="CUSTOMER_CONTRACT" sourceId=\{selectedId\} canManage=\{canManage\}/);
 assert.match(source,/currencyDisplay:"code"/);assert.doesNotMatch(source,/WorkspaceNav|\/api\/contract-workspace/);
});
test('quality human rules use dictionary membership after safe fallback, diagnostics are allowlisted',()=>{
 const source=read('components/data-quality-page.tsx');assert.match(source,/direct.known\?direct.label:mapped.known/);
 assert.doesNotMatch(source,/Object.values\(item.details\)/);
 assert.match(source,/quality.fixFirst/);assert.match(source,/SafeDiagnostics/);
 for(const key of ['quality.rule.contactMethodMissing','quality.rule.organizationOwnerMissing'])for(const dict of [zhCN,en])assert.ok(dict[key]);
});
test('import explanation and next step precede diagnostic codes; no raw lastError',()=>{
 const source=read('components/imports-page.tsx');const region=source.slice(source.indexOf('{rows.map((row)'),source.indexOf('{current && rows.length'));
 assert.ok(region.indexOf('closure.importProblem')<region.indexOf('SafeDiagnostics'));
 assert.ok(region.indexOf('closure.importNext')<region.indexOf('SafeDiagnostics'));
 assert.doesNotMatch(region,/\{row.lastError\}|row.reasons.join/);
 assert.match(region,/imports.repairRow/);
});
test('product identity is locale aware and catalog/bundles/FX and money stay together',()=>{
 const source=read('components/products-page.tsx');assert.match(source,/RecordIdentity nameZh=\{product.nameZh\} nameEn=\{product.nameEn\}/);
 for(const token of ['initialBundles','initialExchangeRates','product.currency','effectiveAt'])assert.ok(source.includes(token));
});
test('closure labels are bilingual and contain no forbidden functional output',()=>{
 assert.deepEqual(Object.keys(uxClosureEn).sort(),Object.keys(uxClosureZh).sort());
 for(const text of [...Object.values(uxClosureEn),...Object.values(uxClosureZh)])assert.doesNotMatch(text,/undefined|null|\[object Object\]|营收|利润|ROI/);
 const producer=read('lib/action-center-repository.ts');
 for(const [,key] of producer.matchAll(/(?:titleKey|detailKey):"([^"]+)"/g)){assert.ok(zhCN[key],key);assert.ok(en[key],key);}
 assert.equal(v2FieldLabel('synthetic.private.field','zh-CN'),'未识别字段');
 assert.equal(v2FieldLabel('synthetic.private.field','en'),'Unrecognized field');
});
