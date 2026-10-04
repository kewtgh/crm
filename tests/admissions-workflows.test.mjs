import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {workflowTemplateSaveSchema,workflowStepSchema,workflowStartSchema,workflowActionSchema,workflowTemplateActionSchema} from '../lib/workflow-input.ts';
import {listWorkflowTemplates,getWorkflowTemplate,saveWorkflowTemplate,changeWorkflowTemplate} from '../lib/workflow-template-repository.ts';
import {listWorkflows,getWorkflow,instantiateWorkflow,operateWorkflow} from '../lib/workflow-instance-repository.ts';
import {workflowPrivacyRecords} from '../scripts/lib/workflow-privacy-export.mjs';
import {listAdmissionsTimeline} from '../lib/admission-milestone-repository.ts';
import {enWorkflows,zhWorkflows} from '../lib/i18n/locales/workflows.ts';
import {presentApiError} from '../lib/api-error-presenter.ts';
import {ApiClientError} from '../lib/api-client.ts';
import {automationInputSchema} from '../lib/automation-input.ts';
const step={id:randomUUID(),sequence:10,name_zh:'准备资料',name_en:'Prepare materials',step_kind:'TASK',required:true,default_owner_role:null,offset_basis:null,offset_days:null,task_config:{title_zh:'准备资料',title_en:'Prepare materials',description:'Instructions',priority:'NORMAL'},milestone_config:null,checkpoint_config:null};
const template={id:randomUUID(),expectedRevision:null,requestKey:randomUUID(),data:{name_zh:'招生流程',name_en:'Admissions',product_id:null,workflow_type:'ADMISSIONS',description:'',steps:[step]}};
test('Template configs are a finite strict catalog, reject arbitrary expressions and duplicate identities',()=>{
 assert.deepEqual(workflowTemplateSaveSchema.parse(template),template);
 for(const patch of [{script:'x'},{step_kind:'PAYMENT'},{task_config:{...step.task_config,sql:'select 1'}},{offset_basis:'TODAY_PLUS_EXPRESSION',offset_days:1},{offset_basis:'WORKFLOW_START',offset_days:null},{offset_basis:null,offset_days:1},{default_owner_role:'ADMISSIONS_MANAGER'},{sequence:0}])assert.equal(workflowStepSchema.safeParse({...step,...patch}).success,false);
 for(const data of [{...template.data,workflow_type:'FINANCE'},{...template.data,steps:[]},{...template.data,steps:[step,{...step,id:randomUUID()}]},{...template.data,steps:[step,{...step,sequence:20}]}])assert.equal(workflowTemplateSaveSchema.safeParse({...template,data}).success,false);
 assert.equal(workflowStepSchema.safeParse({...step,offset_basis:'COHORT_START',offset_days:-14}).success,true);
});
test('Milestone and checkpoint configs do not create duplicate Application or Finance facts',()=>{
 const milestone={...step,step_kind:'MILESTONE',task_config:null,milestone_config:{milestone_type:'INTERVIEW',default_status:'PENDING',application_scope:'APPLICATION'}};
 assert.equal(workflowStepSchema.safeParse(milestone).success,true);
 for(const milestone_type of ['APPLICATION_SUBMITTED','ADMISSION_DECISION','DEPOSIT_PAID','FINAL_PAYMENT'])assert.equal(workflowStepSchema.safeParse({...milestone,milestone_config:{...milestone.milestone_config,milestone_type}}).success,false);
 assert.equal(workflowStepSchema.safeParse({...milestone,milestone_config:{...milestone.milestone_config,default_status:'COMPLETED'}}).success,false);
 const checkpoint={...step,step_kind:'CHECKPOINT',task_config:null,checkpoint_config:{checkpoint_type:'APPLICATION_SUBMITTED',application_scope:'APPLICATION'}};
 assert.equal(workflowStepSchema.safeParse(checkpoint).success,true);
 for(const cfg of [{checkpoint_type:'DEPOSIT_PAID',application_scope:'APPLICATION'},{checkpoint_type:'APPLICATION_SUBMITTED',application_scope:'ENROLLMENT'},{checkpoint_type:'MILESTONE_COMPLETED',application_scope:'ENROLLMENT'}])assert.equal(workflowStepSchema.safeParse({...checkpoint,checkpoint_config:cfg}).success,false);
 assert.equal(workflowStepSchema.safeParse({...checkpoint,checkpoint_config:{checkpoint_type:'MILESTONE_COMPLETED',milestone_type:'VISA_APPOINTMENT',application_scope:'ENROLLMENT'}}).success,true);
});
test('Explicit Enrollment, version and optional Application are required context; mutations cannot complete arbitrary steps',()=>{
 const start={id:randomUUID(),templateId:template.id,templateVersion:1,enrollmentId:randomUUID(),applicationId:null,ownerId:randomUUID(),requestKey:randomUUID()};assert.deepEqual(workflowStartSchema.parse(start),start);
 for(const patch of [{enrollmentId:null},{templateVersion:0},{applicationId:'School A'},{studentId:randomUUID()}])assert.equal(workflowStartSchema.safeParse({...start,...patch}).success,false);
 const action={id:start.id,expectedRevision:2,requestKey:randomUUID(),operation:'WAIVE',stepId:randomUUID(),reason:'Not applicable'};assert.equal(workflowActionSchema.safeParse(action).success,true);
 for(const patch of [{operation:'COMPLETED'},{stepId:undefined},{reason:''},{expectedRevision:null}])assert.equal(workflowActionSchema.safeParse({...action,...patch}).success,false);
 assert.equal(workflowTemplateActionSchema.safeParse({id:template.id,expectedRevision:1,requestKey:randomUUID(),operation:'NEW_VERSION'}).success,false);
});
test('Template repository uses generic/product filtering, pagination and explicit version changes',async()=>{
 const calls=[],adapter={json:async(url,init)=>{calls.push({url,init});return url.includes('workflow_template_records')?[{id:template.id}]:[];},request:async(url,init)=>{calls.push({url,init});return new Response('[]',{headers:{'content-range':'20-39/42'}});}};
 const product=randomUUID(),page=await listWorkflowTemplates({status:'ACTIVE',productId:product,page:2},adapter);assert.equal(page.total,42);assert.equal(calls[0].init.headers.Range,'20-39');assert.equal(new URL(calls[0].url,'http://local').searchParams.get('or'),`(product_id.is.null,product_id.eq.${product})`);
 await getWorkflowTemplate(template.id,adapter);assert.equal(new URL(calls.at(-1).url,'http://local').searchParams.get('order'),'sequence.asc,id.asc');
 await saveWorkflowTemplate(template,adapter);await saveWorkflowTemplate(template,adapter);assert.deepEqual(calls.at(-1),calls.at(-2));
 const version={id:template.id,expectedRevision:2,requestKey:randomUUID(),operation:'NEW_VERSION',newId:randomUUID()};await changeWorkflowTemplate(version,adapter);assert.equal(JSON.parse(calls.at(-1).init.body).new_id,version.newId);
});
test('Instance repository reads canonical projection and sends identical actor-bound retry payloads',async()=>{
 const calls=[],adapter={json:async(url,init)=>{calls.push({url,init});return url.includes('workflow_instance_records')?[{id:template.id}]:[];},request:async(url,init)=>{calls.push({url,init});return new Response('[]',{headers:{'content-range':'0-19/1'}});}};
 const context={enrollmentId:randomUUID(),applicationId:randomUUID(),page:1};await listWorkflows(context,adapter);assert.equal(new URL(calls[0].url,'http://local').searchParams.get('application_id'),`eq.${context.applicationId}`);
 await getWorkflow(template.id,adapter);assert.ok(calls.at(-1).url.startsWith('/db/table/workflow_step_records?'));
 const start={id:randomUUID(),templateId:template.id,templateVersion:3,...context,ownerId:randomUUID(),requestKey:randomUUID()};await instantiateWorkflow(start,adapter);await instantiateWorkflow(start,adapter);assert.deepEqual(calls.at(-1),calls.at(-2));assert.equal(JSON.parse(calls.at(-1).init.body).template_version,3);
 await operateWorkflow({id:start.id,expectedRevision:4,operation:'CANCEL',reason:'No longer applicable',requestKey:randomUUID()},adapter);assert.equal(JSON.parse(calls.at(-1).init.body).expected_revision,4);
});
test('Student privacy export scopes instances and steps; templates remain references and foreign rows fail',async()=>{
 const ws=randomUUID(),en=randomUUID(),instance=randomUUID(),calls=[];
 const reader=async url=>{calls.push(url);return url.includes('workflow_step_instances')?[{id:randomUUID(),workspace_id:ws,workflow_instance_id:instance}]:url.includes('workflow_templates')?[{id:template.id,workspace_id:ws,name_en:'Admissions',version:1}]:[{id:instance,workspace_id:ws,enrollment_id:en,template_id:template.id}];};
 const result=await workflowPrivacyRecords(reader,ws,[en]);assert.equal(result.instances.length,1);assert.equal(result.steps.length,1);assert.equal(result.templates.length,1);assert.ok(calls.every(url=>url.includes(`workspace_id=eq.${ws}`)));assert.ok(calls[2].includes('select=id,workspace_id,name_zh,name_en,version'));assert.ok(!calls.some(url=>/payments|contracts|template_steps/.test(url)));
 await assert.rejects(workflowPrivacyRecords(async()=>[{id:instance,workspace_id:randomUUID(),enrollment_id:en}],ws,[en]),/scope mismatch/);
 await assert.rejects(workflowPrivacyRecords(reader,ws,['Zhang San']),/Invalid workflow privacy scope/);
 assert.deepEqual(await workflowPrivacyRecords(()=>{throw Error('No query');},ws,[]),{instances:[],steps:[],templates:[]});
});
test('Admissions timeline retains WORKFLOW as a separate source with only start/completion summaries',async()=>{
 const id=randomUUID(),adapter={json:async()=>[],request:async()=>new Response(JSON.stringify([{source_type:'WORKFLOW',source_id:id,event_type:'STARTED',event_at:'2027-01-01T00:00:00Z',application_id:null,status:'ACTIVE',sequence:0,milestone_type:null,outcome:null}]))};const result=await listAdmissionsTimeline(randomUUID(),1,20,adapter);assert.equal(result.items[0].sourceType,'WORKFLOW');assert.equal(result.items[0].id,`WORKFLOW:${id}:STARTED`);
});
test('Types, sources, warnings, automation triggers and conflict feedback are bilingual',()=>{
 assert.deepEqual(Object.keys(enWorkflows).sort(),Object.keys(zhWorkflows).sort());assert.ok(Object.values(enWorkflows).every(v=>v.trim()));
 assert.equal(presentApiError(new ApiClientError('WORKFLOW_VERSION_CONFLICT',409),key=>zhWorkflows[key]??key,'workflow.saveFailed').message,zhWorkflows['workflow.conflict']);
 for(const key of ['automation.trigger.APPLICATION_CREATED','automation.trigger.WORKFLOW_STEP_READY','quality.rule.WORKFLOW_MISSING_CONTEXT','milestones.source.WORKFLOW'])assert.ok(enWorkflows[key]&&zhWorkflows[key]);
});
test('Admissions events use existing TASK/NOTIFICATION rules without additional actions',()=>{
 for(const triggerKey of ['APPLICATION_CREATED','APPLICATION_STATUS_CHANGED','MILESTONE_STATUS_CHANGED','MILESTONE_DUE_APPROACHING','WORKFLOW_STARTED','WORKFLOW_STEP_READY','WORKFLOW_COMPLETED'])for(const actionType of ['TASK','NOTIFICATION'])assert.equal(automationInputSchema.safeParse({operation:'create',nameZh:'招生规则',nameEn:'Admissions rule',triggerKey,actionType,titleZh:'业务跟进',titleEn:'Follow up',priority:'NORMAL',dueHours:24}).success,true);
});
