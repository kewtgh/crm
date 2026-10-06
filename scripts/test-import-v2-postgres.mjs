import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {v2Headers,normalizeV2Row} from '../lib/import-v2.ts';
import {buildV2Xlsx} from '../lib/import-v2-template.ts';
import {normalizeImportSheet} from '../lib/import-sheet.ts';
import {readSheet} from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';
const container=`lumina-import-v2-${randomBytes(5).toString('hex')}`,deadline=Date.now()+50_000,password=randomBytes(32).toString('hex');
const image=process.env.IMPORT_TEST_POSTGRES_IMAGE||'postgres:18.4-bookworm';
let client;
function run(command,args,env=process.env){const result=spawnSync(command,args,{env,encoding:'utf8',timeout:Math.max(1,Math.min(20_000,deadline-Date.now())),windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command}: ${result.stderr.slice(-5000)}`);return result.stdout.trim();}
try{
 run('docker',['run','--detach','--rm','--pull=never','--name',container,'--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql:rw,noexec,nosuid,size=768m','--env','POSTGRES_DB=import_test','--env','POSTGRES_USER=postgres','--env','POSTGRES_PASSWORD',image],{...process.env,POSTGRES_PASSWORD:password});
 const port=run('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',container]);
 const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/import_test`;
 for(let n=0;n<20;n++){client=new pg.Client({connectionString,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch(e){await client.end().catch(()=>{});if(n===19)throw e;await new Promise(r=>setTimeout(r,150));}}
 const env={...process.env,DATABASE_ADMIN_URL:connectionString,MIGRATION_DATABASE_URL:connectionString};for(const role of ['APP','SYSTEM','WORKER','MIGRATOR','BACKUP'])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString('hex');
 run(process.execPath,['scripts/db-bootstrap.mjs'],env);run(process.execPath,['scripts/db-migrate.mjs'],env);
 const ws='00000000-0000-4000-8000-000000000001',actor=randomUUID();
 await client.query('insert into app_auth.accounts(id,email,username) values($1,$2,$3)',[actor,'import-v2@example.test','import-v2']);
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role,status) values($1,$2,'ADMIN','ACTIVE')",[ws,actor]);
 await client.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[actor,ws]);
 await client.query('set role crm_app');
 const org=(await client.query("select public.save_customer_record('ORGANIZATIONS',$1,null,$2) as item",[randomUUID(),{nameZh:'测试',nameEn:'Test',city:'Taipei'}])).rows[0].item;
 assert.equal(org.city,'Taipei');
 const scalar=async(sql,values=[])=>(await client.query(sql,values)).rows[0];
 const token=async(kind,id)=>(await scalar('select public.issue_import_reference($1,$2) as token',[kind,id])).token;
 // Release golden rows start with the downloaded workbook, fill its Data sheet,
 // and pass parsed strings through the same normalization used by execution.
 const workbookRow=async(resource,input)=>{
  const blank=await buildV2Xlsx(resource,'blank');
  const headers=(await readSheet(blank,'Data'))[0];
  const sheets=[];for(const sheet of ['Data','Guide','Enums','Metadata']){
   const values=sheet==='Data'?[headers,headers.map(k=>input[k]??'')]:await readSheet(blank,sheet);
   sheets.push({sheet,data:values.map(row=>row.map(value=>({value:String(value??''),type:String})))});
  }
  const filled=await writeXlsxFile(sheets).toBuffer();
  assert.deepEqual(Object.fromEntries(await readSheet(filled,'Metadata')),{resource,template_version:'2'});
  const parsed=normalizeImportSheet(await readSheet(filled,'Data',{parseNumber:v=>v}),100,true);
  assert.deepEqual(parsed.headers,v2Headers(resource));
  return normalizeV2Row(resource,parsed.rows[0],parsed.rowLocations[0],'Data');
 };
 const create=async(resource,input,key=randomUUID(),xlsx=false)=>({batch:(await scalar('select to_jsonb(public.create_import_batch_v2($1,$2,$3,$4,$5,$6)) as item',[resource,xlsx?'filled-template.xlsx':'fixture.csv','a'.repeat(64),key,JSON.stringify(v2Headers(resource)),JSON.stringify([xlsx?await workbookRow(resource,input):normalizeV2Row(resource,input,2)])])).item,key});
 const rows=async(batch)=>(await client.query('select * from public.import_rows where batch_id=$1',[batch.id])).rows;
 const execute=async batch=>(await scalar('select to_jsonb(public.process_import_batch_v2($1,100)) as item',[batch.id])).item;
 const orgToken=await token('ORGANIZATION',org.id);
 const snapshotSql='select (select count(*) from public.organizations) as facts,(select count(*) from public.audit_events) as audits,(select count(*) from public.mutation_receipts) as receipts,(select count(*) from public.student_enrollment_status_history) as history';
 const snapshot=async()=>{await client.query('reset role');try{return await scalar(snapshotSql);}finally{await client.query('set role crm_app');}};
 const before=await snapshot();
 const {batch:b1,key:k1}=await create('ORGANIZATIONS',{nameZh:'独立机构',city:'台北',website:'https://example.test','profile.organization_type':'SCHOOL','profile.roles':'SCHOOL_ENTRY'},randomUUID(),true);
 if(b1.status!=='READY'){await client.query('reset role');await client.query("select public.import_v2_preflight('ORGANIZATIONS',$1)",[normalizeV2Row('ORGANIZATIONS',{nameZh:'独立机构',city:'台北',website:'https://example.test','profile.organization_type':'SCHOOL','profile.roles':'SCHOOL_ENTRY'},2)]);await client.query('set role crm_app');}
 assert.equal(b1.status,'READY',JSON.stringify(await rows(b1)));
 assert.deepEqual(await snapshot(),before);
 await assert.rejects(client.query('select public.process_import_batch($1,100)',[b1.id]),/TEMPLATE_VERSION_UNSUPPORTED/);
 assert.equal((await execute(b1)).applied_rows,1);
 assert.equal((await create('ORGANIZATIONS',{nameZh:'独立机构',city:'台北',website:'https://example.test','profile.organization_type':'SCHOOL','profile.roles':'SCHOOL_ENTRY'},k1,true)).batch.id,b1.id);
 await assert.rejects(create('ORGANIZATIONS',{nameZh:'Changed',city:'台北'},k1),/IMPORT_REQUEST_CONFLICT/);
 assert.equal((await execute(b1)).applied_rows,1);
 const {batch:update}=await create('ORGANIZATIONS',{operation:'UPDATE',targetReference:orgToken,website:'https://updated.test',address:''});
 assert.equal(update.status,'READY',JSON.stringify(await rows(update)));assert.equal((await execute(update)).applied_rows,1);
 assert.equal((await scalar('select website,address from public.organizations where id=$1',[org.id])).website,'https://updated.test');
 const {batch:clear}=await create('ORGANIZATIONS',{operation:'UPDATE',targetReference:orgToken,website:'__CLEAR__'});assert.equal((await execute(clear)).applied_rows,1);
 assert.equal((await scalar('select website from public.organizations where id=$1',[org.id])).website,'');
 await scalar('select public.rollback_import_batch_v2($1,$2)',[clear.id,randomUUID()]);assert.equal((await scalar('select website from public.organizations where id=$1',[org.id])).website,'https://updated.test');
 await assert.rejects(client.query('select public.rollback_import_batch_v2($1,$2)',[update.id,randomUUID()]),/STALE_TARGET/);
 const createdOrganization=(await rows(b1))[0].applied_entity_id,rollbackKey=randomUUID();
 await scalar('select public.rollback_import_batch_v2($1,$2)',[b1.id,rollbackKey]);await scalar('select public.rollback_import_batch_v2($1,$2)',[b1.id,rollbackKey]);
 assert.equal((await scalar('select count(*)::int as n from public.organizations where id=$1',[createdOrganization])).n,0);
 assert.equal((await scalar('select count(*)::int as n from public.organization_business_profiles where id=$1',[createdOrganization])).n,0);
 const {batch:hh}=await create('HOUSEHOLDS',{nameZh:'家庭',annualIncomeAmount:'100000000.01','profile.services':'STUDY_TOUR','profile.budget_min':'20000.01','profile.budget_max':'30000.02','profile.budget_currency':'CNY'},randomUUID(),true);
 assert.equal(hh.status,'READY',JSON.stringify(await rows(hh)));assert.equal((await execute(hh)).applied_rows,1);
 const householdId=(await rows(hh))[0].applied_entity_id;
 assert.equal((await scalar('select annual_income_amount::text as income from public.households where id=$1',[householdId])).income,'100000000.01');
 const householdToken=await token('HOUSEHOLD',householdId);
 const {batch:houseUpdate}=await create('HOUSEHOLDS',{operation:'UPDATE',targetReference:householdToken,address:'New address',annualIncomeAmount:'','profile.budget_max':'35000.03'});
 assert.equal(houseUpdate.status,'READY',JSON.stringify(await rows(houseUpdate)));assert.equal((await execute(houseUpdate)).applied_rows,1);
 assert.equal((await scalar('select annual_income_amount::text as income from public.households where id=$1',[householdId])).income,'100000000.01');
 await scalar('select public.rollback_import_batch_v2($1,$2)',[houseUpdate.id,randomUUID()]);
 assert.equal((await scalar('select budget_max::text as money from public.family_education_needs where id=$1',[householdId])).money,'30000.02');
 const {batch:invalidRange}=await create('HOUSEHOLDS',{operation:'UPDATE',targetReference:householdToken,address:'MUST NOT SURVIVE','profile.budget_min':'999999.00','profile.budget_max':'1.00'});
 assert.equal(invalidRange.invalid_rows,1);assert.equal((await scalar('select address from public.households where id=$1',[householdId])).address,'');
 const ownerToken=await token('STAFF',actor);
 const {batch:contact}=await create('CONTACTS',{nameZh:'联系人',email:'new@example.test',phone:'+886 20000000',contactType:'PARENT',contactStatus:'CONNECTED',communicationLevel:'2',notesMarkdown:'PRIVATE NOTE',organizationId:orgToken,preferredContactMethod:'EMAIL',preferredLanguage:'zh-CN',acquisitionSource:'Synthetic release',decisionRole:'INFLUENCER',tags:'Release,QA',nextFollowUpAt:'2026-11-01T09:00:00Z',ownerId:ownerToken},randomUUID(),true);
 assert.equal(contact.status,'READY',JSON.stringify(await rows(contact)));assert.equal((await execute(contact)).applied_rows,1);
 const contactId=(await rows(contact))[0].applied_entity_id,contactToken=await token('CONTACT',contactId);
 const {batch:cu}=await create('CONTACTS',{operation:'UPDATE',targetReference:contactToken,title:'Changed',notesMarkdown:'',wechatId:'test-wechat',status:'FOLLOW_UP'});
 if(cu.status!=='READY'){await client.query('reset role');await client.query("select public.import_v2_preflight('CONTACTS',$1)",[normalizeV2Row('CONTACTS',{operation:'UPDATE',targetReference:contactToken,title:'Changed',wechatId:'test-wechat'},2)]);await client.query('set role crm_app');}
 assert.equal(cu.status,'READY',JSON.stringify(await rows(cu)));assert.equal((await execute(cu)).applied_rows,1);
 const c=await scalar('select notes_markdown,contact_type,contact_status,wechat_id,preferred_contact_method,preferred_language,acquisition_source,decision_role,tags,next_follow_up_at,owner_id,status from public.contacts where id=$1',[contactId]);assert.equal(c.notes_markdown,'PRIVATE NOTE');assert.equal(c.contact_type,'PARENT');assert.equal(c.contact_status,'CONNECTED');assert.equal(c.wechat_id,'test-wechat');
 assert.equal(c.preferred_contact_method,'EMAIL');assert.equal(c.preferred_language,'zh-CN');assert.equal(c.acquisition_source,'Synthetic release');assert.equal(c.decision_role,'INFLUENCER');assert.deepEqual(c.tags,['Release','QA']);assert.equal(c.next_follow_up_at.toISOString(),'2026-11-01T09:00:00.000Z');assert.equal(c.owner_id,actor);assert.equal(c.status,'FOLLOW_UP');
 await scalar('select public.rollback_import_batch_v2($1,$2)',[cu.id,randomUUID()]);assert.equal((await scalar('select title from public.contacts where id=$1',[contactId])).title,'');
 const badCommunication=normalizeV2Row('CONTACTS',{operation:'UPDATE',targetReference:contactToken,title:'MUST ROLLBACK'},2);badCommunication.patch.wechatId='x'.repeat(101);
 const atomicFailure=(await scalar("select to_jsonb(public.create_import_batch_v2('CONTACTS','fixture.csv',$1,$2,$3,$4)) as item",['a'.repeat(64),randomUUID(),JSON.stringify(v2Headers('CONTACTS')),JSON.stringify([badCommunication])])).item;
 assert.equal(atomicFailure.invalid_rows,1);assert.equal((await scalar('select title from public.contacts where id=$1',[contactId])).title,'');
 const {batch:stale}=await create('ORGANIZATIONS',{operation:'UPDATE',targetReference:orgToken,address:'new'});
 await client.query('reset role');await client.query("update public.organizations set updated_at=clock_timestamp() where id=$1",[org.id]);await client.query('set role crm_app');assert.equal((await execute(stale)).failed_rows,1);assert.equal((await rows(stale))[0].last_error,'STALE_TARGET');
 const {batch:concurrentA}=await create('ORGANIZATIONS',{operation:'UPDATE',targetReference:orgToken,address:'Concurrent A'}),{batch:concurrentB}=await create('ORGANIZATIONS',{operation:'UPDATE',targetReference:orgToken,address:'Concurrent B'});
 const peer=new pg.Client({connectionString,statement_timeout:5000});await peer.connect();
 try{await peer.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false)",[actor,ws]);await peer.query("select set_config('app.aal','aal2',false)");await peer.query('set role crm_app');const result=await Promise.all([execute(concurrentA),peer.query('select to_jsonb(public.process_import_batch_v2($1,100)) as item',[concurrentB.id]).then(r=>r.rows[0].item)]);assert.equal(result.reduce((n,r)=>n+r.applied_rows,0),1);assert.equal(result.reduce((n,r)=>n+r.failed_rows,0),1);}finally{await peer.end();}
 const {batch:dupe}=await create('ORGANIZATIONS',{nameZh:'测试',city:'台北'});assert.equal(dupe.duplicate_rows,1);assert.equal((await rows(dupe))[0].duplicate_entity_id,null);
 await client.query('reset role');await client.query("insert into public.organizations(id,workspace_id,name_zh,name_en,city,owner_id,created_by) values($1,$2,'测试','Second English identity','Taipei',$3,$3)",[randomUUID(),ws,actor]);await client.query('set role crm_app');
 const ambiguous=await create('ORGANIZATIONS',{nameZh:'测试',city:'台北'});assert.equal(ambiguous.batch.duplicate_rows,1);assert.equal((await rows(ambiguous.batch))[0].duplicate_entity_id,null);await assert.rejects(execute(ambiguous.batch),/IMPORT_NOT_READY/);assert.equal((await rows(ambiguous.batch))[0].applied_entity_id,null);
 // Tokens prove selected identity, not perpetual authorization; inspect hash storage,
 // type binding and expiry without using a hidden-record existence response.
 await client.query('reset role');const stored=(await scalar("select token_hash,resource,actor_id,workspace_id,extract(epoch from expires_at-now()) ttl from public.import_reference_tokens where token_hash=encode(extensions.digest($1,'sha256'),'hex')",[contactToken]));
 assert.notEqual(stored.token_hash,contactToken);assert.equal(stored.resource,'CONTACT');assert.equal(stored.actor_id,actor);assert.equal(stored.workspace_id,ws);assert.ok(Number(stored.ttl)>86300&&Number(stored.ttl)<=86400);
 await client.query('set role crm_app');const wrongType=await create('ORGANIZATIONS',{operation:'UPDATE',targetReference:contactToken,website:'https://wrong.test'});assert.equal((await rows(wrongType.batch))[0].errors[0].code,'INVALID_REFERENCE');
 const expiredToken=await token('CONTACT',contactId);await client.query('reset role');await client.query("update public.import_reference_tokens set expires_at=now()-interval '1 second' where token_hash=encode(extensions.digest($1,'sha256'),'hex')",[expiredToken]);await client.query('set role crm_app');
 const expiredReference=await create('CONTACTS',{operation:'UPDATE',targetReference:expiredToken,title:'Must not apply'});assert.equal((await rows(expiredReference.batch))[0].errors[0].code,'INVALID_REFERENCE');
 const mapping=(await scalar("select to_jsonb(public.save_import_mapping_v2('CONTACTS','v2', $1,'2',null)) as item",[{email:'email'}])).item;await assert.rejects(client.query("select public.save_import_mapping_v2('CONTACTS','v2',$1,'2',0)",[{email:'email'}]),/STALE_TARGET/);assert.equal(mapping.template_version,'2');
 const legacy=async(resource,row)=>(await scalar('select to_jsonb(public.create_import_batch($1,$2,$3,$4,$5,$6)) as item',[resource,'legacy.csv','b'.repeat(64),randomUUID(),{},JSON.stringify([row])])).item;
 const student=await legacy('STUDENTS',{personId:contactId,householdId:householdId,nameZh:'Ignored name',nameEn:'Ignored name',currentGrade:'Grade 8',academicYear:'2026-2027'});
 assert.equal(student.template_version,'LEGACY_UNVERSIONED');assert.equal(student.execution_contract,'CANONICAL_V2');assert.equal(student.status,'READY',JSON.stringify(await rows(student)));assert.equal((await execute(student)).applied_rows,1);
 const studentId=(await rows(student))[0].applied_entity_id;
 assert.equal((await scalar('select person_id from public.students where id=$1',[studentId])).person_id,contactId);
 assert.equal((await scalar('select name_zh from public.contacts where id=$1',[contactId])).name_zh,'联系人');
 await assert.rejects(client.query('select public.rollback_import_batch_v2($1,$2)',[contact.id,randomUUID()]),/STALE_TARGET/);
 const studentToken=await token('STUDENT',studentId);
 const studentUpdate=normalizeV2Row('STUDENTS',{operation:'UPDATE',targetReference:studentToken,currentClass:'Class A',currentGrade:''},2);
 const studentBatch=(await scalar("select to_jsonb(public.create_import_batch_v2('STUDENTS','compatibility.csv',$1,$2,$3,$4)) as item",['a'.repeat(64),randomUUID(),JSON.stringify(v2Headers('STUDENTS')),JSON.stringify([studentUpdate])])).item;
 assert.equal((await execute(studentBatch)).applied_rows,1);assert.equal((await scalar('select current_grade from public.students where id=$1',[studentId])).current_grade,'Grade 8');
 const legacyOrg=await legacy('ORGANIZATIONS',{nameZh:'Legacy organization',nameEn:'Legacy organization',city:'台北'});assert.equal((await execute(legacyOrg)).applied_rows,1);
 const legacyHouse=await legacy('HOUSEHOLDS',{nameZh:'Legacy family',annualIncomeAmount:'20000.01'});assert.equal((await execute(legacyHouse)).applied_rows,1);
 const legacyContact=await legacy('CONTACTS',{nameZh:'Legacy contact',email:'legacy@example.test'});assert.equal((await execute(legacyContact)).applied_rows,1);
 const dependencyContact=(await rows(legacyContact))[0].applied_entity_id;
 await client.query('reset role');await client.query("insert into public.students(workspace_id,person_id,current_grade,academic_year,created_by) values($1,$2,'Grade 7','2026-2027',$3)",[ws,dependencyContact,actor]);await client.query('set role crm_app');
 await assert.rejects(client.query('select public.rollback_import_batch_v2($1,$2)',[legacyContact.id,randomUUID()]),/IMPORT_ROLLBACK_HAS_DEPENDENCIES/);
 assert.equal((await client.query("update public.import_mapping_profiles set revision=0 where id=$1",[mapping.id])).rowCount,0);
 assert.equal((await scalar('select revision from public.import_mapping_profiles where id=$1',[mapping.id])).revision,1);
 const foreignWs=randomUUID(),foreignOrg=randomUUID(),secondActor=randomUUID();
 await client.query('reset role');await client.query("insert into public.workspaces(id,slug,name) values($1,'import-other','Other')",[foreignWs]);await client.query("insert into public.organizations(id,workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,'Foreign secret','Foreign secret',$3,$3)",[foreignOrg,foreignWs,actor]);
 await client.query("insert into app_auth.accounts(id,email,username) values($1,'import-sales@example.test','import-sales')",[secondActor]);await client.query("insert into public.workspace_memberships(workspace_id,user_id,role,status) values($1,$2,'SALES_MANAGER','ACTIVE')",[ws,secondActor]);await client.query('set role crm_app');
 await assert.rejects(token('ORGANIZATION',foreignOrg),/INVALID_REFERENCE/);await assert.rejects(token('ORGANIZATION',randomUUID()),/INVALID_REFERENCE/);
 await client.query("select set_config('app.user_id',$1,false)",[secondActor]);assert.equal((await scalar('select count(*)::int as n from public.import_rows where batch_id=$1',[contact.id])).n,0);await assert.rejects(token('CONTACT',contactId),/INVALID_REFERENCE/);
 await client.query("select set_config('app.user_id',$1,false)",[actor]);
 await client.query('reset role');await client.query("update app_auth.accounts set status='DISABLED' where id=$1",[secondActor]);await client.query('set role crm_app');
 await assert.rejects(token('STAFF',secondActor),/INVALID_REFERENCE/);
 await client.query('reset role');await client.query("update app_auth.accounts set status='ACTIVE' where id=$1",[secondActor]);await client.query("update public.workspace_memberships set status='SUSPENDED' where user_id=$1 and workspace_id=$2",[secondActor,ws]);await client.query('set role crm_app');
 await assert.rejects(token('STAFF',secondActor),/INVALID_REFERENCE/);
 const orgSearch=(await scalar("select public.search_import_references('ORGANIZATION','Foreign secret') as items")).items;assert.deepEqual(orgSearch,[]);
 for(const kind of ['ORGANIZATION','HOUSEHOLD','CONTACT','STUDENT','PRODUCT','COHORT','OPPORTUNITY','STAFF']){
  assert.ok(Array.isArray((await scalar('select public.search_import_references($1,$2) as items',[kind,'no-match-fixture'])).items),`${kind} selected-reference search uses canonical columns`);
 }
 await client.query('reset role');await client.query("update public.import_batches set evidence_expires_at=now()-interval '1 second' where id=$1",[contact.id]);await client.query('set role crm_app');assert.equal((await scalar('select count(*)::int as n from public.import_rows where batch_id=$1',[contact.id])).n,0);
 await client.query('reset role');await client.query('set role crm_worker');await client.query('select public.purge_expired_import_v2_evidence()');await client.query('reset role');assert.deepEqual((await scalar('select raw_data,normalized_data from public.import_rows where batch_id=$1',[contact.id])).raw_data,{});
 await client.query('reset role');const audit=await scalar("select count(*)::int as n from public.audit_events where after_data::text like '%PRIVATE NOTE%' or after_data::text like '%100000000.01%'");assert.equal(audit.n,0);
 await client.query("update public.workspace_memberships set status='SUSPENDED' where user_id=$1 and workspace_id=$2",[actor,ws]);await client.query('set role crm_app');
 await assert.rejects(client.query("select public.save_import_mapping_v2('CONTACTS','inactive',$1,'2',null)",[{email:'email'}]),/PERMISSION_DENIED/);
 await assert.rejects(client.query('select public.process_import_batch_v2($1,100)',[b1.id]),/PERMISSION_DENIED/);
 console.log(`PASS ${image}: migrations, canonical atomic adapters, zero-write preflight, core/profile precision, blank/clear, rollback, Contact/WeChat, stale targets, duplicate review, accepted retry/payload conflict, mapping revision, minimized audit`);
}finally{
 await client?.end().catch(()=>{});
 assert.match(container,/^lumina-import-v2-[a-f0-9]{10}$/);
 const result=spawnSync('docker',['rm','--force',container],{encoding:'utf8',timeout:10_000,windowsHide:true});if(result.status!==0&&!result.stderr?.includes('No such container'))throw new Error('Disposable container cleanup failed');
}
