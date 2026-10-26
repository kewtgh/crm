import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdirSync,writeFileSync} from "node:fs";
import pg from "pg";
import {rpcArgumentValues} from "../lib/db/rpc-arguments.ts";

// Fresh loopback-only, temporary storage. Never reads dotenv or an application database URL.
const container=`lumina-crm-calendar-it-${randomBytes(5).toString("hex")}`,password=randomBytes(32).toString("hex");
const image=process.env.CALENDAR_TEST_POSTGRES_IMAGE||"postgres:18.6-trixie",deadline=Date.now()+50_000;
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
const output="work/calendar-actions-postgres";mkdirSync(output,{recursive:true});
writeFileSync(`${output}/container.json`,JSON.stringify({container,image}));
const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false"};
for(const key of Object.keys(env))if(/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|ENCRYPTION_KEY|HASH_SECRET|WEBHOOK|API_KEY|APP_URL/.test(key))delete env[key];
for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
function run(command,args,label,environment=env){const result=spawnSync(command,args,{env:environment,encoding:"utf8",timeout:Math.max(1,Math.min(30_000,deadline-Date.now())),windowsHide:true});writeFileSync(`${output}/${label}.log`,`${result.stdout??""}\n${result.stderr??""}`);if(result.error||result.status!==0)throw new Error(`CALENDAR_TEST_SUBPROCESS_FAILED:${label}`);return result.stdout.trim();}
let client,started=false;const peers=[];
try{
 run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=calendar-actions","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=calendar_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],"container",{...env,POSTGRES_PASSWORD:password});started=true;
 const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container],"port");assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/calendar_test`;
 for(let n=0;n<25;n++){client=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch{await client.end().catch(()=>{});client=undefined;if(n===24)throw new Error("CALENDAR_TEST_DATABASE_NOT_READY");await new Promise(resolve=>setTimeout(resolve,200));}}
 env.DATABASE_ADMIN_URL=url;env.MIGRATION_DATABASE_URL=url;
 run(process.execPath,["scripts/db-bootstrap.mjs"],"bootstrap");run(process.execPath,["scripts/db-migrate.mjs"],"migrate");
 console.log("PASS current migration chain including calendar action receipts on a fresh disposable database.");
 const ws="00000000-0000-4000-8000-000000000001",actor=randomUUID(),other=randomUUID(),foreign=randomUUID(),otherWs=randomUUID();
 await client.query("insert into app_auth.accounts(id,email,username) values($1,'calendar.actor@example.test','fictional-calendar-actor'),($2,'calendar.peer@example.test','fictional-calendar-peer'),($3,'calendar.foreign@example.test','fictional-calendar-foreign')",[actor,other,foreign]);
 await client.query("insert into public.workspaces(id,slug,name) values($1,'calendar-other','Fictional Calendar Workspace')",[otherWs]);
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'SALES_SPECIALIST'),($1,$3,'SALES_SPECIALIST'),($4,$5,'ADMIN')",[ws,actor,other,otherWs,foreign]);
 const context=async(connection=client,user=actor,workspace=ws)=>{await connection.query("reset role");await connection.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[user,workspace]);await connection.query("set role crm_app");};
 await context();
 const creationEntries=(attendees=[],key=randomUUID())=>Object.entries({title_zh:"示例日程",title_en:"Fictional schedule",event_type:"MEETING",relation_type:null,relation_id:null,relation_label:"",starts:"2030-01-01T02:00:00Z",ends:"2030-01-01T03:00:00Z",event_channel:"Teams",reminders:[1440],attendees,target_request_key:key});
 const creationSql=entries=>`select * from public.create_appointment_with_delivery(${entries.map(([name],index)=>`"${name}" => $${index+1}`).join(",")})`;
 const createViaGateway=async(entries,connection=client)=>(await connection.query(creationSql(entries),await rpcArgumentValues(connection,"create_appointment_with_delivery",entries))).rows[0];
 assert.equal((await client.query("select jsonb_typeof($1::jsonb) kind",[[]])).rows[0].kind,"object","unencoded JS arrays reproduce PostgreSQL-array transport instead of JSON arrays");
 const emptyEntries=creationEntries();
 await assert.rejects(client.query(creationSql(emptyEntries),emptyEntries.map(([,value])=>value)),/appointment_invalid|cannot get array length|invalid input syntax for type json/);
 const created=await createViaGateway(emptyEntries);assert.ok(created.id);assert.equal(created.event_version,1);assert.deepEqual(await createViaGateway(emptyEntries),created);
 const attendedEntries=creationEntries([{email:"attendee@example.test",consentConfirmed:true}]);
 const attended=await createViaGateway(attendedEntries);assert.ok(attended.id);assert.deepEqual(await createViaGateway(attendedEntries),attended);
 await assert.rejects(createViaGateway(creationEntries([{email:"attendee@example.test",consentConfirmed:false}])),/appointment_attendee_consent_required/);
 await client.query("reset role");
 const creationFacts=(await client.query("select (select count(*)::int from public.appointment_attendees where appointment_id=$1) attendees,(select count(*)::int from public.calendar_deliveries where appointment_id=$1) deliveries",[attended.id])).rows[0];
 assert.deepEqual(creationFacts,{attendees:1,deliveries:1});await context();
 console.log("PASS reproduced original JSONB array failure; real empty-attendee and invited appointment creation, exact replay, SQL-array reminders and consent denial now verified.");
 const seed=async()=>{await client.query("reset role");const id=randomUUID();await client.query("insert into public.appointments(id,workspace_id,title_zh,title_en,appointment_type,starts_at,ends_at,owner_id,created_by) values($1,$2,'示例预约','Fictional appointment','MEETING','2030-01-01T02:00Z','2030-01-01T03:00Z',$3,$3)",[id,ws,actor]);await client.query("insert into public.appointment_attendees(workspace_id,appointment_id,email,name,consent_confirmed,created_by) values($1,$2,'attendee@example.test','Fictional Attendee',true,$3)",[ws,id,actor]);await context();return id;};
 const mutate=async(id,action,version,key=randomUUID(),connection=client)=>{const start=action==="UPDATE"?"2030-01-02T02:00Z":null,end=action==="UPDATE"?"2030-01-02T03:00Z":null;return (await connection.query("select public.mutate_calendar_appointment($1,$2,$3,$4,$5,$6) item",[id,action,version,key,start,end])).rows[0].item;};
 const facts=async id=>{await client.query("reset role");const row=(await client.query("select event_version,status,completed_at,(select count(*)::int from public.calendar_deliveries where appointment_id=a.id) deliveries,(select count(*)::int from public.audit_events where entity_id=a.id::text and action in ('APPOINTMENT_UPDATE','APPOINTMENT_CANCEL','APPOINTMENT_COMPLETE')) audits from public.appointments a where id=$1",[id])).rows[0];await context();return row;};
 const id=await seed(),key=randomUUID(),first=await mutate(id,"UPDATE",1,key);assert.equal(first.event_version,2);assert.deepEqual(await mutate(id,"UPDATE",1,key),first);assert.equal((await facts(id)).deliveries,1);assert.equal((await facts(id)).audits,1);
 await assert.rejects(mutate(id,"CANCEL",1,key),/appointment_request_conflict/);await assert.rejects(mutate(id,"CANCEL",1),/appointment_state_changed/);
 const completeKey=randomUUID(),completed=await mutate(id,"COMPLETE",2,completeKey),before=await facts(id);assert.equal(completed.status,"COMPLETED");assert.equal(before.event_version,3);assert.deepEqual(await mutate(id,"COMPLETE",2,completeKey),completed);assert.deepEqual(await facts(id),before);
 assert.deepEqual(await mutate(id,"UPDATE",1,key),first);assert.deepEqual(await facts(id),before);await assert.rejects(mutate(id,"CANCEL",3),/appointment_state_changed/);
 const cancelledId=await seed(),cancelKey=randomUUID(),cancelled=await mutate(cancelledId,"CANCEL",1,cancelKey);assert.equal(cancelled.status,"CANCELLED");assert.deepEqual(await mutate(cancelledId,"CANCEL",1,cancelKey),cancelled);assert.equal((await facts(cancelledId)).deliveries,1);await assert.rejects(mutate(cancelledId,"COMPLETE",2),/appointment_state_changed/);
 const protectedId=await seed();await context(client,other);await assert.rejects(mutate(protectedId,"COMPLETE",1),/appointment_forbidden/);await context(client,foreign,otherWs);await assert.rejects(mutate(protectedId,"UPDATE",1),/appointment_forbidden/);await context();
 await assert.rejects(client.query("select public.complete_appointment($1)",[protectedId]),/permission denied/);await assert.rejects(client.query("select public.update_appointment_delivery($1,'CANCEL')",[protectedId]),/permission denied/);await assert.rejects(client.query("update public.appointments set status='COMPLETED' where id=$1",[protectedId]),/permission denied/);
 console.log("PASS exact replay, payload conflict, current versions, terminal lifecycle, tenant/owner scope and legacy/direct-write denial.");
 // Two independent connections racing from the same version yield one accepted transition.
 const race=await seed();for(let n=0;n<2;n++){const peer=new pg.Client({connectionString:url,statement_timeout:5000});await peer.connect();peers.push(peer);await context(peer);}
 const raceResults=await Promise.allSettled(peers.map(peer=>mutate(race,"UPDATE",1,randomUUID(),peer)));assert.equal(raceResults.filter(result=>result.status==="fulfilled").length,1);assert.match(raceResults.find(result=>result.status==="rejected").reason.message,/appointment_state_changed/);assert.equal((await facts(race)).deliveries,1);
 // A delivery failure must roll back the appointment, audit and receipt together.
 const atomic=await seed(),atomicKey=randomUUID();await client.query("reset role");await client.query("create function public.calendar_test_reject_delivery() returns trigger language plpgsql as $$begin raise exception 'fictional_delivery_failure';end$$;create trigger calendar_test_reject before insert on public.calendar_deliveries for each row execute function public.calendar_test_reject_delivery()");await context();
 await assert.rejects(mutate(atomic,"UPDATE",1,atomicKey),/fictional_delivery_failure/);const rolled=await facts(atomic);assert.equal(rolled.event_version,1);assert.equal(rolled.deliveries,0);assert.equal(rolled.audits,0);await client.query("reset role");assert.equal((await client.query("select count(*)::int n from public.mutation_receipts where request_key=$1",[atomicKey])).rows[0].n,0);await client.query("drop trigger calendar_test_reject on public.calendar_deliveries;drop function public.calendar_test_reject_delivery()");
 await client.query("update public.workspace_memberships set status='SUSPENDED' where workspace_id=$1 and user_id=$2",[ws,actor]);await context();await assert.rejects(mutate(id,"UPDATE",1,key),/appointment_forbidden/);
 console.log("PASS concurrent stale action, atomic delivery failure rollback and suspended-actor replay denial. No real calendar invitation sent.");
 writeFileSync(`${output}/result.json`,JSON.stringify({passed:true,image,checks:["migration","receipts","versions","terminal states","scope","legacy denial","concurrency","atomic rollback","suspension"]}));
}finally{
 for(const peer of peers)await peer.end().catch(()=>{});await client?.end().catch(()=>{});
 if(started){assert.match(container,/^lumina-crm-calendar-it-[a-f0-9]{10}$/);const cleanup=spawnSync("docker",["rm","--force",container],{encoding:"utf8",timeout:10000,windowsHide:true});writeFileSync(`${output}/cleanup.log`,`${cleanup.stdout??""}\n${cleanup.stderr??""}`);if(cleanup.status!==0&&!cleanup.stderr?.includes("No such container"))throw new Error("CALENDAR_TEST_CLEANUP_FAILED");}
}
