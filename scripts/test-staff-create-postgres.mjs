import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {mkdirSync,writeFileSync} from "node:fs";
import pg from "pg";

// Fresh loopback/tmpfs database only. No dotenv, application credentials or
// existing database is accepted. Child diagnostics never print credentials.
const container=`lumina-staff-create-it-${randomBytes(5).toString("hex")}`;
const database=`staff_create_${randomBytes(5).toString("hex")}`;
const password=randomBytes(32).toString("hex");
const image="postgres:18.4-bookworm";
const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false"};
for(const key of Object.keys(env)) if (/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|INVITATION_CREDENTIAL_ENCRYPTION_KEY|APP_URL|DATABASE_SSL_REJECT_UNAUTHORIZED/.test(key)) delete env[key];
for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"]) env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
function run(command,args,environment=env){const r=spawnSync(command,args,{env:environment,encoding:"utf8",timeout:25000,windowsHide:true});if(r.error||r.status!==0){mkdirSync("work/staff-create-v3353",{recursive:true});writeFileSync("work/staff-create-v3353/subprocess-failure.log",r.stderr||String(r.error));throw new Error(`STAFF_CREATE_TEST_SUBPROCESS_FAILED:${command}`);}return r.stdout.trim();}
let admin,closePools;
const previous={};
try {
 run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=staff-create","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env",`POSTGRES_DB=${database}`,"--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],{...env,POSTGRES_PASSWORD:password});
 const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
 for(let n=0;n<25;n++){admin=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await admin.connect();break;}catch{await admin.end().catch(()=>{});admin=undefined;if(n===24)throw new Error("STAFF_CREATE_TEST_DATABASE_NOT_READY");await new Promise(r=>setTimeout(r,200));}}
 env.DATABASE_ADMIN_URL=url;
 run(process.execPath,["scripts/db-bootstrap.mjs"]);
 env.MIGRATION_DATABASE_URL=`postgresql://crm_migrator:${env.CRM_MIGRATOR_DB_PASSWORD}@127.0.0.1:${port}/${database}`;
 run(process.execPath,["scripts/db-migrate.mjs"]);
 const workspace=randomUUID(),otherWorkspace=randomUUID(),superId=randomUUID(),adminId=randomUUID();
 await admin.query("insert into public.workspaces(id,slug,name) values($1,'staff-create-fictional','Fictional Staff Workspace'),($2,'staff-create-other','Other Fictional Workspace')",[workspace,otherWorkspace]);
 for(const [id,role,name] of [[superId,"SUPER_ADMIN","super"],[adminId,"ADMIN","admin"]]){
  await admin.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)",[id,`${name}@example.test`,name]);
  await admin.query("insert into public.user_profiles(user_id,username,display_name_zh,display_name_en) values($1,$2,'示例管理员','Fictional Administrator')",[id,name]);
  await admin.query("insert into public.workspace_memberships(workspace_id,user_id,role,status) values($1,$2,$3,'ACTIVE')",[workspace,id,role]);
 }
 const team=(await admin.query("insert into public.sales_teams(workspace_id,code,name_zh,name_en,active) values($1,'TEST-TEAM','示例团队','Fictional Team',true) returning id",[workspace])).rows[0].id;
 const inactive=(await admin.query("insert into public.sales_teams(workspace_id,code,name_zh,name_en,active) values($1,'INACTIVE','停用示例','Inactive Fictional Team',false) returning id",[workspace])).rows[0].id;
 const foreign=(await admin.query("insert into public.sales_teams(workspace_id,code,name_zh,name_en,active) values($1,'FOREIGN','外部示例','Other Workspace Team',true) returning id",[otherWorkspace])).rows[0].id;
 const testEnvironment={NODE_ENV:"test",DATABASE_SSL:"false",SYSTEM_DATABASE_URL:`postgresql://crm_system:${env.CRM_SYSTEM_DB_PASSWORD}@127.0.0.1:${port}/${database}`,CRM_WORKSPACE_ID:workspace,APP_URL:"https://crm.example.test",INVITATION_CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString("hex")};
 for(const [key,value] of Object.entries(testEnvironment)){previous[key]=process.env[key];process.env[key]=value;}
 const {createStaffUser}=await import("../lib/admin-users-repository.ts");
 const {closeDatabasePools}=await import("../lib/db/pools.ts");closePools=closeDatabasePools;
 const {decryptInvitationCredential}=await import("../lib/invitation-credential-crypto.mjs");
 const {verifyPassword}=await import("../lib/auth/password.ts");
 const actor={id:superId,role:"SUPER_ADMIN",aal:"aal2",email:"super@example.test",username:"super",displayName:"Fictional Super",displayNameZh:"示例管理",initials:"FS",mfaEnabled:true,emailVerified:true};
 const input=(name,extra={})=>({username:name,email:`${name}@example.test`,displayNameZh:"示例员工",displayNameEn:"Fictional Staff",role:"SALES_SPECIALIST",teamId:team,...extra});
 const tables=["app_auth.accounts","app_auth.password_credentials","public.user_profiles","public.workspace_memberships","public.sales_team_members","public.sales_team_memberships","public.staff_invitation_deliveries","public.notification_outbox","public.audit_events"];
 const counts=async()=>{const result=[];for(const t of tables)result.push((await admin.query(`select count(*) n from ${t}`)).rows[0].n);return result;};
 const role=(await admin.query("select rolbypassrls,rolsuper from pg_roles where rolname='crm_system'")).rows[0];assert.deepEqual(role,{rolbypassrls:false,rolsuper:false});
 assert.equal((await admin.query("select relrowsecurity from pg_class where oid='public.notification_outbox'::regclass")).rows[0].relrowsecurity,true);
 const migration=await readFile(new URL("../db/migrations/202610080127_staff_invitation_outbox_system_insert.sql",import.meta.url),"utf8");
 // Migration 058 dynamically grants an ALL policy on preexisting tables.
 // Prove fresh-schema creation first, then simulate a missing legacy policy
 // only in this disposable database to test the diagnosed deployment state.
 const genericPolicy="crm_internal_"+createHash("md5").update("notification_outbox").digest("hex").slice(0,16);
 assert.equal((await admin.query("select count(*) n from pg_policies where schemaname='public' and tablename='notification_outbox' and policyname=$1",[genericPolicy])).rows[0].n,"1");
 const fresh=await createStaffUser(input("fresh.schema"),actor);assert.equal(fresh.emailDeliveryStatus,"UNCONFIRMED");
 await admin.query(`drop policy "${genericPolicy}" on public.notification_outbox`);
 await admin.query('drop policy "system inserts staff invitation outbox" on public.notification_outbox');
 const before=await counts();
 await assert.rejects(createStaffUser(input("policy-denied"),actor),e=>e.code==="42501");assert.deepEqual(await counts(),before);
 const grantsBefore=(await admin.query("select relacl::text acl from pg_class where oid='public.notification_outbox'::regclass")).rows[0].acl;
 await admin.query(migration);await admin.query(migration);
 assert.equal((await admin.query("select relacl::text acl from pg_class where oid='public.notification_outbox'::regclass")).rows[0].acl,grantsBefore);
 const explicit=(await admin.query("select roles::text[] roles,cmd from pg_policies where schemaname='public' and tablename='notification_outbox' and policyname='system inserts staff invitation outbox'")).rows[0];
 assert.deepEqual(explicit,{roles:["crm_system"],cmd:"INSERT"});
 const result=await createStaffUser(input("created.staff"),actor);assert.equal(result.emailDeliveryStatus,"UNCONFIRMED");assert.equal(result.item.invitationDeliveryStatus,"QUEUED");
 const id=result.item.id;
 for(const [table,column] of [[tables[0],"id"],[tables[1],"user_id"],[tables[2],"user_id"],[tables[3],"user_id"],[tables[4],"auth_user_id"],[tables[6],"user_id"],[tables[7],"recipient_id"]])assert.equal((await admin.query(`select * from ${table} where ${column}=$1`,[id])).rowCount,1);
 const member=(await admin.query("select * from public.sales_team_members where auth_user_id=$1",[id])).rows[0];assert.equal(member.team_id,team);
 const membership=(await admin.query("select * from public.sales_team_memberships where member_id=$1",[member.id])).rows[0];assert.equal(membership.team_id,team);assert.equal(membership.status,"ACTIVE");
 const outbox=(await admin.query("select * from public.notification_outbox where recipient_id=$1",[id])).rows[0];
 const invitation=(await admin.query("select * from public.staff_invitation_deliveries where user_id=$1",[id])).rows[0];
 assert.equal(outbox.template_key,"staff-account-created");assert.equal(outbox.channel,"EMAIL");assert.equal(outbox.status,"PENDING");assert.equal(invitation.status,"QUEUED");assert.equal(invitation.outbox_id,outbox.id);
 const temporary=decryptInvitationCredential(outbox.payload.encryptedTemporaryPassword);assert.equal(temporary.length,24);
 assert.equal(await verifyPassword((await admin.query("select password_hash from app_auth.password_credentials where user_id=$1",[id])).rows[0].password_hash,temporary),true);
 for(const table of tables)assert.ok(!JSON.stringify((await admin.query(`select to_jsonb(t) data from ${table} t`)).rows).includes(temporary),`plaintext in ${table}`);
 console.log("PASS NOBYPASSRLS, policy repair/idempotence, atomic SALES creation, all eight owners and encrypted-only invitation credential.");
 for(const [name,extra] of [["missing.team",{teamId:null}],["invalid.team",{teamId:randomUUID()}],["inactive.team",{teamId:inactive}],["foreign.team",{teamId:foreign}]]){const snapshot=await counts();await assert.rejects(createStaffUser(input(name,extra),actor),e=>e.code==="TEAM_NOT_FOUND");assert.deepEqual(await counts(),snapshot);}
 for(const extra of [{email:result.item.email},{username:result.item.username}]){const snapshot=await counts();await assert.rejects(createStaffUser(input("duplicate.staff",extra),actor),e=>e.code==="STAFF_IDENTITY_TAKEN");assert.deepEqual(await counts(),snapshot);}
 const snapshot=await counts();await assert.rejects(createStaffUser(input("forbidden.admin",{role:"ADMIN",teamId:null}),{...actor,id:adminId,role:"ADMIN"}),e=>e.code==="ROLE_ASSIGNMENT_FORBIDDEN");assert.deepEqual(await counts(),snapshot);
 const administrator=await createStaffUser(input("created.admin",{role:"ADMIN",teamId:null}),actor);assert.equal(administrator.item.role,"ADMIN");assert.equal(administrator.item.teams.length,0);assert.equal(administrator.emailDeliveryStatus,"UNCONFIRMED");assert.equal((await admin.query("select count(*) n from public.sales_team_memberships where member_id=(select id from public.sales_team_members where auth_user_id=$1)",[administrator.item.id])).rows[0].n,"0");
 // Delivery fails after commit: account remains created and UNCONFIRMED response is unchanged.
 await admin.query("set role crm_worker");await admin.query("select public.record_staff_invitation_delivery($1,'FAILED','DELIVERY_NETWORK_ERROR',null)",[invitation.id]);await admin.query("reset role");
 assert.equal((await admin.query("select count(*) n from app_auth.accounts where id=$1",[id])).rows[0].n,"1");assert.equal((await admin.query("select status from public.staff_invitation_deliveries where id=$1",[invitation.id])).rows[0].status,"FAILED");assert.equal(result.emailDeliveryStatus,"UNCONFIRMED");
 const ordinary="staff_create_ordinary";await admin.query(`create role ${ordinary} nologin nosuperuser nobypassrls`);await admin.query(`grant usage on schema public to ${ordinary}; grant insert on public.notification_outbox to ${ordinary}`);
 const arbitrary="insert into public.notification_outbox(workspace_id,recipient_id,channel,template_key,payload) values($1,$2,'EMAIL','arbitrary','{}')";
 for(const denied of [ordinary,"crm_app","crm_worker","crm_system"]){await admin.query(`set role ${denied}`);try{await assert.rejects(admin.query(arbitrary,[workspace,id]),e=>e.code==="42501");}finally{await admin.query("reset role");}}
 await admin.query("set role crm_system");
 try{
  await assert.rejects(admin.query("insert into public.notification_outbox(workspace_id,recipient_id,channel,template_key,payload) values($1,$2,'EMAIL','staff-account-created','{}')",[workspace,id]),e=>e.code==="42501");
  assert.equal((await admin.query("delete from public.notification_outbox where id=$1",[outbox.id])).rowCount,0);
  assert.equal((await admin.query("update public.notification_outbox set payload='{}' where id=$1",[outbox.id])).rowCount,0);
 }finally{await admin.query("reset role");}
 console.log("PASS missing/inactive/foreign teams, duplicates and role denial leave no partial records; teamless ADMIN, post-commit delivery failure, app/ordinary/worker denial and system INSERT-only scope.");
 run(process.execPath,["scripts/test-staff-invitation-rls.mjs"]);
 console.log("PASS existing staff invitation RLS regression (system/worker/app/ordinary/PUBLIC).");
 console.log(`PASS disposable staff-create integration on ${image}; no application environment or Production access.`);
} finally {
 await closePools?.();await admin?.end().catch(()=>{});
 run("docker",["rm","--force",container]);
 for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
