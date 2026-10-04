import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {successCaseDataSchema,successGoalDataSchema,successCaseSaveSchema,successTaskLinkSchema,successFiltersSchema,successStatuses,successHealth} from '../lib/student-success-input.ts';
import {listSuccessCases,saveSuccessCase,saveSuccessGoal,saveSuccessTaskLink,listSuccessTasks} from '../lib/student-success-repository.ts';
import {studentSuccessPrivacyRecords} from '../scripts/lib/student-success-privacy-export.mjs';
import {enSuccess,zhSuccess} from '../lib/i18n/locales/student-success.ts';
import {presentApiError} from '../lib/api-error-presenter.ts';
import {ApiClientError} from '../lib/api-client.ts';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const data={enrollment_id:uuid(1),status:'PLANNING',health_status:'UNKNOWN',owner_id:null,next_review_on:null,success_summary:null,plan_summary:null};
const goal={case_id:uuid(2),goal_type:'ACADEMIC',title:'Maintain B+ average',description:null,status:'PLANNED',target_on:null,achieved_at:null,owner_id:null};
test('case lifecycle and human assessment preserve unknown and immutable identity boundary',()=>{
 for(const status of successStatuses)for(const health_status of successHealth)assert.equal(successCaseDataSchema.parse({...data,status,health_status}).health_status,health_status);
 for(const extra of [{student_id:uuid(3)},{product_id:uuid(4)},{cohort_id:uuid(5)},{risk_score:80}])assert.equal(successCaseDataSchema.safeParse({...data,...extra}).success,false);
 assert.equal(successCaseDataSchema.safeParse({...data,status:'REGISTERING'}).success,false);
 assert.equal(successCaseDataSchema.safeParse({...data,health_status:'HEALTHY'}).success,false);
 assert.equal(successCaseSaveSchema.safeParse({id:uuid(2),requestKey:'test-request',expectedRevision:0,data}).success,false);
});
test('goal results require explicit achievement time but do not require unique titles',()=>{
 assert.equal(successGoalDataSchema.safeParse(goal).success,true);
 assert.equal(successGoalDataSchema.safeParse({...goal,status:'ACHIEVED'}).success,false);
 assert.equal(successGoalDataSchema.safeParse({...goal,status:'ACHIEVED',achieved_at:'2026-10-05T00:00:00Z'}).success,true);
 for(const status of ['ACTIVE','NOT_ACHIEVED','CANCELLED'])assert.equal(successGoalDataSchema.safeParse({...goal,status}).success,true);
});
test('list projection filters dates and identities on server without widening hidden task counts',async()=>{
 let captured;
 const page=await listSuccessCases({page:2,pageSize:10,health:'UNKNOWN',reviewFrom:'2027-01-01',reviewTo:'2027-02-01',productId:uuid(4)}, {request:async(url,init)=>{captured={url,init};return new Response(JSON.stringify([{...data,id:uuid(2),open_task_count:0}]),{headers:{'content-range':'10-10/11'}});},json:async()=>[]});
 const params=new URL(captured.url,'http://localhost').searchParams;
 assert.equal(params.get('health_status'),'eq.UNKNOWN');assert.equal(params.get('product_id'),`eq.${uuid(4)}`);assert.equal(params.get('and'),'(next_review_on.gte.2027-01-01,next_review_on.lte.2027-02-01)');assert.equal(captured.init.headers.Range,'10-19');assert.equal(page.total,11);assert.equal(page.items[0].health_status,'UNKNOWN');
 assert.equal(successFiltersSchema.safeParse({reviewFrom:'2027-02-01',reviewTo:'2027-01-01'}).success,false);
});
test('case goal and task link retry payloads preserve revision and explicit domain context',async()=>{
 const calls=[],adapter={json:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return data;},request:async()=>new Response('[]')};
 const input={id:uuid(2),expectedRevision:null,requestKey:'same-request',statusReason:'Human start',data};
 await saveSuccessCase(input,adapter);await saveSuccessCase(input,adapter);assert.deepEqual(calls[0],calls[1]);
 await saveSuccessGoal({...input,data:goal},adapter);assert.equal(calls[2].body.data.case_id,uuid(2));
 const link={id:uuid(6),expectedRevision:null,requestKey:'task-request',caseId:uuid(2),taskId:uuid(7),goalId:null,unlink:false};
 await saveSuccessTaskLink(link,adapter);assert.equal(calls[3].body.target_task,uuid(7));assert.equal(calls[3].body.target_case,uuid(2));
 assert.equal(successTaskLinkSchema.safeParse({...link,unlink:true}).success,false);
 const queries=[];await listSuccessTasks(uuid(2),2,{...adapter,json:async url=>{queries.push(url);return[];}});assert.ok(queries[0].includes('student_success_task_records'));assert.ok(queries[0].includes('offset=50'));
});
test('privacy export returns one Task fact with relationship references and rejects foreign rows',async()=>{
 const cases=[{id:uuid(2),workspace_id:uuid(9),enrollment_id:uuid(1)}],links=[{id:uuid(6),workspace_id:uuid(9),case_id:uuid(2),task_id:uuid(7),goal_id:null}],queries=[];
 const requestAll=async url=>{queries.push(url);if(url.includes('/student_success_cases?'))return cases;if(url.includes('/student_success_task_links?'))return links;if(url.includes('/student_success_privacy_tasks?'))return[{id:uuid(7),workspace_id:uuid(9),title_en:'Real task'}];return[];};
 const exported=await studentSuccessPrivacyRecords(requestAll,uuid(9),[uuid(1)]);assert.equal(exported.tasks.length,1);assert.equal(exported.links[0].task_id,exported.tasks[0].id);assert.equal(queries.filter(q=>q.includes('privacy_tasks')).length,1);
 await assert.rejects(studentSuccessPrivacyRecords(async()=>[{...cases[0],workspace_id:uuid(8)}],uuid(9),[uuid(1)]),/scope mismatch/);
 await assert.rejects(studentSuccessPrivacyRecords(requestAll,uuid(9),['bad']),/Invalid/);
});
test('all success labels match bilingually including actionable conflicts',()=>{
 assert.deepEqual(Object.keys(enSuccess).sort(),Object.keys(zhSuccess).sort());for(const [key,value] of Object.entries(enSuccess))assert.ok(value&&zhSuccess[key]);
 const error=new ApiClientError('SUCCESS_VERSION_CONFLICT',409);assert.equal(presentApiError(error,key=>enSuccess[key]??key,'success.saveFailed').message,enSuccess['success.conflict']);
});
test('Student Success does not redefine admissions, finance, workflow or risk facts',async()=>{
 const sql=await readFile(new URL('../db/migrations/202610050103_student_success_foundation.sql',import.meta.url),'utf8');
 const caseTable=sql.slice(sql.indexOf('create table public.student_success_cases'),sql.indexOf('create index success_case_review_idx'));
 for(const column of ['student_id','product_id','cohort_id','risk_score','success_score'])assert.equal(caseTable.includes(column),false);
 assert.ok(caseTable.includes('unique(workspace_id,enrollment_id)'));assert.equal(/create table.*student_success_tasks/.test(sql),false);
 assert.equal(/(?:insert into|update) public\.(?:contracts|payments|refunds|student_applications|admission_milestones|commission_accruals)\b/.test(sql),false);
 assert.ok(sql.includes('security_invoker=true'));assert.ok(sql.includes('student_success_case_access'));
});
