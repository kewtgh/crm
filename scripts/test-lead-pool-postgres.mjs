import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";

// Disposable local DB only; never loads .env.local or existing application credentials.
const container=`lumina-crm-lead-pool-it-${randomBytes(5).toString("hex")}`,deadline=Date.now()+50_000,password=randomBytes(32).toString("hex");
const image=process.env.LEAD_POOL_TEST_POSTGRES_IMAGE||"postgres:18.6-trixie";
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
let client,otherClient;
function run(command,args,env=process.env){const result=spawnSync(command,args,{env,encoding:"utf8",timeout:Math.max(1,Math.min(15_000,deadline-Date.now())),windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed: ${result.stderr.trim()}`);return result.stdout.trim();}
try{
  run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=workflows","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=lumina_channel_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],{...process.env,POSTGRES_PASSWORD:password});
  const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);assert.match(port,/^\d+$/);
  const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/lumina_channel_test`;
  for(let attempt=0;attempt<20;attempt++){client=new pg.Client({connectionString,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch(error){await client.end().catch(()=>{});client=undefined;if(attempt===19)throw error;await new Promise(resolve=>setTimeout(resolve,200));}}
  const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false",DATABASE_ADMIN_URL:connectionString,MIGRATION_DATABASE_URL:connectionString};
  for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
  run(process.execPath,["scripts/db-bootstrap.mjs"],env);run(process.execPath,["scripts/db-migrate.mjs"],env);
  const ws="00000000-0000-4000-8000-000000000001",otherWs=randomUUID(),admin=randomUUID(),sales=randomUUID(),stranger=randomUUID();
  await client.query("insert into app_auth.accounts(id,email,username) values($1,'enrollment-admin@example.test','enrollment-admin'),($2,'enrollment-sales@example.test','enrollment-sales'),($3,'enrollment-stranger@example.test','enrollment-stranger')",[admin,sales,stranger]);
  await client.query("insert into public.workspaces(id,slug,name) values($1,'enrollment-other','Other')",[otherWs]);
  await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'ADMIN'),($1,$3,'SALES_SPECIALIST'),($4,$5,'ADMIN')",[ws,admin,sales,otherWs,stranger]);
  const context=async(user=admin,workspace=ws,connection=client)=>{await connection.query("reset role");await connection.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[user,workspace]);await connection.query("set role crm_app");};
 const o=(await client.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by,status) values($1,'公共学校','Public School',$2,$2,'UNVERIFIED') returning id",[ws,admin])).rows[0].id;
 const h=(await client.query("insert into public.households(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'家庭','Family',$2,$2) returning id",[ws,admin])).rows[0].id;
 const foreign=(await client.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'外部','Foreign',$2,$2) returning id",[otherWs,stranger])).rows[0].id;
 await client.query("insert into public.record_collaborators(workspace_id,resource_type,resource_id,user_id,access_level,granted_by) values($1,'ORGANIZATION',$2,$3,'READ',$4)",[ws,o,sales,admin]);
 const save=async(id,rev,data,key=randomUUID(),connection=client)=>(await connection.query('select to_jsonb(public.save_lead($1,$2,$3,$4)) item',[id,rev,data,key])).rows[0].item;
 const assignment=async(id,rev,op='CLAIM',owner=null,reason='',key=randomUUID(),connection=client)=>(await connection.query('select to_jsonb(public.manage_lead_assignment($1,$2,$3,$4,$5,$6)) item',[id,rev,op,owner,reason,key])).rows[0].item;
 const data={subject_type:'SCHOOL',organization_id:o,household_id:null,name_zh:'学校线索',name_en:'School lead',source:'RESEARCH',qualification_score:0,qualification_note:'',status:'NEW',pool_visibility:'WORKSPACE_PUBLIC',next_action:''};
 const lead=randomUUID();await context();
 const first=await save(lead,null,data);assert.equal(first.owner_id,null);assert.equal(first.status,'NEW');
 assert.equal((await client.query("select count(*)::int n from public.lead_pool_records where pool_visibility='WORKSPACE_PUBLIC' and owner_id is null")).rows[0].n,1);
 const privateLead=await save(randomUUID(),null,{...data,pool_visibility:'PRIVATE'});assert.equal(privateLead.owner_id,admin);
 await assert.rejects(save(privateLead.id,1,{organization_id:foreign}),/lead_subject_immutable/);
 await assert.rejects(save(privateLead.id,1,{owner_id:sales}),/lead_input_invalid/);
 await assert.rejects(assignment(privateLead.id,1),/lead_not_available/);
 const reassigned=await assignment(privateLead.id,1,'REASSIGN',sales,'Explicit territory');assert.equal(reassigned.owner_id,sales);assert.equal(reassigned.status,'NEW');
 assert.equal((await client.query("select count(*)::int n from public.lead_assignment_history where lead_id=$1 and event_type='REASSIGNED'",[privateLead.id])).rows[0].n,1);
 await assert.rejects(save(randomUUID(),null,{...data,organization_id:foreign}),/lead_forbidden|foreign key/);
 const family=await save(randomUUID(),null,{...data,subject_type:'HOUSEHOLD',organization_id:null,household_id:h,pool_visibility:'PRIVATE'});assert.equal(family.status,'NEW');
 await save(family.id,1,{status:'QUALIFYING',next_action:'Call family'});
 await assert.rejects(save(randomUUID(),null,{...data,subject_type:'HOUSEHOLD',organization_id:null,household_id:h}),/lead_forbidden|check constraint/);
 await context(sales);assert.equal((await client.query('select count(*)::int n from public.lead_pool_records where id=$1',[lead])).rows[0].n,1);
 await assert.rejects(save(randomUUID(),null,data),/lead_visibility_forbidden/);
 await assert.rejects(assignment(privateLead.id,2,'REASSIGN',admin,'Unauthorized'),/lead_owner_forbidden/);
 await assert.rejects(assignment(lead,1,'VISIBILITY_PRIVATE'),/lead_forbidden/);
 await assert.rejects(client.query('update public.leads set owner_id=$1 where id=$2',[sales,lead]),/permission denied/);
 await context();const rule=(await client.query("insert into public.automation_rules(workspace_id,name_zh,name_en,trigger_key,action_type,action_config,created_by) values($1,'领取后跟进','Claim follow-up','LEAD_CLAIMED','TASK','{\"titleZh\":\"明确跟进\",\"titleEn\":\"Explicit follow-up\",\"priority\":\"NORMAL\"}',$2) returning id",[ws,admin])).rows[0].id;
 const disabled=(await client.query("insert into public.automation_rules(workspace_id,name_zh,name_en,trigger_key,action_type,active,created_by) values($1,'关闭规则','Disabled rule','LEAD_CLAIMED','NOTIFICATION',false,$2) returning id",[ws,admin])).rows[0].id;
 await client.query("insert into public.automation_rules(workspace_id,name_zh,name_en,trigger_key,action_type,created_by) values($1,'释放通知','Release notification','LEAD_RELEASED','NOTIFICATION',$2)",[ws,admin]);
 await context(sales);const request=randomUUID(),claimed=await assignment(lead,1,'CLAIM',null,'',request);assert.equal(claimed.owner_id,sales);assert.equal(claimed.status,'NEW');
 for(let j=0;j<2;j++)assert.equal((await assignment(lead,1,'CLAIM',null,'',request)).revision,2);
 assert.equal((await client.query('select count(*)::int n from public.lead_assignment_history where lead_id=$1',[lead])).rows[0].n,1);
 await context();assert.equal((await client.query('select count(*)::int n from public.automation_runs where rule_id=$1 and status=\'SUCCEEDED\'',[rule])).rows[0].n,1);assert.equal((await client.query('select count(*)::int n from public.automation_runs where rule_id=$1',[disabled])).rows[0].n,0);assert.equal((await client.query("select count(*)::int n from public.automation_events where trigger_key='LEAD_CLAIMED' and payload->>'leadId'=$1",[lead])).rows[0].n,1);await context(sales);
 await assert.rejects(assignment(lead,2),/lead_already_claimed/);
 await assert.rejects(assignment(lead,2,'RELEASE'),/lead_reason_required/);
 const released=await assignment(lead,2,'RELEASE',null,'Workload');assert.equal(released.owner_id,null);assert.equal(released.status,'NEW');
 await context();assert.equal((await client.query("select count(*)::int n from public.automation_runs r join public.automation_rules a on a.id=r.rule_id where a.trigger_key='LEAD_RELEASED' and r.status='SUCCEEDED' and a.action_type='NOTIFICATION'")).rows[0].n,1);
 await context();otherClient=new pg.Client({connectionString,statement_timeout:5000});await otherClient.connect();await context(admin,ws,client);await context(sales,ws,otherClient);
 const race=await Promise.allSettled([assignment(lead,3,'CLAIM',null,'',randomUUID(),client),assignment(lead,3,'CLAIM',null,'',randomUUID(),otherClient)]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.match(race.find(x=>x.status==='rejected').reason.message,/lead_already_claimed/);
 await context();const current=(await client.query('select revision,owner_id,status from public.leads where id=$1',[lead])).rows[0];
 if(current.owner_id!==sales)await assignment(lead,current.revision,'REASSIGN',sales,'Territory');
 await assert.rejects(save(lead,1,{next_action:'Stale'}),/lead_version_conflict|lead_forbidden/);
 await context(sales);const current2=(await client.query('select revision from public.leads where id=$1',[lead])).rows[0];await save(lead,current2.revision,{status:'QUALIFYING',next_action:'Identify key person'});
 await context(stranger,otherWs);assert.equal((await client.query('select count(*)::int n from public.lead_pool_records where id=$1',[lead])).rows[0].n,0);await assert.rejects(assignment(lead,1),/lead_forbidden/);
 await context();
 const profile={id:o,organization_type:'SCHOOL',roles:['SCHOOL_ENTRY'],partnership_stage:'PROSPECT',primary_contact_id:null,focus_regions:['US'],agreement_expires_on:null,next_action:'Call principal'};
 await client.query("select public.save_education_business('organizations',$1,null,$2)",[o,profile]);
 const stage=async(rev,next,reason='Explicit review',key=randomUUID())=>(await client.query('select public.update_channel_partnership_stage($1,$2,$3,$4,$5) item',[o,rev,next,reason,key])).rows[0].item;
 const stageKey=randomUUID();let updated=await stage(1,'SOLUTION_PROPOSED','Explicit review',stageKey);assert.equal(updated.revision,2);await stage(1,'SOLUTION_PROPOSED','Explicit review',stageKey);
 const count=async()=>(await client.query('select count(*)::int n from public.organization_channel_stage_history where organization_id=$1',[o])).rows[0].n;
 assert.equal(await count(),2);updated=await stage(2,'NEEDS_QUALIFIED');assert.equal(await count(),3);
 const ordinary={...updated,bd_plan_markdown:'Ordinary narrative'};for(const k of ['workspace_id','revision','updated_at','archived_at'])delete ordinary[k];await client.query("select public.save_education_business('organizations',$1,$2,$3)",[o,3,ordinary]);assert.equal(await count(),3);
 const proj=(await client.query('select public.channel_activation_projection($1) item',[o])).rows[0].item;assert.equal(proj.currentPartnershipStage,'NEEDS_QUALIFIED');assert.equal(proj.openLeadCount,2);assert.equal(proj.primaryEnrollmentCount,0);
 // Contextual quality rules appear and resolve; no automatic stage/qualification.
 const quality=async()=>{await client.query('select public.run_data_quality_rules()');return(await client.query("select rule_key,severity from public.data_quality_issues where status='OPEN' and rule_key in ('CLAIMED_LEAD_WITHOUT_NEXT_ACTION','QUALIFYING_SCHOOL_LEAD_WITHOUT_KEY_CONTACT','SOLUTION_PROPOSED_WITHOUT_OPPORTUNITY','RECRUITMENT_ACTIVATED_WITHOUT_KEY_CONTACT')")).rows;};
 assert.ok((await quality()).some(r=>r.rule_key==='QUALIFYING_SCHOOL_LEAD_WITHOUT_KEY_CONTACT'&&r.severity==='MEDIUM'));
 await stage(4,'RECRUITMENT_ACTIVATED');assert.ok((await quality()).some(r=>r.rule_key==='RECRUITMENT_ACTIVATED_WITHOUT_KEY_CONTACT'));
 await client.query('reset role');const product=(await client.query("insert into public.products(workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en) values($1,'POOL-GOLDEN','黄金产品','Golden product','PROJECT','一年','Year') returning id",[ws])).rows[0].id;
 const cohort=(await client.query("insert into public.product_cohorts(workspace_id,product_id,code,name_zh,name_en,status) values($1,$2,'POOL-2027','批次2027','Intake 2027','RECRUITING') returning id",[ws,product])).rows[0].id;
 const c=(await client.query("insert into public.contacts(workspace_id,organization_id,name_zh,name_en,owner_id,created_by,decision_role) values($1,$2,'关键人','Key person',$3,$3,'DECISION_MAKER') returning id",[ws,o,sales])).rows[0].id;
 const hidden=(await client.query("insert into public.contacts(workspace_id,organization_id,name_zh,name_en,owner_id,created_by,decision_role) values($1,$2,'不可见','Hidden person',$3,$4,'DECISION_MAKER') returning id",[ws,o,admin,admin])).rows[0].id;
 const person=(await client.query("insert into public.contacts(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'学生','Student',$2,$2) returning id",[ws,admin])).rows[0].id;
 const student=(await client.query('insert into public.students(workspace_id,person_id,owner_id,created_by) values($1,$2,$3,$3) returning id',[ws,person,admin])).rows[0].id;
 await context();for(const contactId of [c,hidden])await client.query('select public.save_organization_contact_intelligence($1,null,$2,$3)',[randomUUID(),{organization_id:o,contact_id:contactId,key_contact_status:'KEY',decision_power_score:10,contribution_score:10,working_style_markdown:'',cooperation_notes:'',potential_notes:''},randomUUID()]);
 assert.ok(!(await quality()).some(r=>r.rule_key==='QUALIFYING_SCHOOL_LEAD_WITHOUT_KEY_CONTACT'||r.rule_key==='RECRUITMENT_ACTIVATED_WITHOUT_KEY_CONTACT'));
 await context(sales);const visible=(await client.query('select public.channel_activation_projection($1) item',[o])).rows[0].item;assert.equal(visible.keyContactCount,1);assert.equal(visible.decisionMakerCount,1);const pooled=(await client.query('select key_contact_count from public.lead_pool_records where id=$1',[lead])).rows[0];assert.equal(Number(pooled.key_contact_count),1);
 await context();const leadBeforeConversion=(await client.query('select revision from public.leads where id=$1',[lead])).rows[0].revision;await save(lead,leadBeforeConversion,{status:'QUALIFIED',next_action:'Propose product'});
 const conversionKey=randomUUID();const convert=async()=> (await client.query('select to_jsonb(public.convert_lead_to_opportunity($1,$2,$3,100,\'CNY\',$4,$5,$6,$7)) item',[lead,'明确商机','Explicit opportunity',conversionKey,product,cohort,sales])).rows[0].item;
 const opportunity=await convert();assert.equal((await convert()).id,opportunity.id);assert.equal(opportunity.product_id,product);assert.equal(opportunity.cohort_id,cohort);assert.equal((await client.query('select count(*)::int n from public.organizations where id=$1',[o])).rows[0].n,1);
 const eventId=randomUUID();await client.query("select public.save_education_business('events',$1,null,$2)",[eventId,{organization_id:o,partner_organization_id:null,name:'Recruitment information session',kind:'SEMINAR',starts_on:'2026-10-04',ends_on:'2026-10-04',location:'Campus',capacity:null,attendee_count:null,status:'CONFIRMED',next_action:'',campaign_id:null,product_id:product,cohort_id:cohort}]);
 const eid=randomUUID();await client.query('select public.save_student_enrollment($1,null,$2,$3,\'\')',[eid,{student_id:student,cohort_id:cohort,household_id:null,opportunity_id:opportunity.id,status:'INTERESTED',owner_id:admin,sales_owner_id:null,enrolled_at:null,completed_at:null,withdrawn_at:null,withdrawal_reason:''},randomUUID()]);
 const source={enrollment_id:eid,attribution_type:'PRIMARY',source_organization_id:o,source_contact_id:null,source_event_id:eventId,source_campaign_id:null,source_referral_id:null,note:''};await client.query('select public.save_enrollment_attribution($1,$2,$3)',[randomUUID(),source,randomUUID()]);await assert.rejects(client.query('select public.save_enrollment_attribution($1,$2,$3)',[randomUUID(),source,randomUUID()]),/unique/);
 await client.query('select public.save_enrollment_attribution($1,$2,$3)',[randomUUID(),{...source,attribution_type:'ASSIST'},randomUUID()]);
 const golden=(await client.query('select public.channel_activation_projection($1) item',[o])).rows[0].item;assert.equal(golden.currentPartnershipStage,'RECRUITMENT_ACTIVATED');assert.equal(golden.activeOpportunityCount,1);assert.equal(golden.recentRecruitmentEventCount,1);assert.equal(golden.primaryEnrollmentCount,1);assert.equal(golden.assistEnrollmentCount,1);assert.equal(golden.keyContactCount,2);assert.ok(golden.lastEnrollmentAt);assert.ok(!('channelRevenue' in golden));
 // Customer Contact privacy cleanup retains staff Lead and Organization stage histories.
 const assignmentsBefore=(await client.query('select count(*)::int n from public.lead_assignment_history where lead_id=$1',[lead])).rows[0].n,stagesBefore=await count();await client.query('reset role');await client.query("update public.contacts set do_not_contact_reason='PRIVACY_DELETION:test' where id=$1",[c]);await context();assert.equal((await client.query('select count(*)::int n from public.lead_assignment_history where lead_id=$1',[lead])).rows[0].n,assignmentsBefore);assert.equal(await count(),stagesBefore);
 const rollbackLead=await save(randomUUID(),null,data);await assignment(rollbackLead.id,1);
 await client.query('reset role');await client.query("create function public.test_block_lead_audit() returns trigger language plpgsql as $$begin if new.action='LEAD_RELEASED' then raise exception 'test_audit_failed';end if;return new;end$$;create trigger test_block_lead_audit before insert on public.audit_events for each row execute function public.test_block_lead_audit()");
 await context();const revision=(await client.query('select revision from public.leads where id=$1',[rollbackLead.id])).rows[0].revision;await assert.rejects(assignment(rollbackLead.id,revision,'RELEASE',null,'Rollback'),/test_audit_failed/);assert.equal((await client.query('select revision from public.leads where id=$1',[rollbackLead.id])).rows[0].revision,revision);
 assert.equal((await client.query("select count(*)::int n from public.lead_assignment_history where lead_id=$1 and event_type='RELEASED'",[rollbackLead.id])).rows[0].n,0);
 assert.equal((await client.query("select count(*)::int n from public.automation_events where trigger_key='LEAD_RELEASED' and payload->>'leadId'=$1",[rollbackLead.id])).rows[0].n,0);
 await client.query('reset role');await client.query('drop trigger test_block_lead_audit on public.audit_events;drop function public.test_block_lead_audit()');
 // The special privacy/maintenance removal clears personal receipts, not shared domains.
 await client.query('delete from public.leads where id=$1',[rollbackLead.id]);
 assert.equal((await client.query("select count(*)::int n from public.mutation_receipts where operation in ('LEAD_SAVE','LEAD_ASSIGNMENT') and result->'item'->>'id'=$1",[rollbackLead.id])).rows[0].n,0);
 assert.equal((await client.query('select count(*)::int n from public.organizations where id=$1',[o])).rows[0].n,1);
 assert.equal((await client.query("select count(*)::int n from public.data_quality_rule_configs where workspace_id=$1 and rule_key='CLAIMED_LEAD_WITHOUT_NEXT_ACTION'",[otherWs])).rows[0].n,1);
 // Recoverable removal uses the same revision/receipt guarantees as ordinary mutations.
 await context();const deleteTarget=await save(randomUUID(),null,{...data,pool_visibility:'PRIVATE'}),deleteKey=randomUUID();
 const archive=async(rev,key=deleteKey)=>(await client.query('select to_jsonb(public.archive_lead($1,$2,$3)) item',[deleteTarget.id,rev,key])).rows[0].item;
 await assert.rejects(archive(deleteTarget.revision+1),/lead_version_conflict/);
 const beforeLeadCount=(await client.query('select public.dashboard_snapshot(null) item')).rows[0].item.newLeads;
 const deleted=await archive(deleteTarget.revision);assert.ok(deleted.archived_at);assert.equal((await client.query('select public.dashboard_snapshot(null) item')).rows[0].item.newLeads,beforeLeadCount-1);
 assert.equal((await archive(deleteTarget.revision)).revision,deleted.revision);
 assert.equal((await client.query('select count(*)::int n from public.lead_pool_records where id=$1',[deleteTarget.id])).rows[0].n,0);
 await assert.rejects(save(deleteTarget.id,deleted.revision,{next_action:'Cannot edit a deleted lead'}),/lead_forbidden/);
 await context(stranger,otherWs);await assert.rejects(archive(deleteTarget.revision),/lead_forbidden/);
 await context();await assert.rejects(client.query("select public.restore_crm_recycle_bin('LEAD',$1)",[deleteTarget.id]),/super_admin_required/);
 await client.query('reset role');await client.query("update public.workspace_memberships set role='SUPER_ADMIN' where workspace_id=$1 and user_id=$2",[ws,admin]);await context();
 await client.query("select public.restore_crm_recycle_bin('LEAD',$1)",[deleteTarget.id]);
 assert.equal((await client.query('select count(*)::int n from public.lead_pool_records where id=$1',[deleteTarget.id])).rows[0].n,1);
 // Directory filters operate before count/paging, with real canonical columns.
 await client.query('reset role');await client.query("update public.students set current_grade='G8',academic_year='2026-2027' where id=$1",[student]);await client.query("update public.organizations set city='Example City',curriculum='IB' where id=$1",[o]);await context();
 assert.equal((await client.query("select * from public.list_student_family_page('',1,10,'ACTIVE','G8','2026-2027')")).rows.length,1);
 assert.equal((await client.query("select * from public.list_student_family_page('',1,10,'ACTIVE','G9','2026-2027')")).rows.length,0);
 assert.equal((await client.query("select public.organization_commercial_metrics('','all',null,null,null,null,'Example City','IB','SCHOOL') item")).rows[0].item.total,1);
 assert.equal((await client.query("select public.organization_commercial_metrics('','all',null,null,null,null,'Unmatched City','IB','SCHOOL') item")).rows[0].item.total,0);
 // Every supported kind is actually readable through the same RLS-bound cleanup endpoint.
 const kinds=['ORGANIZATION','CONTACT','STUDENT','HOUSEHOLD','TASK','PRODUCT','LEAD','OPPORTUNITY','CONTRACT','ENROLLMENT','APPLICATION','SUPPORT_CASE','SUPPORT_GOAL','SUPPORT_CHECKIN','SUPPORT_RISK','SUPPORT_INTERVENTION','ORGANIZATION_PROFILE','FAMILY_NEED','PATHWAY','OUTREACH_EVENT','REFERRAL','EVENT_PARTICIPATION','ACADEMIC_RECORD','COHORT','BUNDLE','QUOTE','CAMPAIGN','ADMISSION_JOURNEY','MILESTONE','WORKFLOW_TEMPLATE','APPOINTMENT','EXCHANGE_RATE','ADMISSION_OUTCOME','CONTACT_INTELLIGENCE','CONTACT_RELATIONSHIP','FOLLOWUP_PLAN','FOLLOWUP_ENTRY','ACTIVITY','IMPORT_BATCH','IMPORT_MAPPING','IMPORT_SET','PRODUCT_PRICE','CHANNEL_AGREEMENT','CHANNEL_AGREEMENT_VERSION'];
 for(const kind of kinds){const listed=(await client.query('select public.list_deletable_business_records($1,$2,1,20) item',[kind,''])).rows[0].item;assert.ok(Array.isArray(listed.items),kind);assert.ok(Number.isInteger(listed.total),kind);}
 const cleanup=async(kind,id,rev,token,key)=>(await client.query('select public.archive_business_record($1,$2,$3,$4,$5) item',[kind,id,rev,token,key])).rows[0].item;
 // A stale editor cannot establish a new link to a removed cohort.
 await client.query('reset role');const emptyCohort=(await client.query("insert into public.product_cohorts(workspace_id,product_id,code,name_zh,name_en,status) values($1,$2,'EXAMPLE-EMPTY','示例空批次','Example empty cohort','RECRUITING') returning id",[ws,product])).rows[0].id;await context();
 const empty=(await client.query("select public.list_deletable_business_records('COHORT',$1,1,20) item",[emptyCohort])).rows[0].item.items[0];await cleanup('COHORT',emptyCohort,empty.revision,empty.updatedAt,randomUUID());
 await assert.rejects(client.query("select public.save_student_enrollment($1,null,$2,$3,'')",[randomUUID(),{student_id:student,cohort_id:emptyCohort,household_id:null,opportunity_id:null,status:'INTERESTED',owner_id:admin,sales_owner_id:null,enrolled_at:null,completed_at:null,withdrawn_at:null,withdrawal_reason:''},randomUUID()]),/linked_record_deleted|forbidden/);
 // Channel drafts can be removed, while their immutable earning records cannot.
 const agreementId=randomUUID(),versionId=randomUUID(),agreementData={organization_id:o,agreement_code:'EXAMPLE-DRAFT',name_zh:'示例渠道协议',name_en:'Example channel agreement',effective_from:'2027-01-01',effective_to:null,signed_on:null,reference_number:null,notes:'',rules:[]};
 await client.query('select public.save_channel_agreement($1,$2,null,$3,$4)',[agreementId,versionId,agreementData,randomUUID()]);
 const getDelete=async(kind,id)=>(await client.query('select public.list_deletable_business_records($1,$2,1,20) item',[kind,id])).rows[0].item.items[0];
 let agreementRecord=await getDelete('CHANNEL_AGREEMENT',agreementId);assert.equal(agreementRecord.blockedReason,'REFERENCED');
 const draft=await getDelete('CHANNEL_AGREEMENT_VERSION',versionId);assert.equal(draft.canDelete,true);assert.equal(draft.blockedReason,null);
 await cleanup('CHANNEL_AGREEMENT_VERSION',versionId,draft.revision,draft.updatedAt,randomUUID());
 assert.equal((await client.query('select public.get_channel_agreements($1) item',[o])).rows[0].item.items[0].versions.length,0);
 await assert.rejects(client.query('select public.save_channel_agreement($1,$2,$3,$4,$5)',[agreementId,versionId,draft.revision+1,agreementData,randomUUID()]),/not_found/);
 agreementRecord=await getDelete('CHANNEL_AGREEMENT',agreementId);await cleanup('CHANNEL_AGREEMENT',agreementId,agreementRecord.revision,agreementRecord.updatedAt,randomUUID());
 assert.equal((await client.query('select public.get_channel_agreements($1) item',[o])).rows[0].item.items.length,0);
 const recycled=(await client.query('select public.list_deleted_business_records() item')).rows[0].item;assert.ok(recycled.some(item=>item.kind==='CHANNEL_AGREEMENT_VERSION'&&item.id===versionId));assert.ok(recycled.some(item=>item.kind==='CHANNEL_AGREEMENT'&&item.id===agreementId));
 await assert.rejects(client.query('select public.save_channel_agreement($1,$2,null,$3,$4)',[agreementId,randomUUID(),agreementData,randomUUID()]),/not_found/);
 await client.query("select public.restore_crm_recycle_bin('CHANNEL_AGREEMENT',$1)",[agreementId]);await client.query("select public.restore_crm_recycle_bin('CHANNEL_AGREEMENT_VERSION',$1)",[versionId]);
 assert.equal((await client.query('select public.get_channel_agreements($1) item',[o])).rows[0].item.items[0].versions.length,1);
 // Price cleanup cannot select another tenant or silently reuse an archived current price.
 await client.query("select public.set_product_price($1,'CNY',250,current_date)",[product]);
 await client.query("select set_config('app.aal','aal1',false)");await assert.rejects(cleanup('PRODUCT',product,null,'2026-01-01T00:00:00Z',randomUUID()),/mfa_required|business_delete_forbidden/);await client.query("select set_config('app.aal','aal2',false)");
 const price=(await client.query("select public.list_deletable_business_records('PRODUCT_PRICE','',1,20) item")).rows[0].item.items[0];assert.ok(price);assert.equal(price.canDelete,true);
 await cleanup('PRODUCT_PRICE',price.id,price.revision,price.updatedAt,randomUUID());
 await client.query("select public.set_product_price($1,'CNY',300,current_date)",[product]);
 const catalog=(await client.query('select public.product_catalog_snapshot() item')).rows[0].item;const priced=catalog.find(p=>p.id===product);assert.ok(priced);assert.ok(priced.prices.every(p=>Number(p.amount)!==250));assert.ok(priced.prices.some(p=>Number(p.amount)===300));
 const event=(await client.query("select public.list_deletable_business_records('OUTREACH_EVENT',$1,1,20) item",[eventId])).rows[0].item.items[0],eventKey=randomUUID();assert.equal(event.canDelete,true);
 await assert.rejects(cleanup('OUTREACH_EVENT',eventId,event.revision+1,event.updatedAt,eventKey),/version_conflict/);
 await cleanup('OUTREACH_EVENT',eventId,event.revision,event.updatedAt,eventKey);await cleanup('OUTREACH_EVENT',eventId,event.revision,event.updatedAt,eventKey);
 assert.equal((await client.query('select count(*)::int n from public.education_outreach_events where id=$1',[eventId])).rows[0].n,0);
 await assert.rejects(client.query("select public.save_education_business('events',$1,$2,$3)",[eventId,event.revision+1,{organization_id:o,partner_organization_id:null,name:'Cannot modify a removed event',kind:'SEMINAR',starts_on:'2026-10-04',ends_on:'2026-10-04',location:'Campus',capacity:null,attendee_count:null,status:'CONFIRMED',next_action:'',campaign_id:null,product_id:product,cohort_id:cohort}]),/forbidden|deleted/);
 await context(stranger,otherWs);await assert.rejects(cleanup('OUTREACH_EVENT',eventId,event.revision,event.updatedAt,randomUUID()),/forbidden/);
 await context();await client.query("select public.restore_crm_recycle_bin('OUTREACH_EVENT',$1)",[eventId]);assert.equal((await client.query('select count(*)::int n from public.education_outreach_events where id=$1',[eventId])).rows[0].n,1);
 // Archiving an Enrollment with active related facts is blocked without removing those facts.
 const enrolled=(await client.query("select public.list_deletable_business_records('ENROLLMENT',$1,1,20) item",[eid])).rows[0].item.items[0];assert.ok(enrolled);
 await client.query('reset role');await client.query("update public.workspace_memberships set role='SALES_SUPPORT' where workspace_id=$1 and user_id=$2",[ws,sales]);await context(sales);
 assert.equal((await client.query("select public.business_record_delete_access('PRODUCT',to_jsonb(p)) permitted from public.products p where id=$1",[product])).rows[0].permitted,false);
 await client.query('reset role');await client.query("update public.workspace_memberships set role='SALES_SPECIALIST' where workspace_id=$1 and user_id=$2",[ws,sales]);await context();
 // PostgreSQL JSON keeps the exact token; the gateway's parser must preserve it too.
 await client.query('reset role');await client.query("update public.organizations set updated_at='2026-10-07T12:34:56.123456Z' where id=$1",[o]);await context();
 const token=(await client.query("select updated_at::text token from public.organizations where id=$1",[o])).rows[0].token;
 await assert.rejects(client.query("select public.save_crm_record('schools',$1,$2,'{\"archived\":true}')",[o,'2026-10-07T12:34:56.123Z']),/crm_version_conflict/);
 await client.query("select public.save_crm_record('schools',$1,$2,'{\"archived\":true}')",[o,token]);
 console.log('PASS Lead pool PostgreSQL: existing action/tenant/revision/audit contracts, recoverable archive/replay/restore, exact microsecond Organization deletion, 44 resource read contracts, generic archive/replay/restore and negative permissions.');
}finally{if(otherClient)await otherClient.end().catch(()=>{});if(client)await client.end().catch(()=>{});spawnSync('docker',['rm','--force',container],{encoding:'utf8',windowsHide:true,timeout:5000});}
