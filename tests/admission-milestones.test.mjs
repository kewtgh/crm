import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {milestoneDataSchema,milestoneSaveSchema,milestoneFiltersSchema,milestoneTypes} from '../lib/admission-milestone-input.ts';
import {listMilestones,getMilestone,saveMilestone,listMilestoneStatusHistory,listAdmissionsTimeline} from '../lib/admission-milestone-repository.ts';
import {milestonePrivacyRecords} from '../scripts/lib/milestone-privacy-export.mjs';
import {enMilestones,zhMilestones} from '../lib/i18n/locales/admission-milestones.ts';
import {presentApiError} from '../lib/api-error-presenter.ts';
import {ApiClientError} from '../lib/api-client.ts';
const data={enrollment_id:randomUUID(),application_id:null,milestone_type:'INTERVIEW',status:'PENDING',due_at:null,scheduled_at:null,completed_at:null,outcome:null,owner_id:null,external_reference:null,note:null,sequence:1,metadata:{}};
test('Milestone identity requires Enrollment, allows optional Application and repeat types; no duplicated domain facts',()=>{
 assert.deepEqual(milestoneDataSchema.parse(data),data);
 for(const patch of [{student_id:randomUUID()},{product_id:randomUUID()},{cohort_id:randomUUID()},{enrollment_id:null},{milestone_type:'APPLICATION_SUBMITTED'},{milestone_type:'ADMISSION_DECISION'},{milestone_type:'DEPOSIT_PAID'},{milestone_type:'FINAL_PAYMENT'},{status:'ADMITTED'},{sequence:0}])assert.equal(milestoneDataSchema.safeParse({...data,...patch}).success,false);
 assert.ok(milestoneTypes.includes('VISA_APPOINTMENT'));assert.equal(milestoneDataSchema.safeParse({...data,application_id:randomUUID(),sequence:2}).success,true);
});
test('Scheduled/completed require their own dates; due differs from scheduled and early completion is valid',()=>{
 for(const patch of [{status:'SCHEDULED'},{status:'COMPLETED'},{due_at:'2027-01-01'},{scheduled_at:'wrong'}])assert.equal(milestoneDataSchema.safeParse({...data,...patch}).success,false);
 assert.equal(milestoneDataSchema.safeParse({...data,status:'COMPLETED',due_at:'2027-02-01T00:00:00Z',scheduled_at:'2027-01-10T00:00:00Z',completed_at:'2027-01-09T00:00:00Z'}).success,true);
 for(const status of ['WAIVED','CANCELLED','BLOCKED'])assert.equal(milestoneDataSchema.safeParse({...data,status}).success,true);
});
test('Metadata is type-specific and rejects unknown keys, files, wrong types and unknown controlled results',()=>{
 for(const metadata of [{passport:'x'},{summary:'x'.repeat(2001)},{result:'APPROVED'},{interviewer:12},{summary:''}])assert.equal(milestoneDataSchema.safeParse({...data,metadata}).success,false);
 assert.deepEqual(milestoneDataSchema.parse({...data,metadata:{summary:' Summary ',result:'PASS'}}).metadata,{summary:'Summary',result:'PASS'});
 for(const [type,metadata] of [['PLACEMENT_TEST',{score:0,scale:'100',result:'A'}],['VISA_RESULT',{result:'ADMINISTRATIVE_PROCESSING',reason:'Review'}],['OTHER',{label:'Custom'}]])assert.equal(milestoneDataSchema.safeParse({...data,milestone_type:type,metadata}).success,true);
 for(const [type,metadata] of [['PLACEMENT_TEST',{score:'90'}],['VISA_RESULT',{result:'PASS'}],['I20_ISSUED',{result:'ISSUED'}]])assert.equal(milestoneDataSchema.safeParse({...data,milestone_type:type,metadata}).success,false);
});
test('Repository uses contextual pagination and identical revision/receipt request on retry',async()=>{
 const calls=[],adapter={json:async(url,init)=>{calls.push({url,init});return[];},request:async(url,init)=>{calls.push({url,init});return new Response('[]',{headers:{'content-range':'20-39/41'}});}},app=randomUUID();
 const page=await listMilestones({enrollmentId:data.enrollment_id,applicationId:app,page:2},adapter);assert.equal(page.total,41);assert.equal(calls[0].init.headers.Range,'20-39');assert.equal(new URL(calls[0].url,'http://local').searchParams.get('application_id'),`eq.${app}`);
 const input=milestoneSaveSchema.parse({id:randomUUID(),expectedRevision:2,requestKey:randomUUID(),statusReason:'Interview scheduled',data});await saveMilestone(input,adapter);await saveMilestone(input,adapter);assert.deepEqual(calls[1],calls[2]);const body=JSON.parse(calls[1].init.body);assert.equal(body.expected_revision,2);assert.equal(body.p_request_key,input.requestKey);
 await getMilestone(input.id,adapter);await listMilestoneStatusHistory(input.id,2,adapter);assert.equal(new URL(calls.at(-1).url,'http://local').searchParams.get('offset'),'50');
 for(const patch of [{pageSize:51},{page:0},{enrollmentId:'Name'}])assert.equal(milestoneFiltersSchema.safeParse({enrollmentId:data.enrollment_id,...patch}).success,false);
});
test('Timeline preserves Application/Milestone source and stable ordering without conflating status history',async()=>{
 let request;const id=randomUUID(),adapter={json:async()=>[],request:async(url,init)=>{request={url,init};return new Response(JSON.stringify([{source_type:'APPLICATION',source_id:id,application_id:id,event_type:'SUBMITTED',status:'SUBMITTED',event_at:'2027-01-01T00:00:00Z',sequence:0,milestone_type:null,outcome:null}]),{headers:{'content-range':'0-0/1'}});}};
 const result=await listAdmissionsTimeline(data.enrollment_id,1,20,adapter);assert.equal(result.items[0].id,`APPLICATION:${id}:SUBMITTED`);assert.equal(result.items[0].sourceType,'APPLICATION');assert.equal(new URL(request.url,'http://local').searchParams.get('order'),'event_at.asc,sequence.asc,source_type.asc,source_id.asc,event_type.asc');assert.ok(!request.url.includes('history'));assert.equal(request.init.headers.Range,'0-19');
});
test('Privacy export scopes milestones/history without duplicating Application or Finance facts',async()=>{
 const ws=randomUUID(),id=randomUUID(),calls=[];const result=await milestonePrivacyRecords(async url=>{calls.push(url);return url.includes('status_history')?[{workspace_id:ws,milestone_id:id}]:[{workspace_id:ws,id,enrollment_id:data.enrollment_id}];},ws,[data.enrollment_id]);assert.equal(result.milestones.length,1);assert.equal(result.history.length,1);assert.equal(calls.length,2);assert.ok(calls.every(url=>url.includes(`workspace_id=eq.${ws}`)&&!url.includes('student_applications')&&!url.includes('payments')));
 await assert.rejects(milestonePrivacyRecords(async()=>[{workspace_id:randomUUID(),id,enrollment_id:data.enrollment_id}],ws,[data.enrollment_id]),/scope mismatch/);
 assert.deepEqual(await milestonePrivacyRecords(()=>{throw Error('No query');},ws,[]),{milestones:[],history:[]});
});
test('Types, statuses, outcomes, findings and mutation feedback are bilingual',()=>{
 assert.deepEqual(Object.keys(enMilestones).sort(),Object.keys(zhMilestones).sort());for(const text of Object.values(enMilestones))assert.ok(text.trim());
 assert.equal(presentApiError(new ApiClientError('MILESTONE_VERSION_CONFLICT',409),key=>zhMilestones[key]??key,'milestones.saveFailed').message,zhMilestones['milestones.versionConflict']);
});
