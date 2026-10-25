import test from 'node:test';
import assert from 'node:assert/strict';
import {loadActionCenter} from '../lib/action-center-repository.ts';
import {loadDashboard} from '../lib/dashboard-repository.ts';
import {pendingApprovalCount,exactCount} from '../lib/pending-approval-count.ts';
import {readActionFilters,writeActionFilters,filterActionItems} from '../lib/action-center-filters.ts';
import {searchRelatedRecords} from '../lib/related-search-repository.ts';
import {hasCapability} from '../lib/capabilities.ts';
import {APP_ROLES} from '../lib/roles.ts';
import {actionReviewEn,actionReviewZh} from '../lib/i18n/locales/action-review.ts';

const user={id:'00000000-0000-4000-8000-000000000099',role:'ADMIN'};
const data={todayTasks:3,overdueTasks:2,pendingApprovals:999,renewalsDue:4,riskContracts:1,newLeads:2,
 pendingProgression:1,pendingAdmissions:3,unreadNotifications:5,activeProducts:2,focusTasks:[],monthRevenueByCurrency:{}};
const fail=async()=>{throw new Error('Fictional private diagnostic must never be returned');};
const adapter=(overrides={})=>({dashboard:async()=>data,privacy:async()=>6,readiness:async()=>({failedJobs:2,stuckJobs:1}),approvals:async()=>7,...overrides});

test('pending approvals use the invoker RLS count and reject unavailable results',async()=>{
 let request;
 assert.equal(await pendingApprovalCount(async(url,init)=>{request={url,init};return Response.json({count:7});}),7);
 assert.equal(request.url,'/db/rpc/approval_pending_count');
 assert.equal(request.init.method,'POST');assert.equal(request.init.body,'{}');
 for(const range of ['0-0/0','*/0'])assert.equal(exactCount(new Response('[]',{headers:{'content-range':range}})),0);
 for(const value of [null,{},[],{count:-1},{count:1.5},{count:'0'},{count:9007199254740992}]){
  await assert.rejects(pendingApprovalCount(async()=>Response.json(value)),/COUNT_UNAVAILABLE/);
 }
 assert.throws(()=>exactCount(new Response('[]',{status:503,headers:{'content-range':'0-0/0'}})),/COUNT_UNAVAILABLE/);
});

test('all roles receive RLS approval signals and only reachable restricted action entries',async()=>{
 for(const role of APP_ROLES){
  let privacyReads=0,operationsReads=0;
  const result=await loadActionCenter({...user,role},adapter({privacy:async()=>{privacyReads++;return 1;},readiness:async()=>{operationsReads++;return {failedJobs:1,stuckJobs:0};}}));
  const item=result.items.find(item=>item.id==='pending-approvals');assert.equal(item.count,7);
  assert.equal(item.href,hasCapability(role,'admin.access')?'/admin/approvals':'/approvals');
  assert.equal(privacyReads,Number(hasCapability(role,'privacyRequests.manage')));
  assert.equal(operationsReads,Number(hasCapability(role,'admin.access')));
  for(const [id,capability] of [['risk-contracts','contracts.view'],['renewals','contracts.view'],['notifications','messages.view'],['new-leads','leads.view']]){
   assert.equal(result.items.some(item=>item.id===id),hasCapability(role,capability),`${role}:${id}`);
  }
  assert.deepEqual(result.unavailableSources,[]);
 }
});

test('each failed source preserves independent confirmed work and discloses only its safe identifier',async()=>{
 for(const [method,source,omitted] of [['dashboard','dashboard','today-tasks'],['privacy','privacy','privacy-requests'],['readiness','operations','operational-failures'],['approvals','approvals','pending-approvals']]){
  const result=await loadActionCenter(user,adapter({[method]:fail}));
  assert.deepEqual(result.unavailableSources,[source]);assert.ok(!result.items.some(item=>item.id===omitted));
  assert.ok(result.items.some(item=>item.id===(source==='approvals'?'today-tasks':'pending-approvals')));
  assert.equal(result.total,result.items.reduce((sum,item)=>sum+item.count,0));
  assert.equal(result.urgent,result.items.filter(item=>item.priority==='urgent').reduce((sum,item)=>sum+item.count,0));
  assert.ok(!JSON.stringify(result).includes('private diagnostic'));
 }
 const missing=await loadActionCenter(user,adapter({dashboard:fail,privacy:fail,readiness:fail,approvals:fail}));
 assert.equal(missing.total,0);assert.equal(missing.items.length,0);assert.equal(missing.unavailableSources.length,4);
 const recovered=await loadActionCenter(user,adapter());assert.deepEqual(recovered.unavailableSources,[]);assert.ok(recovered.total>0);
});

