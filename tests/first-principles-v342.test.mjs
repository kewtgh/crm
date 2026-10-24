import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {recycleDefaults,recycleQuerySchema,readRecycleQuery,writeRecycleQuery,recycleRestoreSchema,restoredRecordHref,recycleKinds} from '../lib/recycle-contract.ts';
import {loadRecyclePage,restoreRecycleRecord} from '../lib/recycle-bin-repository.ts';
import {recoveryZh,recoveryEn} from '../lib/i18n/locales/recovery-workspace.ts';

const id='00000000-0000-4000-8000-000000000001',stamp='2026-10-25T01:02:03.123456+08:00';
const command={scope:'personal',kind:'TASK',id,expectedDeletedAt:stamp,requestKey:'fictional-recovery-request'};
test('recovery query URLs preserve external context, multiword typing and explicit paging',()=>{
 for(const kind of ['all',...recycleKinds])for(const retention of ['all','eligible','retained']){
  const query={q:'Fictional record ',kind,retention,page:3,pageSize:10},original=new URLSearchParams('context=fictional');
  assert.deepEqual(readRecycleQuery(writeRecycleQuery(original,query)),query);assert.equal(writeRecycleQuery(original,query).get('context'),'fictional');assert.equal(original.has('q'),false);
 }
 assert.deepEqual(readRecycleQuery(new URLSearchParams('kind=constructor&retention=expired&page=-2&pageSize=999&q='+'x'.repeat(200))),recycleDefaults);
 assert.equal(writeRecycleQuery(new URLSearchParams(),recycleDefaults).toString(),'');
 for(const patch of [{page:0},{page:1.2},{page:1000001},{pageSize:51},{kind:'UNKNOWN'},{retention:'expired'},{q:'x'.repeat(101)}])assert.equal(recycleQuerySchema.safeParse({...recycleDefaults,...patch}).success,false);
});
test('recovery reads use one scoped query and preserve exact archive microseconds',async()=>{
 const result=await loadRecyclePage('personal',{...recycleDefaults,kind:'TASK',q:'Fictional,(task) ',page:6},async(url,init)=>{
  assert.equal(url,'/db/rpc/query_recycle_records');assert.deepEqual(JSON.parse(init.body),{p_scope:'personal',p_query:'Fictional,(task)',p_kind:'TASK',p_retention:'all',p_page:6,p_page_size:20});
  return {scope:'personal',total:101,page:6,pageSize:20,items:[{id,kind:'TASK',labelZh:'示例任务',labelEn:'Fictional task',deletedAt:stamp,purgeEligibleAt:'2026-11-24T01:02:03.123456+08:00'}]};
 });
 assert.equal(result.total,101);assert.equal(result.items[0].deletedAt,stamp);
});
test('malformed and foreign-scope recovery snapshots never become an empty successful result',async()=>{
 const base={scope:'personal',items:[],total:0,page:1,pageSize:20};
 for(const value of [null,[],{}, {...base,total:'0'},{...base,scope:'workspace'},{...base,page:2},{...base,pageSize:10},{...base,items:[{id,kind:'UNKNOWN'}]}]){
  await assert.rejects(loadRecyclePage('personal',recycleDefaults,async()=>value),error=>error.code==='INVALID_RECYCLE_RESPONSE'&&error.status===502);
 }
});
test('restoration requires the observed deletion, scope and original receipt identity',async()=>{
 for(const patch of [{expectedDeletedAt:undefined},{expectedDeletedAt:'invalid'},{requestKey:undefined},{requestKey:' short '},{scope:'all'},{kind:'UNKNOWN'},{id:'not-an-id'},{unexpected:true}]){
  assert.equal(recycleRestoreSchema.safeParse({...command,...patch}).success,false);
  await assert.rejects(restoreRecycleRecord({...command,...patch},async()=>assert.fail('invalid restore dispatched')));
 }
 let body;
 const result=await restoreRecycleRecord(command,async(url,init)=>{assert.equal(url,'/db/rpc/restore_recycle_record_command');body=JSON.parse(init.body);return {id,kind:'TASK',restored:true};});
 assert.equal(body.p_deleted_at,stamp);assert.equal(body.p_request_key,command.requestKey);assert.equal(body.p_scope,'personal');assert.equal(result.restored,true);
});
test('restore transport success requires the matching record and an accepted result',async()=>{
 for(const value of [undefined,null,true,{ok:true},{id,kind:'TASK',restored:false},{id,kind:'CONTACT',restored:true},{id:'00000000-0000-4000-8000-000000000002',kind:'TASK',restored:true}])await assert.rejects(restoreRecycleRecord(command,async()=>value),error=>error.code==='INVALID_RECYCLE_RESPONSE');
});
test('restored links use only established detail routes and valid identifiers',()=>{
 for(const [kind,path] of [['TASK','tasks'],['ORGANIZATION','schools'],['CONTACT','people']])assert.equal(restoredRecordHref({kind,id}),`/${path}/${id}`);
 assert.equal(restoredRecordHref({kind:'CONTRACT',id}),null);assert.equal(restoredRecordHref({kind:'TASK',id:'//example.test/'}),null);
});
test('database recovery catalog matches the canonical application resource catalog',async()=>{
 const directory=new URL('../db/migrations/',import.meta.url);let source;
 for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')).sort()){
  const sql=await readFile(new URL(file,directory),'utf8');
  const match=sql.match(/create(?: or replace)? function public\.recycle_resource_kinds\(\)[\s\S]*?select array\[([^\]]+)\]::text\[\]/i);
  if(match)source=match[1];
 }
 assert.ok(source,'a forward migration must declare the current recovery catalog');
 assert.deepEqual([...source.matchAll(/'([A-Z_]+)'/g)].map(match=>match[1]),recycleKinds);assert.equal(new Set(recycleKinds).size,recycleKinds.length);
});
test('recovery copy has bilingual parity and distinguishes eligibility from physical deletion',()=>{
 assert.deepEqual(Object.keys(recoveryZh).sort(),Object.keys(recoveryEn).sort());
 assert.match(recoveryEn['recovery.retentionHelp'],/not a guaranteed deletion time/);assert.match(recoveryZh['recovery.retentionHelp'],/不是实际删除承诺/);
 for(const key of ['recovery.uncertain','recovery.refreshOnly','recovery.eligibleAt','recovery.retained','recovery.conflict']){assert.ok(recoveryEn[key]);assert.ok(recoveryZh[key]);}
});
