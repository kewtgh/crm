import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";

// Disposable local DB only; never loads .env.local or existing application credentials.
const container=`lumina-crm-workflows-it-${randomBytes(5).toString("hex")}`,deadline=Date.now()+50_000,password=randomBytes(32).toString("hex");
const image=process.env.WORKFLOW_TEST_POSTGRES_IMAGE||"postgres:18.6-trixie";
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
let client,otherClient;
function run(command,args,env=process.env){const result=spawnSync(command,args,{env,encoding:"utf8",timeout:Math.max(1,Math.min(15_000,deadline-Date.now())),windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed: ${result.stderr.trim()}`);return result.stdout.trim();}
try{
  run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=workflows","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=lumina_workflows_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],{...process.env,POSTGRES_PASSWORD:password});
  const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);assert.match(port,/^\d+$/);
  const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/lumina_workflows_test`;
  for(let attempt=0;attempt<20;attempt++){client=new pg.Client({connectionString,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch(error){await client.end().catch(()=>{});client=undefined;if(attempt===19)throw error;await new Promise(resolve=>setTimeout(resolve,200));}}
  const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false",DATABASE_ADMIN_URL:connectionString,MIGRATION_DATABASE_URL:connectionString};
  for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
  run(process.execPath,["scripts/db-bootstrap.mjs"],env);run(process.execPath,["scripts/db-migrate.mjs"],env);
  const ws="00000000-0000-4000-8000-000000000001",otherWs=randomUUID(),admin=randomUUID(),sales=randomUUID(),stranger=randomUUID();
  await client.query("insert into app_auth.accounts(id,email,username) values($1,'enrollment-admin@example.test','enrollment-admin'),($2,'enrollment-sales@example.test','enrollment-sales'),($3,'enrollment-stranger@example.test','enrollment-stranger')",[admin,sales,stranger]);
  await client.query("insert into public.workspaces(id,slug,name) values($1,'enrollment-other','Other')",[otherWs]);
  await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'ADMIN'),($1,$3,'SALES_SPECIALIST'),($4,$5,'ADMIN')",[ws,admin,sales,otherWs,stranger]);
  const context=async(user=admin,workspace=ws,connection=client)=>{await connection.query("reset role");await connection.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[user,workspace]);await connection.query("set role crm_app");};
  const person=async(workspace,owner,name)=>(await client.query("insert into public.contacts(workspace_id,name_zh,name_en,owner_id,created_by) values($1,$3,$3,$2,$2) returning id",[workspace,owner,name])).rows[0].id;
  const contact=await person(ws,admin,"Applicant"),contact2=await person(ws,admin,"Other applicant"),foreignContact=await person(otherWs,stranger,"Foreign applicant");
  const student=async(workspace,owner,personId)=>(await client.query("insert into public.students(workspace_id,person_id,owner_id,created_by) values($1,$3,$2,$2) returning id",[workspace,owner,personId])).rows[0].id;
  const st=await student(ws,admin,contact),st2=await student(ws,admin,contact2),foreignStudent=await student(otherWs,stranger,foreignContact);
  const product=async(workspace,code)=>(await client.query("insert into public.products(workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en) values($1,$2::text,$2::text,$2::text,'PROJECT','一年','Year') returning id",[workspace,code])).rows[0].id;
  const p=await product(ws,"APPLICATION"),foreignP=await product(otherWs,"FOREIGN");
  const cohort=async(workspace,productId,code)=>(await client.query("insert into public.product_cohorts(workspace_id,product_id,code,name_zh,name_en,status) values($1,$2,$3::text,$3::text,$3::text,'RECRUITING') returning id",[workspace,productId,code])).rows[0].id;
  const co=await cohort(ws,p,"FALL"),foreignCo=await cohort(otherWs,foreignP,"FALL");
  const enrollment=async(workspace,studentId,cohortId,owner)=>(await client.query("insert into public.student_enrollments(workspace_id,student_id,cohort_id,owner_id) values($1,$2,$3,$4) returning id",[workspace,studentId,cohortId,owner])).rows[0].id;
  const en=await enrollment(ws,st,co,admin),foreignEn=await enrollment(otherWs,foreignStudent,foreignCo,stranger),en2=await enrollment(ws,st2,co,admin);
  const organization=async(workspace,owner,name)=>(await client.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,$3,$3,$2,$2) returning id",[workspace,owner,name])).rows[0].id;
  const target=await organization(ws,admin,"University");
  const journey=(await client.query("insert into public.admission_journeys(workspace_id,student_id,owner_id,created_by,stage) values($1,$2,$3,$3,'INQUIRY') returning *",[ws,st,admin])).rows[0];
  await context();
  const application=async(enrollment=en,status='DRAFT',owner=admin,targetId=target)=>(await client.query("select * from public.save_student_application($1,null,$2,$3,'')",[randomUUID(),{enrollment_id:enrollment,target_organization_id:targetId,external_application_id:null,deadline_on:null,status,decision:null,submitted_at:status==='SUBMITTED'?'2027-01-01T00:00:00Z':null,decision_at:null,withdrawn_at:null,owner_id:owner},randomUUID()])).rows[0];

  // Two formal Applications share the Enrollment; context is always explicit.
  const app=await application(en),app2=await application(en);
  assert.notEqual(app.id,app2.id);
  const step=(kind,sequence)=>({id:randomUUID(),sequence,name_zh:kind,name_en:kind,step_kind:kind,required:true,default_owner_role:null,offset_basis:null,offset_days:null,task_config:null,milestone_config:null,checkpoint_config:null});
  const templateId=randomUUID();
  const data={name_zh:'发布测试',name_en:'Release golden path',product_id:p,workflow_type:'ADMISSIONS',description:'QA fixture only',steps:[
    {...step('TASK',10),task_config:{title_zh:'准备材料',title_en:'Prepare materials',description:'',priority:'NORMAL'}},
    {...step('CHECKPOINT',20),checkpoint_config:{checkpoint_type:'APPLICATION_SUBMITTED',application_scope:'APPLICATION'}},
    {...step('MILESTONE',30),milestone_config:{milestone_type:'INTERVIEW',default_status:'PENDING',application_scope:'APPLICATION'}},
    {...step('CHECKPOINT',40),checkpoint_config:{checkpoint_type:'APPLICATION_DECIDED',application_scope:'APPLICATION'}},
  ]};
  await client.query('select public.save_workflow_template($1,null,$2,$3)',[templateId,data,randomUUID()]);
  await client.query("select public.change_workflow_template($1,1,'ACTIVATE',null,$2)",[templateId,randomUUID()]);
  const start=async(id,applicationId,key,enrollmentId=en)=>(await client.query('select * from public.instantiate_workflow($1,$2,1,$3,$4,$5,$6)',[id,templateId,enrollmentId,applicationId,admin,key])).rows[0];
  const projection=async(id)=>(await client.query('select public.workflow_projection($1) p',[id])).rows[0].p;
  const tables=['workflow_instances','workflow_step_instances','crm_tasks','admission_milestones','admission_milestone_status_history','student_application_status_history','audit_events','automation_events','automation_runs','mutation_receipts'];
  const counts=async()=>{await client.query('reset role');const result={};for(const table of tables)result[table]=(await client.query(`select count(*)::int n from public.${table}`)).rows[0].n;await context();return result;};
  // Creating Applications never implicitly starts a workflow or duplicates identity.
  assert.equal((await counts()).workflow_instances,0);
  const identityColumns=(await client.query("select column_name from information_schema.columns where table_schema='public' and table_name='student_applications' and column_name in ('student_id','product_id','cohort_id')")).rows;
  assert.equal(identityColumns.length,0);
  // Missing application context rolls back every generated fact and governance record.
  const beforeMissing=await counts();
  await assert.rejects(start(randomUUID(),null,randomUUID()),/workflow_context_required/);
  await assert.rejects(start(randomUUID(),app.id,randomUUID(),en2),/workflow_application_mismatch|workflow_forbidden/);
  await assert.rejects(start(randomUUID(),app.id,randomUUID(),foreignEn),/workflow_forbidden/);
  assert.deepEqual(await counts(),beforeMissing);
  // A failure late in the transaction also rolls back tasks, history, events and receipts.
  await client.query('reset role');
  await client.query("create function public.release_fail_audit() returns trigger language plpgsql as $$ begin if new.action='WORKFLOW_INSTANCE_STARTED' then raise exception 'release_audit_failure'; end if; return new; end $$; create trigger release_fail_audit before insert on public.audit_events for each row execute function public.release_fail_audit()");
  await context();const beforeFailure=await counts();
  await assert.rejects(start(randomUUID(),app.id,randomUUID()),/release_audit_failure/);
  assert.deepEqual(await counts(),beforeFailure);
  await client.query('reset role');await client.query('drop trigger release_fail_audit on public.audit_events');await context();
  const wfId=randomUUID(),requestKey=randomUUID(),wf=await start(wfId,app.id,requestKey);
  const startedCounts=await counts();assert.equal((await start(wfId,app.id,requestKey)).id,wf.id);assert.deepEqual(await counts(),startedCounts);
  const links=(await client.query('select * from public.workflow_step_instances where workflow_instance_id=$1 order by created_at',[wf.id])).rows;
  assert.equal(links.length,4);assert.ok(links[0].task_id);assert.ok(links[2].milestone_id);
  for(const index of [1,3]){assert.equal(links[index].task_id,null);assert.equal(links[index].milestone_id,null);}
  const statuses=async()=>(await projection(wf.id)).steps.map(s=>s.status);
  assert.deepEqual(await statuses(),['READY','PENDING','PENDING','PENDING']);
  await client.query('select public.bulk_complete_crm_tasks($1,$2)',[[links[0].task_id],'Materials ready']);
  assert.deepEqual(await statuses(),['COMPLETED','READY','PENDING','PENDING']);
  const applicationData={enrollment_id:en,target_organization_id:target,external_application_id:null,deadline_on:null,status:'SUBMITTED',decision:null,submitted_at:'2027-01-01T00:00:00Z',decision_at:null,withdrawn_at:null,owner_id:admin};
  await client.query('select public.save_student_application($1,1,$2,$3,$4)',[app.id,applicationData,randomUUID(),'Submitted']);
  assert.deepEqual(await statuses(),['COMPLETED','COMPLETED','READY','PENDING']);
  const milestone=(await client.query('select * from public.admission_milestones where id=$1',[links[2].milestone_id])).rows[0];
  assert.equal(milestone.application_id,app.id);
  const milestoneData=Object.fromEntries(['enrollment_id','application_id','milestone_type','status','due_at','scheduled_at','completed_at','outcome','owner_id','external_reference','note','metadata','sequence'].map(k=>[k,milestone[k]]));
  await client.query('select public.save_admission_milestone($1,1,$2,$3,$4)',[milestone.id,{...milestoneData,status:'COMPLETED',completed_at:'2027-01-02T00:00:00Z'},randomUUID(),'Interview complete']);
  assert.deepEqual(await statuses(),['COMPLETED','COMPLETED','COMPLETED','READY']);
  assert.equal((await projection(wf.id)).status,'ACTIVE');
  await client.query('select public.save_student_application($1,2,$2,$3,$4)',[app.id,{...applicationData,status:'DECIDED',decision:'ADMITTED',decision_at:'2027-01-03T00:00:00Z'},randomUUID(),'Decision received']);
  assert.deepEqual(await statuses(),['COMPLETED','COMPLETED','COMPLETED','COMPLETED']);
  assert.equal((await projection(wf.id)).status,'COMPLETED');
  assert.equal((await client.query('select status from public.student_applications where id=$1',[app2.id])).rows[0].status,'DRAFT');
  assert.equal((await client.query('select count(*)::int n from public.admission_milestones where enrollment_id=$1',[en])).rows[0].n,1);
  const applicationHistory=(await client.query('select from_status,to_status from public.student_application_status_history where application_id=$1 order by application_revision',[app.id])).rows;
  assert.deepEqual(applicationHistory,[{from_status:null,to_status:'DRAFT'},{from_status:'DRAFT',to_status:'SUBMITTED'},{from_status:'SUBMITTED',to_status:'DECIDED'}]);
  assert.deepEqual((await client.query('select to_status from public.admission_milestone_status_history where milestone_id=$1 order by milestone_revision',[milestone.id])).rows.map(r=>r.to_status),['PENDING','COMPLETED']);
  const events=(await client.query("select trigger_key,count(*)::int n from public.automation_events where trigger_key in ('WORKFLOW_STARTED','WORKFLOW_STEP_READY','WORKFLOW_COMPLETED','APPLICATION_CREATED','APPLICATION_STATUS_CHANGED','MILESTONE_STATUS_CHANGED') group by trigger_key")).rows;
  assert.deepEqual(Object.fromEntries(events.map(r=>[r.trigger_key,r.n])),{APPLICATION_CREATED:2,APPLICATION_STATUS_CHANGED:2,MILESTONE_STATUS_CHANGED:1,WORKFLOW_STARTED:1,WORKFLOW_STEP_READY:4,WORKFLOW_COMPLETED:1});
  assert.equal((await client.query("select count(*)::int n from public.audit_events where action='WORKFLOW_INSTANCE_STARTED' and entity_id=$1",[wf.id])).rows[0].n,1);
  const timeline=(await client.query('select source_type,event_type from public.admissions_timeline where enrollment_id=$1',[en])).rows;
  assert.deepEqual(timeline.filter(r=>r.source_type==='APPLICATION').map(r=>r.event_type).sort(),['DECISION','SUBMITTED']);
  assert.deepEqual(timeline.filter(r=>r.source_type==='WORKFLOW').map(r=>r.event_type).sort(),['COMPLETED','STARTED']);
  assert.equal(timeline.filter(r=>r.source_type==='MILESTONE').length,1);
  assert.deepEqual((await client.query('select * from public.admission_journeys where id=$1',[journey.id])).rows[0],journey);
  console.log('PASS v3.20 release PostgreSQL golden path: TASK → Application Submitted → Interview → Application Decision → Workflow Complete; explicit one-to-many context, canonical facts, histories, audit, exactly-once events and full negative/late-failure rollback');
}finally{if(otherClient)await otherClient.end().catch(()=>{});if(client)await client.end().catch(()=>{});assert.match(container,/^lumina-crm-workflows-it-[a-f0-9]{10}$/);spawnSync('docker',['rm','--force',container],{encoding:'utf8',timeout:10000,windowsHide:true});}
