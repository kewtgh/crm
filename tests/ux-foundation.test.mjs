import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {APP_ROLES} from '../lib/roles.ts';
import {hasCapability} from '../lib/capabilities.ts';
import {navigationDestinations,visibleDestinations,activeDestination} from '../lib/navigation-destinations.ts';
import {localeIdentity,presentMissing,presentEnum,safeTranslation} from '../lib/ux-presentation.ts';
import {organizationAdvancedCount} from '../lib/organization-filter-presentation.ts';
import {zhCN} from '../lib/i18n/locales/zh-CN.ts';
import {en} from '../lib/i18n/locales/en.ts';
import {zhUXFoundation,enUXFoundation} from '../lib/i18n/locales/ux-foundation.ts';
const source=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('all access roles use canonical capabilities and admin role restrictions without fake view capabilities',()=>{
  for(const role of APP_ROLES){
    const entries=visibleDestinations(role);
    assert.equal(new Set(entries.map(d=>d.href)).size,entries.length);
    for(const d of navigationDestinations)assert.equal(entries.some(v=>v.id===d.id),(!d.capability||hasCapability(role,d.capability))&&(!d.roles||d.roles.includes(role))&&(!d.anyCapabilities||d.anyCapabilities.some(capability=>hasCapability(role,capability))));
    assert.equal(entries.some(d=>d.id==='commissions'),hasCapability(role,'finance.view'));
    assert.equal(entries.some(d=>d.id==='admin-recycle'),role==='SUPER_ADMIN');
    for(const d of entries){assert.ok(zhCN[d.labelKey]);assert.ok(en[d.labelKey]);}
  }
  assert.equal(navigationDestinations.find(d=>d.id==='performance').capability,'performance.view');
  for(const role of APP_ROLES.filter(role=>!role.startsWith('SALES_')&&!['ADMIN','SUPER_ADMIN'].includes(role)))assert.ok(!visibleDestinations(role).some(d=>d.id==='performance'));
  const support=visibleDestinations('SALES_SUPPORT');
  for(const id of ['approvals','progression','imports','quality','admin','admin-users'])assert.ok(!support.some(d=>d.id===id));
  assert.ok(support.some(d=>d.id==='commissions'),'finance-view entry remains available without settlement authority');
  for(const id of ['products','reports'])assert.equal(navigationDestinations.find(d=>d.id===id).capability,undefined);
});
test('query-aware navigation preserves Student/Family aliases and ignores non-identity query ordering',()=>{
  const examples={'/dashboard':'dashboard','/students':'students','/students?focus=synthetic':'students','/households':'students','/households?tab=students':'students','/households?tab=families':'families','/households?focus=synthetic&sort=primary&tab=families':'families','/enrollments':'enrollments','/applications':'applications','/student-success':'support','/progression':'progression','/workflow-templates':'workflows','/commissions':'commissions','/reports/executive':'executive','/imports':'imports','/data-quality':'quality'};
  for(const [href,id] of Object.entries(examples)){const url=new URL(href,'http://example.test');assert.equal(activeDestination(url.pathname,url.searchParams,visibleDestinations('ADMIN'))?.id,id,href);}
  assert.equal(activeDestination('/reports/executive/attention',new URLSearchParams(),visibleDestinations('ADMIN'))?.id,'executive');
  assert.equal(activeDestination('/imports',new URLSearchParams(),visibleDestinations('SALES_SUPPORT')),undefined);
  assert.equal(new Set(navigationDestinations.filter(d=>d.space!=='account').map(d=>d.space)).size,7);
});
test('Workflow Templates is governance; student route loaders and bare household semantics remain intact',async()=>{
  assert.equal(navigationDestinations.find(d=>d.id==='workflows').space,'governance');
  const household=await source('app/(crm)/households/page.tsx');
  assert.match(household,/StudentsWorkspace/);assert.match(household,/HouseholdsWorkspace/);
  for(const page of ['students','households','enrollments','applications','student-success','progression','workflow-templates'])assert.doesNotMatch(await source(`app/(crm)/${page}/page.tsx`),/<WorkspaceTabs items=\{familyTabs\}/);
  const workspace=await source('components/workspace-tabs.tsx');
  assert.match(workspace,/function WorkspaceNav/);assert.match(workspace,/<nav/);assert.match(workspace,/<Link/);assert.match(workspace,/aria-current/);assert.doesNotMatch(workspace,/role="tab"/);
});
test('locale identity hierarchy avoids duplicate normalized identity and preserves missing semantics including zero',()=>{
  assert.deepEqual(localeIdentity('en','学生甲','Student A'),{primary:'Student A',alternate:'学生甲'});
  assert.deepEqual(localeIdentity('zh-CN','学生甲','Student A'),{primary:'学生甲',alternate:'Student A'});
  assert.equal(localeIdentity('en','Student A','Student A').alternate,undefined);
  assert.equal(localeIdentity('en','学生甲',null).primary,'学生甲');
  assert.equal(localeIdentity('zh-CN','   ','Student A').primary,'Student A');
  assert.equal(localeIdentity('en','Student  A','Student A').alternate,undefined);
  assert.equal(presentMissing('en',0),'0');assert.equal(presentMissing('zh-CN',null),'未记录');
  assert.equal(presentMissing('en',null,'notSet'),'Not set');assert.equal(presentMissing('en',123,'restricted'),'Restricted');assert.equal(presentMissing('en',123,'unavailable'),'Unavailable');
});
test('missing translation diagnostics never echo internal keys; enum failures remain unknown, not valid',()=>{
  let missing=0;const key='synthetic.secret.key';
  assert.equal(safeTranslation('zh-CN',zhCN,key,undefined,()=>missing++),'暂不可用');assert.equal(missing,1);
  assert.equal(safeTranslation('en',en,'common.notSet'),'Not set');assert.equal(safeTranslation('zh-CN',zhCN,'common.notSet'),'未设置');
  assert.deepEqual(presentEnum('en',en,'crm.status.SYNTHETIC_UNKNOWN'),{label:'Unknown status',known:false});
  assert.equal(presentEnum('en',en,'crm.status.RISK').known,true);
  assert.equal(safeTranslation('en',{'example':'Found {count}'},'example',{count:0}),'Found 0');
  assert.deepEqual(Object.keys(zhUXFoundation).sort(),Object.keys(enUXFoundation).sort());
});
test('advanced badge counts only applied advanced values, independent of primary filters',()=>{
  assert.equal(organizationAdvancedCount({commercialTier:'',keyContact:'',potentialMin:'',ownerId:'synthetic',q:'search',status:'RISK'}),0);
  assert.equal(organizationAdvancedCount({commercialTier:'A',keyContact:'KEY',potentialMin:'80'}),3);
});
