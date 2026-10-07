import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nProvider} from '../components/i18n-provider.tsx';
import {RecordHeader} from '../components/record-header.tsx';
import {SectionHeader} from '../components/responsive-detail-layout.tsx';
import {RecordDeleteAction} from '../components/record-delete-action.tsx';
import {navigationDestinations,visibleDestinations,activeDestination} from '../lib/navigation-destinations.ts';
import {workspaceRedesignEn,workspaceRedesignZh} from '../lib/i18n/locales/workspace-redesign.ts';
import {en} from '../lib/i18n/locales/en.ts';
import {UiIcon,uiIcons} from '../components/ui-icon.tsx';
const render=node=>renderToStaticMarkup(React.createElement(I18nProvider,{initialLocale:'en',initialMessages:en},node));
const source=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('semantic icon vocabulary is decorative and shares stable size/stroke without replacing labels',()=>{
 for(const name of Object.keys(uiIcons)){
  const html=renderToStaticMarkup(React.createElement(UiIcon,{name,size:16}));
  assert.match(html,/aria-hidden="true"/);assert.match(html,/focusable="false"/);assert.match(html,/width="16"/);assert.match(html,/stroke-width="1.8"/);
 }
});
test('one identity has localized hierarchy, breadcrumb and ordered primary/secondary/overflow actions',()=>{
 const html=render(React.createElement(RecordHeader,{nameZh:'示例机构甲',nameEn:'Example Organization A',breadcrumb:'Organizations',avatar:'A',status:'Active',context:'Advisor A',primaryAction:React.createElement('button',null,'Record activity'),secondaryActions:React.createElement('button',null,'Edit'),moreActions:React.createElement('button',null,'More')}));
 assert.equal((html.match(/<h1>/g)||[]).length,1);assert.match(html,/<h1>Example Organization A<\/h1>/);assert.match(html,/ux-alternate-identity">示例机构甲/);assert.match(html,/aria-label="Current location"/);assert.ok(html.indexOf('Record activity')<html.indexOf('>Edit<'));assert.ok(html.indexOf('>Edit<')<html.indexOf('>More<'));
 assert.doesNotMatch(render(React.createElement(RecordHeader,{nameZh:'Same',nameEn:'Same'})),/ux-alternate-identity/);
});
test('section headings preserve heading and action semantics without a nested identity',()=>{
 const html=render(React.createElement(SectionHeader,{title:'Profile',icon:'I',help:'Recorded context',action:React.createElement('button',null,'Edit')}));
 assert.match(html,/<h2>Profile<\/h2>/);assert.match(html,/aria-hidden="true"/);assert.match(html,/<button>Edit<\/button>/);assert.doesNotMatch(html,/<h1/);
});
test('customer communications is primary; portal is an in-workspace feature, not a page command',()=>{
 const messages=navigationDestinations.find(d=>d.id==='messages');assert.equal(messages.secondary,false);assert.equal(messages.capability,'messages.view');assert.equal(navigationDestinations.some(d=>d.href==='/guardian-portal'),false);
 assert.equal(activeDestination('/guardian-portal',new URLSearchParams(),visibleDestinations('ADMIN'))?.id,'messages');
});
test('delete trigger in More retains the existing recoverable confirmation owner',()=>{
 const html=render(React.createElement(RecordDeleteAction,{kind:'ORGANIZATION',id:'00000000-0000-4000-8000-000000000001',label:'Example Organization A',menuItem:true,onDeleted:()=>{}}));
 assert.match(html,/role="menuitem"/);assert.match(html,/aria-label="Delete Example Organization A"/);assert.doesNotMatch(html,/role="dialog"/);
});
test('Contact record route delegates single identity and authorized related panels',async()=>{
 const route=await source('app/(crm)/people/[id]/page.tsx');assert.match(route,/<ContactWorkspace initial=\{data\}/);assert.doesNotMatch(route,/<h1|<CrmRecordEditor/);
 const contact=await source('components/contact-workspace.tsx');assert.match(contact,/snapshot\?\.canManage/);assert.match(contact,/CustomerOperationsPanel subject="CONTACT"/);assert.match(contact,/ContactConsentPage/);assert.match(contact,/enumLabel/);assert.doesNotMatch(contact,/GRANTED.*=>.*true/);
});
test('locale additions have identical coverage and do not leak internal translation identifiers',()=>{
 assert.deepEqual(Object.keys(workspaceRedesignEn).sort(),Object.keys(workspaceRedesignZh).sort());
 for(const dictionary of [workspaceRedesignEn,workspaceRedesignZh])for(const value of Object.values(dictionary))assert.doesNotMatch(value,/undefined|\[object Object\]|workspace\./);
});
