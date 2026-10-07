import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {leadQueueActions,leadAdvancedCount,leadFilterDefaults,readDashboardMode,saveDashboardMode,dashboardPreferenceKey,dashboardDefaultMode} from '../lib/frontline-presentation.ts';
import {frontlineEn,frontlineZh} from '../lib/i18n/locales/frontline.ts';
import {hasCapability} from '../lib/capabilities.ts';
import {APP_ROLES} from '../lib/roles.ts';
const read=p=>fs.readFileSync(p,'utf8');
const lead={subject_type:'SCHOOL',pool_visibility:'WORKSPACE_PUBLIC',owner_id:null,status:'NEW',can_edit:false,can_assign:false,is_mine:false};
test('primary action is reordered only from existing eligibility and edit authority',()=>{
 assert.equal(leadQueueActions(lead,'pool',true,false).primary,'claim');
 for(const patch of [{owner_id:'other'},{pool_visibility:'PRIVATE'},{subject_type:'HOUSEHOLD'},{status:'CONVERTED'},{status:'DISQUALIFIED'}])assert.equal(leadQueueActions({...lead,...patch},'pool',true,false).primary,null);
 assert.equal(leadQueueActions(lead,'all',true,false).primary,null);
 assert.equal(leadQueueActions({...lead,owner_id:'self',is_mine:true,can_edit:true},'mine',true,false).primary,'update');
 assert.equal(leadQueueActions({...lead,status:'QUALIFIED',can_edit:true},'all',true,false).primary,'convert');
 assert.equal(leadQueueActions({...lead,status:'CONVERTED',can_edit:true},'all',true,false).primary,null);
 assert.equal(leadQueueActions({...lead,status:'DISQUALIFIED',can_edit:true},'all',true,false).primary,null);
 assert.ok(leadQueueActions({...lead,status:'DISQUALIFIED',can_edit:true},'all',true,false).more.includes('update'));
 assert.ok(leadQueueActions({...lead,can_edit:true},'pool',true,false).more.includes('update'));
 assert.equal(leadQueueActions({...lead,can_edit:true},'all',false,false).primary,null);
});
test('governance actions stay under their exact gates and More retains history',()=>{
 const owned={...lead,owner_id:'self',is_mine:true,can_edit:true,can_assign:true,status:'QUALIFIED'};
 assert.deepEqual(leadQueueActions(owned,'mine',true,true).more,['update','release','reassign','visibility','history','archive']);
 assert.deepEqual(leadQueueActions(owned,'mine',false,false).more,['history']);
 assert.deepEqual(leadQueueActions({...owned,subject_type:'HOUSEHOLD'},'mine',true,true).more,['update','release','reassign','history','archive']);
 assert.ok(!leadQueueActions({...owned,status:'CONVERTED'},'all',true,true).more.includes('release'));
 assert.deepEqual(leadQueueActions({...owned,is_mine:false,can_assign:false},'all',true,false).more,['update','history','archive']);
});
test('Lead visibility uses every canonical staff capability, not a guessed role permission',()=>{
 for(const role of APP_ROLES){const manage=hasCapability(role,'leads.manage'),manager=['SUPER_ADMIN','ADMIN','SALES_DIRECTOR','SALES_MANAGER'].includes(role);const actions=leadQueueActions({...lead,owner_id:'self',is_mine:true,can_edit:true,can_assign:manager},'mine',manage,manager);assert.equal(actions.primary,manage?'update':null);assert.equal(actions.more.includes('reassign'),manager);}
});
test('advanced count excludes primary query/status/scope and includes only changed actual query conditions',()=>{
 assert.equal(leadAdvancedCount({...leadFilterDefaults,q:'Example',status:'QUALIFIED'}),0);
 assert.equal(leadAdvancedCount({...leadFilterDefaults,city:'Example city',sort:'oldest',potentialMin:'80',tier:'A'}),4);
});
test('dashboard explicit preference is account isolated, validated and cannot grant management access',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 saveDashboardMode(storage,'a','daily');saveDashboardMode(storage,'b','management');
 assert.equal(readDashboardMode(storage,'a','ADMIN',true),'daily');
 assert.equal(readDashboardMode(storage,'b','SALES_SPECIALIST',true),'management');
 assert.equal(readDashboardMode(storage,'b','ADMIN',false),'daily');
 assert.notEqual(dashboardPreferenceKey('a'),dashboardPreferenceKey('b'));
 values.set(dashboardPreferenceKey('a'),'invalid');assert.equal(readDashboardMode(storage,'a','ADMIN',true),'management');
});
test('unavailable browser storage is harmless and default uses authority plus audience',()=>{
 const broken={getItem(){throw new Error('Synthetic storage denied');},setItem(){throw new Error('Synthetic storage denied');}};
 assert.equal(readDashboardMode(broken,'a','SALES_SPECIALIST',true),'daily');
 assert.doesNotThrow(()=>saveDashboardMode(broken,'a','daily'));
 assert.equal(dashboardDefaultMode('SALES_MANAGER',false),'daily');
 assert.equal(dashboardDefaultMode('SALES_MANAGER',hasCapability('SALES_MANAGER','education.view')),'management');
});
test('Dashboard daily hierarchy precedes launchpad; management summary has no Executive data fetch or signal sum',()=>{
 const code=read('components/dashboard-page.tsx');
 assert.ok(code.indexOf('data-region="my-today"')<code.indexOf('data-region="quick-navigation"'));
 assert.match(code,/operational-attention/);assert.match(code,/\{business\}[\s\S]*data-region="quick-navigation"/);
 assert.match(code,/WorkflowLaunchpad audience="daily"/);assert.match(code,/href="\/reports\/executive"/);assert.match(code,/href="\/action-center"/);
 assert.doesNotMatch(code,/\/api\/(management|action-center)|\.reduce\(/);
 assert.match(code,/pendingTaskIds\.current\.has\(task.id\)/);assert.match(code,/method:"PATCH"/);assert.match(code,/focusTasks:current.focusTasks.filter/);
 assert.match(code,/growthUnavailable/);assert.match(code,/signals:AttentionItem\[\]=\[\]/);
 assert.match(code,/Object.entries\(snapshot.monthRevenueByCurrency\)/);
});
test('Lead editors retain payload-bound uncertain retry, conflict handling and conversion amount/currency',()=>{
 const code=read('components/lead-pool-workspace.tsx');
 assert.match(code,/if\(!attempt.current&&event\)/);assert.match(code,/const request=attempt.current/);assert.match(code,/JSON.stringify\(request.body\)/);assert.match(code,/settleMutation/);
 assert.match(code,/expectedRevision:l!\.revision/);assert.match(code,/ALREADY_CLAIMED/);assert.match(code,/VERSION_CONFLICT/);assert.match(code,/business.retrySame/);
 assert.match(code,/amount:Number\(f.get\("amount"\)\),currency:f.get\("currency"\)/);
 assert.match(code,/MoreActions/);assert.match(code,/role="menuitem"/);assert.match(code,/FilterBar/);assert.doesNotMatch(code,/ownerFilter|sourceFilter/);
});
test('shared queue primitives are presentation-only and More reuses existing disclosure',()=>{
 for(const path of ['components/queue-item.tsx','components/more-actions.tsx'])assert.doesNotMatch(read(path),/apiFetch|useCapability|fetch\(/);
 assert.match(read('components/more-actions.tsx'),/ActionDisclosure label=\{label\} menu/);
 assert.match(read('components/action-disclosure.tsx'),/ArrowDown/);assert.match(read('components/action-disclosure.tsx'),/Escape/);
});
test('frontline labels are complete in both locales without raw-key fallback',()=>{
 assert.deepEqual(Object.keys(frontlineEn),Object.keys(frontlineZh));
 for(const key of Object.keys(frontlineEn)){assert.ok(frontlineEn[key]);assert.ok(frontlineZh[key]);}
});