test('growth unavailability is incomplete only for a role with admissions decisions',async()=>{
 for(const role of APP_ROLES){
  const result=await loadActionCenter({...user,role},adapter({dashboard:async()=>({...data,growthUnavailable:true})}));
  assert.equal(result.unavailableSources.includes('growth'),hasCapability(role,'portal.decide'));
  assert.ok(!result.items.some(item=>item.id==='admissions'));
 }
});

test('dashboard overrides legacy definer approval count, preserves work on count failure and fails on core failure',async()=>{
 const base={json:async()=>data,growth:async()=>({summary:{}}),approvals:async()=>7};
 const good=await loadDashboard(base);assert.equal(good.pendingApprovals,7);assert.equal(good.approvalUnavailable,false);
 const partial=await loadDashboard({...base,approvals:fail});assert.equal(partial.pendingApprovals,0);assert.equal(partial.approvalUnavailable,true);assert.equal(partial.todayTasks,3);
 await assert.rejects(loadDashboard({...base,json:fail}),/private diagnostic/);
});

test('action filters round-trip, preserve unrelated context, reject invalid values and do not mutate input',async()=>{
 const items=(await loadActionCenter(user,adapter())).items;
 for(const category of ['all','work','sales','service','governance'])for(const priority of ['all','urgent','high','normal']){
  const filters={category,priority},original=new URLSearchParams('context=example&category=obsolete');
  const written=writeActionFilters(original,filters);
  assert.deepEqual(readActionFilters(written),filters);assert.equal(written.get('context'),'example');assert.equal(original.get('category'),'obsolete');
  const actual=filterActionItems(items,filters);
  assert.ok(actual.every(item=>(category==='all'||item.category===category)&&(priority==='all'||item.priority===priority)));
 }
 assert.deepEqual(readActionFilters(new URLSearchParams('category=constructor&priority=URGENT')),{category:'all',priority:'all'});
 assert.equal(filterActionItems(items,{category:'sales',priority:'high'}).length,1);
});

test('relation queries explicitly exclude archived rows before limits and preserve search/type scoping',async()=>{
 for(const [type,table] of [['OPPORTUNITY','opportunities'],['CONTRACT','contracts'],['QUOTE','quotes'],['HOUSEHOLD','households'],['LEAD','leads']]){
  const requests=[];
  const result=await searchRelatedRecords(' Fictional,(Academy)* ',[type],undefined,async url=>{
   requests.push(url);const parsed=new URL(url,'https://example.test');
   assert.equal(parsed.pathname,`/db/table/${table}`);assert.equal(parsed.searchParams.get('archived_at'),'is.null');assert.equal(parsed.searchParams.get('limit'),'5');
   // A miniature adapter models the server predicate before paging, including an archived newest row.
   const rows=[{id:'archived',archived_at:'2026-01-01'},{id:'active',archived_at:null,title_zh:'示例',title_en:'Example',contract_number:'EXAMPLE-C',quote_number:'EXAMPLE-Q',name_zh:'示例',name_en:'Example'}];
   return rows.filter(row=>parsed.searchParams.get('archived_at')!=='is.null'||row.archived_at===null).slice(0,Number(parsed.searchParams.get('limit')));
  });
  assert.equal(requests.length,1);assert.equal(result.length,1);assert.equal(result[0].value,`${type}:active`);
 }
 await assert.rejects(searchRelatedRecords('Example',['CONTRACT'],undefined,fail),/private diagnostic/);
});

test('new interface messages have matching bilingual coverage',()=>{
 assert.deepEqual(Object.keys(actionReviewZh).sort(),Object.keys(actionReviewEn).sort());
 for(const messages of [actionReviewZh,actionReviewEn])for(const value of Object.values(messages))assert.ok(value.trim());
});
