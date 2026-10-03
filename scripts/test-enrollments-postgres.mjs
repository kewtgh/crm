import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";
import {enrollmentPrivacyRecords} from "./lib/enrollment-privacy-export.mjs";
// Disposable local DB only; never loads .env.local or existing application credentials.
const container=`lumina-crm-enrollments-it-${randomBytes(5).toString("hex")}`,deadline=Date.now()+50_000,password=randomBytes(32).toString("hex");
const image=process.env.ENROLLMENT_TEST_POSTGRES_IMAGE||"postgres:18.6-trixie";
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
let client,otherClient;
function run(command,args,env=process.env){const result=spawnSync(command,args,{env,encoding:"utf8",timeout:Math.max(1,Math.min(15_000,deadline-Date.now())),windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed: ${result.stderr.trim()}`);return result.stdout.trim();}
try{
  run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=enrollments","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=lumina_enrollments_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],{...process.env,POSTGRES_PASSWORD:password});
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
  const person=await contact(ws,admin,"student-a"),person2=await contact(ws,admin,"student-b"),foreignPerson=await contact(otherWs,stranger,"foreign-student"),counselor=await contact(ws,sales,"counselor");
  const household=(await client.query("insert into public.households(workspace_id,name_zh,name_en,created_by) values($1,'家庭','Family',$2) returning id",[ws,admin])).rows[0].id;
  const student=(await client.query("insert into public.students(workspace_id,person_id,household_id,owner_id,created_by) values($1,$2,$3,$4,$4) returning id",[ws,person,household,admin])).rows[0].id;
  const student2=(await client.query("insert into public.students(workspace_id,person_id,owner_id,created_by) values($1,$2,$3,$3) returning id",[ws,person2,admin])).rows[0].id;
  const foreignStudent=(await client.query("insert into public.students(workspace_id,person_id,owner_id,created_by) values($1,$2,$3,$3) returning id",[otherWs,foreignPerson,stranger])).rows[0].id;
  const product=async(workspace,code)=>(await client.query("insert into public.products(workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en) values($1,$2::text,$2::text,$2::text,'PROJECT','一年','Year') returning id",[workspace,code])).rows[0].id;
  const p=await product(ws,"ENROLLMENT-PRODUCT"),p2=await product(ws,"SECOND-PRODUCT"),foreignProduct=await product(otherWs,"FOREIGN-PRODUCT");
  const cohort=async(workspace,prod,code,status="RECRUITING")=>(await client.query("insert into public.product_cohorts(workspace_id,product_id,code,name_zh,name_en,status,capacity,target_enrollment) values($1,$2,$3::text,$3::text,$3::text,$4,0,0) returning id",[workspace,prod,code,status])).rows[0].id;
  const co=await cohort(ws,p,"FALL-2027"),co2=await cohort(ws,p,"FALL-2028"),closed=await cohort(ws,p,"CLOSED","CLOSED"),foreignCo=await cohort(otherWs,foreignProduct,"FOREIGN-COHORT");
  const org=async(workspace,owner,name)=>(await client.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,$3,$3,$2,$2) returning id",[workspace,owner,name])).rows[0].id;
  const school=await org(ws,admin,"school"),salesSchool=await org(ws,sales,"sales-school"),foreignSchool=await org(otherWs,stranger,"foreign-school");
  const campaign=(await client.query("insert into public.growth_campaigns(workspace_id,code,name_zh,name_en,channel,created_by) values($1,'GAPP','招生活动','Campaign','EVENT',$2) returning id",[ws,admin])).rows[0].id;
  const event=(await client.query("insert into public.education_outreach_events(id,workspace_id,organization_id,name,kind,starts_on,ends_on,location,status,next_action) values(gen_random_uuid(),$1,$2,'GAPP Seminar','SEMINAR','2026-10-01','2026-10-02','','CONFIRMED','') returning id",[ws,school])).rows[0].id;
  const referral=(await client.query("insert into public.education_family_referrals(id,workspace_id,source_organization_id,household_id,referred_on,status,next_action) values(gen_random_uuid(),$1,$2,$3,'2026-10-01','NEW','') returning id",[ws,school,household])).rows[0].id;
  const opportunity=(await client.query("insert into public.opportunities(workspace_id,organization_id,product_id,title_zh,title_en,owner_id,created_by,next_action_zh,next_action_en,expected_close_date) values($1,$2,$3,'商机','Opportunity',$4,$4,'联系','Contact','2027-06-01') returning id",[ws,school,p,admin])).rows[0].id;
  const mismatchedOpportunity=(await client.query("insert into public.opportunities(workspace_id,organization_id,product_id,title_zh,title_en,owner_id,created_by,next_action_zh,next_action_en,expected_close_date) values($1,$2,$3,'其他商机','Other opportunity',$4,$4,'联系','Contact','2027-06-01') returning id",[ws,school,p2,admin])).rows[0].id;
  await context();
  const data={student_id:student,cohort_id:co,household_id:household,opportunity_id:opportunity,status:"INTERESTED",owner_id:admin,sales_owner_id:null,enrolled_at:null,completed_at:null,withdrawn_at:null,withdrawal_reason:""};
  const save=async(id,revision,input=data,key=randomUUID(),reason="",connection=client)=>(await connection.query("select * from public.save_student_enrollment($1,$2,$3,$4,$5)",[id,revision,input,key,reason])).rows[0];
  const id=randomUUID(),key=randomUUID(),first=await save(id,null,data,key);
  assert.equal(first.revision,1);assert.equal(first.student_id,student);assert.deepEqual(await save(id,null,data,key),first);
  await assert.rejects(save(id,null,{...data,status:"LEAD"},key),/enrollment_request_conflict/);
  const history=async()=>(await client.query("select * from public.student_enrollment_status_history where enrollment_id=$1 order by id",[id])).rows;
  assert.equal((await history()).length,1);assert.equal((await history())[0].from_status,null);assert.equal((await history())[0].to_status,"INTERESTED");
  await assert.rejects(save(randomUUID(),null),/student_enrollments_workspace_id_student_id_cohort_id_key/);
  const next=await save(randomUUID(),null,{...data,cohort_id:co2,opportunity_id:null});assert.equal(next.student_id,student);
  await assert.rejects(save(randomUUID(),null,{...data,student_id:foreignStudent}),/enrollment_student_not_found/);
  await assert.rejects(save(randomUUID(),null,{...data,cohort_id:foreignCo}),/enrollment_cohort_not_found/);
  await assert.rejects(save(id,1,{...data,student_id:student2}),/enrollment_parent_immutable/);
  await assert.rejects(save(id,1,{...data,cohort_id:co2}),/enrollment_parent_immutable/);
  await assert.rejects(save(randomUUID(),null,{...data,cohort_id:closed}),/enrollment_cohort_closed/);
  await assert.rejects(save(id,1,{...data,opportunity_id:mismatchedOpportunity}),/enrollment_opportunity_mismatch/);
  await assert.rejects(save(id,1,{...data,status:"OFFERED"}),/student_enrollments_status_check/);
  for(const patch of [{status:"ACTIVE"},{status:"COMPLETED"},{status:"WITHDRAWN",withdrawn_at:"2027-09-01"},{status:"WITHDRAWN",withdrawal_reason:"Changed plans"},
    {enrolled_at:"2027-09-01",completed_at:"2027-08-01"},{enrolled_at:"2027-09-01",withdrawn_at:"2027-08-01"}])await assert.rejects(save(id,1,{...data,...patch}),/student_enrollments_lifecycle_check/);
  const ordinary=await save(id,1,{...data,withdrawal_reason:"draft note"});assert.equal(ordinary.revision,2);assert.equal((await history()).length,1);
  const registering=await save(id,2,{...data,status:"REGISTERING"},randomUUID(),"Preparing enrollment");assert.equal(registering.revision,3);assert.equal((await history()).length,2);assert.equal((await history())[1].reason,"Preparing enrollment");
  await assert.rejects(save(id,2),/enrollment_version_conflict/);
  await assert.rejects(client.query("update public.student_enrollment_status_history set reason='rewrite' where enrollment_id=$1",[id]),/permission denied/);
  await assert.rejects(client.query("delete from public.student_enrollments where id=$1",[id]),/permission denied/);
  // Failure injection proves history and audit cannot leave half-saved enrollment facts.
  await client.query("reset role");
  await client.query("create function public.test_enrollment_history_failure() returns trigger language plpgsql as $$ begin raise exception 'test_history_failed'; end $$; create trigger test_history_failure before insert on public.student_enrollment_status_history for each row execute function public.test_enrollment_history_failure()");
  await context();await assert.rejects(save(id,3,{...data,status:"ACTIVE",enrolled_at:"2027-09-01"}),/test_history_failed/);
  assert.equal((await client.query("select revision,status from public.student_enrollments where id=$1",[id])).rows[0].revision,3);assert.equal((await history()).length,2);
  await client.query("reset role");await client.query("drop trigger test_history_failure on public.student_enrollment_status_history");
  await client.query("create function public.test_enrollment_audit_failure() returns trigger language plpgsql as $$ begin if new.action='STUDENT_ENROLLMENT_UPDATED' then raise exception 'test_audit_failed'; end if; return new; end $$; create trigger test_audit_failure before insert on public.audit_events for each row execute function public.test_enrollment_audit_failure()");
  await context();await assert.rejects(save(id,3,{...data,status:"ACTIVE",enrolled_at:"2027-09-01"}),/test_audit_failed/);assert.equal((await history()).length,2);
  assert.deepEqual((await client.query("select revision,status from public.student_enrollments where id=$1",[id])).rows[0],{revision:3,status:"REGISTERING"});
  await client.query("reset role");await client.query("drop trigger test_audit_failure on public.audit_events");await context();
  otherClient=new pg.Client({connectionString,connectionTimeoutMillis:1000,statement_timeout:5000});await otherClient.connect();await context(admin,ws,otherClient);
  const active={...data,status:"ACTIVE",enrolled_at:"2027-09-01T00:00:00Z"};
  const concurrent=await Promise.allSettled([save(id,3,active,randomUUID(),"",client),save(id,3,active,randomUUID(),"",otherClient)]);
  assert.equal(concurrent.filter(item=>item.status==="fulfilled").length,1);assert.match(concurrent.find(item=>item.status==="rejected").reason.message,/enrollment_version_conflict/);assert.equal((await history()).length,3);
  await otherClient.end();otherClient=undefined;
  const source={enrollment_id:id,attribution_type:"PRIMARY",source_organization_id:school,source_contact_id:null,source_event_id:event,source_campaign_id:campaign,source_referral_id:referral,note:"From the school"};
  const attribute=async(recordId,input=source,requestKey=randomUUID())=>(await client.query("select * from public.save_enrollment_attribution($1,$2,$3)",[recordId,input,requestKey])).rows[0];
  const sourceId=randomUUID(),sourceKey=randomUUID(),primary=await attribute(sourceId,source,sourceKey);
  assert.deepEqual(await attribute(sourceId,source,sourceKey),primary);
  await assert.rejects(attribute(randomUUID()),/enrollment_attributions_primary_uidx/);
  await assert.rejects(attribute(randomUUID(),{...source,source_organization_id:null,source_event_id:null,source_campaign_id:null,source_referral_id:null,attribution_type:"ASSIST"}),/enrollment_attributions_source_check/);
  await assert.rejects(attribute(randomUUID(),{...source,source_organization_id:foreignSchool,attribution_type:"ASSIST"}),/enrollment_source_forbidden/);
  await attribute(randomUUID(),{...source,attribution_type:"ASSIST",source_contact_id:counselor});await attribute(randomUUID(),{...source,attribution_type:"ASSIST"});
  assert.equal((await client.query("select has_primary_attribution from public.student_enrollment_records where id=$1",[id])).rows[0].has_primary_attribution,true);
  // Read projections inherit access from every underlying source, not just enrollment FK.
  assert.equal((await client.query("select count(*)::int n from public.enrollment_attribution_records where enrollment_id=$1",[id])).rows[0].n,3);
  const referralOption=(await client.query("select * from public.enrollment_referral_options where id=$1",[referral])).rows[0];assert.equal(referralOption.organization_name_en,"school");assert.equal(referralOption.household_name_en,"Family");
  await client.query("reset role");await client.query("update public.contacts set owner_id=$1 where id=$2",[sales,person]);
  // Student visibility alone never grants access to someone else's enrollment.
  await context(sales);assert.equal((await client.query("select count(*)::int n from public.student_enrollment_records where id=$1",[id])).rows[0].n,0);
  await assert.rejects(save(id,4,{...active,opportunity_id:null}),/enrollment_update_forbidden/);
  await client.query("reset role");await client.query("update public.student_enrollments set owner_id=$1,opportunity_id=null where id=$2",[sales,id]);
  await context(sales);
  assert.equal((await client.query("select count(*)::int n from public.enrollment_referral_options where id=$1",[referral])).rows[0].n,0);
  assert.equal((await client.query("select count(*)::int n from public.student_enrollment_records where id=$1",[id])).rows[0].n,1);
  assert.equal((await client.query("select has_primary_attribution from public.student_enrollment_records where id=$1",[id])).rows[0].has_primary_attribution,true);
  await assert.rejects(attribute(randomUUID(),{...source,source_organization_id:school,source_event_id:null,source_referral_id:null,attribution_type:"ASSIST"}),/enrollment_source_forbidden/);
  await attribute(randomUUID(),{...source,source_organization_id:salesSchool,source_event_id:null,source_referral_id:null,attribution_type:"ASSIST"});
  await assert.rejects(save(id,4,{...active,owner_id:admin,opportunity_id:null}),/enrollment_owner_invalid/);
  const scoped={...active,owner_id:sales,opportunity_id:null};
  for(const role of ["SUPER_ADMIN","SALES_DIRECTOR","SALES_MANAGER","SALES_SPECIALIST","SALES_SUPPORT"]){await client.query("reset role");await client.query("update public.workspace_memberships set role=$1 where user_id=$2",[role,sales]);await context(sales);const current=(await client.query("select revision from public.student_enrollments where id=$1",[id])).rows[0].revision;await save(id,current,scoped);}
  await context(stranger,otherWs);assert.equal((await client.query("select count(*)::int n from public.student_enrollment_records")).rows[0].n,0);await assert.rejects(save(id,4),/enrollment_student_not_found/);
  await client.query("reset role");
  // Composite FKs and immutable identity also protect maintenance SQL.
  await assert.rejects(client.query("insert into public.student_enrollments(workspace_id,student_id,cohort_id,owner_id) values($1,$2,$3,$4)",[ws,student,foreignCo,admin]),/foreign key constraint/);
  await assert.rejects(client.query("insert into public.student_enrollments(workspace_id,student_id,cohort_id,owner_id) values($1,$2,$3,$4)",[ws,foreignStudent,co,admin]),/foreign key constraint/);
  await assert.rejects(client.query("update public.student_enrollments set student_id=$1 where id=$2",[student2,id]),/enrollment_parent_immutable/);
  await assert.rejects(client.query("update public.student_enrollment_status_history set reason='rewrite' where enrollment_id=$1",[id]),/enrollment_history_immutable/);
  const audit=(await client.query("select after_data from public.audit_events where entity_id=$1 and action='STUDENT_ENROLLMENT_CREATED'",[id])).rows[0].after_data;
  assert.deepEqual(Object.keys(audit).sort(),["revision","status"]);
  await client.query("update public.product_cohorts set status='CLOSED' where id=$1",[co]);await context(sales);
  const current=(await client.query("select revision from public.student_enrollments where id=$1",[id])).rows[0].revision;await save(id,current,{...scoped,status:"COMPLETED",completed_at:"2027-10-01"});
  await client.query("reset role");await client.query("update public.students set household_id=null where id=$1",[student]);assert.equal((await client.query("select household_id from public.student_enrollments where id=$1",[id])).rows[0].household_id,household);
  assert.equal((await client.query("select count(*)::int n from public.students where id=$1",[student])).rows[0].n,1);assert.equal((await client.query("select count(*)::int n from public.student_enrollments where student_id=$1",[student])).rows[0].n,2);
  // Real worker grants and all three privacy fact types, scoped to this Student.
  await client.query("set role crm_worker");
  const exported=await enrollmentPrivacyRecords(async url=>{const params=new URL(url,"http://localhost").searchParams,table=new URL(url,"http://localhost").pathname.split("/").at(-1);assert.ok(["student_enrollments","student_enrollment_status_history","enrollment_attributions"].includes(table));const column=table==="student_enrollments"?"student_id":"enrollment_id";const ids=params.get(column).slice(4,-1).split(",");return(await client.query(`select * from public.${table} where workspace_id=$1 and ${column}=any($2::uuid[])`,[ws,ids])).rows;},ws,[student]);
  assert.equal(exported.enrollments.length,2);assert.ok(exported.history.length>=3);assert.equal(exported.attributions.length,4);
  await client.query("reset role");
  const before=(await client.query("select count(*)::int n from public.mutation_receipts where operation in ('ENROLLMENT_SAVE','ENROLLMENT_ATTRIBUTION_SAVE')")).rows[0].n;assert.ok(before>0);
  await client.query("update public.contacts set do_not_contact_reason='PRIVACY_DELETION:test' where id=$1",[person]);
  for(const table of ["student_enrollments","student_enrollment_status_history","enrollment_attributions"])assert.equal((await client.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
  assert.equal((await client.query("select count(*)::int n from public.mutation_receipts where operation in ('ENROLLMENT_SAVE','ENROLLMENT_ATTRIBUTION_SAVE')")).rows[0].n,0);
  await context(sales);await assert.rejects(save(randomUUID(),null,scoped),/enrollment_student_not_found/);
  // Physical Student purge cascades, without touching unrelated Student or Product facts.
  await context();const purge=await save(randomUUID(),null,{...data,student_id:student2,cohort_id:co2,opportunity_id:null});
  await attribute(randomUUID(),{...source,enrollment_id:purge.id,attribution_type:"ASSIST",source_organization_id:null,source_contact_id:counselor,source_event_id:null,source_campaign_id:null,source_referral_id:null});
  await client.query("reset role");await client.query("update public.contacts set do_not_contact_reason='PRIVACY_DELETION:counselor' where id=$1",[counselor]);
  assert.equal((await client.query("select count(*)::int n from public.student_enrollments where id=$1",[purge.id])).rows[0].n,1);
  assert.equal((await client.query("select count(*)::int n from public.enrollment_attributions where enrollment_id=$1",[purge.id])).rows[0].n,0);
  assert.equal((await client.query("select count(*)::int n from public.mutation_receipts where operation='ENROLLMENT_ATTRIBUTION_SAVE'")).rows[0].n,0);
  await client.query("delete from public.students where id=$1",[student2]);
  assert.equal((await client.query("select count(*)::int n from public.student_enrollment_status_history where enrollment_id=$1",[purge.id])).rows[0].n,0);
  assert.equal((await client.query("select count(*)::int n from public.students where id=$1",[student])).rows[0].n,1);
  console.log(`PASS ${(await client.query("select version() v")).rows[0].v} (${image}): enrollment identities/FKs, lifecycle, true concurrent revisions, scoped roles/sources, PRIMARY/ASSIST, history/audit rollback, no capacity enforcement, historical household and privacy export/deletion/purge`);
}finally{
  await otherClient?.end().catch(()=>{});await client?.end().catch(()=>{});assert.match(container,/^lumina-crm-enrollments-it-[a-f0-9]{10}$/);
  const cleanup=spawnSync("docker",["rm","--force",container],{encoding:"utf8",timeout:10000,windowsHide:true});if(cleanup.status!==0&&!cleanup.stderr?.includes("No such container"))throw new Error(`Could not remove isolated test container ${container}: ${cleanup.stderr}`);
}
