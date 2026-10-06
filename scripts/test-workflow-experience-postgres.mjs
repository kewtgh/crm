import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";
// Disposable local DB only; never loads .env.local or existing application credentials.
const container=`lumina-crm-experience-it-${randomBytes(5).toString("hex")}`,deadline=Date.now()+50_000,password=randomBytes(32).toString("hex");
const image=process.env.SUCCESS_TEST_POSTGRES_IMAGE||"postgres:18.4-bookworm";
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
let client,otherClient;
function run(command,args,env=process.env){const result=spawnSync(command,args,{env,encoding:"utf8",timeout:Math.max(1,Math.min(15_000,deadline-Date.now())),windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed: ${result.stderr.trim()}`);return result.stdout.trim();}
try{
  run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=success","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=lumina_applications_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],{...process.env,POSTGRES_PASSWORD:password});
  const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);assert.match(port,/^\d+$/);
  const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/lumina_applications_test`;
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

  assert.equal((await client.query("select public.academic_progression_year('2026-08-31T15:59:59Z','Asia/Taipei') y")).rows[0].y,2025);
  assert.equal((await client.query("select public.academic_progression_year('2026-08-31T16:00:00Z','Asia/Taipei') y")).rows[0].y,2026);
  assert.equal((await client.query("select public.academic_progression_year('2026-09-01T00:00:00Z','America/New_York') y")).rows[0].y,2025);
  const child=await person(ws,admin,'Student A'),father=await person(ws,admin,'Parent A');
  const y=(await client.query("select extract(year from current_timestamp at time zone business_timezone)::int-case when extract(month from current_timestamp at time zone business_timezone)<9 then 1 else 0 end y from public.workspaces where id=$1",[ws])).rows[0].y;
  const student=(await client.query("insert into public.students(workspace_id,person_id,owner_id,created_by,current_grade,academic_year) values($1,$2,$3,$3,'G5',$4) returning id",[ws,child,admin,(y-1)+'-'+y])).rows[0].id;
  await client.query("insert into public.student_guardian_relationships(workspace_id,student_id,guardian_contact_id,relationship_type,legal_authority,created_by) values($1,$2,$3,'FATHER',false,$4)",[ws,student,father,admin]);
  await client.query("insert into public.grade_progression_rules(workspace_id,from_grade,to_grade,action,active) values($1,'G5','G6','ADVANCE',true) on conflict do nothing",[ws]);
  await context();
  const rows=(await client.query("select * from public.list_student_family_page('Parent A',1,10,'all')")).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].family_members[0].relationship,'FATHER');assert.equal(rows[0].id,student);
  await assert.rejects(client.query('select public.process_annual_student_progression()'),/permission denied/);
  await assert.rejects(client.query("select public.apply_student_progression_internal($1,$2,'illegal')",[ws,randomUUID()]),/permission denied/);
  await client.query('reset role');await client.query("select set_config('app.user_id','',false),set_config('app.workspace_id','',false)");await client.query('set role crm_worker');
  assert.equal((await client.query('select public.process_annual_student_progression() n')).rows[0].n,1);
  assert.equal((await client.query('select public.process_annual_student_progression() n')).rows[0].n,0);
  await client.query('reset role');
  const after=(await client.query('select * from public.students where id=$1',[student])).rows[0];assert.equal(after.current_grade,'G6');assert.equal(after.academic_year,y+'-'+(y+1));
  const batch=(await client.query("select * from public.progression_batches where workspace_id=$1 and execution_source='ANNUAL'",[ws])).rows[0];assert.equal(batch.status,'APPLIED');assert.equal(batch.created_by,null);
  const history=(await client.query('select * from public.student_academic_records where student_id=$1',[student])).rows;assert.equal(history.length,1);assert.equal(history[0].progression_batch_id,batch.id);assert.equal(history[0].created_by,null);
  assert.equal((await client.query('select legal_authority from public.student_guardian_relationships where student_id=$1',[student])).rows[0].legal_authority,false);
  await context(stranger,otherWs);assert.equal((await client.query("select * from public.list_student_family_page('Parent A',1,10,'all')")).rows.length,0);
  await client.query('reset role');await context();assert.equal((await client.query("select public.contact_directory_metrics('', 'all',null,null,null) m")).rows[0].m.total,2);

  await client.query('reset role');
  const org=(await client.query("insert into public.organizations(workspace_id,name_zh,name_en,organization_type,owner_id,created_by) values($1,'Example Education Organization','Example Education Organization','SCHOOL',$2,$2) returning id",[ws,admin])).rows[0].id;
  await context();
  const draft=(await client.query("select * from public.create_buyer_contract('TEST-DRAFT', $1,null,null,current_date,current_date+30,'CNY',20000,1::smallint)",[org])).rows[0];
  draft.updated_at=(await client.query("select public.get_contract_draft_detail($1) item",[draft.id])).rows[0].item.updated_at;
  const edited=(await client.query("select * from public.update_buyer_contract_draft($1,$2,'TEST-EDITED',null,current_date,current_date+60,'CNY',19000)",[draft.id,draft.updated_at])).rows[0];
  assert.equal(edited.contract_value,'19000.00');
  await assert.rejects(client.query("select public.update_buyer_contract_draft($1,$2,'STALE',null,current_date,current_date+60,'CNY',18000)",[draft.id,draft.updated_at]),/contract_version_conflict/);
  assert.equal(Number((await client.query('select count(*) from public.contract_versions where contract_id=$1',[draft.id])).rows[0].count),2);
  await client.query('reset role');await client.query("update public.contracts set status='ACTIVE' where id=$1",[draft.id]);await context();
  await assert.rejects(client.query("select public.update_buyer_contract_draft($1,$2,'ACTIVE-EDIT',null,current_date,current_date+60,'CNY',18000)",[draft.id,edited.updated_at]),/contract_draft_required|contract_not_found/);
  await client.query('reset role');await client.query("update public.students set current_grade='G8' where id=$1",[student]);await client.query("select set_config('app.user_id','',false),set_config('app.workspace_id','',false)");await client.query('set role crm_worker');
  assert.equal((await client.query('select public.process_annual_student_progression() n')).rows[0].n,0);
  await client.query('reset role');assert.equal((await client.query('select current_grade from public.students where id=$1',[student])).rows[0].current_grade,'G8');
  process.stdout.write('PASS: family role search and tenant isolation; annual worker-only progression; immutable annual identity; retry; academic lineage; no guardian-authority inference.\n');
}finally{await client?.end().catch(()=>{});await otherClient?.end().catch(()=>{});spawnSync('docker',['rm','--force',container],{encoding:'utf8',timeout:10000,windowsHide:true});}
