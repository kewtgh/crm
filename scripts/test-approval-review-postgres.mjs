import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import pg from 'pg';

// A new loopback-only tmpfs database. Never load application dotenv or connection strings.
const container=`lumina-crm-approval-it-${randomBytes(5).toString('hex')}`,password=randomBytes(32).toString('hex'),deadline=Date.now()+50_000;
const image=process.env.APPROVAL_TEST_POSTGRES_IMAGE||'postgres:18.6-trixie';assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
const output='work/approval-review-postgres';mkdirSync(output,{recursive:true});
const env={...process.env,NODE_ENV:'test',DATABASE_SSL:'false'};
for(const key of Object.keys(env))if(/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|ENCRYPTION_KEY|HASH_SECRET|WEBHOOK|API_KEY|APP_URL/.test(key))delete env[key];
for(const role of ['APP','SYSTEM','WORKER','MIGRATOR','BACKUP'])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString('hex');
function run(command,args,label,environment=env){
 const result=spawnSync(command,args,{env:environment,encoding:'utf8',windowsHide:true,timeout:Math.max(1,Math.min(18000,deadline-Date.now())),maxBuffer:12*1024*1024});
 writeFileSync(`${output}/${label}.log`,`${result.stdout??''}\n${result.stderr??''}`);
 if(result.error||result.status!==0)throw new Error(`APPROVAL_TEST_SUBPROCESS_FAILED:${label}`);return result.stdout.trim();
}
let client,started=false;const peers=[];
try{
 run('docker',['run','--detach','--rm','--pull=never','--name',container,'--label','com.lumina.crm.test=approval-review','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql:rw,noexec,nosuid,size=768m','--env','POSTGRES_DB=approval_test','--env','POSTGRES_USER=postgres','--env','POSTGRES_PASSWORD',image],'container',{...env,POSTGRES_PASSWORD:password});started=true;
 const port=run('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',container],'port');assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/approval_test`;
 for(let n=0;n<25;n++){client=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch{await client.end().catch(()=>{});client=undefined;if(n===24)throw new Error('APPROVAL_TEST_DATABASE_NOT_READY');await new Promise(resolve=>setTimeout(resolve,200));}}
 env.DATABASE_ADMIN_URL=url;env.MIGRATION_DATABASE_URL=url;
 run(process.execPath,['scripts/db-bootstrap.mjs'],'bootstrap');run(process.execPath,['scripts/db-migrate.mjs'],'migrate');
 console.log('PASS fresh migration chain through approval recovery migration 141.');
 const ws='00000000-0000-4000-8000-000000000001',admin=randomUUID(),admin2=randomUUID(),owner=randomUUID(),lead=randomUUID(),unassigned=randomUUID(),foreign=randomUUID(),otherWs=randomUUID();
 for(const [user,name,role] of [[admin,'admin','ADMIN'],[admin2,'checker','ADMIN'],[owner,'owner','SALES_SPECIALIST'],[lead,'lead','SALES_MANAGER'],[unassigned,'unassigned','SALES_MANAGER'],[foreign,'foreign','ADMIN']]){
  await client.query('insert into app_auth.accounts(id,email,username) values($1,$2,$3)',[user,`approval.${name}@example.test`,`fictional-approval-${name}`]);
  if(user!==foreign)await client.query('insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)',[ws,user,role]);
 }
 await client.query("insert into public.workspaces(id,slug,name) values($1,'fictional-approval-other','Fictional Approval Workspace')",[otherWs]);
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'ADMIN')",[otherWs,foreign]);
 const context=async(user=admin,connection=client,aal='aal2')=>{await connection.query('reset role');await connection.query("select set_config('app.user_id',$1,false),set_config('app.aal',$2,false),set_config('app.workspace_id',$3,false)",[user,aal,user===foreign?otherWs:ws]);await connection.query('set role crm_app');};
 let number=0;
 const seed=async({type='PERFORMANCE_SUMMARY',requester=owner,objectId=randomUUID(),objectType='FICTIONAL_CONTEXT',payload={},reason='Fictional request '+(++number),expires='2099-01-01T00:00:00Z',workspace=ws}={})=>{
  await client.query('reset role');
  return (await client.query("insert into public.approval_requests(workspace_id,request_number,request_type,business_object_type,business_object_id,requester_id,reason,expires_at,request_payload) values($1,$2,$3,$8,$4,$5,$6,$7,$9) returning id",[workspace,'EX-APPROVAL-'+randomUUID(),type,objectId,requester,reason,expires,objectType,JSON.stringify(payload)])).rows[0].id;
 };
 const token=async(id,connection=client)=>(await connection.query('select public.approval_review_token(a) token from public.approval_requests a where id=$1',[id])).rows[0]?.token;
 let custodyTransaction=false;
 const decide=async(id,reviewToken,key=randomUUID(),decision='APPROVED',comment='Fictional review',connection=client)=>{
  if(custodyTransaction)await connection.query('savepoint approval_fixture_attempt');
  try{const result=(await connection.query('select public.decide_approval_command($1,$2,$3,$4,$5) item',[id,reviewToken,decision,comment,key])).rows[0].item;if(custodyTransaction)await connection.query('release savepoint approval_fixture_attempt');return result;}
  catch(error){if(custodyTransaction){await connection.query('rollback to savepoint approval_fixture_attempt');await connection.query('release savepoint approval_fixture_attempt');}throw error;}
 };
 const list=async({q='',type='all',status='pending',scope='all',execution='all',page=1,size=10}={})=>(await client.query('select public.query_approval_workspace($1,$2,$3,$4,$5,$6,$7) item',[q,type,status,scope,execution,page,size])).rows[0].item;
 const ids=[];for(let n=1;n<=25;n++)ids.push(await seed({reason:'Fictional request '+n,expires:n===22||n===23?'2020-01-01T00:00:00Z':undefined}));
 await client.query("update public.approval_requests set status='CANCELLED' where id=$1",[ids[23]]);
 await client.query("update public.approval_requests set status='APPROVED',decided_by=$2,decided_at=now(),execution_status='FAILED',execution_error='Fictional internal diagnostic must remain private' where id=$1",[ids[24],admin]);
 await context();
 const initial=await list();assert.equal(initial.total,21);assert.equal(initial.summary.pending,21);assert.equal(initial.summary.expired,2);assert.equal(initial.summary.cancelled,1);assert.equal(initial.summary.failedExecution,1);
 assert.equal((await list({status:'all'})).total,25);assert.equal((await list({page:3})).items.length,1);assert.equal((await list({q:'Fictional request 1'})).total,11);assert.equal((await list({q:'%'})).total,0);assert.equal((await list({status:'expired'})).items.every(row=>!row.canDecide),true);
 assert.equal((await list({status:'all',execution:'FAILED'})).items[0].id,ids[24]);assert.ok(!JSON.stringify(await list({status:'all'})).includes('Fictional internal diagnostic'));
 assert.equal((await client.query('select public.approval_pending_count() item')).rows[0].item.count,21);
 const originalToken=await token(ids[0]);await client.query("set time zone 'America/New_York'");assert.equal(await token(ids[0]),originalToken);await client.query("set time zone 'UTC'");
 await client.query('reset role');await client.query("update public.approval_requests set reason='Changed fictional review context' where id=$1",[ids[0]]);await context();
 await assert.rejects(decide(ids[0],originalToken),/approval_snapshot_conflict/);
 const fresh=await token(ids[0]),key=randomUUID(),accepted=await decide(ids[0],fresh,key);assert.equal(accepted.status,'approved');assert.equal(accepted.executionStatus,'SUCCEEDED');assert.deepEqual(await decide(ids[0],fresh,key),accepted);
 await assert.rejects(decide(ids[0],fresh,key,'REJECTED','Different fictional decision'),/approval_request_conflict/);
 await assert.rejects(decide(ids[0],fresh),/approval_snapshot_conflict/);
 await client.query('reset role');assert.equal((await client.query('select count(*)::int n from public.approval_actions where approval_request_id=$1',[ids[0]])).rows[0].n,1);assert.equal((await client.query('select count(*)::int n from public.generated_jobs where approval_request_id=$1',[ids[0]])).rows[0].n,1);
 await context();for(const target of [ids[21],ids[23]])await assert.rejects(decide(target,await token(target)),/approval_not_pending/);
 await context(admin,client,'aal1');await assert.rejects(decide(ids[1],fresh),/approval_access_denied|mfa_required/);
 await context(owner);assert.equal((await list({scope:'mine',status:'all'})).total,25);assert.equal((await list({scope:'reviewable'})).total,0);await assert.rejects(decide(ids[0],fresh,key),/approval_access_denied/);
 await context(foreign);assert.equal((await list({status:'all'})).total,0);await assert.rejects(decide(ids[0],fresh,key),/approval_access_denied/);
 console.log('PASS authorized complete pages, expiry/cancellation/counters, minimized history, timezone-stable tokens, stale context and exactly-once decision/execution.');

 await client.query('reset role');
 const team=(await client.query("insert into public.sales_teams(workspace_id,code,name_zh,name_en) values($1,'FICTIONAL-REVIEW','示例审批团队','Fictional Review Team') returning id",[ws])).rows[0].id;
 const members=[];
 for(const [user,role] of [[lead,'SALES_MANAGER'],[owner,'SALES_SPECIALIST']])members.push((await client.query("insert into public.sales_team_members(workspace_id,auth_user_id,name_zh,name_en,role,team,team_id) values($1,$2,'示例成员','Fictional Member',$3,'Fictional Review Team',$4) returning id",[ws,user,role,team])).rows[0].id);
 await client.query('update public.sales_teams set lead_member_id=$2 where id=$1',[team,members[0]]);
 const assigned=await seed(),ownLead=await seed({requester:lead});await client.query("update public.approval_requests set required_role='TEAM_LEAD' where id in ($1,$2)",[assigned,ownLead]);
 await context(lead);assert.equal((await list({scope:'reviewable'})).items.some(row=>row.id===assigned),true);assert.equal((await list({scope:'reviewable'})).items.some(row=>row.id===ownLead),false);
 const leadToken=await token(assigned),leadKey=randomUUID();await decide(assigned,leadToken,leadKey,'REJECTED','Fictional correction needed');
 await context(unassigned);await assert.rejects(decide(assigned,leadToken,leadKey),/approval_access_denied/);
 await client.query('reset role');await client.query('update public.sales_teams set lead_member_id=null where id=$1',[team]);await context(lead);await assert.rejects(decide(assigned,leadToken,leadKey,'REJECTED','Fictional correction needed'),/approval_access_denied/);
 await context();
 for(let n=0;n<2;n++){const peer=new pg.Client({connectionString:url,statement_timeout:5000});await peer.connect();peers.push(peer);await context(admin,peer);}
 const raceToken=await token(ids[1]),race=await Promise.allSettled(peers.map(peer=>decide(ids[1],raceToken,randomUUID(),'APPROVED','Fictional concurrent review',peer)));assert.equal(race.filter(row=>row.status==='fulfilled').length,1);assert.match(race.find(row=>row.status==='rejected').reason.message,/approval_snapshot_conflict/);
 const replayToken=await token(ids[2]),replayKey=randomUUID(),replayed=await Promise.all(peers.map(peer=>decide(ids[2],replayToken,replayKey,'APPROVED','Fictional replay',peer)));assert.deepEqual(replayed[0],replayed[1]);
 await client.query('reset role');await client.query("create function public.approval_test_receipt_failure() returns trigger language plpgsql as $$begin if new.operation='APPROVAL_DECISION' then raise exception 'fictional_receipt_failure';end if;return new;end$$;create trigger approval_test_receipt_failure before insert on public.mutation_receipts for each row execute function public.approval_test_receipt_failure()");await context();
 const rollbackKey=randomUUID();await assert.rejects(decide(ids[3],await token(ids[3]),rollbackKey),/fictional_receipt_failure/);
 await client.query('reset role');assert.equal((await client.query('select status from public.approval_requests where id=$1',[ids[3]])).rows[0].status,'PENDING');assert.equal((await client.query('select count(*)::int n from public.approval_actions where approval_request_id=$1',[ids[3]])).rows[0].n,0);assert.equal((await client.query('select count(*)::int n from public.generated_jobs where approval_request_id=$1',[ids[3]])).rows[0].n,0);assert.equal((await client.query('select count(*)::int n from public.audit_events where request_id=$1',[rollbackKey])).rows[0].n,0);
 await client.query('drop trigger approval_test_receipt_failure on public.mutation_receipts;drop function public.approval_test_receipt_failure()');
 const failedId=await seed({type:'CONTRACT_SIGN'});await context();const failedToken=await token(failedId),failedKey=randomUUID(),failed=await decide(failedId,failedToken,failedKey);assert.equal(failed.accepted,true);assert.equal(failed.status,'approved');assert.equal(failed.executionStatus,'FAILED');assert.deepEqual(await decide(failedId,failedToken,failedKey),failed);
 console.log('PASS current team assignment, non-administrator independence, concurrent decisions/replay, receipt/audit/job rollback and accepted execution failure.');

 await client.query('reset role');const entity=randomUUID();
 await client.query("insert into public.revenue_reporting_profiles(workspace_id,reporting_entity_id,legal_name,accounting_framework,business_timezone,allowed_currencies,cutoff_reference,correction_reference,retention_reference,status,created_by) values($1,$2,'Fictional Reporting Entity','Fictional Framework','Asia/Taipei',array['USD'],'EX-CUTOFF','EX-CORRECTION','EX-RETENTION','ACTIVE',$3)",[ws,entity,admin]);
 const designation=(await client.query("insert into public.revenue_authority_assignments(workspace_id,reporting_entity_id,user_id,authority,effective_from,authority_reference,assigned_by) values($1,$2,$3,'CASH_APPLICATION_MANAGER','2020-01-01T00:00:00Z','EX-AUTHORITY',$4) returning id",[ws,entity,admin,admin2])).rows[0].id;
 // Review authority only: this minimal custody row stays uncommitted, then rolls back.
 // The deferred declaration guard remains enabled; allocation/receipt posting is not exercised.
 await client.query('begin');custodyTransaction=true;
 const payment=(await client.query("insert into public.payments(workspace_id,amount,currency,status,purpose,reporting_entity_id,paid_at) values($1,100,'USD','CONFIRMED','CUSTODY_RECEIPT',$2,now()) returning id",[ws,entity])).rows[0].id;
 const refund=(await client.query("insert into public.refunds(workspace_id,refund_number,payment_id,amount,reason,requested_by) values($1,'EX-APPROVAL-REFUND',$2,10,'Fictional refund',$3) returning id",[ws,payment,owner])).rows[0].id;
 const selfRefundRecord=(await client.query("insert into public.refunds(workspace_id,refund_number,payment_id,amount,reason,requested_by) values($1,'EX-APPROVAL-SELF-REFUND',$2,10,'Fictional independent review test',$3) returning id",[ws,payment,admin])).rows[0].id;
 const refundBasis={type:'REFUND',objectType:'REFUND',payload:{cash_entity:entity,payment,amount:'10.00'}};
 const refundApproval=await seed({...refundBasis,objectId:refund}),selfRefund=await seed({...refundBasis,objectId:selfRefundRecord,requester:admin});
 await client.query('update public.refunds set approval_request_id=$2 where id=$1',[refund,refundApproval]);
 await context(admin2);assert.equal((await list({type:'REFUND'})).items.find(row=>row.id===refundApproval).canDecide,false);await assert.rejects(decide(refundApproval,await token(refundApproval)),/approval_access_denied/);
 await context(admin);assert.equal((await list({type:'REFUND'})).items.find(row=>row.id===selfRefund).canDecide,false);await assert.rejects(decide(selfRefund,await token(selfRefund)),/approval_access_denied/);
 const custodyToken=await token(refundApproval),custodyKey=randomUUID(),custody=await decide(refundApproval,custodyToken,custodyKey);assert.equal(custody.status,'approved');assert.deepEqual(await decide(refundApproval,custodyToken,custodyKey),custody);
 await client.query('reset role');await client.query("update public.revenue_authority_assignments set status='REVOKED',revoked_at=now() where id=$1",[designation]);await context();await assert.rejects(decide(refundApproval,custodyToken,custodyKey),/approval_access_denied/);
 await client.query('reset role');await client.query('rollback');custodyTransaction=false;
 for(const requestType of ['REVENUE_REPORTING_PROFILE','REVENUE_POLICY_VERSION','REVENUE_SERVICE_BINDING','REVENUE_AUTHORITY_ASSIGNMENT','REVENUE_RECOGNITION_CANDIDATE']){
  const domain=await seed({type:requestType});await context();const row=(await list({type:requestType})).items[0];assert.equal(row.id,domain);assert.equal(row.requestType,requestType);assert.equal(row.canDecide,false);await assert.rejects(decide(domain,row.reviewToken),/approval_domain_review_required/);
 }
 await client.query('reset role');const receiptRows=(await client.query("select result::text from public.mutation_receipts where operation='APPROVAL_DECISION'")).rows;for(const row of receiptRows){assert.ok(!row.result.includes('Fictional review'));assert.ok(!row.result.includes('Fictional internal diagnostic'));}
 console.log('PASS custody authority/independence before row locking and receipt replay, specialized revenue routing and minimized receipts.');
 writeFileSync(`${output}/summary.json`,JSON.stringify({passed:true,image,migration:141,externalOperations:0,existingDatabasesTouched:false},null,2));
}finally{
 for(const peer of peers)await peer.end().catch(()=>{});await client?.end().catch(()=>{});
 if(started){const removed=spawnSync('docker',['rm','--force',container],{encoding:'utf8',windowsHide:true,timeout:10000});writeFileSync(`${output}/cleanup.log`,`${removed.stdout??''}\n${removed.stderr??''}`);if(removed.status!==0)throw new Error('APPROVAL_TEST_CONTAINER_CLEANUP_FAILED');console.log('PASS disposable approval container removed.');}
}
