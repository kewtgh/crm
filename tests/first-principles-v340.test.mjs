import test from 'node:test';
import assert from 'node:assert/strict';
import {qualityDefaults,qualityFilterSchema,readQualityFilters,writeQualityFilters,qualityCommandSchema,qualityIsActive,qualityRecordHref} from '../lib/quality-contract.ts';
import {listQualityIssues} from '../lib/phase2-repository.ts';
import {loadQualityWorkspace,executeQualityCommand} from '../lib/quality-workspace-repository.ts';
import {qualityTriageEn,qualityTriageZh} from '../lib/i18n/locales/quality-triage.ts';

const id='00000000-0000-4000-8000-000000000001';
test('quality filters round-trip through URLs and reject unsupported API inputs',()=>{
 for(const status of ['active','OPEN','ASSIGNED','RESOLVED','DISMISSED','all'])for(const severity of ['all','HIGH','MEDIUM','LOW'])for(const assignment of ['all','mine','unassigned']){
  const filters={q:'Fictional',status,severity,assignment},original=new URLSearchParams('context=example&severity=old');
  assert.deepEqual(readQualityFilters(writeQualityFilters(original,filters)),filters);assert.equal(original.get('severity'),'old');assert.equal(writeQualityFilters(original,filters).get('context'),'example');
 }
 assert.equal(readQualityFilters(writeQualityFilters(new URLSearchParams(),{...qualityDefaults,q:'Fictional '})).q,'Fictional ');
 assert.deepEqual(readQualityFilters(new URLSearchParams('status=constructor&severity=extreme&assignment=other')),qualityDefaults);
 for(const patch of [{status:'unknown'},{severity:'critical'},{assignment:id},{q:'x'.repeat(101)}])assert.equal(qualityFilterSchema.safeParse({...qualityDefaults,...patch}).success,false);
 assert.equal(qualityIsActive('RESOLVED'),false);assert.equal(qualityIsActive('DISMISSED'),false);assert.equal(qualityIsActive('ASSIGNED'),true);
});
test('quality reads filter status/severity/actor before stable paging',async()=>{
 for(const status of ['active','RESOLVED','all']){
  let params,range;
  const result=await listQualityIssues({status,severity:'HIGH',assignment:'mine',actorId:id,page:2,pageSize:10,query:'Fictional,(rule)'},async(url,init)=>{params=new URL(url,'https://example.test').searchParams;range=init.headers.Range;return new Response(JSON.stringify([{id,revision:4,rule_key:'FICTIONAL',entity_type:'TASK',entity_id:id,severity:'HIGH',title_key:'quality.rule.generic',details:null,status:'ASSIGNED',assigned_to:id,last_seen_at:'2026-10-23T00:00:00Z'}]),{headers:{'content-range':'10-10/11'}});});
  assert.equal(range,'10-19');assert.equal(params.get('order'),'last_seen_at.desc,id.asc');assert.equal(params.get('assigned_to'),`eq.${id}`);assert.equal(params.get('severity'),'eq.HIGH');assert.equal(params.get('status'),status==='active'?'in.(OPEN,ASSIGNED)':status==='all'?null:'eq.RESOLVED');assert.equal(result.items[0].revision,4);assert.deepEqual(result.items[0].details,{});assert.equal(result.total,11);
 }
 await assert.rejects(listQualityIssues({assignment:'mine'},async()=>{throw new Error('must not dispatch');}),/QUALITY_ACTOR_REQUIRED/);
});
test('default quality view excludes history, with explicit unassigned scope',async()=>{
 await listQualityIssues({assignment:'unassigned'},async url=>{const params=new URL(url,'https://example.test').searchParams;assert.equal(params.get('status'),'in.(OPEN,ASSIGNED)');assert.equal(params.get('assigned_to'),'is.null');return new Response('[]',{headers:{'content-range':'0-0/0'}});});
});
test('quality mutation contract requires one receipt and a current version for every record change',async()=>{
 const key='fictional-quality-request';
 const commands=[{operation:'run',requestKey:key},{operation:'assign',id,expectedRevision:1,requestKey:key},{operation:'resolve',id,expectedRevision:2,resolution:'Verified fictional correction',dismiss:false,requestKey:key},{operation:'configure',ruleKey:'FICTIONAL',expectedRevision:3,enabled:false,severity:'LOW',requestKey:key}];
 for(const command of commands){const parsed=qualityCommandSchema.parse(command);let body;await executeQualityCommand(parsed,async(url,init)=>{assert.equal(url,'/db/rpc/execute_quality_command');body=JSON.parse(init.body);return true;});assert.equal(body.p_request_key,key);assert.equal(body.command.requestKey,undefined);assert.equal(body.command.operation,command.operation);assert.equal(qualityCommandSchema.safeParse({...command,requestKey:undefined}).success,false);}
 for(const patch of [{expectedRevision:undefined},{expectedRevision:0},{expectedRevision:'1'}])assert.equal(qualityCommandSchema.safeParse({...commands[1],...patch}).success,false);
 assert.equal(qualityCommandSchema.safeParse({...commands[2],resolution:'x'}).success,false);
});
test('optional trend/config failures preserve the core queue and expose safe availability markers',async()=>{
 const issue={items:[],total:0,page:1,pageSize:10},fail=async()=>{throw new Error('Fictional private diagnostic');};
 const result=await loadQualityWorkspace({}, {issues:async()=>issue,trend:fail,rules:fail});assert.deepEqual(result.unavailable,['trend','rules']);assert.deepEqual(result.items,[]);assert.equal(result.total,0);assert.ok(!JSON.stringify(result).includes('private diagnostic'));
 await assert.rejects(loadQualityWorkspace({}, {issues:fail,trend:async()=>[],rules:async()=>[]}),/private diagnostic/);
});
test('quality links preserve owning workspaces and reject malformed context identifiers',()=>{
 assert.equal(qualityRecordHref({entityType:'TASK',entityId:id,details:{}}),`/tasks/${id}`);
 assert.equal(qualityRecordHref({entityType:'STUDENT_SUCCESS_RISK',entityId:id,details:{caseId:id}}),`/student-success?focus=${id}`);
 assert.equal(qualityRecordHref({entityType:'WORKFLOW',entityId:id,details:{enrollmentId:'bad&scope=all'}}),null);
 assert.equal(qualityRecordHref({entityType:'TASK',entityId:'../settings',details:{}}),null);
});
test('quality triage messages retain matching bilingual keys',()=>assert.deepEqual(Object.keys(qualityTriageEn).sort(),Object.keys(qualityTriageZh).sort()));
