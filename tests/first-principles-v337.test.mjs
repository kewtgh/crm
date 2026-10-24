import test from 'node:test';
import assert from 'node:assert/strict';
import {completeDashboardTask} from '../lib/dashboard-repository.ts';
import {DatabaseRequestError} from '../lib/db/gateway.ts';
import {viewConfigSchema,savedViewSchema,viewMatchesResource,restoredViewFilters} from '../lib/saved-view-schema.ts';
import {organizationFilterDefaults,contactFilterDefaults,writeDirectoryFilters} from '../lib/directory-filter-query.ts';
import {filterTaskQueue,parseTaskQueueFilter,taskIsDueToday} from '../lib/task-queue.ts';
import {visibleWorkflowEntries} from '../lib/workflow-navigation.ts';
import {visibleDestinations} from '../lib/navigation-destinations.ts';
import {APP_ROLES} from '../lib/roles.ts';
import {loadActionCenter} from '../lib/action-center-repository.ts';

const id='00000000-0000-4000-8000-000000000001';
const base={version:1,query:'Example',status:'all',sort:'primary',direction:'asc',pageSize:10};

test('task completion requires a confirmed receipt and the observed revision',async()=>{
 let request;
 await completeDashboardTask(id,3,'fictional-task-request',async(url,init)=>{request={url,init};return {ids:[id],affected:1};});
 assert.equal(request.url,'/db/rpc/complete_crm_tasks_command');
 const body=JSON.parse(request.init.body);
 assert.deepEqual(body.command,{operation:'complete',tasks:[{id,expectedRevision:3}]});
 assert.equal(body.p_request_key,'fictional-task-request');
});

test('zero, unexpected and malformed completion results never produce success',async()=>{
 for(const value of [undefined,null,[],{},[{id:'different'}],[{id},{id}]]){
  await assert.rejects(completeDashboardTask(id,1,'fictional-task-request',async()=>value),error=>error instanceof DatabaseRequestError&&error.status===502&&error.code==='INVALID_TASK_COMPLETION_RESULT');
 }
 const denied=new DatabaseRequestError(403,'DATABASE_PERMISSION_DENIED','synthetic failure');
 await assert.rejects(completeDashboardTask(id,1,'fictional-task-request',async()=>{throw denied;}),error=>error===denied);
});

test('new views round-trip complete directory filters and clear filters absent from the saved view',()=>{
 for(const [resource,defaults,filters] of [
  ['schools',organizationFilterDefaults,{city:'Example City',commercialTier:'A',ownerId:id}],
  ['people',contactFilterDefaults,{organizationId:id,contactType:'CONTACT'}],
 ]){
  const config=viewConfigSchema.parse(JSON.parse(JSON.stringify({...base,version:2,filters})));
  assert.equal(viewMatchesResource(config,resource),true);
  const restored=restoredViewFilters(config,resource,Object.fromEntries(Object.keys(defaults).map(key=>[key,'stale'])));
  assert.deepEqual(restored,{...defaults,...filters});
  const params=writeDirectoryFilters(new URLSearchParams('queue=today&ownerId=stale&city=stale'),restored);
  assert.equal(params.get('queue'),'today');
  assert.equal(params.get('ownerId'),filters.ownerId??null);
  const saved=savedViewSchema.parse({...config,id,name:'Fictional view',visibility:'PERSONAL',source:'LOCAL',owned:true});
  assert.deepEqual(saved.filters,filters);
 }
});

