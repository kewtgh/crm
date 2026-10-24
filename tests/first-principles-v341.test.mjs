import test from 'node:test';
import assert from 'node:assert/strict';
import {taskCompletionSchema,confirmedTaskCompletion} from '../lib/task-completion.ts';
import {executeTaskCompletion} from '../lib/task-workspace-repository.ts';
import {readTaskQueueView,writeTaskQueueView,filterTaskQueue} from '../lib/task-queue.ts';
import {createReceiptAttempt} from '../lib/receipt-attempt.ts';
import {taskQueueEn,taskQueueZh} from '../lib/i18n/locales/task-queue.ts';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const single={operation:'complete',tasks:[{id:id(1),expectedRevision:3}],requestKey:'fictional-task-request'};
test('task completion rejects obsolete clients, duplicate selections and invalid versions before dispatch',async()=>{
 for(const command of [
  {...single,requestKey:undefined},{...single,requestKey:' short '},{...single,reason:'unexpected'},
  {...single,tasks:[]},{...single,tasks:[...single.tasks,...single.tasks]},
  ...[undefined,0,-1,1.1,'3',2147483648].map(expectedRevision=>({...single,tasks:[{id:id(1),expectedRevision}]})),
  {operation:'bulkComplete',requestKey:single.requestKey,tasks:single.tasks,reason:' '},
  {operation:'bulkComplete',requestKey:single.requestKey,tasks:Array.from({length:51},(_,n)=>({id:id(n),expectedRevision:1})),reason:'Fictional verified work'},
 ]){
  assert.equal(taskCompletionSchema.safeParse(command).success,false,JSON.stringify(command));
  await assert.rejects(executeTaskCompletion(command,async()=>{assert.fail('invalid command dispatched');}));
 }
});
test('task commands retain exact request identity and require every accepted target',async()=>{
 const input={operation:'bulkComplete',tasks:[{id:id(2),expectedRevision:4},{id:id(1),expectedRevision:3}],reason:'Fictional reviewed completion',requestKey:single.requestKey};
 let body;
 assert.deepEqual(await executeTaskCompletion(input,async(url,init)=>{assert.equal(url,'/db/rpc/complete_crm_tasks_command');body=JSON.parse(init.body);return {ids:[id(1),id(2)],affected:2};}),{ids:[id(1),id(2)],affected:2});
 assert.equal(body.p_request_key,input.requestKey);assert.equal(body.command.requestKey,undefined);assert.deepEqual(body.command.tasks,input.tasks);
 for(const value of [null,{}, {ids:[id(1)],affected:2},{ids:[id(1),id(1)],affected:2},{ids:[id(1),id(3)],affected:2},{ids:[id(1),id(2)],affected:1}])assert.equal(confirmedTaskCompletion(value,input),null);
});
test('uncertain task intention retains bytes despite selection, reason and language changes',()=>{
 let keys=0;const attempt=createReceiptAttempt(()=>`fictional-key-${++keys}`),original=attempt.prepare(single);
 const retry=attempt.prepare({...single,reason:'Changed localized reason',tasks:[{id:id(2),expectedRevision:9}]});
 assert.equal(retry,original);assert.equal(keys,1);attempt.clear();assert.notEqual(attempt.prepare(single),original);assert.equal(keys,2);
});
test('queue views round-trip independently of directory filters and preserve multiword typing',()=>{
 const base=new URLSearchParams('q=directory&status=TODO&page=3&queue=today');
 for(const priority of ['all','URGENT','HIGH','NORMAL','LOW']){
  const view={filter:'mine',search:'Fictional task ',priority,page:2},next=writeTaskQueueView(base,view);
  assert.deepEqual(readTaskQueueView(next),view);assert.equal(next.get('q'),'directory');assert.equal(next.get('status'),'TODO');assert.equal(next.get('page'),'3');
 }
 assert.equal(base.get('queue'),'today');
 assert.deepEqual(readTaskQueueView(new URLSearchParams('queue=constructor&queuePriority=invalid&queuePage=-1')),{filter:'all',search:'',priority:'all',page:1});
 assert.equal(readTaskQueueView(new URLSearchParams('queuePage=Infinity')).page,1);
 assert.equal(readTaskQueueView(new URLSearchParams('queueSearch='+'x'.repeat(500))).search.length,100);
});
test('priority and ownership combine before queue pagination without editing source facts',()=>{
 const items=Array.from({length:30},(_,n)=>({id:id(n),titleZh:`示例 ${n}`,titleEn:`Fictional task ${n}`,related:'Fictional Academy',ownerName:'Advisor',ownerId:id(n%2),priority:n%3?'NORMAL':'HIGH',dueAt:null,slaDueAt:null,revision:1}));
 const before=JSON.stringify(items),result=filterTaskQueue(items,'mine','Fictional task',id(0),Date.now(),'Asia/Taipei','HIGH');
 assert.equal(result.length,5);assert.ok(result.every(item=>item.ownerId===id(0)&&item.priority==='HIGH'));assert.equal(JSON.stringify(items),before);
});
test('task and notification recovery messages have complete bilingual parity',()=>{
 assert.deepEqual(Object.keys(taskQueueEn).sort(),Object.keys(taskQueueZh).sort());
 for(const key of ['taskQueue.uncertain','taskQueue.refreshOnly','taskQueue.priority','notifications.refreshOnly','notifications.uncertain']){assert.ok(taskQueueEn[key]);assert.ok(taskQueueZh[key]);}
});
