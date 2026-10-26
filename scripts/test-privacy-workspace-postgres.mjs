import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import pg from 'pg';
import {privacyPageSchema,privacyReceiptSchema} from '../lib/privacy-request-contract.ts';

// A new loopback-only tmpfs database. Never load application dotenv or connection strings.
const container=`lumina-crm-approval-it-${randomBytes(5).toString('hex')}`,password=randomBytes(32).toString('hex'),deadline=Date.now()+50_000;
const image=process.env.PRIVACY_TEST_POSTGRES_IMAGE||'postgres:18.6-trixie';assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
const output='work/privacy-workspace-postgres';mkdirSync(output,{recursive:true});
const env={...process.env,NODE_ENV:'test',DATABASE_SSL:'false'};
for(const key of Object.keys(env))if(/DATABASE_URL$|DATABASE_ADMIN_URL|CRM_.*DB_PASSWORD|CRM_WORKSPACE_ID|ENCRYPTION_KEY|HASH_SECRET|WEBHOOK|API_KEY|APP_URL/.test(key))delete env[key];
for(const role of ['APP','SYSTEM','WORKER','MIGRATOR','BACKUP'])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString('hex');
function run(command,args,label,environment=env){
 const result=spawnSync(command,args,{env:environment,encoding:'utf8',windowsHide:true,timeout:Math.max(1,Math.min(18000,deadline-Date.now())),maxBuffer:12*1024*1024});
 writeFileSync(`${output}/${label}.log`,`${result.stdout??''}\n${result.stderr??''}`);
 if(result.error||result.status!==0)throw new Error(`PRIVACY_TEST_SUBPROCESS_FAILED:${label}`);return result.stdout.trim();
}
let client,started=false;const peers=[];
try{
 run('docker',['run','--detach','--rm','--pull=never','--name',container,'--label','com.lumina.crm.test=privacy-workspace','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql:rw,noexec,nosuid,size=768m','--env','POSTGRES_DB=privacy_test','--env','POSTGRES_USER=postgres','--env','POSTGRES_PASSWORD',image],'container',{...env,POSTGRES_PASSWORD:password});started=true;
 const port=run('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',container],'port');assert.match(port,/^\d+$/);
 const url=`postgresql://postgres:${password}@127.0.0.1:${port}/privacy_test`;
 for(let n=0;n<25;n++){client=new pg.Client({connectionString:url,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch{await client.end().catch(()=>{});client=undefined;if(n===24)throw new Error('PRIVACY_TEST_DATABASE_NOT_READY');await new Promise(resolve=>setTimeout(resolve,200));}}
 env.DATABASE_ADMIN_URL=url;env.MIGRATION_DATABASE_URL=url;
 run(process.execPath,['scripts/db-bootstrap.mjs'],'bootstrap');run(process.execPath,['scripts/db-migrate.mjs'],'migrate');

 console.log('PASS fresh migration chain through privacy command migration 143.');
 const ws='00000000-0000-4000-8000-000000000001',admin=randomUUID(),checker=randomUUID(),owner=randomUUID(),foreign=randomUUID(),otherWs=randomUUID();
 for(const [user,name,role] of [[admin,'admin','ADMIN'],[checker,'checker','ADMIN'],[owner,'owner','SALES_SPECIALIST'],[foreign,'foreign','ADMIN']]){
  await client.query('insert into app_auth.accounts(id,email,username) values($1,$2,$3)',[user,'privacy.'+name+'@example.test','fictional-privacy-'+name]);
  if(user!==foreign)await client.query('insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)',[ws,user,role]);
 }
 await client.query("insert into public.workspaces(id,slug,name) values($1,'fictional-privacy-other','Fictional Privacy Workspace')",[otherWs]);
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'ADMIN')",[otherWs,foreign]);
 const contact=(await client.query("insert into public.contacts(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'示例联系人','Fictional Contact',$2,$2) returning id",[ws,owner])).rows[0].id;
 const context=async(user=admin,connection=client,aal='aal2')=>{await connection.query('reset role');await connection.query("select set_config('app.user_id',$1,false),set_config('app.aal',$2,false),set_config('app.workspace_id',$3,false)",[user,aal,user===foreign?otherWs:ws]);await connection.query('set role crm_app');};
 const command=async(payload,key=randomUUID(),connection=client)=>(await connection.query('select public.privacy_request_command($1::jsonb,$2) item',[JSON.stringify(payload),key])).rows[0].item;
 const list=async(values={})=>(await client.query('select public.list_privacy_requests($1,$2,$3,$4,$5,$6) item',[values.status??'all',values.type??'all',values.scope??'all',values.due??'all',values.page??1,values.pageSize??20])).rows[0].item;
 const token=async(id,connection=client)=>(await connection.query('select public.privacy_review_token(r) token from public.privacy_requests r where id=$1',[id])).rows[0].token;
 const review=async(id,status,identityStatus='VERIFIED',key=randomUUID(),connection=client)=>command({operation:'manage',id,reviewToken:await token(id,connection),status,identityStatus,decision:'Fictional reviewed decision'},key,connection);
 const create={operation:'create',type:'CORRECTION',note:'Fictional correction evidence',contactId:contact,changes:{title:'Fictional corrected title'}};
 await context(owner);const key=randomUUID(),created=await command(create,key);assert.deepEqual(await command(create,key),created);await assert.rejects(command({...create,note:'Fictional changed evidence'},key),/privacy_request_conflict/);
 for(let n=0;n<24;n++)await command({...create,type:'ACCESS',changes:{},note:'Fictional access evidence '+n});
 const second=await list({page:2,pageSize:10});privacyPageSchema.parse(second);privacyReceiptSchema.parse(created);assert.equal(second.total,25);assert.equal(second.items.length,10);assert.equal((await list({scope:'mine'})).total,25);
 await context(foreign);assert.equal((await list()).total,0);await assert.rejects(command(create),/privacy_contact_unavailable/);await context(owner);await assert.rejects(review(created.id,'IDENTITY_REVIEW','PENDING'),/privacy_access_denied/);
 await context();const mfaToken=await token(created.id);await context(admin,client,'aal1');await assert.rejects(command({operation:'manage',id:created.id,reviewToken:mfaToken,status:'IDENTITY_REVIEW',identityStatus:'PENDING',decision:'Fictional unverified review'}),/mfa_required|privacy_access_denied/);await context();
 const original=await token(created.id),reviewKey=randomUUID(),payload={operation:'manage',id:created.id,reviewToken:original,status:'IDENTITY_REVIEW',identityStatus:'PENDING',decision:'Fictional first review'};
 const accepted=await command(payload,reviewKey);await client.query("set timezone='America/New_York'");assert.deepEqual(await command(payload,reviewKey),accepted);await assert.rejects(command({...payload,status:'CANCELLED'}),/privacy_snapshot_conflict/);
 await review(created.id,'IN_PROGRESS');const fulfilled=await review(created.id,'FULFILLED');assert.equal(fulfilled.status,'FULFILLED');
 await client.query('reset role');assert.equal((await client.query('select title from public.contacts where id=$1',[contact])).rows[0].title,'Fictional corrected title');assert.equal((await client.query('select count(*)::int n from public.privacy_executions where request_id=$1',[created.id])).rows[0].n,1);
 await client.query("update public.privacy_executions set failure_detail='Fictional internal private diagnostic' where request_id=$1",[created.id]);await context();assert.equal(JSON.stringify(await list()).includes('Fictional internal private diagnostic'),false);assert.equal(JSON.stringify(await list()).includes('result_summary'),false);
 const exp=await command({...create,type:'EXPORT',changes:{},note:'Fictional export review evidence'});await review(exp.id,'IDENTITY_REVIEW','PENDING');await review(exp.id,'IN_PROGRESS');await review(exp.id,'WAITING_APPROVAL');await assert.rejects(review(exp.id,'FULFILLED'),/privacy_second_reviewer_required/);await context(checker);const exportKey=randomUUID(),exportPayload={operation:'manage',id:exp.id,reviewToken:await token(exp.id),status:'FULFILLED',identityStatus:'VERIFIED',decision:'Fictional independent reviewer'};
 assert.equal((await command(exportPayload,exportKey)).status,'EXECUTING');await command(exportPayload,exportKey);await client.query('reset role');assert.equal((await client.query('select count(*)::int n from public.generated_jobs where privacy_request_id=$1',[exp.id])).rows[0].n,1);
 for(let n=0;n<2;n++){const peer=new pg.Client({connectionString:url,statement_timeout:5000});await peer.connect();peers.push(peer);await context(admin,peer);}
 await context();const race=await command({...create,type:'ACCESS',changes:{},note:'Fictional concurrent request'}),raceToken=await token(race.id);
 const outcomes=await Promise.allSettled(peers.map(peer=>command({operation:'manage',id:race.id,reviewToken:raceToken,status:'IDENTITY_REVIEW',identityStatus:'PENDING',decision:'Fictional competing review'},randomUUID(),peer)));assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.match(outcomes.find(row=>row.status==='rejected').reason.message,/privacy_snapshot_conflict/);
 const concurrentKey=randomUUID(),same=await Promise.all(peers.map(peer=>command({...create,note:'Fictional same request concurrent'},concurrentKey,peer)));assert.equal(same[0].id,same[1].id);
 await client.query('reset role');await client.query("create function public.privacy_test_receipt_failure() returns trigger language plpgsql as $$begin if new.operation='PRIVACY_COMMAND' then raise exception 'fictional_receipt_failure';end if;return new;end$$;create trigger privacy_test_receipt_failure before insert on public.mutation_receipts for each row execute function public.privacy_test_receipt_failure()");await context();await assert.rejects(command({...create,note:'Fictional rollback marker'}),/fictional_receipt_failure/);await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.privacy_requests where request_note='Fictional rollback marker'")).rows[0].n,0);await client.query('drop trigger privacy_test_receipt_failure on public.mutation_receipts');
 const receipts=(await client.query("select result::text from public.mutation_receipts where operation='PRIVACY_COMMAND'")).rows;for(const receipt of receipts){assert.equal(receipt.result.includes('Fictional'),false);assert.equal(receipt.result.includes('changes'),false);}

 await client.query('reset role');await client.query('update public.privacy_requests set requested_changes=$1::jsonb where id=$2',[JSON.stringify({title:'Fictional legacy title '.repeat(12),internalDetail:'Fictional hidden field'}),created.id]);await context();const legacy=privacyPageSchema.parse(await list({status:'FULFILLED'}));assert.equal(legacy.items[0].requestedChanges.internalDetail,undefined);assert.ok(legacy.items[0].requestedChanges.title.length>160);
 await client.query('reset role');await client.query('update app_auth.accounts set last_sign_in_at=now(),must_change_password=false');await client.query('update public.workspace_memberships set must_change_password=false');
 const invitee=randomUUID();await client.query("insert into app_auth.accounts(id,email,username,last_sign_in_at,must_change_password) values($1,'calendar.invitee@example.test','fictional-calendar-invitee',now(),false)",[invitee]);await client.query("insert into public.workspace_memberships(workspace_id,user_id,role,must_change_password) values($1,$2,'SALES_SPECIALIST',false)",[ws,invitee]);
 await client.query("insert into public.user_profiles(user_id,username,display_name_zh,display_name_en) values($1,'fictional-calendar-invitee','示例成员','Fictional Member')",[invitee]);
 await context(owner);const members=(await client.query("select * from public.list_calendar_members('')")).rows;assert.ok(members.some(row=>row.user_id===invitee));assert.equal(members.some(row=>row.user_id===foreign),false);
 const start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+90000000).toISOString(),inviteKey=randomUUID();
 const invite=async(target=invitee,key=inviteKey,connection=client)=>(await connection.query("select (public.create_appointment_with_delivery('示例邀请','Fictional invitation','MEETING','USER',$1,'Fictional member',$2,$3,'Office',array[30],'[]'::jsonb,$4)).*",[target,start,end,key])).rows[0];
 const appointment=await invite();assert.equal((await invite()).id,appointment.id);await assert.rejects(invite(foreign,randomUUID()),/appointment_member_unavailable/);
 await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.user_notifications where source_id=$1 and title_key='calendarInvite.invited'",[appointment.id])).rows[0].n,1);assert.equal((await client.query("select count(*)::int n from public.reminders where source_id=$1 and status='PENDING'",[appointment.id])).rows[0].n,2);
 await context(invitee);assert.equal((await client.query('select count(*)::int n from public.appointments where id=$1',[appointment.id])).rows[0].n,1);
 const mutate=async(action,version,key=randomUUID(),connection=client)=>(await connection.query("select public.mutate_calendar_appointment($1,$2,$3,$4,null,null) item",[appointment.id,action,version,key])).rows[0].item;
 await assert.rejects(mutate('COMPLETE',1),/appointment_forbidden/);await context(foreign);assert.equal((await client.query('select count(*)::int n from public.appointments where id=$1',[appointment.id])).rows[0].n,0);
 await context(owner);const completionKey=randomUUID(),completed=await mutate('COMPLETE',1,completionKey);assert.equal(completed.status,'COMPLETED');assert.ok(completed.completed_at);assert.equal((await mutate('COMPLETE',1,completionKey)).event_version,completed.event_version);
 await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.user_notifications where source_id=$1 and title_key='calendarInvite.completed'",[appointment.id])).rows[0].n,1);assert.equal((await client.query("select count(*)::int n from public.reminders where source_id=$1 and status='PENDING'",[appointment.id])).rows[0].n,0);
 await client.query("update public.workspace_memberships set status='SUSPENDED' where user_id=$1",[invitee]);await context(owner);assert.equal((await invite()).id,appointment.id);await assert.rejects(invite(invitee,randomUUID()),/appointment_member_unavailable/);assert.equal((await client.query('select count(*)::int n from public.appointments where id=$1 and completed_at is not null',[appointment.id])).rows[0].n,1);

 await client.query('reset role');await client.query("update public.workspace_memberships set status='ACTIVE' where user_id=$1",[invitee]);await context(owner);const changed=await invite(invitee,randomUUID());
 const updateKey=randomUUID(),later=new Date(Date.now()+172800000).toISOString(),laterEnd=new Date(Date.now()+176400000).toISOString();
 const update=async()=>(await client.query("select public.mutate_calendar_appointment($1,'UPDATE',1,$2,$3,$4) item",[changed.id,updateKey,later,laterEnd])).rows[0].item;assert.equal((await update()).event_version,2);await update();
 await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.user_notifications where source_id=$1 and title_key='calendarInvite.updated'",[changed.id])).rows[0].n,1);assert.equal((await client.query("select count(*)::int n from public.reminders where source_id=$1 and status='PENDING'",[changed.id])).rows[0].n,2);
 await context(owner);const cancelKey=randomUUID();for(let n=0;n<2;n++)await client.query("select public.mutate_calendar_appointment($1,'CANCEL',2,$2,null,null)",[changed.id,cancelKey]);await client.query('reset role');assert.equal((await client.query("select count(*)::int n from public.user_notifications where source_id=$1 and title_key='calendarInvite.cancelled'",[changed.id])).rows[0].n,1);assert.equal((await client.query("select count(*)::int n from public.reminders where source_id=$1 and status='PENDING'",[changed.id])).rows[0].n,0);
 await client.query("create function public.calendar_test_notice_failure() returns trigger language plpgsql as $$begin if new.kind='CALENDAR_INVITE' then raise exception 'fictional_notice_failure';end if;return new;end$$;create trigger calendar_test_notice_failure before insert on public.user_notifications for each row execute function public.calendar_test_notice_failure()");await context(owner);const rejectedKey=randomUUID();await assert.rejects(invite(invitee,rejectedKey),/fictional_notice_failure/);await client.query('reset role');assert.equal((await client.query('select count(*)::int n from public.appointments where creation_request_key=$1',[rejectedKey])).rows[0].n,0);await client.query('drop trigger calendar_test_notice_failure on public.user_notifications');
 console.log('PASS real calendar member directory, invite/reminder atomicity and replay, recipient read-only RLS, cross-workspace denial, completion retention and inactive-member denial.');
 await client.query('reset role');await client.query("update public.workspace_memberships set status='SUSPENDED' where user_id=$1",[owner]);await context(owner);await assert.rejects(command(create,key),/privacy_access_denied/);
 console.log('PASS create/review replay, stale snapshots, RLS/membership/MFA, second review, exactly-once correction/export queue, concurrency and atomic receipt rollback. No worker was run.');
 writeFileSync(output+'/summary.json',JSON.stringify({passed:true,image,migration:143,externalOperations:0,existingDatabasesTouched:false}));
}finally{
 for(const peer of peers)await peer.end().catch(()=>{});await client?.end().catch(()=>{});
 if(started){const result=spawnSync('docker',['rm','--force',container],{encoding:'utf8',windowsHide:true,timeout:10000});writeFileSync(output+'/cleanup.log',result.stdout+'\n'+result.stderr);if(result.status!==0)throw Error('PRIVACY_TEST_CONTAINER_CLEANUP_FAILED');console.log('PASS disposable privacy container removed.');}
}
