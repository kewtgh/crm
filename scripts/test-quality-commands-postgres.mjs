import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import pg from "pg";

// Fresh loopback-only, temporary storage. Never reads dotenv or an application database URL.
const container=`lumina-crm-quality-it-${randomBytes(5).toString("hex")}`,password=randomBytes(32).toString("hex");
const image=process.env.QUALITY_TEST_POSTGRES_IMAGE||"postgres:18.6-trixie",deadline=Date.now()+50_000;
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
const output="work/quality-actions-postgres";mkdirSync(output,{recursive:true});
writeFileSync(`${output}/container.json`,JSON.stringify({container,image}));
const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false"};
for(const key of Object.keys(env))if(/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|ENCRYPTION_KEY|HASH_SECRET|WEBHOOK|API_KEY|APP_URL/.test(key))delete env[key];
for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
function run(command,args,label,environment=env){const result=spawnSync(command,args,{env:environment,encoding:"utf8",timeout:Math.max(1,Math.min(30_000,deadline-Date.now())),windowsHide:true});writeFileSync(`${output}/${label}.log`,`${result.stdout??""}\n${result.stderr??""}`);if(result.error||result.status!==0)throw new Error(`QUALITY_TEST_SUBPROCESS_FAILED:${label}`);return result.stdout.trim();}
let client,started=false;const peers=[];
try{
 run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=quality-actions","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=quality_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],"container",{...env,POSTGRES_PASSWORD:password});started=true;
 const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container],"port");assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/quality_test`;
 for(let n=0;n<25;n++){client=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch{await client.end().catch(()=>{});client=undefined;if(n===24)throw new Error("QUALITY_TEST_DATABASE_NOT_READY");await new Promise(resolve=>setTimeout(resolve,200));}}
 env.DATABASE_ADMIN_URL=url;env.MIGRATION_DATABASE_URL=url;
 run(process.execPath,["scripts/db-bootstrap.mjs"],"bootstrap");run(process.execPath,["scripts/db-migrate.mjs"],"migrate");
 console.log("PASS current migration chain including quality action receipts on a fresh disposable database.");

 const ws="00000000-0000-4000-8000-000000000001",actor=randomUUID(),viewer=randomUUID(),foreign=randomUUID(),otherWs=randomUUID(),contact=randomUUID();
 await client.query("insert into app_auth.accounts(id,email,username) values($1,'quality.actor@example.test','fictional-quality-actor'),($2,'quality.viewer@example.test','fictional-quality-viewer'),($3,'quality.foreign@example.test','fictional-quality-foreign')",[actor,viewer,foreign]);
 await client.query("insert into public.workspaces(id,slug,name) values($1,'quality-other','Fictional Quality Workspace')",[otherWs]);
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'ADMIN'),($1,$3,'SALES_SPECIALIST'),($4,$5,'ADMIN')",[ws,actor,viewer,otherWs,foreign]);
 await client.query("insert into public.contacts(id,workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,'示例联系人','Fictional Contact',$3,$3)",[contact,ws,actor]);
 const context=async(connection=client,user=actor,workspace=ws)=>{await connection.query("reset role");await connection.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[user,workspace]);await connection.query("set role crm_app");};await context();
 const command=async(payload,key=randomUUID(),connection=client)=>(await connection.query("select public.execute_quality_command($1,$2) item",[payload,key])).rows[0].item;
 const issue=async()=>(await client.query("select * from public.data_quality_issues where workspace_id=$1 and entity_id=$2::uuid and rule_key='CONTACT_METHOD_MISSING'",[ws,contact])).rows[0];
 const scanKey=randomUUID();await command({operation:'run'},scanKey);const observed=await issue();assert.ok(observed);assert.equal(observed.status,'OPEN');await command({operation:'run'},scanKey);assert.deepEqual(await issue(),observed);
 const invalidKey=randomUUID();await assert.rejects(command({operation:'resolve',id:observed.id,expectedRevision:observed.revision,resolution:'Source must be fixed',dismiss:false},invalidKey),/quality_source_not_fixed/);assert.deepEqual(await issue(),observed);
 const assignPayload={operation:'assign',id:observed.id,expectedRevision:observed.revision},assignKey=randomUUID(),assigned=await command(assignPayload,assignKey);assert.equal(assigned.status,'ASSIGNED');assert.equal(assigned.assigned_to,actor);assert.ok(assigned.revision>observed.revision);assert.deepEqual(await command(assignPayload,assignKey),assigned);
 await assert.rejects(command({...assignPayload,expectedRevision:assigned.revision},assignKey),/quality_request_conflict/);await assert.rejects(command(assignPayload),/quality_version_conflict/);
 await client.query('reset role');await client.query("update public.contacts set email='contact@example.test' where id=$1",[contact]);await context();
 const resolvePayload={operation:'resolve',id:observed.id,expectedRevision:assigned.revision,resolution:'Verified fictional source correction',dismiss:false},resolveKey=randomUUID(),resolved=await command(resolvePayload,resolveKey);assert.equal(resolved.status,'RESOLVED');assert.equal(resolved.resolution_note,resolvePayload.resolution);assert.deepEqual(await command(resolvePayload,resolveKey),resolved);
 await assert.rejects(command({operation:'assign',id:observed.id,expectedRevision:resolved.revision}),/quality_version_conflict/);
 await client.query('reset role');assert.equal((await client.query('select count(*)::int n from public.mutation_receipts where request_key=$1',[invalidKey])).rows[0].n,0);await client.query("update public.contacts set email=null where id=$1",[contact]);await context();await command({operation:'run'});const reopened=await issue();assert.equal(reopened.status,'OPEN');assert.ok(reopened.revision>resolved.revision);
 const getRule=async()=>(await client.query("select * from public.data_quality_rule_configs where workspace_id=$1 and rule_key='CONTACT_METHOD_MISSING'",[ws])).rows[0];
 const rule=await getRule(),configure={operation:'configure',ruleKey:rule.rule_key,expectedRevision:rule.revision,enabled:true,severity:'LOW'},configKey=randomUUID(),configured=await command(configure,configKey);assert.equal(configured.severity,'LOW');assert.deepEqual(await command(configure,configKey),configured);await assert.rejects(command(configure),/quality_version_conflict/);
 await assert.rejects(client.query('select public.run_data_quality_rules()'),/permission denied/);await assert.rejects(client.query("update public.data_quality_issues set status='RESOLVED' where id=$1",[observed.id]),/permission denied/);
 await context(client,viewer);await assert.rejects(command({operation:'run'},scanKey),/quality_not_authorized/);await context(client,foreign,otherWs);await assert.rejects(command({...assignPayload,expectedRevision:reopened.revision}),/quality_version_conflict/);await context();
 console.log('PASS active/history lifecycle, source-not-fixed rejection and rollback, verified resolution, scan reopening, exact replay, stale rule/finding revisions, role/tenant and legacy-write boundaries.');
 for(let n=0;n<2;n++){const peer=new pg.Client({connectionString:url,statement_timeout:5000});await peer.connect();peers.push(peer);await context(peer);}
 const raced=await Promise.allSettled(peers.map(peer=>command({operation:'assign',id:reopened.id,expectedRevision:reopened.revision},randomUUID(),peer)));assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);assert.match(raced.find(result=>result.status==='rejected').reason.message,/quality_version_conflict/);
 await client.query('reset role');await client.query("create function public.quality_test_receipt_failure() returns trigger language plpgsql as $$begin if new.operation='QUALITY_COMMAND' then raise exception 'fictional_receipt_failure';end if;return new;end$$;create trigger quality_test_receipt_failure before insert on public.mutation_receipts for each row execute function public.quality_test_receipt_failure()");await context();const before=await getRule();await assert.rejects(command({...configure,expectedRevision:before.revision,severity:'HIGH'}),/fictional_receipt_failure/);assert.deepEqual(await getRule(),before);await client.query('reset role');await client.query('drop trigger quality_test_receipt_failure on public.mutation_receipts;drop function public.quality_test_receipt_failure()');await client.query("update public.workspace_memberships set status='SUSPENDED' where workspace_id=$1 and user_id=$2",[ws,actor]);await context();await assert.rejects(command({operation:'run'},scanKey),/quality_not_authorized/);
 console.log('PASS simultaneous stale mutation, receipt-failure atomic rollback and suspended-actor replay denial.');
 writeFileSync(output+'/result.json',JSON.stringify({passed:true,image,checks:['migration','source verification','receipt replay','revisions','closure/reopening','tenant/role','concurrency','atomic rollback']}));
}finally{
 for(const peer of peers)await peer.end().catch(()=>{});await client?.end().catch(()=>{});
 if(started){assert.match(container,/^lumina-crm-quality-it-[a-f0-9]{10}$/);const cleanup=spawnSync('docker',['rm','--force',container],{encoding:'utf8',timeout:10000,windowsHide:true});writeFileSync(output+'/cleanup.log',(cleanup.stdout??'')+'\n'+(cleanup.stderr??''));if(cleanup.status!==0&&!cleanup.stderr?.includes('No such container'))throw new Error('QUALITY_TEST_CLEANUP_FAILED');}
}
