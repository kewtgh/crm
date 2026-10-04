import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {successCheckinDataSchema,successCheckinSaveSchema,successCheckinOptionsSchema,successRiskDataSchema,successInterventionDataSchema,successRiskStatuses,successInterventionStatuses,successCheckinTypes,successRiskTypes,successInterventionTypes} from '../lib/student-success-operations-input.ts';
import {listSuccessOperations,saveSuccessCheckin,saveSuccessRisk,saveSuccessIntervention} from '../lib/student-success-operations-repository.ts';
import {saveSuccessTaskLink} from '../lib/student-success-repository.ts';
import {successTaskLinkSchema} from '../lib/student-success-input.ts';
import {enSuccessOperations,zhSuccessOperations} from '../lib/i18n/locales/student-success-operations.ts';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,time='2026-10-05T03:00:00Z';
const checkin={case_id:uuid(1),checkin_type:'ROUTINE',occurred_at:time,conducted_by:uuid(2),summary:null,next_steps:null};
const risk={case_id:uuid(1),source_checkin_id:null,risk_type:'ACADEMIC',severity:'LOW',status:'OPEN',observed_at:time,owner_id:null,summary:'Confirmed support concern',resolution_note:null,resolved_at:null};
const intervention={case_id:uuid(1),risk_signal_id:null,intervention_type:'MENTORING',status:'PLANNED',owner_id:null,started_on:null,target_end_on:null,completed_at:null,summary:'Six weeks of mentoring',outcome_note:null};
test('check-ins are occurred events without task lifecycle or implicit assessments',()=>{
 for(const checkin_type of successCheckinTypes)assert.ok(successCheckinDataSchema.safeParse({...checkin,checkin_type}).success);
 for(const extra of [{status:'COMPLETED'},{occurred_at:'infinity'},{conducted_by:null}])assert.equal(successCheckinDataSchema.safeParse({...checkin,...extra}).success,false);
 const input=successCheckinSaveSchema.parse({id:uuid(3),expectedRevision:null,requestKey:'repeat-checkin',data:checkin});assert.equal(input.options.assess_health,false);assert.equal(input.options.update_next_review,false);assert.equal(input.options.next_review_on,null);
 for(const options of [{assess_health:true},{health_status:'ON_TRACK'},{next_review_on:'2027-01-01'},{assess_health:true,health_status:'AT_RISK'}])assert.equal(successCheckinOptionsSchema.safeParse(options).success,false);
 assert.ok(successCheckinOptionsSchema.safeParse({assess_health:true,health_status:'UNKNOWN',expected_case_revision:1}).success);
 assert.ok(successCheckinOptionsSchema.safeParse({update_next_review:true,next_review_on:null,expected_case_revision:1}).success);
});
test('risk and intervention lifecycle requirements keep independent facts and unknown owners',()=>{
 for(const risk_type of successRiskTypes)for(const status of successRiskStatuses)assert.ok(successRiskDataSchema.safeParse({...risk,risk_type,status,resolved_at:status==='RESOLVED'?time:null}).success);
 assert.equal(successRiskDataSchema.safeParse({...risk,status:'RESOLVED'}).success,false);
 for(const intervention_type of successInterventionTypes)for(const status of successInterventionStatuses)assert.ok(successInterventionDataSchema.safeParse({...intervention,intervention_type,status,completed_at:status==='COMPLETED'?time:null}).success);
 assert.equal(successInterventionDataSchema.safeParse({...intervention,status:'COMPLETED'}).success,false);
 assert.equal(successInterventionDataSchema.safeParse({...intervention,started_on:'2027-01-02',target_end_on:'2027-01-01'}).success,false);
 for(const field of ['risk_score','health_status','student_id','GPA'])assert.equal(successRiskDataSchema.safeParse({...risk,[field]:50}).success,false);
 for(const field of ['task_status','goal_status','risk_status','health_status'])assert.equal(successInterventionDataSchema.safeParse({...intervention,[field]:'ACTIVE'}).success,false);
});
test('operation repositories preserve actor-bound retry payload and canonical business date ordering',async()=>{
 const calls=[],adapter=async(url,init)=>{calls.push({url,body:init?JSON.parse(init.body):null});return[];};
 const identity={id:uuid(3),expectedRevision:null,requestKey:'same-request'};
 const input=successCheckinSaveSchema.parse({...identity,data:checkin});await saveSuccessCheckin(input,adapter);await saveSuccessCheckin(input,adapter);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].body.options.assess_health,false);
 await saveSuccessRisk({...identity,data:risk,statusReason:''},adapter);await saveSuccessIntervention({...identity,data:intervention,statusReason:''},adapter);assert.equal(calls[2].body.data.owner_id,null);assert.equal(calls[3].body.data.risk_signal_id,null);
 await listSuccessOperations(uuid(1),'checkins',2,adapter);const params=new URL(calls[4].url,'http://localhost').searchParams;assert.equal(params.get('order'),'occurred_at.desc,id.asc');assert.equal(params.get('offset'),'50');assert.equal(params.get('case_id'),`eq.${uuid(1)}`);
});
test('legacy Task callers keep the old RPC while intervention context uses a guarded mutation',async()=>{
 const calls=[],adapter={json:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return{};}};
 const input=successTaskLinkSchema.parse({id:uuid(5),caseId:uuid(1),taskId:uuid(6),goalId:null,expectedRevision:null,requestKey:'task-link',unlink:false});assert.equal(input.interventionId,null);
 await saveSuccessTaskLink(input,adapter);await saveSuccessTaskLink({...input,interventionId:uuid(7)},adapter);assert.equal(calls[0].url,'/db/rpc/save_student_success_task_link');assert.equal(calls[1].body.target_intervention,uuid(7));
});
test('operations labels are bilingual and SQL preserves canonical domain independence',async()=>{
 assert.deepEqual(Object.keys(enSuccessOperations).sort(),Object.keys(zhSuccessOperations).sort());for(const key of Object.keys(enSuccessOperations))assert.ok(enSuccessOperations[key]&&zhSuccessOperations[key]);
 const sql=await readFile(new URL('../db/migrations/202610050104_student_success_operations.sql',import.meta.url),'utf8');
 assert.ok(sql.includes('security_invoker=true'));assert.ok(sql.includes('student_success_parent_access'));assert.ok(sql.includes("new.health_status<>'UNKNOWN'"));
 assert.equal(/(?:insert into|update) public\.(?:contracts|payments|refunds|commission_accruals|student_applications|admission_milestones|workflow_instances)\b/.test(sql),false);
 assert.equal(/create table.*student_success_tasks/.test(sql),false);assert.equal(/unique\([^)]*risk_type/.test(sql),false);assert.equal(/unique\([^)]*intervention_type/.test(sql),false);
 assert.ok(sql.includes("max(k.occurred_at)"));assert.ok(sql.includes("new.health_status is distinct from old.health_status"));
});
