import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";
// Disposable local DB only; never loads .env.local or existing application credentials.
const container=`lumina-crm-operational-it-${randomBytes(5).toString("hex")}`,deadline=Date.now()+50_000,password=randomBytes(32).toString("hex");
const image=process.env.OPERATIONAL_TEST_POSTGRES_IMAGE||"postgres:18.6-trixie";
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
let client,otherClient;
function run(command,args,env=process.env){const result=spawnSync(command,args,{env,encoding:"utf8",timeout:Math.max(1,Math.min(15_000,deadline-Date.now())),windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed: ${result.stderr.trim()}`);return result.stdout.trim();}
try{
  run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=commercial-links","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=lumina_enrollments_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],{...process.env,POSTGRES_PASSWORD:password});
  const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);assert.match(port,/^\d+$/);
  const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/lumina_enrollments_test`;
  for(let attempt=0;attempt<20;attempt++){client=new pg.Client({connectionString,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch(error){await client.end().catch(()=>{});client=undefined;if(attempt===19)throw error;await new Promise(resolve=>setTimeout(resolve,200));}}
  const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false",DATABASE_ADMIN_URL:connectionString,MIGRATION_DATABASE_URL:connectionString};
  for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
  run(process.execPath,["scripts/db-bootstrap.mjs"],env);run(process.execPath,["scripts/db-migrate.mjs"],env);
  const ws="00000000-0000-4000-8000-000000000001",otherWs=randomUUID(),admin=randomUUID(),sales=randomUUID(),stranger=randomUUID();
  await client.query("insert into app_auth.accounts(id,email,username) values($1,'enrollment-admin@example.test','enrollment-admin'),($2,'enrollment-sales@example.test','enrollment-sales'),($3,'enrollment-stranger@example.test','enrollment-stranger')",[admin,sales,stranger]);
  await client.query("insert into public.workspaces(id,slug,name) values($1,'enrollment-other','Other')",[otherWs]);
  await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'ADMIN'),($1,$3,'SALES_SPECIALIST'),($4,$5,'ADMIN')",[ws,admin,sales,otherWs,stranger]);
  const context=async(user=admin,workspace=ws,connection=client)=>{await connection.query("reset role");await connection.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[user,workspace]);await connection.query("set role crm_app");};
  const contact=async(workspace,owner,name)=>(await client.query("insert into public.contacts(workspace_id,name_zh,name_en,owner_id,created_by,email) values($1,$3,$3,$2,$2,$4) returning id",[workspace,owner,name,`${name}@example.test`])).rows[0].id;
  const person=await contact(ws,admin,"student-a"),person2=await contact(ws,admin,"student-b"),foreignPerson=await contact(otherWs,stranger,"foreign-student");
  const household=(await client.query("insert into public.households(workspace_id,name_zh,name_en,created_by) values($1,'家庭','Family',$2) returning id",[ws,admin])).rows[0].id;
  const student=(await client.query("insert into public.students(workspace_id,person_id,household_id,owner_id,created_by) values($1,$2,$3,$4,$4) returning id",[ws,person,household,admin])).rows[0].id;
  const student2=(await client.query("insert into public.students(workspace_id,person_id,owner_id,created_by) values($1,$2,$3,$3) returning id",[ws,person2,admin])).rows[0].id;
  await client.query("insert into public.students(workspace_id,person_id,owner_id,created_by,student_number) values($1,$2,$3,$3,'FOREIGN-NUMBER')",[otherWs,foreignPerson,stranger]);
  const product=async(workspace,code)=>(await client.query("insert into public.products(workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en) values($1,$2::text,$2::text,$2::text,'PROJECT','一年','Year') returning id",[workspace,code])).rows[0].id;
  const p=await product(ws,"ENROLLMENT-PRODUCT"),foreignProduct=await product(otherWs,"FOREIGN-PRODUCT");
  const cohort=async(workspace,prod,code,status="RECRUITING")=>(await client.query("insert into public.product_cohorts(workspace_id,product_id,code,name_zh,name_en,status,capacity,target_enrollment) values($1,$2,$3::text,$3::text,$3::text,$4,0,0) returning id",[workspace,prod,code,status])).rows[0].id;
  const co=await cohort(ws,p,"FALL-2027"),co2=await cohort(ws,p,"FALL-2028");await cohort(otherWs,foreignProduct,"FOREIGN-COHORT");
  const org=async(workspace,owner,name)=>(await client.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,$3,$3,$2,$2) returning id",[workspace,owner,name])).rows[0].id;
  const school=await org(ws,admin,"school");
  await context();
  const rule=async(trigger,action='TASK',conditions={},active=true)=>(await client.query("insert into public.automation_rules(workspace_id,name_zh,name_en,trigger_key,conditions,action_type,action_config,created_by,active) values($1,'提醒规则','Reminder rule',$2,$3,$4,$5,$6,$7) returning id",[ws,trigger,conditions,action,{titleZh:'报名跟进',titleEn:'Enrollment follow-up',priority:'NORMAL',dueHours:24},admin,active])).rows[0].id;
  const createdRule=await rule('ENROLLMENT_CREATED'),statusRule=await rule('ENROLLMENT_STATUS_CHANGED','NOTIFICATION'),disabled=await rule('ENROLLMENT_CREATED','TASK',{},false);
  const data={student_id:student,cohort_id:co,household_id:household,opportunity_id:null,status:'INTERESTED',owner_id:admin,sales_owner_id:null,enrolled_at:null,completed_at:null,withdrawn_at:null,withdrawal_reason:''};
  const save=async(input=data,id=randomUUID(),rev=null,key=randomUUID())=>(await client.query('select * from public.save_student_enrollment($1,$2,$3,$4)',[id,rev,input,key])).rows[0];
  const en=await save(),en2=await save({...data,student_id:student2});
  const scalar=async(sql,args=[])=>(await client.query(sql,args)).rows[0];
  assert.equal((await scalar('select count(*)::int n from public.automation_runs where rule_id=$1',[createdRule])).n,2);
  assert.equal((await scalar('select count(*)::int n from public.automation_runs where rule_id=$1',[disabled])).n,0);
  const before=(await scalar('select count(*)::int n from public.automation_events')).n;
  const ordinary=await save({...data,withdrawal_reason:'No status change'},en.id,1);
  assert.equal((await scalar('select count(*)::int n from public.automation_events')).n,before);
  const changeKey=randomUUID(),activeData={...data,status:'ACTIVE',enrolled_at:'2026-10-01T00:00:00Z'};
  const active=await save(activeData,en.id,ordinary.revision,changeKey);await save(activeData,en.id,ordinary.revision,changeKey);
  assert.equal((await scalar('select count(*)::int n from public.automation_runs where rule_id=$1',[statusRule])).n,1);
  assert.equal((await scalar('select count(*)::int n from public.student_enrollment_status_history where enrollment_id=$1',[en.id])).n,2);
  const contract=async(currency='CNY',buyer=household)=>(await client.query("select * from public.create_buyer_contract($1,$2,$3,$4,'2026-01-01','2028-01-01',$5,100000)",['OP-'+randomUUID(),buyer===school?school:null,buyer===school?null:buyer,p,currency])).rows[0];
  const link=async(contractId,enrollmentId)=>(await client.query('select * from public.link_contract_enrollment($1,$2,$3,$4)',[randomUUID(),contractId,enrollmentId,randomUUID()])).rows[0];
  const finance=async(id)=>(await client.query('select * from public.enrollment_contract_finance where enrollment_id=$1 order by contract_id',[id])).rows;
  assert.equal((await finance(en.id)).length,0);
  const c=await contract(),first=await link(c.id,en.id);assert.equal((await finance(en.id))[0].active_enrollment_link_count,'1');
  const schedules=(await client.query('select * from public.save_receivable_schedule($1,$2)',[c.id,JSON.stringify([{dueDate:'2026-01-01',amount:100000}])])).rows;
  const paid=(await client.query("select * from public.record_payment($1,$2,80000,'CNY','REAL-RECEIPT',now())",[c.id,schedules[0].id])).rows[0];
  let projection=(await finance(en.id))[0];assert.equal(Number(projection.contracted),100000);assert.equal(Number(projection.receivable),100000);assert.equal(Number(projection.collected),80000);assert.equal(Number(projection.outstanding),20000);assert.equal(Number(projection.overdue),20000);
  const refund=(await client.query("select * from public.request_refund($1,10000,'Approved business refund')",[paid.id])).rows[0];
  assert.equal(Number((await finance(en.id))[0].refunded),0); // Pending approval is not refunded money.
  await client.query('reset role');await client.query("update public.refunds set status='APPROVED' where id=$1",[refund.id]);await context();
  await client.query("select * from public.complete_refund($1,'REFUND-RECEIPT')",[refund.id]);
  projection=(await finance(en.id))[0];assert.equal(Number(projection.refunded),10000);assert.equal(Number(projection.collected),70000);assert.equal(Number(projection.outstanding),30000);
  await link(c.id,en2.id);assert.equal((await finance(en.id))[0].active_enrollment_link_count,'2');assert.equal((await finance(en2.id))[0].active_enrollment_link_count,'2');
  const filter=[{studentId:student,cohortId:co,enrollmentId:en.id}];
  assert.equal((await scalar('select count(*)::int n from public.finance_filtered_contracts where enrollment_contexts @> $1::jsonb',[JSON.stringify(filter)])).n,1);
  assert.equal((await scalar('select count(*)::int n from public.finance_filtered_payments where enrollment_contexts @> $1::jsonb',[JSON.stringify(filter)])).n,1);
  assert.equal((await scalar('select count(*)::int n from public.finance_filtered_refunds where enrollment_contexts @> $1::jsonb',[JSON.stringify(filter)])).n,1);
  const usd=await contract('USD',school);await link(usd.id,en.id);assert.deepEqual(new Set((await finance(en.id)).map(row=>row.currency)),new Set(['USD','CNY']));
  await client.query('select * from public.unlink_contract_enrollment($1,1,$2,$3)',[first.id,'Corrected coverage',randomUUID()]);
  assert.equal((await finance(en.id)).length,1);assert.equal((await finance(en2.id))[0].active_enrollment_link_count,'1');
  // Invisible other enrollments must never turn a shared contract into exclusive.
  await link(c.id,en.id);await client.query('reset role');await client.query('update public.contacts set owner_id=$1 where id=$2',[sales,person]);await client.query('update public.students set owner_id=$1 where id=$2',[sales,student]);await client.query('update public.student_enrollments set owner_id=$1 where id=$2',[sales,en.id]);await client.query('update public.contracts set owner_id=$1 where id=$2',[sales,c.id]);await context(sales);
  assert.equal((await finance(en.id)).find(row=>row.contract_id===c.id).active_enrollment_link_count,'2');
  const vis=await scalar('select public.enrollment_finance_visibility($1) v',[en.id]);assert.equal(vis.v.available,false);assert.equal(vis.v.partial,true);
  await context(stranger,otherWs);assert.equal((await finance(en.id)).length,0);await assert.rejects(client.query('select public.enrollment_finance_visibility($1)',[en.id]),/enrollment_not_found/);await context();
  // Import preview validates through domain RPCs, leaving no business artifacts.
  await client.query('reset role');await client.query("update public.students set student_number='STABLE-A' where id=$1",[student]);await context();
  const createBatch=async(resource,rows,key=randomUUID())=>(await client.query('select * from public.create_import_batch($1,$2,$3,$4,$5,$6)',[resource,'operational.csv','a'.repeat(64),key,{},JSON.stringify(rows)])).rows[0];
  const cohortRow={productCode:'ENROLLMENT-PRODUCT',cohortCode:'IMPORT-2029',nameZh:'导入批次',nameEn:'Imported cohort',intakeType:'FALL',academicYear:'2029-2030',applicationOpenOn:'2029-01-01',applicationDeadline:'2029-08-01',startOn:'2029-09-01',endOn:'2030-06-01',targetEnrollment:'20',capacity:'30',currency:'CNY',ownerEmail:'enrollment-admin@example.test',status:'RECRUITING'};
  const countBefore=(await scalar('select count(*)::int n from public.product_cohorts')).n;
  const cb=await createBatch('COHORTS',[cohortRow]);assert.equal(cb.valid_rows,1);assert.equal((await scalar('select count(*)::int n from public.product_cohorts')).n,countBefore);
  assert.equal((await scalar('select public.import_dry_run($1) d',[cb.id])).d.canExecute,true);
  const executed=(await client.query('select * from public.process_import_batch($1,100)',[cb.id])).rows[0];assert.equal(executed.applied_rows,1);assert.equal((await client.query('select * from public.process_import_batch($1,100)',[cb.id])).rows[0].applied_rows,1);
  for(const invalid of [{productCode:'UNKNOWN'},{cohortCode:'FALL-2027'},{cohortCode:'BAD-DATE',applicationDeadline:'2031-01-01'},{cohortCode:'BAD-CAP',capacity:'-1'},{cohortCode:'BAD-OWNER',ownerEmail:'enrollment-stranger@example.test'},{productCode:'FOREIGN-PRODUCT',cohortCode:'BAD-WS'}]){const b=await createBatch('COHORTS',[{...cohortRow,...invalid}]);assert.equal(b.invalid_rows,1);}
  const importRow={studentNumber:'STABLE-A',cohortCode:'IMPORT-2029',status:'INTERESTED',ownerEmail:'enrollment-admin@example.test',salesOwnerEmail:'',householdReference:household,opportunityReference:''};
  const eventsBefore=(await scalar('select count(*)::int n from public.automation_events')).n;
  const ib=await createBatch('ENROLLMENTS',[importRow]);assert.equal(ib.valid_rows,1);assert.equal((await scalar('select count(*)::int n from public.automation_events')).n,eventsBefore);
  const applied=(await client.query('select * from public.process_import_batch($1,100)',[ib.id])).rows[0];assert.equal(applied.applied_rows,1);assert.equal((await scalar('select count(*)::int n from public.automation_events')).n,eventsBefore+1);
  for(const invalid of [{studentNumber:'UNKNOWN'},{cohortCode:'FALL-2027'},{cohortCode:'INVALID'},{status:'VISA_APPROVED',cohortCode:'FALL-2028'},{cohortCode:'FOREIGN-COHORT'},{ownerEmail:'enrollment-stranger@example.test',cohortCode:'FALL-2028'},{studentNumber:'',nameZh:'student-a'}]){const b=await createBatch('ENROLLMENTS',[{...importRow,...invalid}]);assert.equal(b.invalid_rows,1);}
  const duplicateBatch=await createBatch('ENROLLMENTS',[{...importRow,cohortCode:'FALL-2028'},{...importRow,cohortCode:'FALL-2028'}]);assert.equal(duplicateBatch.invalid_rows,1);
  await client.query('reset role');await assert.rejects(client.query("update public.students set student_number='STABLE-A' where id=$1",[student2]),/students_workspace_id_student_number_key/);await context();
  const badBatch=await createBatch('ENROLLMENTS',[{...importRow,studentNumber:'UNKNOWN',cohortCode:'FALL-2028'}]);const badRow=(await scalar('select id from public.import_rows where batch_id=$1',[badBatch.id])).id;
  assert.equal((await client.query('select * from public.repair_import_row($1,$2)',[badRow,{studentNumber:'STABLE-A'}])).rows[0].status,'VALID');
  await client.query('select * from public.process_import_batch($1,100)',[badBatch.id]);await client.query('select * from public.rollback_import_batch($1)',[badBatch.id]);
  assert.equal((await scalar("select e.status from public.student_enrollments e join public.import_rows r on r.applied_entity_id=e.id where r.batch_id=$1",[badBatch.id])).status,'CANCELLED');
  await assert.rejects(client.query('select * from public.rollback_import_batch($1)',[cb.id]),/import_rollback_has_dependencies/);
  // Quality warnings are contextual and auto-resolve after the facts are fixed.
  await client.query('select public.run_data_quality_rules()');
  assert.equal((await scalar("select count(*)::int n from public.data_quality_issues where entity_id=$1 and rule_key='ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION' and status='OPEN'",[en.id])).n,1);
  assert.equal((await scalar("select count(*)::int n from public.data_quality_issues where entity_id=$1 and rule_key='ENROLLMENT_ACTIVE_WITHOUT_CONTRACT' and status='OPEN'",[en2.id])).n,0);
  const lead=await save({...data,student_id:student2,cohort_id:co2,status:'LEAD'});await client.query('select public.run_data_quality_rules()');
  assert.equal((await scalar("select count(*)::int n from public.data_quality_issues where entity_id=$1 and rule_key like 'ENROLLMENT_%' and status='OPEN'",[lead.id])).n,0);
  const attr={enrollment_id:en.id,attribution_type:'PRIMARY',source_organization_id:school,source_contact_id:null,source_event_id:null,source_campaign_id:null,source_referral_id:null,note:''};
  await client.query('select * from public.save_enrollment_attribution($1,$2,$3)',[randomUUID(),attr,randomUUID()]);await client.query('select public.run_data_quality_rules()');
  assert.equal((await scalar("select status from public.data_quality_issues where entity_id=$1 and rule_key='ENROLLMENT_WITHOUT_PRIMARY_ATTRIBUTION'",[en.id])).status,'RESOLVED');
  const snapshot=await scalar('select * from public.cohort_enrollment_snapshots where cohort_id=$1',[co]);assert.equal(snapshot.active,'1');assert.equal(snapshot.total_records,'2');assert.equal(snapshot.current_open,'2');
  const channel=await scalar('select * from public.channel_enrollment_snapshots where cohort_id=$1',[co]);assert.equal(channel.primary_enrollment_count,'1');assert.equal(channel.active_enrollment_count,'1');
  await context(stranger,otherWs);assert.equal((await scalar('select count(*)::int n from public.cohort_enrollment_snapshots where cohort_id=$1',[co])).n,0);assert.equal((await scalar('select count(*)::int n from public.channel_enrollment_snapshots where cohort_id=$1',[co])).n,0);await context();
  const deadlineRule=await rule('COHORT_APPLICATION_DEADLINE_APPROACHING','TASK',{daysUntilDeadline:7});
  await client.query('reset role');await client.query("update public.product_cohorts set application_deadline=((now() at time zone 'Asia/Shanghai')::date+7),owner_id=$1 where id=$2",[admin,co]);await client.query('set role crm_worker');assert.equal((await scalar('select public.process_cohort_deadline_events(100) n')).n,1);assert.equal((await scalar('select public.process_cohort_deadline_events(100) n')).n,0);await context();
  assert.equal((await scalar('select count(*)::int n from public.automation_runs where rule_id=$1',[deadlineRule])).n,1);
  // A failed action leaves a retryable run, and retrying twice cannot make two tasks.
  const failRule=await rule('ENROLLMENT_CREATED');await client.query('reset role');await client.query("update public.automation_rules set action_config=jsonb_build_object('titleZh','','titleEn','') where id=$1",[failRule]);await context();
  // Deliberately fail task insertion with a temporary trigger to exercise existing retry.
  await client.query('reset role');await client.query("create function public.operational_test_fail_task() returns trigger language plpgsql as $$ begin raise exception 'test task failure'; end $$; create trigger operational_test_fail_task before insert on public.crm_tasks for each row execute function public.operational_test_fail_task();");await context();
  await client.query('reset role');const retryCohort=await cohort(ws,p,'RETRY-COHORT');await context();const last=await save({...data,student_id:student2,cohort_id:retryCohort,status:'LEAD'});
  const failedRun=await scalar("select id from public.automation_runs where rule_id=$1 and status='FAILED' order by created_at desc limit 1",[failRule]);assert(failedRun.id);
  await client.query('reset role');await client.query('drop trigger operational_test_fail_task on public.crm_tasks');await client.query("update public.automation_rules set action_config=action_config||jsonb_build_object('priority','NORMAL') where id=$1",[failRule]);await context();
  await client.query('select public.retry_automation_run($1)',[failedRun.id]);await assert.rejects(client.query('select public.retry_automation_run($1)',[failedRun.id]),/automation_retry_invalid|automation_run_not_retryable/);
  assert(last.id&&active.id);
  const tasksBefore=(await scalar('select count(*)::int n from public.crm_tasks')).n;
  await assert.rejects(client.query('select public.retry_automation_run($1)',[failedRun.id]),/automation_run_not_retryable/);
  assert.equal((await scalar('select count(*)::int n from public.crm_tasks')).n,tasksBefore);
  // Domain/history/event failure rolls back the whole status mutation.
  await client.query('reset role');await client.query("create function public.operational_test_fail_history() returns trigger language plpgsql as $$ begin raise exception 'test history failure'; end $$; create trigger operational_test_fail_history before insert on public.student_enrollment_status_history for each row execute function public.operational_test_fail_history();");await context();
  const eventCount=(await scalar('select count(*)::int n from public.automation_events')).n;
  const current=(await scalar('select * from public.student_enrollments where id=$1',[en.id]));
  await assert.rejects(save({...activeData,owner_id:sales,status:'COMPLETED',completed_at:'2026-10-02T00:00:00Z'},en.id,current.revision),/test history failure/);
  assert.equal((await scalar('select status from public.student_enrollments where id=$1',[en.id])).status,current.status);
  assert.equal((await scalar('select count(*)::int n from public.automation_events')).n,eventCount);
  await client.query('reset role');await client.query('drop trigger operational_test_fail_history on public.student_enrollment_status_history');await context();
  const contractsBefore=(await scalar('select count(*)::int n from public.contracts')).n;
  await client.query('reset role');await client.query("update public.contacts set do_not_contact_reason='PRIVACY_DELETION:operational-test' where id=$1",[person]);await context();
  assert.equal((await scalar('select count(*)::int n from public.contracts')).n,contractsBefore);
  assert.equal((await scalar('select count(*)::int n from public.student_enrollments where student_id=$1',[student])).n,0);
  assert.equal((await scalar("select count(*)::int n from public.import_rows where batch_id=$1 and raw_data<>'{}'::jsonb",[ib.id])).n,0);
  console.log(`PASS ${image}: live receipts/refunds/installments, exact active link allocation counts, currency isolation, finance visibility and deduplicated filters; deterministic imports/preview/repair/rollback; contextual quality and scoped snapshots; history-based automation, configured deadline dispatch and retry idempotency`);

}finally{
  await otherClient?.end().catch(()=>{});await client?.end().catch(()=>{});assert.match(container,/^lumina-crm-operational-it-[a-f0-9]{10}$/);
  const cleanup=spawnSync("docker",["rm","--force",container],{encoding:"utf8",timeout:10000,windowsHide:true});if(cleanup.status!==0&&!cleanup.stderr?.includes("No such container"))throw new Error(`Could not remove isolated test container ${container}: ${cleanup.stderr}`);
}
