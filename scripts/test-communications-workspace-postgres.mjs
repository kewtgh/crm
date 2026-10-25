import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import pg from 'pg';

// A new loopback-only tmpfs database. Never load application dotenv or connection strings.
const container=`lumina-crm-comms-it-${randomBytes(5).toString('hex')}`,password=randomBytes(32).toString('hex'),deadline=Date.now()+50_000;
const image=process.env.COMMUNICATION_TEST_POSTGRES_IMAGE||'postgres:18.6-trixie';assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
const output='work/communications-workspace-postgres';mkdirSync(output,{recursive:true});
const env={...process.env,NODE_ENV:'test',DATABASE_SSL:'false'};
for(const key of Object.keys(env))if(/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|ENCRYPTION_KEY|HASH_SECRET|WEBHOOK|API_KEY|APP_URL/.test(key))delete env[key];
for(const role of ['APP','SYSTEM','WORKER','MIGRATOR','BACKUP'])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString('hex');
function run(command,args,label,environment=env){
 const result=spawnSync(command,args,{env:environment,encoding:'utf8',windowsHide:true,timeout:Math.max(1,Math.min(18000,deadline-Date.now())),maxBuffer:12*1024*1024});
 writeFileSync(`${output}/${label}.log`,`${result.stdout??''}\n${result.stderr??''}`);
 if(result.error||result.status!==0)throw new Error(`COMMUNICATION_TEST_SUBPROCESS_FAILED:${label}`);return result.stdout.trim();
}
let client,started=false;const peers=[];
try{
 run('docker',['run','--detach','--rm','--pull=never','--name',container,'--label','com.lumina.crm.test=communications-workspace','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql:rw,noexec,nosuid,size=768m','--env','POSTGRES_DB=comms_test','--env','POSTGRES_USER=postgres','--env','POSTGRES_PASSWORD',image],'container',{...env,POSTGRES_PASSWORD:password});started=true;
 const port=run('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',container],'port');assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/comms_test`;
 for(let n=0;n<25;n++){client=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch{await client.end().catch(()=>{});client=undefined;if(n===24)throw new Error('COMMUNICATION_TEST_DATABASE_NOT_READY');await new Promise(resolve=>setTimeout(resolve,200));}}
 env.DATABASE_ADMIN_URL=url;env.MIGRATION_DATABASE_URL=url;
 run(process.execPath,['scripts/db-bootstrap.mjs'],'bootstrap');run(process.execPath,['scripts/db-migrate.mjs'],'migrate');
 console.log('PASS fresh migration chain through communication recovery migration 140.');
 const ws='00000000-0000-4000-8000-000000000001',actor=randomUUID(),other=randomUUID(),reader=randomUUID(),foreignActor=randomUUID(),foreignWs=randomUUID();
 for(const [id,name] of [[actor,'owner'],[other,'other'],[reader,'reader'],[foreignActor,'foreign']])await client.query('insert into app_auth.accounts(id,email,username) values($1,$2,$3)',[id,`comms.${name}@example.test`,`fictional-comms-${name}`]);
 await client.query("insert into public.workspaces(id,slug,name) values($1,'fictional-comms-other','Fictional Communication Workspace')",[foreignWs]);
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'SALES_SPECIALIST'),($1,$3,'SALES_SPECIALIST'),($1,$4,'OPERATIONS_MANAGER'),($5,$6,'SALES_SPECIALIST')",[ws,actor,other,reader,foreignWs,foreignActor]);
 const contact=(await client.query("insert into public.contacts(workspace_id,name_zh,name_en,email,owner_id,created_by) values($1,'示例联系人','Fictional Contact','comms.contact@example.test',$2,$2) returning id",[ws,actor])).rows[0].id;
 await client.query("insert into public.contact_consents(workspace_id,contact_id,channel,purpose,status,source,obtained_at,created_by,updated_by) values($1,$2,'EMAIL','SERVICE','GRANTED','FICTIONAL_TEST',now(),$3,$3)",[ws,contact,actor]);
 const context=async(connection=client,user=actor,workspace=ws)=>{await connection.query('reset role');await connection.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[user,workspace]);await connection.query('set role crm_app');};
 const command=async(payload,key=randomUUID(),connection=client)=>(await connection.query('select public.communication_workspace_command($1,$2) item',[JSON.stringify(payload),key])).rows[0].item;
 const snapshot=async id=>(await client.query('select public.communication_thread_snapshot($1,null,20) item',[id])).rows[0].item;
 const list=async({q='',status='all',purpose='all',delivery='all',page=1,size=20}={})=>(await client.query('select public.query_communication_inbox($1,$2,$3,$4,$5,$6) item',[q,status,purpose,delivery,page,size])).rows[0].item;
 await context();
 const create={operation:'thread',contactId:contact,subject:'Fictional service conversation',channel:'EMAIL',purpose:'SERVICE'},createKey=randomUUID();
 const created=await command(create,createKey);assert.deepEqual(await command(create,createKey),created);const thread=created.threadId;
 const send={operation:'send',threadId:thread,body:'Fictional service update'},sendKey=randomUUID(),accepted=await command(send,sendKey);assert.equal(accepted.deliveryStatus,'QUEUED');assert.deepEqual(await command(send,sendKey),accepted);
 await assert.rejects(command({...send,body:'Different fictional update'},sendKey),/communication_request_conflict/);
 const inbound={operation:'inbound',threadId:thread,body:'Fictional inbound response'},inKey=randomUUID();const recorded=await command(inbound,inKey);assert.equal(recorded.deliveryStatus,'RECEIVED');assert.deepEqual(await command(inbound,inKey),recorded);
 await client.query('reset role');assert.equal((await client.query('select count(*)::int n from public.communication_messages where thread_id=$1',[thread])).rows[0].n,2);
 await client.query("update public.communication_messages set delivery_status='FAILED',outcome_may_have_been_accepted=false,updated_at=clock_timestamp() where id=$1",[accepted.messageId]);await context();
 const failure=(await snapshot(thread)).messages.find(message=>message.id===accepted.messageId);assert.equal(failure.retryAllowed,true);assert.match(failure.retryToken,/T.*[+-]00:00$/);
 const retry={operation:'retry',messageId:failure.id,expectedUpdatedAt:failure.retryToken},retryKey=randomUUID(),retried=await command(retry,retryKey);assert.equal(retried.deliveryStatus,'QUEUED');assert.deepEqual(await command(retry,retryKey),retried);
 await client.query('reset role');await client.query("update public.communication_messages set delivery_status='FAILED',updated_at=clock_timestamp() where id=$1",[failure.id]);await context();
 assert.deepEqual(await command(retry,retryKey),retried);await assert.rejects(command(retry),/communication_version_conflict/);
 assert.equal((await snapshot(thread)).messages.find(message=>message.id===failure.id).deliveryStatus,'FAILED');
 const later=(await snapshot(thread)).messages.find(message=>message.id===failure.id);
  await client.query('reset role');await client.query('update public.communication_messages set outcome_may_have_been_accepted=true,provider_attempt_count=1,first_provider_attempt_at=now(),last_provider_attempt_at=now(),last_provider_attempt_lease_token=gen_random_uuid() where id=$1',[failure.id]);await context();
 await assert.rejects(command({...retry,expectedUpdatedAt:later.retryToken}),/communication_delivery_not_retryable/);
 await assert.rejects(client.query('select public.requeue_failed_communication_delivery($1)',[failure.id]),/permission denied/);
 assert.equal((await list({delivery:'uncertain'})).total,1);assert.equal((await list({delivery:'failed'})).total,0);
 await client.query('reset role');await client.query("update public.communication_messages set outcome_may_have_been_accepted=false,updated_at=clock_timestamp() where id=$1",[failure.id]);
  await client.query("insert into public.communication_threads(workspace_id,contact_id,subject,channel,purpose,status,assigned_to,created_by) select $1,$2,'Fictional triage '||n,'EMAIL',case when n%2=0 then 'SERVICE' else 'EVENT' end,case when n%3=0 then 'CLOSED' else 'OPEN' end,$3,$3 from generate_series(1,24) n",[ws,contact,actor]);await context();
 assert.equal((await list()).total,25);assert.equal((await list({page:3,size:10})).items.length,5);assert.equal((await list({status:'CLOSED'})).total,8);assert.equal((await list({purpose:'EVENT'})).total,12);assert.equal((await list({status:'CLOSED',purpose:'EVENT'})).total,4);assert.equal((await list({q:'Fictional triage 1'})).total,11);assert.equal((await list({q:'%'})).total,0);assert.equal((await list({delivery:'failed'})).total,1);
 await assert.rejects(list({status:'UNKNOWN'}),/communication_input_invalid/);
 console.log('PASS exact request receipts, message identity, guarded redelivery and complete literal-search/status/purpose/delivery pagination.');
 await client.query('reset role');await client.query("update public.communication_threads set status='CLOSED' where id=$1",[thread]);await client.query("update public.contact_consents set status='REVOKED',revoked_at=now() where contact_id=$1",[contact]);await context();
 assert.deepEqual(await command(send,sendKey),accepted);await assert.rejects(command(send),/communication_thread_not_open/);
 await client.query('reset role');await client.query("update public.communication_threads set status='OPEN' where id=$1",[thread]);await context();await assert.rejects(command(send),/communication_consent_required/);
 await context(client,other);assert.equal((await list()).total,0);await assert.rejects(command(send,sendKey),/communication_access_denied/);await assert.rejects(command(create),/communication_access_denied/);
  await context(client,foreignActor,foreignWs);await assert.rejects(command(send,sendKey),/communication_access_denied/);assert.equal((await list()).total,0);
 await context(client,reader);await assert.rejects(command(create),/communication_access_denied/);assert.equal((await list()).total,0);
  await client.query('reset role');await client.query("insert into public.record_collaborators(workspace_id,resource_type,resource_id,user_id,access_level,granted_by) values($1,'CONTACT',$2,$3,'READ',$4)",[ws,contact,reader,actor]);await context(client,reader);assert.equal((await list()).total,25);assert.equal((await snapshot(thread)).id,thread);
 await context();
 for(let n=0;n<2;n++){const peer=new pg.Client({connectionString:url,statement_timeout:5000});await peer.connect();peers.push(peer);await context(peer);}
 const concurrentKey=randomUUID();const race=await Promise.all(peers.map(peer=>command({...inbound,body:'Fictional concurrent inbound'},concurrentKey,peer)));assert.deepEqual(race[0],race[1]);
 await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.audit_events where action='COMMUNICATION_COMMAND_CONFIRMED' and request_id=$1",[concurrentKey])).rows[0].n,1);
 await client.query("create function public.comms_test_receipt_failure() returns trigger language plpgsql as $$begin if new.operation='COMMUNICATION_WORKSPACE' then raise exception 'fictional_receipt_failure';end if;return new;end$$;create trigger comms_test_receipt_failure before insert on public.mutation_receipts for each row execute function public.comms_test_receipt_failure()");await context();
 const rollbackKey=randomUUID();await assert.rejects(command({...inbound,body:'Fictional rollback inbound'},rollbackKey),/fictional_receipt_failure/);
 await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.communication_messages where body='Fictional rollback inbound'")).rows[0].n,0);assert.equal((await client.query("select count(*)::int n from public.audit_events where request_id=$1",[rollbackKey])).rows[0].n,0);
 await client.query('drop trigger comms_test_receipt_failure on public.mutation_receipts;drop function public.comms_test_receipt_failure()');
 const receipts=(await client.query("select result::text from public.mutation_receipts where operation='COMMUNICATION_WORKSPACE'")).rows;for(const row of receipts){assert.ok(!row.result.includes(send.body));assert.ok(!row.result.includes(inbound.body));}
 await client.query('update public.contacts set owner_id=$2 where id=$1',[contact,other]);await context();await assert.rejects(command(send,sendKey),/communication_access_denied/);
 console.log('PASS current permission/workspace boundaries before replay, closed/consent rules, read-only access, concurrent replay, atomic rollback and minimized receipts.');
 writeFileSync(`${output}/summary.json`,JSON.stringify({passed:true,image,migration:140,externalDeliveries:0,existingDatabasesTouched:false},null,2));
}finally{
 for(const peer of peers)await peer.end().catch(()=>{});await client?.end().catch(()=>{});
 if(started){const removed=spawnSync('docker',['rm','--force',container],{encoding:'utf8',windowsHide:true,timeout:10000});writeFileSync(`${output}/cleanup.log`,`${removed.stdout??''}\n${removed.stderr??''}`);if(removed.status!==0)throw new Error('COMMUNICATION_TEST_CONTAINER_CLEANUP_FAILED');console.log('PASS disposable communication container removed.');}
}