test('v1 views preserve independent filters while v2 is strict and bounded',()=>{
 const legacy=viewConfigSchema.parse(base),current={...organizationFilterDefaults,city:'Current City'};
 assert.equal(restoredViewFilters(legacy,'schools',current),current);
 for(const candidate of [
  {...base,version:3},{...base,version:2},{...base,filters:{}},
  {...base,version:2,filters:{unknown:'value'}},
  {...base,version:2,filters:{city:'x'.repeat(121)}},
  {...base,version:2,filters:{ownerId:123}},
 ])assert.equal(viewConfigSchema.safeParse(candidate).success,false);
 assert.equal(viewMatchesResource(viewConfigSchema.parse({...base,version:2,filters:{city:'Example'}}),'people'),false);
 assert.equal(viewMatchesResource(viewConfigSchema.parse({...base,version:2,filters:{ownerId:id}}),'tasks'),false);
 assert.equal(viewMatchesResource(viewConfigSchema.parse({...base,version:2,filters:{}}),'tasks'),true);
});

test('due-today uses reporting timezone across midnight and DST rather than host time',()=>{
 const now=Date.parse('2026-10-16T00:30:00Z');
 assert.equal(taskIsDueToday('2026-10-15T23:00:00Z',now,'Asia/Taipei'),true);
 assert.equal(taskIsDueToday('2026-10-15T10:00:00Z',now,'Asia/Taipei'),false);
 assert.equal(taskIsDueToday('2026-10-15T10:00:00Z',now,'America/New_York'),true);
 assert.equal(taskIsDueToday('2026-11-01T05:30:00Z',Date.parse('2026-11-01T06:30:00Z'),'America/New_York'),true);
 assert.equal(taskIsDueToday(null,now,'Asia/Taipei'),false);
 assert.equal(taskIsDueToday('invalid',now,'Asia/Taipei'),false);
});

test('task queue deep links restrict my time-based signals and search only available rows',()=>{
 const now=Date.parse('2026-10-16T00:30:00Z');
 const item={id,titleZh:'示例回访',titleEn:'Example Follow-up',related:'Example Academy',status:'TODO',priority:'NORMAL',ownerId:id,ownerName:'Advisor A',dueAt:'2026-10-15T23:00:00Z',slaDueAt:null};
 const rows=[item,{...item,id:'other',ownerId:'other',slaDueAt:'2026-10-15T00:00:00Z'}];
 const filter=(scope,query='')=>filterTaskQueue(rows,scope,query,id,now,'Asia/Taipei');
 assert.equal(parseTaskQueueFilter('unsupported'),'all');assert.equal(parseTaskQueueFilter(null),'all');
 assert.deepEqual(filter('today').map(row=>row.id),[id]);
 assert.deepEqual(filter('overdue').map(row=>row.id),[id]);
 assert.deepEqual(filter('sla').map(row=>row.id),['other']);
 assert.equal(filter('all','academy').length,2);assert.equal(filter('mine','示例').length,1);
 assert.equal(filter('all','missing').length,0);
});

test('all role launchers agree with canonical Students and Performance navigation',()=>{
 for(const role of APP_ROLES){
  const launch=visibleWorkflowEntries(role),nav=visibleDestinations(role);
  for(const [key,navId] of [['students','students'],['performance','performance']]){
   assert.equal(Boolean(launch.find(item=>item.key===key)),Boolean(nav.find(item=>item.id===navId)),role);
   if(launch.some(item=>item.key===key))assert.equal(launch.find(item=>item.key===key).href,nav.find(item=>item.id===navId).href);
  }
 }
});

test('action-center task signals retain the matching queue intention',async()=>{
 const user={id,role:'SALES_SPECIALIST'};
 const data={overdueTasks:2,todayTasks:3,pendingApprovals:0,renewalsDue:0,riskContracts:0,newLeads:0,pendingProgression:0,pendingAdmissions:0,unreadNotifications:0};
 const result=await loadActionCenter(user,{approvals:async()=>0,dashboard:async()=>data,privacy:async()=>{throw new Error('should not load');},readiness:async()=>{throw new Error('should not load');}});
 assert.equal(result.items.find(item=>item.id==='overdue-tasks').href,'/tasks?queue=overdue');
 assert.equal(result.items.find(item=>item.id==='today-tasks').href,'/tasks?queue=today');
 assert.equal(result.total,5);
});
