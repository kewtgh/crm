import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import pg from "pg";

// Fresh loopback/tmpfs database only. No dotenv, application credentials or
// existing database is accepted. Child diagnostics never print credentials.
const container=`ewaya-staff-lifecycle-it-${randomBytes(5).toString("hex")}`;
const database=`staff_create_${randomBytes(5).toString("hex")}`;
const password=randomBytes(32).toString("hex");
const image="postgres:18.4-bookworm";
const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false"};
for(const key of Object.keys(env)) if (/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|INVITATION_CREDENTIAL_ENCRYPTION_KEY|APP_URL|DATABASE_SSL_REJECT_UNAUTHORIZED/.test(key)) delete env[key];
for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"]) env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
function run(command,args,environment=env){const r=spawnSync(command,args,{env:environment,encoding:"utf8",timeout:25000,windowsHide:true});if(r.error||r.status!==0){mkdirSync("work/v336",{recursive:true});writeFileSync("work/v336/subprocess-failure.log",r.stderr||String(r.error));throw new Error(`STAFF_CREATE_TEST_SUBPROCESS_FAILED:${command}`);}return r.stdout.trim();}
let admin,closePools;
const previous={};
try {
 run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=staff-lifecycle","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env",`POSTGRES_DB=${database}`,"--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],{...env,POSTGRES_PASSWORD:password});
 const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
 for(let n=0;n<25;n++){admin=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await admin.connect();break;}catch{await admin.end().catch(()=>{});admin=undefined;if(n===24)throw new Error("STAFF_CREATE_TEST_DATABASE_NOT_READY");await new Promise(r=>setTimeout(r,200));}}
 env.DATABASE_ADMIN_URL=url;
 run(process.execPath,["scripts/db-bootstrap.mjs"]);
 env.MIGRATION_DATABASE_URL=`postgresql://crm_migrator:${env.CRM_MIGRATOR_DB_PASSWORD}@127.0.0.1:${port}/${database}`;
 run(process.execPath,["scripts/db-migrate.mjs"]);
 const identityColumns=await admin.query("select c.relname,a.attname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind='r' and a.atttypid='uuid'::regtype and a.attnum>0 and not a.attisdropped and a.attname ~ '(owner|actor|user|member|created_by|updated_by|approved_by|assigned|reviewed_by)' and not exists(select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='f' and a.attnum=any(k.conkey)) order by c.relname,a.attname");
 mkdirSync("work/v336",{recursive:true});writeFileSync("work/v336/legacy-identity-columns.json",JSON.stringify(identityColumns.rows,null,2));
 const workspace=randomUUID(),otherWorkspace=randomUUID(),superId=randomUUID(),adminId=randomUUID();
 await admin.query("insert into public.workspaces(id,slug,name) values($1,'staff-create-fictional','Fictional Staff Workspace'),($2,'staff-create-other','Other Fictional Workspace')",[workspace,otherWorkspace]);
 for(const [id,role,name] of [[superId,"SUPER_ADMIN","super"],[adminId,"ADMIN","admin"]]){
  await admin.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)",[id,`${name}@example.test`,name]);
  await admin.query("insert into public.user_profiles(user_id,username,display_name_zh,display_name_en) values($1,$2,'示例管理员','Fictional Administrator')",[id,name]);
  await admin.query("insert into public.workspace_memberships(workspace_id,user_id,role,status) values($1,$2,$3,'ACTIVE')",[workspace,id,role]);
 }
 const team=(await admin.query("insert into public.sales_teams(workspace_id,code,name_zh,name_en,active) values($1,'TEST-TEAM','示例团队','Fictional Team',true) returning id",[workspace])).rows[0].id;
 const testEnvironment={NODE_ENV:"test",DATABASE_SSL:"false",SYSTEM_DATABASE_URL:`postgresql://crm_system:${env.CRM_SYSTEM_DB_PASSWORD}@127.0.0.1:${port}/${database}`,CRM_WORKSPACE_ID:workspace,APP_URL:"https://crm.example.test",INVITATION_CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString("hex")};
 for(const [key,value] of Object.entries(testEnvironment)){previous[key]=process.env[key];process.env[key]=value;}
 const {createStaffUser,resendStaffInvitation,updateStaffUser,getStaffUser}=await import("../lib/admin-users-repository.ts");
 const {closeDatabasePools}=await import("../lib/db/pools.ts");closePools=closeDatabasePools;
 const actor={id:superId,role:"SUPER_ADMIN",aal:"aal2",email:"super@example.test",username:"super",displayName:"Fictional Super",displayNameZh:"示例管理",initials:"FS",mfaEnabled:true,emailVerified:true};
 const input=(name,extra={})=>({username:name,email:`${name}@example.test`,displayNameZh:"示例员工",displayNameEn:"Fictional Staff",role:"SALES_SPECIALIST",teamId:team,...extra});
 const appUrl=`postgresql://crm_app:${env.CRM_APP_DB_PASSWORD}@127.0.0.1:${port}/${database}`;
 const execute=async(userId,sql,values=[],aal="aal2")=>{const client=new pg.Client({connectionString:appUrl});await client.connect();try{await client.query("begin");await client.query("select set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true),set_config('app.aal',$3,true)",[userId,workspace,aal]);const result=await client.query(sql,values);await client.query("commit");return result.rows[0]?.item;}catch(e){await client.query("rollback");throw e;}finally{await client.end();}};
 const eligibility=id=>execute(superId,"select public.staff_lifecycle_eligibility($1) item",[id]);
 const remove=(id,key=randomUUID(),userId=superId)=>execute(userId,"select public.remove_unused_staff_account($1,$2) item",[id,key]);
 const create=async(name,extra={})=>(await createStaffUser(input(name,extra),actor)).item;
 const pause=async(staff)=>{await updateStaffUser(staff,{status:"SUSPENDED"},actor);return staff;};
 const paused=async(name,extra={})=>pause(await create(name,extra));
 const historicalDirector=await create("historical.pending.director",{role:"SALES_DIRECTOR"});
 const historicalMember=(await admin.query("select id from public.sales_team_members where auth_user_id=$1",[historicalDirector.id])).rows[0].id;
 await admin.query("insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action) values($1,$2,'sales_team_members',$3,'UPDATE')",[workspace,superId,historicalMember]);
 await pause(historicalDirector);
 assert.equal((await eligibility(historicalDirector.id)).status,"DELETE_ELIGIBLE","historical member audit alone must not block an unused pending account");
 const historicalAudit=(await admin.query("select * from public.audit_events where entity_type='sales_team_members' and entity_id=$1::text",[historicalMember])).rows;
 assert.equal((await remove(historicalDirector.id)).status,"REMOVED");
 assert.deepEqual((await admin.query("select * from public.audit_events where entity_type='sales_team_members' and entity_id=$1::text",[historicalMember])).rows,historicalAudit);
 // Existing installations can retain the previous identity-sync protocol's
 // completed role-change rows even though new changes use the direct RPC.
 const legacyPending=await create("legacy.pending.director",{role:"ADMIN"});
 const legacyChange=(await admin.query("select (public.prepare_staff_identity_change($1,'SALES_DIRECTOR','ACTIVE',$2)).id",[legacyPending.id,superId])).rows[0].id;
 await admin.query("select public.complete_staff_identity_change($1)",[legacyChange]);
 const legacyDirector=await getStaffUser(legacyPending.id);
 assert.equal(legacyDirector.lastSignInAt,null);
 await pause(legacyDirector);
 assert.equal((await eligibility(legacyDirector.id)).status,"DELETE_ELIGIBLE","completed legacy role changes are account configuration, not business references");
 assert.equal((await eligibility(legacyDirector.id)).retentionMode,"AUDIT_IDENTITY");
 assert.equal((await remove(legacyDirector.id)).status,"REMOVED");
 const legacyHistory=(await admin.query("select state,before_role,after_role,before_team,error_message from public.staff_identity_changes where id=$1",[legacyChange])).rows[0];
 assert.equal(legacyHistory.state,"SYNCED");assert.equal(legacyHistory.before_role,"ADMIN");assert.equal(legacyHistory.after_role,"SALES_DIRECTOR");
 assert.equal(legacyHistory.before_team.name_en,undefined);assert.equal(legacyHistory.before_team.name_zh,undefined);assert.equal(legacyHistory.before_team.team,undefined);
 assert.equal((await admin.query("select status,purged_at from app_auth.accounts where id=$1",[legacyDirector.id])).rows[0].status,"DISABLED");
 assert.equal((await admin.query("select count(*) n from public.workspace_memberships where user_id=$1",[legacyDirector.id])).rows[0].n,"0");
 await assert.rejects(admin.query("update public.staff_identity_changes set state='PENDING' where id=$1",[legacyChange]),e=>e.message==="STAFF_IDENTITY_REMOVED");
 const legacyRepair=await create("legacy.repair.director",{role:"ADMIN"});
 const repairChange=(await admin.query("select (public.prepare_staff_identity_change($1,'SALES_DIRECTOR','ACTIVE',$2)).id",[legacyRepair.id,superId])).rows[0].id;
 await pause(await getStaffUser(legacyRepair.id));
 assert.equal((await eligibility(legacyRepair.id)).status,"IDENTITY_REPAIR_REQUIRED");
 await assert.rejects(remove(legacyRepair.id),e=>e.message==="IDENTITY_REPAIR_REQUIRED");
 // Seed the historical compensation outcome; do not invoke the retired
 // rollback implementation against today's expanded member schema.
 await admin.query("update public.staff_identity_changes set state='FAILED',error_message='FICTIONAL',completed_at=now() where id=$1",[repairChange]);
 const repairJob=(await admin.query("select id from public.staff_identity_repair_jobs where identity_change_id=$1",[repairChange])).rows[0].id;
 // A failed legacy change remains FAILED after its separate repair completes.
 await pause(await getStaffUser(legacyRepair.id));
 for(const status of ['PENDING','PROCESSING','FAILED','DEAD']){
  await admin.query("update public.staff_identity_repair_jobs set status=$2 where id=$1",[repairJob,status]);
  assert.equal((await eligibility(legacyRepair.id)).status,"IDENTITY_REPAIR_REQUIRED",status);
 }
 await admin.query("select public.complete_identity_repair($1,true)",[repairJob]);
 assert.equal((await eligibility(legacyRepair.id)).status,"DELETE_ELIGIBLE");
 assert.equal((await remove(legacyRepair.id)).status,"REMOVED");
 assert.equal((await admin.query("select status from public.staff_identity_repair_jobs where id=$1",[repairJob])).rows[0].status,"COMPLETED");
 await assert.rejects(admin.query("update public.staff_identity_repair_jobs set status='PENDING' where id=$1",[repairJob]),e=>e.message==="STAFF_IDENTITY_REMOVED");
 const legacyRollback=await create("legacy.rollback.director",{role:"ADMIN"});
 const rollbackChange=(await admin.query("select (public.prepare_staff_identity_change($1,'SALES_DIRECTOR','ACTIVE',$2)).id",[legacyRollback.id,superId])).rows[0].id;
 await admin.query("update public.staff_identity_changes set state='ROLLED_BACK',completed_at=now() where id=$1",[rollbackChange]);
 await admin.query("insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action) values($1,$2,'staff_user',$3,'IDENTITY_CHANGE_ROLLED_BACK')",[workspace,superId,legacyRollback.id]);
 await pause(await getStaffUser(legacyRollback.id));
 assert.equal((await eligibility(legacyRollback.id)).status,"DELETE_ELIGIBLE");
 assert.equal((await remove(legacyRollback.id)).status,"REMOVED");
 console.log("PASS legacy synced/rolled-back/repaired role history is removable; unresolved work and operation replay remain blocked.");
 const pendingRoleChange=await create("pending.role.change",{role:"ADMIN"});
 await execute(superId,"select public.change_staff_role($1,'SALES_DIRECTOR','ADMIN',$2) item",[pendingRoleChange.id,randomUUID()]);
 const pendingDirector=await getStaffUser(pendingRoleChange.id);
 assert.equal(pendingDirector.role,"SALES_DIRECTOR");
 assert.equal(pendingDirector.lastSignInAt,null);
 await execute(superId,"select public.staff_profile_command($1,1,'SALES','{}',true,current_date,'Fictional pending staff configuration',$2) item",[pendingDirector.id,randomUUID()]);
 const retainedMember=(await admin.query("select id from public.sales_team_members where auth_user_id=$1",[pendingDirector.id])).rows[0].id;
 assert.equal(await execute(superId,"select public.staff_reporting_current($1) item",[retainedMember]),false,"configuration does not enroll a pending account into reporting");
 assert.equal(await execute(superId,"select public.staff_reporting_at($1,current_date) item",[retainedMember]),false);
 assert.equal(await execute(superId,"select public.staff_reporting_in_period($1,current_date,current_date+1) item",[retainedMember]),false);
 assert.ok(!(await execute(superId,"select coalesce(jsonb_agg(id),'[]') item from public.staff_sales_roster()")).includes(retainedMember));
 await assert.rejects(execute(superId,"select to_jsonb(public.save_performance_plan(null,$1,current_date,current_date+30,'CNY',100,'[]')) item",[pendingDirector.id]),e=>e.message==="STAFF_ONBOARDING_REQUIRED");
 // An onboarded administrator need not acquire a sales-member record to manage a plan.
 await admin.query("update app_auth.accounts set last_sign_in_at=now(),must_change_password=false where id=$1",[adminId]);
 await admin.query("update public.workspace_memberships set must_change_password=false where user_id=$1",[adminId]);
 assert.ok((await execute(superId,"select to_jsonb(public.save_performance_plan(null,$1,current_date,current_date+30,'CNY',100,'[]')) item",[adminId])).id);
 const retainedEligibility=(await admin.query("select * from public.staff_sales_eligibility_events where member_id=$1",[retainedMember])).rows;
 await pause(pendingDirector);
 assert.equal((await eligibility(pendingDirector.id)).status,"DELETE_ELIGIBLE","unaccepted administrator invitation changed to sales director must remain removable");
 assert.equal((await eligibility(pendingDirector.id)).retainedReportingIdentity,true);
 const pendingRemovalKey=randomUUID();
 assert.equal((await remove(pendingDirector.id,pendingRemovalKey)).status,"REMOVED");
 assert.equal((await remove(pendingDirector.id,pendingRemovalKey)).status,"REMOVED");
 assert.deepEqual((await admin.query("select * from public.staff_sales_eligibility_events where member_id=$1",[retainedMember])).rows,retainedEligibility);
 const retainedStub=(await admin.query("select m.active,m.name_en,m.team,a.status,a.purged_at from public.sales_team_members m join app_auth.accounts a on a.id=m.auth_user_id where m.id=$1",[retainedMember])).rows[0];
 assert.equal(retainedStub.active,false);assert.equal(retainedStub.name_en,"Removed account");assert.equal(retainedStub.team,"");assert.equal(retainedStub.status,"DISABLED");assert.ok(retainedStub.purged_at);
 assert.equal(await execute(superId,"select public.staff_reporting_current($1) item",[retainedMember]),false);
 assert.equal(await execute(superId,"select public.staff_reporting_at($1,current_date) item",[retainedMember]),false);
 assert.equal(await execute(superId,"select public.staff_reporting_in_period($1,current_date,current_date+1) item",[retainedMember]),false);
 for(const [table,column] of [["app_auth.password_credentials","user_id"],["public.user_profiles","user_id"],["public.workspace_memberships","user_id"],["public.notification_outbox","recipient_id"],["public.sales_team_memberships","member_id"]])assert.equal((await admin.query(`select count(*) n from ${table} where ${column}=$1`,[column==='member_id'?retainedMember:pendingDirector.id])).rows[0].n,"0");
 await assert.rejects(getStaffUser(pendingDirector.id),e=>e.code==="STAFF_USER_NOT_FOUND");
 await assert.rejects(admin.query("update public.sales_team_members set active=true where id=$1",[retainedMember]),e=>e.message==="STAFF_IDENTITY_REMOVED");
 await assert.rejects(admin.query("insert into public.sales_team_memberships(workspace_id,team_id,member_id,requested_by) values($1,$2,$3,$4)",[workspace,team,retainedMember,superId]),e=>e.message==="STAFF_IDENTITY_REMOVED");
 console.log("PASS never-signed-in administrator changed to sales director with reporting configuration can be suspended and removed.");
 const unused=await create("unused.staff");assert.equal((await eligibility(unused.id)).status,"DEACTIVATION_REQUIRED");await assert.rejects(remove(unused.id),e=>e.message==="DEACTIVATION_REQUIRED");
 await execute(unused.id,"insert into public.user_preferences(user_id,workspace_id) values($1,$2) on conflict(user_id) do update set locale='en'",[unused.id,workspace]);
 await pause(unused);assert.equal((await eligibility(unused.id)).status,"DELETE_ELIGIBLE");
 await admin.query("insert into app_auth.sessions(user_id,token_hash,csrf_hash,password_version,idle_expires_at,absolute_expires_at) values($1,$2,$3,1,now()+interval '1 hour',now()+interval '2 hours')",[unused.id,randomBytes(32).toString('hex'),randomBytes(32).toString('hex')]);
 await admin.query("insert into app_auth.totp_factors(user_id,secret_ciphertext,secret_iv,secret_tag) values($1,$2,$3,$4)",[unused.id,Buffer.from('fictional'),Buffer.from('fictional'),Buffer.from('fictional')]);
 await admin.query("insert into public.trusted_login_devices(id,workspace_id,user_id,token_hash,device_label,expires_at) values($1,$2,$3,$4,'Fictional device',now()+interval '1 day')",[randomUUID(),workspace,unused.id,randomBytes(32).toString('hex')]);
 const key=randomUUID();const removed=await remove(unused.id,key);assert.equal(removed.status,"REMOVED");assert.deepEqual(await remove(unused.id,key),removed);
 for(const [table,column] of [["app_auth.accounts","id"],["app_auth.password_credentials","user_id"],["app_auth.sessions","user_id"],["app_auth.totp_factors","user_id"],["public.trusted_login_devices","user_id"],["public.user_profiles","user_id"],["public.workspace_memberships","user_id"],["public.sales_team_members","auth_user_id"],["public.staff_invitation_deliveries","user_id"],["public.notification_outbox","recipient_id"]])assert.equal((await admin.query(`select count(*) n from ${table} where ${column}=$1`,[unused.id])).rows[0].n,"0");
 assert.equal((await admin.query("select count(*) n from public.audit_events where entity_id=$1::text and action='REMOVE_UNUSED_ACCOUNT'",[unused.id])).rows[0].n,"1");
 assert.ok(!JSON.stringify((await admin.query("select before_data,after_data from public.audit_events where entity_id=$1::text",[unused.id])).rows).includes(unused.username));
 assert.equal((await admin.query("select count(*) n from public.user_preferences where user_id=$1",[unused.id])).rows[0].n,"0");
 const preferenceAudits=(await admin.query("select actor_id,before_data,after_data from public.audit_events where entity_type='user_preferences' and entity_id=$1::text",[unused.id])).rows;
 assert.ok(preferenceAudits.length>0);assert.ok(preferenceAudits.every(row=>row.actor_id!==unused.id&&row.before_data===null&&row.after_data.status==='IDENTITY_REMOVED'));
 console.log("PASS unused removal, encrypted invitation cleanup, retained minimized audit and exact receipt retry.");
 const business=await paused("referenced.staff");
 const ownedOrganization=(await admin.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'示例归属机构','Fictional Owned Organization',$2,$3) returning id",[workspace,business.id,superId])).rows[0].id;
 await admin.query("insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action) values($1,$2,'fictional_business',$3,'BUSINESS_ACTION')",[workspace,business.id,randomUUID()]);
 assert.equal((await eligibility(business.id)).status,"BUSINESS_REFERENCES_EXIST");await assert.rejects(remove(business.id),e=>e.message==="BUSINESS_REFERENCES_EXIST");
 assert.equal((await eligibility(business.id)).blockingArea,"CUSTOMER_RECORDS");
 assert.equal((await getStaffUser(business.id)).lastSignInAt,null,"never signing in does not bypass actual customer ownership");
 assert.equal((await admin.query("select count(*) n from app_auth.accounts where id=$1",[business.id])).rows[0].n,"1");
 const sending=await paused("sending.staff");await admin.query("update public.notification_outbox set status='SENDING' where recipient_id=$1",[sending.id]);assert.equal((await eligibility(sending.id)).status,"INVITATION_IN_FLIGHT");await assert.rejects(remove(sending.id),e=>e.message==="INVITATION_IN_FLIGHT");
 const multi=await paused("multi.staff");await admin.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'SALES_SUPPORT')",[otherWorkspace,multi.id]);assert.equal((await eligibility(multi.id)).status,"MULTI_WORKSPACE_ACCOUNT");
 assert.equal((await eligibility(superId)).status,"PROTECTED_ACCOUNT");
 const teamless=await create("teamless.admin",{role:"ADMIN",teamId:null});await assert.rejects(remove(teamless.id,randomUUID(),adminId),e=>e.message==="PROTECTED_ACCOUNT");
 await assert.rejects(execute(superId,"select public.staff_lifecycle_eligibility($1) item",[business.id],"aal1"),e=>/MFA_REQUIRED/.test(e.message));
 await assert.rejects(execute(business.id,"select public.staff_lifecycle_eligibility($1) item",[sending.id]),e=>/ROLE_ASSIGNMENT_FORBIDDEN/.test(e.message));
 const raced=await paused("concurrent.staff");const raceKey=randomUUID();const races=await Promise.all([remove(raced.id,raceKey),remove(raced.id,raceKey)]);assert.deepEqual(races[0],races[1]);
 await assert.rejects(remove(business.id,key),e=>e.message==="PAYLOAD_REUSE");
 console.log("PASS business reference, in-flight invitation, multiple workspace, protected/self, AAL1, ordinary-user denial and concurrent idempotent deletion.");
 const foreignAccount=await paused("foreign.scope");await admin.query("update public.workspace_memberships set workspace_id=$1 where user_id=$2",[otherWorkspace,foreignAccount.id]);await assert.rejects(eligibility(foreignAccount.id),e=>e.message==="STAFF_USER_NOT_FOUND");
 const workerRace=await paused("worker.race");const worker=new pg.Client({connectionString:url});await worker.connect();await worker.query("begin");await worker.query("update public.notification_outbox set status='SENDING' where recipient_id=$1",[workerRace.id]);const racingRemoval=remove(workerRace.id).then(()=>"REMOVED",e=>e.message);await worker.query("commit");await worker.end();assert.equal(await racingRemoval,"INVITATION_IN_FLIGHT");assert.equal((await admin.query("select count(*) n from app_auth.accounts where id=$1",[workerRace.id])).rows[0].n,"1");
 console.log("PASS sessions/MFA/trusted-device cleanup, cross-workspace denial and Worker claim-versus-removal race.");
 const external=await paused("external.staff");await admin.query("insert into public.enterprise_directory_users(workspace_id,auth_user_id,external_id,user_name,display_name_en) values($1,$2,'Fictional external identity','external.staff','Fictional Directory Staff')",[workspace,external.id]);assert.equal((await eligibility(external.id)).status,"EXTERNALLY_MANAGED_ACCOUNT");
 const resendRace=await paused("resend.race");const outcomes=await Promise.allSettled([remove(resendRace.id),resendStaffInvitation(resendRace.id,randomUUID(),actor)]);assert.equal(outcomes[0].status,"fulfilled");if(outcomes[1].status==="rejected")assert.equal(outcomes[1].reason.code,"STAFF_USER_NOT_FOUND");assert.equal((await admin.query("select count(*) n from public.notification_outbox where recipient_id=$1",[resendRace.id])).rows[0].n,"0");
 const staleActor={...actor,id:adminId,username:"admin"};await assert.rejects(createStaffUser(input("stale.admin",{role:"ADMIN",teamId:null}),staleActor),e=>e.code==="ROLE_ASSIGNMENT_FORBIDDEN");await assert.rejects(resendStaffInvitation(teamless.id,randomUUID(),staleActor),e=>e.code==="ROLE_ASSIGNMENT_FORBIDDEN");
 console.log("PASS external-directory protection, deletion/resend serialization and current administrator privilege revalidation.");
 const rollbackTarget=await paused("removal.rollback");const rollbackKey=randomUUID();
 await admin.query("create function public.v336_removal_audit_failure() returns trigger language plpgsql as $$begin if new.action='REMOVE_UNUSED_ACCOUNT' then raise exception 'FICTIONAL_AUDIT_FAILURE';end if;return new;end $$;create trigger v336_removal_audit_failure before insert on public.audit_events for each row execute function public.v336_removal_audit_failure()");
 await assert.rejects(remove(rollbackTarget.id,rollbackKey),e=>e.message==="FICTIONAL_AUDIT_FAILURE");await admin.query("drop trigger v336_removal_audit_failure on public.audit_events;drop function public.v336_removal_audit_failure()");
 assert.equal((await admin.query("select count(*) n from app_auth.accounts where id=$1",[rollbackTarget.id])).rows[0].n,"1");assert.equal((await admin.query("select count(*) n from public.notification_outbox where recipient_id=$1",[rollbackTarget.id])).rows[0].n,"1");assert.equal((await admin.query("select count(*) n from public.mutation_receipts where request_key=$1",[rollbackKey])).rows[0].n,"0");
 console.log("PASS removal audit failure rolls back identity, invitation cleanup and receipt together.");
 // A previous business action is not a permanent deletion ban after current links clear.
 const retainedAudit=(await admin.query("select id,actor_id,entity_type,action,before_data,after_data from public.audit_events where actor_id=$1 and entity_type='fictional_business'",[business.id])).rows;
 await admin.query("update public.organizations set owner_id=$2 where id=$1",[ownedOrganization,superId]);
 assert.equal((await eligibility(business.id)).retentionMode,"AUDIT_IDENTITY");
 await admin.query("insert into app_auth.sessions(user_id,token_hash,csrf_hash,password_version,idle_expires_at,absolute_expires_at) values($1,$2,$3,1,now()+interval '1 hour',now()+interval '2 hours')",[business.id,randomBytes(32).toString('hex'),randomBytes(32).toString('hex')]);
 const retiredKey=randomUUID();assert.equal((await remove(business.id,retiredKey)).status,"REMOVED");assert.equal((await remove(business.id,retiredKey)).status,"REMOVED");
 const stub=(await admin.query("select status,email::text,username::text,purged_at from app_auth.accounts where id=$1",[business.id])).rows[0];assert.equal(stub.status,"DISABLED");assert.ok(stub.email.endsWith('@example.invalid'));assert.notEqual(stub.username,business.username);assert.ok(stub.purged_at);
 for(const [table,column] of [["app_auth.password_credentials","user_id"],["app_auth.sessions","user_id"],["public.user_profiles","user_id"],["public.workspace_memberships","user_id"],["public.sales_team_members","auth_user_id"],["public.notification_outbox","recipient_id"]])assert.equal((await admin.query(`select count(*) n from ${table} where ${column}=$1`,[business.id])).rows[0].n,"0");
 assert.deepEqual((await admin.query("select id,actor_id,entity_type,action,before_data,after_data from public.audit_events where actor_id=$1 and entity_type='fictional_business'",[business.id])).rows,retainedAudit);
 await assert.rejects(getStaffUser(business.id),e=>e.code==="STAFF_USER_NOT_FOUND");await assert.rejects(updateStaffUser(business,{status:"ACTIVE"},actor),e=>e.code==="ROLE_ASSIGNMENT_FORBIDDEN");
 await assert.rejects(admin.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'SALES_SUPPORT')",[workspace,business.id]),e=>e.message==='STAFF_IDENTITY_REMOVED');
 await assert.rejects(admin.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'示例禁止关联','Fictional Rejected Owner',$2,$3)",[workspace,business.id,superId]),e=>e.message==='STAFF_IDENTITY_REMOVED');
 const linkingRace=await paused("ownership.race");await admin.query("insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action) values($1,$2,'fictional_business',$3,'BUSINESS_ACTION')",[workspace,linkingRace.id,randomUUID()]);
 const linkOutcomes=await Promise.allSettled([remove(linkingRace.id),admin.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'示例并发关联','Fictional Concurrent Owner',$2,$3)",[workspace,linkingRace.id,superId])]);assert.equal(linkOutcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.ok(linkOutcomes.filter(r=>r.status==='rejected').every(r=>['BUSINESS_REFERENCES_EXIST','STAFF_IDENTITY_REMOVED'].includes(r.reason.message)));
 console.log("PASS suspend-first deletion, cleared business ownership becomes removable, immutable business audit retains only a disabled login-free identity, no directory/reactivation access.");
 const {verifyStaffRolesAndPerformance}=await import("./lib/test-staff-role-performance.mjs");
 await verifyStaffRolesAndPerformance({admin,execute,create,workspace,otherWorkspace,superId,adminId,team,actor});
 const allocatedStaff=await getStaffUser((await admin.query("select id from app_auth.accounts where username='qualified.sales'")).rows[0].id);
 await pause(allocatedStaff);
 assert.equal((await eligibility(allocatedStaff.id)).status,"BUSINESS_REFERENCES_EXIST");
 await assert.rejects(remove(allocatedStaff.id),e=>e.message==="BUSINESS_REFERENCES_EXIST");
 console.log("PASS approved performance scope and financial contribution still prohibit account removal.");
 const {verifyPersonalGovernance}=await import('./lib/test-personal-governance.mjs');
 await verifyPersonalGovernance({admin,execute,create,workspace,otherWorkspace,superId,team});
 console.log(`PASS disposable lifecycle on ${image}; no application environment or Production.`);
} finally {
 await closePools?.();await admin?.end().catch(()=>{});
 run("docker",["rm","--force",container]);
 for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
