import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";

// Disposable local DB only; never loads .env.local or existing application credentials.
const container=`lumina-crm-channel-it-${randomBytes(5).toString("hex")}`,deadline=Date.now()+50_000,password=randomBytes(32).toString("hex");
const image=process.env.CHANNEL_TEST_POSTGRES_IMAGE||"postgres:18.6-trixie";
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
 const org=async(workspace=ws,owner=admin)=>(await client.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by,status) values($1,$3,$3,$2,$2,'HEALTHY') returning id",[workspace,owner,randomUUID()])).rows[0].id;
 const contact=async(organization,workspace=ws,owner=admin)=>(await client.query("insert into public.contacts(workspace_id,organization_id,name_zh,name_en,owner_id,created_by,title,decision_role) values($1,$2,'王','Wang',$3,$3,'Counselor','INFLUENCER') returning id",[workspace,organization,owner])).rows[0].id;
 const o=await org(),o2=await org(),foreign=await org(otherWs,stranger),a=await contact(o),b=await contact(o),foreignContact=await contact(foreign,otherWs,stranger),differentContact=await contact(o2);
 const retainedContract=(await client.query("insert into public.contracts(workspace_id,contract_number,organization_id,start_date,end_date,contract_value,owner_id,created_by) values($1,'CHANNEL-RETAINED',$2,current_date,current_date+1,100,$3,$3) returning id",[ws,o,admin])).rows[0].id;
 const retainedSchedule=(await client.query("insert into public.receivable_schedules(workspace_id,contract_id,installment_number,due_date,amount,created_by) values($1,$2,1,current_date,100,$3) returning id",[ws,retainedContract,admin])).rows[0].id;
 const retainedPayment=(await client.query("insert into public.payments(workspace_id,contract_id,receivable_schedule_id,amount,currency) values($1,$2,$3,50,'CNY') returning id",[ws,retainedContract,retainedSchedule])).rows[0].id;
 await client.query("insert into public.refunds(workspace_id,refund_number,payment_id,amount,reason,requested_by) values($1,'CHANNEL-REFUND',$2,10,'Fixture',$3)",[ws,retainedPayment,admin]);
 const save=async(resource,id,revision,data,key=randomUUID(),connection=client)=>(await connection.query('select public.channel_intelligence_save_internal($1,$2,$3,$4,$5) item',[resource,id,revision,data,key])).rows[0].item;
 // Use publicly authorized RPCs, not the private helper.
 const mutation=async(resource,id,revision,data,key=randomUUID(),connection=client)=>{const fn={intelligence:'save_organization_contact_intelligence',relationships:'save_organization_contact_relationship',outcomes:'save_organization_admission_outcome'}[resource];return(await connection.query(`select public.${fn}($1,$2,$3,$4) item`,[id,revision,data,key])).rows[0].item;};
 const intel={organization_id:o,contact_id:a,key_contact_status:'KEY',decision_power_score:null,contribution_score:10,working_style_markdown:'Use data',cooperation_notes:'Private note',potential_notes:''};
 const i=randomUUID(),key=randomUUID();await context();
 const first=await mutation('intelligence',i,null,intel,key);assert.equal(first.decision_power_score,null);assert.equal(first.contribution_score,10);assert.equal((await mutation('intelligence',i,null,intel,key)).revision,1);
 await assert.rejects(save('intelligence',randomUUID(),null,intel),/permission denied/);
 await assert.rejects(mutation('intelligence',i,null,{...intel,contribution_score:100},key),/channel_request_conflict/);
 for(const field of ['decision_power_score','contribution_score'])for(const invalid of [0,9,101])await assert.rejects(mutation('intelligence',randomUUID(),null,{...intel,contact_id:b,[field]:invalid}),/check constraint/);
 for(const n of [10,100,null]){const r=await mutation('intelligence',i,(await client.query('select revision from public.organization_contact_intelligence where id=$1',[i])).rows[0].revision,{...intel,decision_power_score:n,contribution_score:n});assert.equal(r.decision_power_score,n);}
 await assert.rejects(mutation('intelligence',i,1,intel),/channel_version_conflict/);
 await assert.rejects(mutation('intelligence',randomUUID(),null,{...intel,contact_id:differentContact}),/foreign key/);
 await assert.rejects(mutation('intelligence',randomUUID(),null,{...intel,contact_id:foreignContact}),/channel_forbidden|foreign key/);
 const fields={id:o,organization_type:'SCHOOL',roles:['SCHOOL_ENTRY'],partnership_stage:'ACTIVE',primary_contact_id:null,focus_regions:['US'],agreement_expires_on:null,next_action:''};
 const profile=async(data,rev=null)=>(await client.query('select public.save_education_business(\'organizations\',$1,$2,$3) item',[o,rev,data])).rows[0].item;
 let prof=await profile(fields);assert.equal(prof.commercial_tier,null);assert.equal((await client.query('select status from public.organizations where id=$1',[o])).rows[0].status,'HEALTHY');
 for(const tier of ['S','A','B','C','D',null]){prof=await profile({...fields,commercial_tier:tier,partnership_potential_score:tier?100:null},prof.revision);assert.equal(prof.commercial_tier,tier);}
 await assert.rejects(profile({...fields,commercial_tier:'E'},prof.revision),/check constraint/);
 for(const n of [0,9,101])await assert.rejects(profile({...fields,partnership_potential_score:n},prof.revision),/check constraint/);
 prof=await profile({...fields,commercial_tier:'S',partnership_potential_score:10,bd_plan_markdown:'Long term',competitor_analysis_markdown:'Private competitor'},prof.revision);
 prof=await profile({...fields,next_action:'Visit'},prof.revision);assert.equal(prof.commercial_tier,'S');assert.equal(prof.partnership_potential_score,10);assert.equal(prof.bd_plan_markdown,'Long term');
 const metrics=(await client.query("select public.organization_commercial_metrics('','all','S',true,null,10) item")).rows[0].item;assert.equal(metrics.total,1);
 for(const bad of [{grade_min:12,grade_max:7},{tuition_min:100,tuition_max:50,tuition_currency:'CNY'},{tuition_min:10,tuition_currency:null}])await assert.rejects(profile({...fields,...bad},prof.revision),/check constraint/);
 const stamp=(await client.query('select updated_at::text stamp from public.contacts where id=$1',[a])).rows[0].stamp;
 assert.equal((await client.query("select (public.save_contact_communication($1,$2,'wx_123')).wechat_id w",[a,stamp])).rows[0].w,'wx_123');await assert.rejects(client.query("select public.save_contact_communication($1,$2,'stale')",[a,stamp]),/channel_version_conflict/);
 const outcome={organization_id:o,academic_year:'2026',destination_region:'UNITED_STATES',offer_count:null,matriculation_count:0,notable_destinations:['UC Davis'],source_note:'Published',as_of_date:null},outId=randomUUID();
 const out=await mutation('outcomes',outId,null,outcome);assert.equal(out.offer_count,null);assert.equal(out.matriculation_count,0);
 assert.equal((await mutation('outcomes',outId,1,{...outcome,offer_count:0})).offer_count,0);await assert.rejects(mutation('outcomes',outId,1,outcome),/channel_version_conflict/);
 await assert.rejects(mutation('outcomes',randomUUID(),null,{...outcome,organization_id:foreign}),/channel_forbidden/);
 const relation={organization_id:o,source_contact_id:a,target_contact_id:b,relationship_type:'REPORTS_TO',status:'ACTIVE',note:'Internal'},rid=randomUUID();
 await mutation('relationships',rid,null,relation);await assert.rejects(mutation('relationships',randomUUID(),null,{...relation,target_contact_id:a}),/check constraint/);
 await assert.rejects(mutation('relationships',randomUUID(),null,{...relation,target_contact_id:differentContact}),/foreign key/);
 await assert.rejects(mutation('relationships',randomUUID(),null,relation),/duplicate key/);
 await assert.rejects(mutation('relationships',randomUUID(),null,{...relation,source_contact_id:b,target_contact_id:a}),/channel_reporting_cycle/);
 const peer=randomUUID();await mutation('relationships',peer,null,{...relation,relationship_type:'PEER'});
 await assert.rejects(mutation('relationships',randomUUID(),null,{...relation,relationship_type:'PEER',source_contact_id:b,target_contact_id:a}),/duplicate key/);
 await mutation('relationships',peer,1,{...relation,relationship_type:'PEER',status:'INACTIVE'});
 await mutation('relationships',randomUUID(),null,{...relation,relationship_type:'PEER',source_contact_id:b,target_contact_id:a});
 await assert.rejects(mutation('relationships',rid,1,{...relation,relationship_type:'OTHER'}),/channel_parent_immutable/);
 assert.equal((await client.query('select has_key_contact from public.organization_commercial_records where id=$1',[o])).rows[0].has_key_contact,true);
 // Atomicity: audit failure must roll back row and receipt.
 await client.query('reset role');await client.query("create function public.fail_channel_audit() returns trigger language plpgsql as $$ begin if new.action like 'CONTACT_INTELLIGENCE_%' then raise exception 'channel_audit_failure';end if;return new;end $$;create trigger fail_channel_audit before insert on public.audit_events for each row execute function public.fail_channel_audit()");await context();const before=(await client.query('select revision from public.organization_contact_intelligence where id=$1',[i])).rows[0].revision,failedKey=randomUUID();await assert.rejects(mutation('intelligence',i,before,{...intel,working_style_markdown:'Changed'},failedKey),/channel_audit_failure/);assert.equal((await client.query('select revision from public.organization_contact_intelligence where id=$1',[i])).rows[0].revision,before);await client.query('reset role');assert.equal((await client.query('select count(*)::int n from public.mutation_receipts where request_key=$1',[failedKey])).rows[0].n,0);await client.query('drop trigger fail_channel_audit on public.audit_events');await context();
 // Contextual findings, no low-score warning, resolution after fixing missing assessment.
 await client.query('select public.run_data_quality_rules()');const missing=async()=>(await client.query("select count(*)::int n from public.data_quality_issues where entity_id=$1 and rule_key='KEY_CONTACT_WITHOUT_DECISION_POWER' and status='OPEN'",[a])).rows[0].n;assert.equal(await missing(),1);
 await mutation('intelligence',i,before,{...intel,decision_power_score:20,contribution_score:20});await client.query('select public.run_data_quality_rules()');assert.equal(await missing(),0);
 // All five contextual rules: missing facts warn, low confirmed values do not.
 await client.query('select public.save_education_business(\'organizations\',$1,null,$2)',[o2,{...fields,id:o2,commercial_tier:'S'}]);
 await client.query('reset role');await client.query('update public.organizations set owner_id=null where id=$1',[o2]);await client.query("update public.contacts set decision_role='UNKNOWN' where id=$1",[a]);await context();await client.query('select public.run_data_quality_rules()');
 for(const [rule,entity] of [['STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT',o2],['HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION',o2],['CHANNEL_ACCOUNT_WITHOUT_OWNER',o2],['KEY_CONTACT_WITHOUT_DECISION_ROLE',a]]){const issue=(await client.query('select severity from public.data_quality_issues where rule_key=$1 and entity_id=$2 and status=\'OPEN\'',[rule,entity])).rows;assert.equal(issue.length,1);assert.equal(issue[0].severity,'MEDIUM');}
 await client.query('reset role');await client.query("update public.organization_business_profiles set commercial_tier='D' where id=$1",[o2]);await client.query("update public.contacts set decision_role='INFLUENCER' where id=$1",[a]);await context();await client.query('select public.run_data_quality_rules()');assert.equal((await client.query("select count(*)::int n from public.data_quality_issues where entity_id=$1 and rule_key in ('STRATEGIC_ACCOUNT_WITHOUT_KEY_CONTACT','HIGH_TIER_ACCOUNT_WITHOUT_NEXT_ACTION') and status='OPEN'",[o2])).rows[0].n,0);
 const audit=(await client.query("select after_data from public.audit_events where action in ('ORGANIZATION_COMMERCIAL_PROFILE_UPDATED','CONTACT_INTELLIGENCE_CREATED','CONTACT_RELATIONSHIP_CREATED','ORGANIZATION_ADMISSION_OUTCOME_CREATED')")).rows;assert.ok(audit.length>=4);assert.ok(!JSON.stringify(audit).includes('Private competitor'));assert.ok(!JSON.stringify(audit).includes('Private note'));
 // Same tenant is insufficient: visible Organization cannot reveal inaccessible contact endpoints.
 await client.query('reset role');await client.query('update public.organizations set owner_id=$1 where id=$2',[sales,o]);await client.query('update public.contacts set owner_id=$1 where id=$2',[sales,a]);await context(sales);
 assert.equal((await client.query('select count(*)::int n from public.organization_contact_intelligence')).rows[0].n,1);
 assert.equal((await client.query('select count(*)::int n from public.organization_contact_relationship_records')).rows[0].n,0);
 assert.equal((await client.query('select count(*)::int n from public.organization_commercial_contact_records')).rows[0].n,1);
 await assert.rejects(mutation('relationships',randomUUID(),null,{...relation,relationship_type:'OTHER'}),/channel_forbidden/);
 await context(stranger,otherWs);for(const table of ['organization_contact_intelligence','organization_contact_relationships','organization_admission_outcomes'])assert.equal((await client.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
 await assert.rejects(mutation('intelligence',i,5,intel),/channel_forbidden/);
 await context();await assert.rejects(client.query("update public.organization_contact_intelligence set contribution_score=80 where id=$1",[i]),/permission denied/);
 // Concurrent revision updates serialize and stale request cannot overwrite.
 otherClient=new pg.Client({connectionString,statement_timeout:5000});await otherClient.connect();await context(admin,ws,otherClient);const rev=(await client.query('select revision from public.organization_contact_intelligence where id=$1',[i])).rows[0].revision;
 const race=await Promise.allSettled([mutation('intelligence',i,rev,{...intel,decision_power_score:50}),mutation('intelligence',i,rev,{...intel,decision_power_score:60},randomUUID(),otherClient)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.match(race.find(r=>r.status==='rejected').reason.message,/channel_version_conflict/);
 // Privacy marker cleans personal data and receipts while retaining organization/outcomes.
 await client.query('reset role');const retained={};for(const table of ['organizations','organization_admission_outcomes','students','contracts','receivable_schedules','payments','refunds'])retained[table]=(await client.query(`select count(*)::int n from public.${table}`)).rows[0].n;
 await client.query("update public.contacts set do_not_contact_reason='PRIVACY_DELETION:channel' where id=$1",[a]);assert.equal((await client.query('select count(*)::int n from public.organization_contact_intelligence where contact_id=$1',[a])).rows[0].n,0);assert.equal((await client.query('select count(*)::int n from public.organization_contact_relationships where source_contact_id=$1 or target_contact_id=$1',[a])).rows[0].n,0);assert.equal((await client.query("select count(*)::int n from public.mutation_receipts where operation like 'CHANNEL_%' and (result->'item'->>'contact_id'=$1 or result->'item'->>'source_contact_id'=$1 or result->'item'->>'target_contact_id'=$1)",[a])).rows[0].n,0);
 for(const table of Object.keys(retained))assert.equal((await client.query(`select count(*)::int n from public.${table}`)).rows[0].n,retained[table]);
 await context();await assert.rejects(client.query("select public.save_contact_communication($1,now(),'do-not-restore')",[a]),/channel_forbidden/);
 console.log('PASS Channel PostgreSQL: nullable human tiers/scores, legacy payload preservation, unknown/zero outcomes, same-org composite FKs, directed/symmetric relations, cycle, strict revision/retry, RLS hidden endpoints and tenant isolation, audit rollback/minimization, contextual DQ resolution, privacy retention');
}finally{if(otherClient)await otherClient.end().catch(()=>{});if(client)await client.end().catch(()=>{});assert.match(container,/^lumina-crm-channel-it-[a-f0-9]{10}$/);spawnSync('docker',['rm','--force',container],{encoding:'utf8',timeout:10000,windowsHide:true});}
