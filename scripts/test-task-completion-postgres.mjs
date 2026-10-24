import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import pg from 'pg';

// Disposable loopback database only. Never load dotenv or inherit application connection strings.
const container=`lumina-crm-task-it-${randomBytes(5).toString('hex')}`;
const password=randomBytes(32).toString('hex'),deadline=Date.now()+50_000;
const image=process.env.TASK_TEST_POSTGRES_IMAGE||'postgres:18.6-trixie';
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
const output='work/task-completion-postgres';mkdirSync(output,{recursive:true});
const env={...process.env,NODE_ENV:'test',DATABASE_SSL:'false'};
for(const key of Object.keys(env))if(/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|ENCRYPTION_KEY|HASH_SECRET|WEBHOOK|API_KEY|APP_URL/.test(key))delete env[key];
for(const role of ['APP','SYSTEM','WORKER','MIGRATOR','BACKUP'])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString('hex');
function run(command,args,label,environment=env){
 const result=spawnSync(command,args,{env:environment,encoding:'utf8',timeout:Math.max(1,Math.min(30_000,deadline-Date.now())),windowsHide:true});
 writeFileSync(`${output}/${label}.log`,`${result.stdout??''}\n${result.stderr??''}`);
 if(result.error||result.status!==0)throw new Error(`TASK_TEST_SUBPROCESS_FAILED:${label}`);return result.stdout.trim();
}
let client,started=false;const peers=[];
try{
 run('docker',['run','--detach','--rm','--pull=never','--name',container,'--label','com.lumina.crm.test=task-completion','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql:rw,noexec,nosuid,size=768m','--env','POSTGRES_DB=task_test','--env','POSTGRES_USER=postgres','--env','POSTGRES_PASSWORD',image],'container',{...env,POSTGRES_PASSWORD:password});started=true;
 const port=run('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',container],'port');assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/task_test`;
 for(let n=0;n<25;n++){client=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch{await client.end().catch(()=>{});client=undefined;if(n===24)throw new Error('TASK_TEST_DATABASE_NOT_READY');await new Promise(resolve=>setTimeout(resolve,200));}}
 env.DATABASE_ADMIN_URL=url;env.MIGRATION_DATABASE_URL=url;
 run(process.execPath,['scripts/db-bootstrap.mjs'],'bootstrap');run(process.execPath,['scripts/db-migrate.mjs'],'migrate');
 console.log('PASS fresh migration chain through task completion migration 138.');
 const ws='00000000-0000-4000-8000-000000000001',actor=randomUUID(),other=randomUUID(),foreign=randomUUID(),otherWs=randomUUID();
 await client.query("insert into app_auth.accounts(id,email,username) values($1,'task.actor@example.test','fictional-task-actor'),($2,'task.other@example.test','fictional-task-other'),($3,'task.foreign@example.test','fictional-task-foreign')",[actor,other,foreign]);
 await client.query("insert into public.workspaces(id,slug,name) values($1,'fictional-task-other','Fictional Task Workspace')",[otherWs]);
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'SALES_SPECIALIST'),($1,$3,'SALES_SPECIALIST'),($4,$5,'SALES_SPECIALIST')",[ws,actor,other,otherWs,foreign]);
 const ids=Array.from({length:12},()=>randomUUID());
 for(const id of ids)await client.query("insert into public.crm_tasks(id,workspace_id,title_zh,title_en,owner_id,created_by,due_at) values($1,$2,'示例任务','Fictional Task',$3,$3,now())",[id,ws,actor]);
 const context=async(connection=client,user=actor,workspace=ws)=>{await connection.query('reset role');await connection.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[user,workspace]);await connection.query('set role crm_app');};
 const row=async(id,connection=client)=>(await connection.query('select * from public.crm_tasks where id=$1',[id])).rows[0];
 const payload=(selected=ids.slice(0,1),revision=1)=>selected.length===1?{operation:'complete',tasks:selected.map(id=>({id,expectedRevision:revision}))}:{operation:'bulkComplete',tasks:selected.map(id=>({id,expectedRevision:revision})),reason:'Fictional verified completion'};
 const command=async(body,key=randomUUID(),connection=client)=>(await connection.query('select public.complete_crm_tasks_command($1,$2) item',[body,key])).rows[0].item;
 await context();
 const workspace=(await client.query('select public.crm_task_workspace() item')).rows[0].item;
 const dashboard=(await client.query('select public.dashboard_snapshot(null) item')).rows[0].item;
 assert.ok(workspace.items.length);assert.ok(workspace.items.every(item=>item.revision===1));assert.ok(dashboard.focusTasks.every(item=>item.revision===1));
 const first=payload(),key=randomUUID(),accepted=await command(first,key),completed=await row(ids[0]);
 assert.deepEqual(accepted,{ids:[ids[0]],affected:1});assert.equal(completed.status,'DONE');assert.equal(completed.revision,2);
 assert.deepEqual(await command(first,key),accepted);assert.deepEqual(await row(ids[0]),completed);
 await client.query('reset role');const audit=await client.query("select count(*)::int n from public.audit_events where action='TASK_COMPLETE' and request_id=$1",[key]);assert.equal(audit.rows[0].n,1);await context();
 await assert.rejects(command({...first,tasks:[{id:ids[0],expectedRevision:2}]},key),/task_request_conflict/);
 await assert.rejects(command(first),/task_version_conflict/);
 await client.query('reset role');await client.query('update public.crm_tasks set title_en=$2 where id=$1',[ids[1],'Fictional amended task']);await context();
 const batch=payload(ids.slice(1,3)),before=await row(ids[2]);await assert.rejects(command(batch),/task_version_conflict/);assert.deepEqual(await row(ids[2]),before);
 const currentBatch={...batch,tasks:[{id:ids[1],expectedRevision:2},{id:ids[2],expectedRevision:1}]};const batchKey=randomUUID();assert.equal((await command(currentBatch,batchKey)).affected,2);assert.equal((await command(currentBatch,batchKey)).affected,2);
 await assert.rejects(command({...payload([ids[3]]),tasks:[{id:ids[3],expectedRevision:1},{id:ids[3],expectedRevision:1}],operation:'bulkComplete',reason:'Fictional duplicate'}),/task_completion_invalid/);
 await assert.rejects(client.query('select public.bulk_complete_crm_tasks($1,$2)',[[ids[3]],'Fictional legacy bypass']),/permission denied/);
 await context(client,other);await assert.rejects(command(first,key),/task_completion_forbidden/);await context(client,foreign,otherWs);await assert.rejects(command(payload([ids[3]])),/task_completion_forbidden/);await context();
 await client.query('reset role');await client.query('update public.crm_tasks set archived_at=now() where id=$1',[ids[4]]);await context();await assert.rejects(command(payload([ids[3],ids[4]])),/task_completion_forbidden/);assert.equal((await row(ids[3])).status,before.status);
 console.log('PASS revisions on every update, dashboard/queue projections, terminal state, atomic stale/archived batches, receipt replay, changed payload, tenant/owner and legacy RPC boundaries.');
 for(let n=0;n<2;n++){const peer=new pg.Client({connectionString:url,statement_timeout:5000});await peer.connect();peers.push(peer);await context(peer);}
 const race=await Promise.allSettled(peers.map(peer=>command(payload([ids[5]]),randomUUID(),peer)));assert.equal(race.filter(item=>item.status==='fulfilled').length,1);assert.match(race.find(item=>item.status==='rejected').reason.message,/task_version_conflict/);
 const sameKey=randomUUID(),same=await Promise.all(peers.map(peer=>command(payload([ids[6]]),sameKey,peer)));assert.deepEqual(same[0],same[1]);assert.equal((await row(ids[6])).revision,2);
 const reverse=ids.slice(9,11),overlap=await Promise.allSettled(peers.map((peer,n)=>command(payload(n?[...reverse].reverse():reverse),randomUUID(),peer)));assert.equal(overlap.filter(item=>item.status==='fulfilled').length,1);assert.match(overlap.find(item=>item.status==='rejected').reason.message,/task_version_conflict/);
 await client.query('reset role');await client.query("create function public.task_test_receipt_failure() returns trigger language plpgsql as $$begin if new.operation='TASK_COMPLETION' then raise exception 'fictional_receipt_failure';end if;return new;end$$;create trigger task_test_receipt_failure before insert on public.mutation_receipts for each row execute function public.task_test_receipt_failure()");await context();
 const rollback=await row(ids[7]),failedKey=randomUUID();await assert.rejects(command(payload([ids[7]]),failedKey),/fictional_receipt_failure/);assert.deepEqual(await row(ids[7]),rollback);
 await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.audit_events where action='TASK_COMPLETE' and request_id=$1",[failedKey])).rows[0].n,0);
 await client.query('reset role');await client.query('drop trigger task_test_receipt_failure on public.mutation_receipts;drop function public.task_test_receipt_failure()');
 await client.query('update public.crm_tasks set owner_id=$2 where id=$1',[ids[0],other]);await context();await assert.rejects(command(first,key),/task_completion_forbidden/);
 await client.query('reset role');await client.query("update public.workspace_memberships set status='SUSPENDED' where workspace_id=$1 and user_id=$2",[ws,actor]);await context();await assert.rejects(command(currentBatch,batchKey),/task_completion_forbidden/);
 console.log('PASS concurrent stale writers, simultaneous exact replay, reverse-order batch locking, receipt/audit rollback and revoked/suspended access on replay.');
 writeFileSync(`${output}/result.json`,JSON.stringify({passed:true,image,migration:138,checks:['revisions','atomic batch','exact replay','concurrency','authorization','receipt rollback']}));
}finally{
 for(const peer of peers)await peer.end().catch(()=>{});await client?.end().catch(()=>{});
 if(started){assert.match(container,/^lumina-crm-task-it-[a-f0-9]{10}$/);const cleanup=spawnSync('docker',['rm','--force',container],{encoding:'utf8',timeout:10000,windowsHide:true});writeFileSync(`${output}/cleanup.log`,`${cleanup.stdout??''}\n${cleanup.stderr??''}`);if(cleanup.status!==0&&!cleanup.stderr?.includes('No such container'))throw new Error('TASK_TEST_CLEANUP_FAILED');}
}
