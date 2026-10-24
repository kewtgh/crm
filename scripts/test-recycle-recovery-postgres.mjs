import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import pg from 'pg';
import {recyclePageSchema} from '../lib/recycle-contract.ts';

// Disposable loopback database only. Never load dotenv or inherit application connection strings.
const container=`lumina-crm-recycle-it-${randomBytes(5).toString('hex')}`;
const password=randomBytes(32).toString('hex'),deadline=Date.now()+50_000;
const image=process.env.RECYCLE_TEST_POSTGRES_IMAGE||'postgres:18.6-trixie';
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
const output='work/recycle-recovery-postgres';mkdirSync(output,{recursive:true});
const env={...process.env,NODE_ENV:'test',DATABASE_SSL:'false'};
for(const key of Object.keys(env))if(/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|ENCRYPTION_KEY|HASH_SECRET|WEBHOOK|API_KEY|APP_URL/.test(key))delete env[key];
for(const role of ['APP','SYSTEM','WORKER','MIGRATOR','BACKUP'])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString('hex');
function run(command,args,label,environment=env){
 const result=spawnSync(command,args,{env:environment,encoding:'utf8',timeout:Math.max(1,Math.min(30_000,deadline-Date.now())),windowsHide:true});
 writeFileSync(`${output}/${label}.log`,`${result.stdout??''}\n${result.stderr??''}`);
 if(result.error||result.status!==0)throw new Error(`RECYCLE_TEST_SUBPROCESS_FAILED:${label}`);return result.stdout.trim();
}
let client,started=false;const peers=[];
try{
 run('docker',['run','--detach','--rm','--pull=never','--name',container,'--label','com.lumina.crm.test=recycle-recovery','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql:rw,noexec,nosuid,size=768m','--env','POSTGRES_DB=recycle_test','--env','POSTGRES_USER=postgres','--env','POSTGRES_PASSWORD',image],'container',{...env,POSTGRES_PASSWORD:password});started=true;
 const port=run('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',container],'port');assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/recycle_test`;
 for(let n=0;n<25;n++){client=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch{await client.end().catch(()=>{});client=undefined;if(n===24)throw new Error('RECYCLE_TEST_DATABASE_NOT_READY');await new Promise(resolve=>setTimeout(resolve,200));}}
 env.DATABASE_ADMIN_URL=url;env.MIGRATION_DATABASE_URL=url;
 run(process.execPath,['scripts/db-bootstrap.mjs'],'bootstrap');run(process.execPath,['scripts/db-migrate.mjs'],'migrate');

 console.log('PASS fresh migration chain through recovery migration 139.');
 const ws='00000000-0000-4000-8000-000000000001',actor=randomUUID(),other=randomUUID(),superId=randomUUID(),adminId=randomUUID(),otherWs=randomUUID();
 for(const [id,name] of [[actor,'owner'],[other,'other'],[superId,'super'],[adminId,'admin']])await client.query('insert into app_auth.accounts(id,email,username) values($1,$2,$3)',[id,`recovery.${name}@example.test`,`fictional-recovery-${name}`]);
 await client.query("insert into public.workspaces(id,slug,name) values($1,'fictional-recovery-other','Fictional Recovery Workspace')",[otherWs]);
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'SALES_SPECIALIST'),($1,$3,'SALES_SPECIALIST'),($1,$4,'SUPER_ADMIN'),($1,$5,'ADMIN')",[ws,actor,other,superId,adminId]);
 const all=(await client.query("insert into public.crm_tasks(workspace_id,title_zh,title_en,owner_id,created_by,archived_at) select $1,'示例回收任务 '||n,'Fictional archived task '||n,$2,$2,now()-interval '40 days'+n*interval '1 second' from generate_series(1,105) n returning id",[ws,actor])).rows.map(row=>row.id);
 assert.equal(all.length,105);
 const recent=(await client.query("insert into public.crm_tasks(workspace_id,title_zh,title_en,owner_id,created_by,archived_at) values($1,'示例近期删除','Fictional recent task',$2,$2,now()-interval '1 day') returning id",[ws,actor])).rows[0].id;
 const otherTask=(await client.query("insert into public.crm_tasks(workspace_id,title_zh,title_en,owner_id,created_by,archived_at) values($1,'示例其他记录','Fictional colleague task',$2,$2,now()) returning id",[ws,other])).rows[0].id;
 const foreign=(await client.query("insert into public.crm_tasks(workspace_id,title_zh,title_en,owner_id,created_by,archived_at) values($1,'示例异工作区','Fictional foreign task',$2,$2,now()) returning id",[otherWs,actor])).rows[0].id;
 const bundle=randomUUID(),product=randomUUID();
 await client.query("insert into public.product_bundles(id,workspace_id,code,name_zh,name_en,created_by,archived_at) values($1,$2,'FICTIONAL-RECOVERY-BUNDLE','示例保留组合','Fictional retained bundle',$3,now()-interval '60 days')",[bundle,ws,superId]);
 await client.query("insert into public.products(id,workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en,created_by,active,lifecycle_status,archived_at) values($1,$2,'FICTIONAL-RECOVERY-PRODUCT','示例产品','Fictional recovery product','TERM','一期','One term',$3,false,'ACTIVE',now())",[product,ws,superId]);
 const context=async(connection=client,user=actor,workspace=ws,aal='aal1')=>{await connection.query('reset role');await connection.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal',$3,false)",[user,workspace,aal]);await connection.query('set role crm_app');};
 const list=async({scope='personal',q='',kind='all',retention='all',page=1,size=20}={})=>recyclePageSchema.parse((await client.query('select public.query_recycle_records($1,$2,$3,$4,$5,$6) item',[scope,q,kind,retention,page,size])).rows[0].item);
 const restore=async(id,token,key=randomUUID(),connection=client,scope='personal',kind='TASK')=>(await connection.query('select public.restore_recycle_record_command($1,$2,$3,$4,$5) item',[scope,kind,id,token,key])).rows[0].item;
 const archivedToken=async id=>(await client.query("select to_char(archived_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') token from public.crm_tasks where id=$1",[id])).rows[0]?.token;
 await context();
 const first=await list({kind:'TASK'}),last=await list({kind:'TASK',page:6});assert.equal(first.total,106);assert.equal(first.items.length,20);assert.equal(last.items.length,6);assert.equal(new Set([...first.items,...last.items].map(row=>row.id)).size,26);
 assert.equal((await list({kind:'TASK',retention:'eligible'})).total,105);assert.equal((await list({kind:'TASK',retention:'retained'})).total,1);assert.equal((await list({q:'Fictional archived task 1',kind:'TASK'})).total,17);
 assert.equal((await list({q:otherTask,kind:'TASK'})).total,0);assert.equal((await list({q:foreign,kind:'TASK'})).total,0);
 await assert.rejects(list({scope:'workspace'}),/recycle_access_denied/);await assert.rejects(list({kind:'UNKNOWN'}),/recycle_input_invalid/);
 const target=last.items[0],key=randomUUID(),accepted=await restore(target.id,target.deletedAt,key);assert.equal(accepted.restored,true);assert.deepEqual(await restore(target.id,target.deletedAt,key),accepted);
 await assert.rejects(restore(target.id,target.deletedAt),/recycle_version_conflict/);
 await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.audit_events where action='RECYCLE_RESTORE_CONFIRMED' and request_id=$1",[key])).rows[0].n,1);
 await client.query('update public.crm_tasks set archived_at=clock_timestamp() where id=$1',[target.id]);const newToken=await archivedToken(target.id);await context();
 await assert.rejects(restore(target.id,target.deletedAt),/recycle_version_conflict/);assert.deepEqual(await restore(target.id,target.deletedAt,key),accepted);
 await client.query('reset role');assert.equal(await archivedToken(target.id),newToken);await context();
 await assert.rejects(restore(target.id,newToken,key),/recycle_request_conflict/);
 await client.query("set time zone 'America/New_York'");assert.deepEqual(await restore(target.id,target.deletedAt,key),accepted);await client.query("set time zone 'UTC'");
 await assert.rejects(client.query("select public.restore_personal_recycle_record('TASK',$1)",[recent]),/permission denied/);await assert.rejects(client.query("select public.restore_crm_recycle_bin('TASK',$1)",[recent]),/permission denied/);
 await context(client,other);await assert.rejects(restore(target.id,target.deletedAt,key),/recycle_access_denied/);await context(client,actor,otherWs);await assert.rejects(restore(foreign,newToken),/recycle_access_denied/);
 await context(client,superId,ws,'aal1');await assert.rejects(list({scope:'workspace'}),/recycle_access_denied/);await context(client,adminId,ws,'aal2');await assert.rejects(list({scope:'workspace'}),/recycle_access_denied/);
 await context(client,superId,ws,'aal2');const core=await list({scope:'workspace',kind:'TASK',q:recent});assert.ok(core.items[0].purgeEligibleAt);const retained=await list({scope:'workspace',kind:'BUNDLE'});assert.equal(retained.items[0].id,bundle);assert.equal(retained.items[0].purgeEligibleAt,null);const overview=await list({scope:'workspace',q:'Fictional'});assert.equal(overview.total,109);
 const productRow=(await list({scope:'workspace',kind:'PRODUCT',q:product})).items[0];await restore(product,productRow.deletedAt,randomUUID(),client,'workspace','PRODUCT');assert.equal((await client.query('select active from public.products where id=$1',[product])).rows[0].active,true);
 const bundleRow=(await list({scope:'workspace',kind:'BUNDLE'})).items[0];await restore(bundle,bundleRow.deletedAt,randomUUID(),client,'workspace','BUNDLE');assert.equal((await list({scope:'workspace',kind:'BUNDLE'})).total,0);
 console.log('PASS global paging beyond 100, exact filtered totals, 44-kind query, personal/workspace scope, cleanup metadata, stale deletion identity, timezone-independent replay and existing product/business restoration.');
 await context();const racing=(await list({kind:'TASK'})).items.find(row=>row.id!==target.id);
 for(let n=0;n<2;n++){const peer=new pg.Client({connectionString:url,statement_timeout:5000});await peer.connect();peers.push(peer);await context(peer);}
 const race=await Promise.allSettled(peers.map(peer=>restore(racing.id,racing.deletedAt,randomUUID(),peer)));assert.equal(race.filter(result=>result.status==='fulfilled').length,1);assert.match(race.find(result=>result.status==='rejected').reason.message,/recycle_version_conflict/);
 const same=(await list({kind:'TASK'})).items.find(row=>row.id!==target.id),sameKey=randomUUID();const replay=await Promise.all(peers.map(peer=>restore(same.id,same.deletedAt,sameKey,peer)));assert.deepEqual(replay[0],replay[1]);
 await client.query('reset role');await client.query("create function public.recovery_test_receipt_failure() returns trigger language plpgsql as $$begin if new.operation='RECYCLE_RESTORE' then raise exception 'fictional_receipt_failure';end if;return new;end$$;create trigger recovery_test_receipt_failure before insert on public.mutation_receipts for each row execute function public.recovery_test_receipt_failure()");await context();
 const rollback=(await list({kind:'TASK'})).items.find(row=>row.id!==target.id),failedKey=randomUUID();await assert.rejects(restore(rollback.id,rollback.deletedAt,failedKey),/fictional_receipt_failure/);assert.ok((await list({kind:'TASK',q:rollback.id})).items.length);
 await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.audit_events where action='RECYCLE_RESTORE_CONFIRMED' and request_id=$1",[failedKey])).rows[0].n,0);await client.query('drop trigger recovery_test_receipt_failure on public.mutation_receipts;drop function public.recovery_test_receipt_failure()');
 await client.query('update public.crm_tasks set owner_id=$2 where id=$1',[same.id,other]);await context();await assert.rejects(restore(same.id,same.deletedAt,sameKey),/recycle_access_denied/);
 await client.query('reset role');await client.query("update public.workspace_memberships set status='SUSPENDED' where workspace_id=$1 and user_id=$2",[ws,actor]);await context();await assert.rejects(restore(target.id,target.deletedAt,key),/recycle_access_denied/);
 console.log('PASS concurrent different intentions, simultaneous exact replay, receipt/audit atomic rollback and current ownership/membership checks before accepted replay.');
 writeFileSync(`${output}/result.json`,JSON.stringify({passed:true,image,migration:139,checks:['global pagination','retention','archive identity','receipt replay','current scope','concurrency','rollback']}));
}finally{
 for(const peer of peers)await peer.end().catch(()=>{});await client?.end().catch(()=>{});
 if(started){assert.match(container,/^lumina-crm-recycle-it-[a-f0-9]{10}$/);const cleanup=spawnSync('docker',['rm','--force',container],{encoding:'utf8',timeout:10000,windowsHide:true});writeFileSync(`${output}/cleanup.log`,`${cleanup.stdout??''}\n${cleanup.stderr??''}`);if(cleanup.status!==0&&!cleanup.stderr?.includes('No such container'))throw new Error('RECYCLE_TEST_CLEANUP_FAILED');}
}
