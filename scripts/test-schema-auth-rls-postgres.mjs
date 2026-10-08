import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import pg from "pg";

// Reproduce the exact CI schema/auth commands on a fresh loopback-only database.
// No dotenv or application database is accepted; diagnostics stay in ignored work/.
const container=`ewaya-schema-auth-it-${randomBytes(5).toString("hex")}`;
const database=`schema_auth_${randomBytes(5).toString("hex")}`;
const password=randomBytes(32).toString("hex"),image="postgres:18.4-bookworm";
const evidence="work/schema-auth-rls";
mkdirSync(evidence,{recursive:true});
const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false"};
for(const key of Object.keys(env))if(/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|ENCRYPTION_KEY|HASH_SECRET|WEBHOOK|RESEND_API_KEY|APP_URL/.test(key))delete env[key];
for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
for(const key of ["TOTP_ENCRYPTION_KEY","INVITATION_CREDENTIAL_ENCRYPTION_KEY","LOGIN_THROTTLE_HASH_SECRET","TRUSTED_DEVICE_HASH_SECRET"])env[key]=randomBytes(32).toString("hex");
function run(command,args,label,environment=env){
 const result=spawnSync(command,args,{env:environment,encoding:"utf8",timeout:30000,windowsHide:true});
 writeFileSync(`${evidence}/${label}.log`,`${result.stdout||""}\n${result.stderr||""}`);
 if(result.error||result.status!==0)throw new Error(`SCHEMA_AUTH_SUBPROCESS_FAILED:${label}`);
 return result.stdout.trim();
}
let admin,started=false;
try{
 run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=schema-auth","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env",`POSTGRES_DB=${database}`,"--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],"container",{...env,POSTGRES_PASSWORD:password});started=true;
 const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container],"port");assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
 for(let n=0;n<25;n++){admin=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await admin.connect();break;}catch{await admin.end().catch(()=>{});admin=undefined;if(n===24)throw new Error("SCHEMA_AUTH_DATABASE_NOT_READY");await new Promise(resolve=>setTimeout(resolve,200));}}
 env.DATABASE_ADMIN_URL=url;
 run(process.execPath,["scripts/db-bootstrap.mjs"],"bootstrap");
 const connection=role=>`postgresql://crm_${role.toLowerCase()}:${env[`CRM_${role}_DB_PASSWORD`]}@127.0.0.1:${port}/${database}`;
 env.MIGRATION_DATABASE_URL=connection("MIGRATOR");env.SYSTEM_DATABASE_URL=connection("SYSTEM");env.DATABASE_URL=connection("APP");env.WORKER_DATABASE_URL=connection("WORKER");
 run(process.execPath,["scripts/db-migrate.mjs"],"migrate");
 console.log("PASS fresh migration chain applied on disposable PostgreSQL.");
 run(process.execPath,["scripts/db-validate.mjs"],"validate");
 console.log("PASS exact CI db:validate, all constraints/indexes valid and least-privilege roles intact.");
 const workspace=randomUUID(),actor=randomUUID(),document=randomUUID(),organization=randomUUID(),contract=randomUUID();env.CRM_WORKSPACE_ID=workspace;
 await admin.query("insert into public.workspaces(id,slug,name) values($1,'schema-auth-fictional','Fictional Schema Workspace')",[workspace]);
 await admin.query("insert into app_auth.accounts(id,email,username) values($1,'receipt.actor@example.test','fictional.receipt.actor')",[actor]);
 await admin.query("insert into public.organizations(id,workspace_id,name_zh,name_en,created_by) values($1,$2,'示例校验机构','Fictional Schema Organization',$3)",[organization,workspace,actor]);
 await admin.query("insert into public.contracts(id,workspace_id,organization_id,contract_number,start_date,end_date,contract_value,created_by) values($1,$2,$3,'FIC-SCHEMA-0001','2030-01-01','2030-12-31',0,$4)",[contract,workspace,organization,actor]);
 await admin.query("insert into public.uploaded_contract_documents(id,workspace_id,source_kind,source_id,source_revision,context,privacy_contacts,filename,format,mime_type,bytes,sha256,storage_key,status,uploaded_by) values($1,$2,'CUSTOMER_CONTRACT',$3,1,'{}','[]','fictional-receipt.pdf','PDF','application/pdf',1,$4,'fictional/schema-receipt.pdf','UPLOADED',$5)",[document,workspace,contract,"0".repeat(64),actor]);
 const insertReceipt="insert into public.uploaded_contract_receipts values($1,$2,$3,$4,$5)";
 await admin.query(insertReceipt,[workspace,actor,"valid-actor-receipt","1".repeat(64),document]);
 const forward=readFileSync("db/migrations/202610080131_validate_uploaded_receipt_actor.sql","utf8");
 const stageFk=async()=>{await admin.query("alter table public.uploaded_contract_receipts drop constraint uploaded_receipt_actor_account_fk;alter table public.uploaded_contract_receipts add constraint uploaded_receipt_actor_account_fk foreign key(actor_id) references app_auth.accounts(id) on delete restrict not valid");};
 await admin.query("begin");try{await stageFk();const before=(await admin.query("select * from public.uploaded_contract_receipts order by request_key")).rows;await admin.query(forward);await admin.query(forward);assert.deepEqual((await admin.query("select * from public.uploaded_contract_receipts order by request_key")).rows,before);assert.equal((await admin.query("select convalidated from pg_constraint where conrelid='public.uploaded_contract_receipts'::regclass and conname='uploaded_receipt_actor_account_fk'")).rows[0].convalidated,true);}finally{await admin.query("rollback");}
 await admin.query("begin");try{
  await admin.query("alter table public.uploaded_contract_receipts drop constraint uploaded_receipt_actor_account_fk");
  const orphan=randomUUID();await admin.query(insertReceipt,[workspace,orphan,"legacy-orphan-receipt","2".repeat(64),document]);
  await admin.query("alter table public.uploaded_contract_receipts add constraint uploaded_receipt_actor_account_fk foreign key(actor_id) references app_auth.accounts(id) on delete restrict not valid");
  await admin.query("savepoint before_review");
  await assert.rejects(admin.query(forward),error=>error.code==="23503"&&error.message==="UPLOADED_RECEIPT_ACTOR_ORPHANS_REQUIRE_REVIEW");
  await admin.query("rollback to savepoint before_review");
  assert.equal((await admin.query("select count(*)::int n from public.uploaded_contract_receipts where actor_id=$1",[orphan])).rows[0].n,1);
 }finally{await admin.query("rollback");}
 console.log("PASS staged-FK upgrade preserves receipt bytes, is repeatable, and rejects legacy orphans without backfill or deletion.");
 await assert.rejects(admin.query(insertReceipt,[workspace,randomUUID(),"rejected-new-actor","3".repeat(64),document]),error=>error.code==="23503");
 run(process.execPath,["--import","tsx","scripts/db-integration-smoke.ts"],"smoke");
 console.log("PASS exact CI db:smoke: authentication, sessions, TOTP/replay, RLS, profile atomicity and delivery idempotency.");
 console.log(`PASS disposable schema/auth/RLS on ${image}; no application environment or Production.`);
}finally{
 await admin?.end().catch(()=>{});
 if(started)run("docker",["rm","--force",container],"cleanup");
}
