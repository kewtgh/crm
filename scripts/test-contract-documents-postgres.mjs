import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import pg from "pg";
import {sealDocumentConfiguration} from "../lib/contract-document-configuration.mjs";
import path from "node:path";
import {digest} from "../lib/contract-document-engine.mjs";
import {contractDocumentReleaseScenario} from './lib/contract-document-release-scenario.mjs';
// Disposable local PostgreSQL only. Never loads .env or accesses an existing database/bucket.
const container=`lumina-document-it-${randomBytes(5).toString("hex")}`,password=randomBytes(32).toString("hex"),deadline=Date.now()+55_000;
const image=process.env.CONTRACT_DOCUMENT_TEST_POSTGRES_IMAGE||"postgres:18.4-bookworm";
assert.match(image,/^postgres:18\.\d+-(trixie|bookworm)$/);
let client;
function run(command,args,env=process.env){const r=spawnSync(command,args,{env,encoding:"utf8",timeout:Math.max(1,Math.min(20_000,deadline-Date.now())),windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${command}: ${r.stderr.trim()}`);return r.stdout.trim();}
try {
 run("docker",["run","--detach","--rm","--pull=never","--name",container,"--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=documents_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD",image],{...process.env,POSTGRES_PASSWORD:password});
 const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);
 const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/documents_test`;
 for(let n=0;n<25;n++){client=new pg.Client({connectionString,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch(error){await client.end().catch(()=>{});client=null;if(n===24)throw error;await new Promise(r=>setTimeout(r,200));}}
 const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false",DATABASE_ADMIN_URL:connectionString,MIGRATION_DATABASE_URL:connectionString};
 for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
 run(process.execPath,["scripts/db-bootstrap.mjs"],env);run(process.execPath,["scripts/db-migrate.mjs"],env);
 const ws="00000000-0000-4000-8000-000000000001",otherWs=randomUUID(),maker=randomUUID(),checker=randomUUID(),hidden=randomUUID(),limited=randomUUID();
 await client.query("insert into app_auth.accounts(id,email,username) values($1,'maker@example.test','doc-maker'),($2,'checker@example.test','doc-checker'),($3,'hidden@example.test','doc-hidden')",[maker,checker,hidden]);
 await client.query("insert into public.workspaces(id,slug,name) values($1,'doc-other','Other')",[otherWs]);
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'ADMIN'),($1,$3,'ADMIN'),($4,$5,'ADMIN')",[ws,maker,checker,otherWs,hidden]);
 const as=async(user=maker,workspace=ws,role="crm_app")=>{await client.query("reset role");await client.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[user,workspace]);await client.query(`set role ${role}`);};
 const rpc=async(name,args)=>(await client.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) result`,args)).rows[0].result;
 await client.query("insert into app_auth.accounts(id,email,username) values($1,'limited@example.test','doc-limited')",[limited]);await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'SALES_SPECIALIST')",[ws,limited]);
 const person=(await client.query("insert into public.contacts(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'合成学生','Synthetic Student',$2,$2) returning id",[ws,maker])).rows[0].id;
 const household=(await client.query("insert into public.households(workspace_id,name_zh,name_en,created_by) values($1,'合成家庭','Synthetic Household',$2) returning id",[ws,maker])).rows[0].id;
 const student=(await client.query("insert into public.students(workspace_id,person_id,household_id,owner_id,created_by) values($1,$2,$3,$4,$4) returning id",[ws,person,household,maker])).rows[0].id;
 const product=(await client.query("insert into public.products(workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en) values($1,'DOC-TEST','合成香港大学计算机与人工智能国际项目长名称换行测试','Synthetic Program','PROJECT','一年','Year') returning id",[ws])).rows[0].id;
 const cohort=(await client.query("insert into public.product_cohorts(workspace_id,product_id,code,name_zh,name_en,status,start_on,end_on) values($1,$2,'DOC-2027','合成批次','Synthetic Cohort','RECRUITING','2027-07-05','2027-07-11') returning id",[ws,product])).rows[0].id;
 const org=(await client.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,'合成渠道机构教育与国际课程合作发展有限公司长名称换行测试','Synthetic Channel',$2,$2) returning id",[ws,maker])).rows[0].id;
 const channelPerson=(await client.query("insert into public.contacts(workspace_id,organization_id,name_zh,name_en,owner_id,created_by) values($1,$2,'合成签署联系人','Synthetic Channel Contact',$3,$3) returning id",[ws,org,maker])).rows[0].id;
 await as();
 const enrollment=(await client.query("select * from public.save_student_enrollment($1,null,$2,$3)",[randomUUID(),{student_id:student,cohort_id:cohort,household_id:household,opportunity_id:null,status:"INTERESTED",owner_id:maker,sales_owner_id:null,enrolled_at:null,completed_at:null,withdrawn_at:null,withdrawal_reason:""},randomUUID()])).rows[0];
 const contract=(await client.query("select * from public.create_buyer_contract($1,null,$2,$3,'2027-01-01','2028-01-01','CNY',20000)",["SYNTHETIC-DOCUMENT",household,product])).rows[0];
 await rpc("link_contract_enrollment",[randomUUID(),contract.id,enrollment.id,randomUUID()]);
 const catalog=JSON.parse(await readFile("templates/contracts/catalog.json","utf8"));
 const original=catalog.versions[1],testDefinition=structuredClone(original);
 testDefinition.review_items=[];for(const f of testDefinition.fields)if(f.category==="UNSUPPORTED"){f.category="TEMPLATE_CONSTANT";f.value="合成技术测试条款 / TEST ONLY";}
 const draftId=await rpc("register_document_template",[original]);testDefinition.version_number=2;
 const templateId=await rpc("register_document_template",[testDefinition]);
 await assert.rejects(rpc("govern_document_template",[templateId,"APPROVED"]),/maker_checker/);
 await as(checker);await rpc("govern_document_template",[templateId,"APPROVED"]);await as();
 const fixture=JSON.parse(await readFile(original.fixture_path,"utf8")),confirmed={},staticValues={};
 for(const f of original.fields)if(f.category==="USER_CONFIRMED"){const dest=/^(company|bank)\./.test(f.key)?staticValues:confirmed;if(fixture.confirmed[f.key]!==undefined)dest[f.key]=fixture.confirmed[f.key];}
 process.env.DOCUMENT_CONFIGURATION_ENCRYPTION_KEY=randomBytes(32).toString("hex");
 if(process.env.CONTRACT_DOCUMENT_RELEASE_TEST==='1'){
  const scope={enrollmentId:enrollment.id},rev=(await rpc('document_generation_context',['CUSTOMER_CONTRACT',contract.id,scope])).sourceRevision;
  await assert.rejects(rpc('request_contract_document',[templateId,'CUSTOMER_CONTRACT',contract.id,rev,scope,confirmed,randomUUID(),'']),/document_configuration_required/);
 }
 const configurationId=await rpc("save_document_configuration",[sealDocumentConfiguration(staticValues)]);
 await as(checker);await rpc("govern_document_configuration",[configurationId,"APPROVED"]);await as();
 const context={enrollmentId:enrollment.id},canonical=await rpc("document_generation_context",["CUSTOMER_CONTRACT",contract.id,context]);
 const revision=canonical.sourceRevision,key=randomUUID();
 const request=(id=templateId,rev=revision,values=confirmed,requestKey=key,scope=context)=>rpc("request_contract_document",[id,"CUSTOMER_CONTRACT",contract.id,rev,scope,values,requestKey,""]);
 await assert.rejects(request(draftId,revision,confirmed,randomUUID()),/template_not_approved/);
 await assert.rejects(request(templateId,revision+1,confirmed,randomUUID()),/source_conflict/);
 await assert.rejects(request(templateId,revision,{...confirmed,"contract.amount":"1"},randomUUID()),/override_forbidden/);
 await assert.rejects(request(templateId,revision,confirmed,randomUUID(),{enrollmentId:randomUUID()}),/enrollment_not_found/);
 const id=await request();assert.equal(await request(),id);
 await assert.rejects(request(templateId,revision,{...confirmed,"buyer.signing_name":"other"}),/request_conflict/);
 await as(hidden,otherWs);await assert.rejects(request(),/source_not_found/);assert.equal((await client.query("select count(*)::int n from public.contract_document_template_versions")).rows[0].n,0);await as();
 await client.query("reset role");
 assert.equal((await client.query("select count(*)::int n from public.generated_contract_documents")).rows[0].n,1);
 assert.equal((await client.query("select count(*)::int n from public.generated_jobs where job_type='CONTRACT_DOCUMENT_GENERATION'")).rows[0].n,1);
 const beforeFacts=(await client.query("select row_to_json(c) facts from public.contracts c where id=$1",[contract.id])).rows[0].facts;
 const storageRoot=path.resolve("work/v324-phase2/postgres/objects");
 const workerEnv={...env,WORKER_DATABASE_URL:`postgresql://crm_worker:${env.CRM_WORKER_DB_PASSWORD}@127.0.0.1:${port}/documents_test`,OBJECT_STORAGE_PROVIDER:"local",OBJECT_STORAGE_LOCAL_ROOT:storageRoot,DOCUMENT_CONFIGURATION_ENCRYPTION_KEY:process.env.DOCUMENT_CONFIGURATION_ENCRYPTION_KEY};
 run(process.execPath,["scripts/process-generated-jobs.mjs"],workerEnv);
 const output=(await client.query("select artifact_key key,artifact_sha256 sha256,status from public.generated_contract_documents where id=$1",[id])).rows[0];
 assert.equal(output.status,"GENERATED");
 const artifact=await readFile(path.join(storageRoot,output.key));assert.equal(digest(artifact),output.sha256);
 await as();const download=await rpc("contract_document_download",[id]);assert.equal(download.sha256,output.sha256);
 if(process.env.CONTRACT_DOCUMENT_RELEASE_TEST==='1')await contractDocumentReleaseScenario({client,as,rpc,run,workerEnv,sourceKind:'CUSTOMER_CONTRACT',sourceId:contract.id,sourceRevision:revision,context,artifact,storageRoot,generatedDocumentId:id});
 const list=await rpc("list_contract_documents",["CUSTOMER_CONTRACT",contract.id]);assert.equal(list.length,1);assert.equal(list[0].status,"GENERATED");assert.ok(!JSON.stringify(list).includes("guardian.name"));
 await as(hidden,otherWs);await assert.rejects(rpc("contract_document_download",[id]),/source_not_found/);await as(limited);await assert.rejects(rpc("contract_document_download",[id]),/source_not_found/);await assert.rejects(rpc("document_generation_context",["CUSTOMER_CONTRACT",contract.id,context]),/source_not_found/);await as();
 await client.query("reset role");
 assert.deepEqual((await client.query("select row_to_json(c) facts from public.contracts c where id=$1",[contract.id])).rows[0].facts,beforeFacts);
 const audits=(await client.query("select after_data from public.audit_events where entity_id=$1",[id])).rows;
 assert.equal(audits.length,2);for(const a of audits)assert.ok(!JSON.stringify(a).includes(fixture.confirmed["guardian.name"]));
 await assert.rejects(client.query("update public.generated_contract_documents set input_snapshot='{}' where id=$1",[id]),/document_immutable/);
 // Audit insertion is part of the request transaction; an injected failure rolls everything back.
 const countBefore=(await client.query("select count(*)::int n from public.generated_contract_documents")).rows[0].n;
 await client.query("create function public.test_document_audit_failure() returns trigger language plpgsql as $$begin if new.action='CONTRACT_DOCUMENT_GENERATION_REQUESTED' then raise exception 'synthetic_audit_failure';end if;return new;end $$;create trigger test_document_audit before insert on public.audit_events for each row execute function public.test_document_audit_failure()");
 await as();await assert.rejects(request(templateId,revision,confirmed,randomUUID()),/synthetic_audit_failure/);await client.query("reset role");
 assert.equal((await client.query("select count(*)::int n from public.generated_contract_documents")).rows[0].n,countBefore);
 await client.query("drop trigger test_document_audit on public.audit_events;drop function public.test_document_audit_failure()");
 // True concurrent clients with the same payload-bound request create exactly one new version/job.
 const concurrentKey=randomUUID();
 const concurrent=async()=>{const peer=new pg.Client({connectionString});await peer.connect();try{await peer.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[maker,ws]);await peer.query("set role crm_app");return (await peer.query("select public.request_contract_document($1,'CUSTOMER_CONTRACT',$2,$3,$4,$5,$6,'') id",[templateId,contract.id,revision,context,confirmed,concurrentKey])).rows[0].id;}finally{await peer.end();}};
 const concurrentResults=await Promise.all([concurrent(),concurrent()]);assert.equal(concurrentResults[0],concurrentResults[1]);
 // Channel generation has its own real source, version and explicitly selected rule.
 const agreement=(await client.query("insert into public.channel_agreements(workspace_id,organization_id,agreement_code,name_zh,created_by) values($1,$2,'DOC-CHANNEL','合成渠道协议',$3) returning id",[ws,org,maker])).rows[0].id;
 const agreementVersion=(await client.query("insert into public.channel_agreement_versions(workspace_id,agreement_id,version,effective_from,effective_to,signed_on,created_by) values($1,$2,1,'2027-01-01','2028-01-01','2027-01-01',$3) returning id",[ws,agreement,maker])).rows[0].id;
 const rule=(await client.query("insert into public.channel_commission_rules(workspace_id,agreement_version_id,scope_type,attribution_type,basis_type,fixed_amount,fixed_currency,earning_event) values($1,$2,'ALL_PRODUCTS','PRIMARY','FIXED_PER_ENROLLMENT',3750,'USD','ENROLLMENT_ACTIVE') returning id",[ws,agreementVersion])).rows[0].id;
 const percentage=(await client.query("insert into public.channel_commission_rules(workspace_id,agreement_version_id,scope_type,attribution_type,basis_type,rate_bps) values($1,$2,'ALL_PRODUCTS','ASSIST','PERCENT_OF_NET_COLLECTED',1000) returning id",[ws,agreementVersion])).rows[0].id;
 await as();const channelOriginal=catalog.versions[0],channelFixture=JSON.parse(await readFile(channelOriginal.fixture_path,"utf8")),channelConfirmed={};
 const channelDraft=await rpc("register_document_template",[channelOriginal]);const channelDefinition=structuredClone(channelOriginal);channelDefinition.version_number=2;channelDefinition.review_items=[];for(const f of channelDefinition.fields)if(f.category==='UNSUPPORTED'){f.category='TEMPLATE_CONSTANT';f.value='合成技术测试条款 / TEST ONLY';}
 const channelTemplate=await rpc("register_document_template",[channelDefinition]);await as(checker);await rpc("govern_document_template",[channelTemplate,"APPROVED"]);await as();
 for(const f of channelOriginal.fields)if(f.category==='USER_CONFIRMED'&&channelFixture.confirmed[f.key]!==undefined){if(/^company\./.test(f.key))staticValues[f.key]=channelFixture.confirmed[f.key];else channelConfirmed[f.key]=channelFixture.confirmed[f.key];}
 channelConfirmed["bank.account"]="SYNTHETIC_CHANNEL_ACCOUNT_NOT_COMPANY";
 const channelConfig=await rpc('save_document_configuration',[sealDocumentConfiguration(staticValues)]);await as(checker);await rpc('govern_document_configuration',[channelConfig,'APPROVED']);await as();
 const channelContext={productId:product,cohortId:cohort,commissionRuleId:rule};
 const channelRequest=(scope=channelContext,template=channelTemplate)=>rpc('request_contract_document',[template,'CHANNEL_AGREEMENT_VERSION',agreementVersion,1,scope,channelConfirmed,randomUUID(),'']);
 await assert.rejects(channelRequest(channelContext,channelDraft),/template_not_approved/);
 await assert.rejects(channelRequest({...channelContext,commissionRuleId:percentage}),/basis_unsupported/);
 await assert.rejects(channelRequest({...channelContext,commissionRuleId:randomUUID()}),/commission_rule_not_found/);
 const channelDocument=await channelRequest();await client.query('reset role');
 run(process.execPath,["scripts/process-generated-jobs.mjs"],workerEnv);
 const channelOutput=(await client.query('select status,artifact_key,artifact_sha256 from public.generated_contract_documents where id=$1',[channelDocument])).rows[0];assert.equal(channelOutput.status,'GENERATED');
 const channelArtifact=await readFile(path.join(storageRoot,channelOutput.artifact_key));assert.equal(digest(channelArtifact),channelOutput.artifact_sha256);
 await mkdir('work/v324-phase2/postgres',{recursive:true});await writeFile('work/v324-phase2/postgres/channel-generated.docx',channelArtifact);
 if(process.env.CONTRACT_DOCUMENT_RELEASE_TEST==='1'){await as();await contractDocumentReleaseScenario({client,as,rpc,run,workerEnv,sourceKind:'CHANNEL_AGREEMENT_VERSION',sourceId:agreementVersion,sourceRevision:1,context:channelContext,artifact:channelArtifact,storageRoot,generatedDocumentId:channelDocument});await client.query('reset role');}
 assert.equal((await client.query('select status from public.channel_agreement_versions where id=$1',[agreementVersion])).rows[0].status,'DRAFT');
 assert.equal((await client.query('select count(*)::int n from public.commission_accruals')).rows[0].n,0);
 // Retired templates reject new production work but retain authorized history downloads.
 await as(checker);await rpc('govern_document_template',[channelTemplate,'RETIRED']);await as();
 await assert.rejects(channelRequest(),/template_not_approved/);assert.equal((await rpc('contract_document_download',[channelDocument])).sha256,channelOutput.artifact_sha256);
 await client.query('reset role');
 // Source revision can move after generation; the old receipt and artifact keep their original revision.
 await client.query("update public.contracts set contract_value=22000 where id=$1",[contract.id]);await as();
 assert.equal(await rpc('document_request_receipt',['student-program',2,'CUSTOMER_CONTRACT',contract.id,revision,context,confirmed,key,'']),id);
 await assert.rejects(rpc('document_request_receipt',['student-program',2,'CUSTOMER_CONTRACT',contract.id,revision,context,{...confirmed,'buyer.signing_name':'other'},key,'']),/request_conflict/);
 await client.query('reset role');
 // Privacy evidence is available only for the verified subject of this leased export job.
 const privacy=(await client.query("insert into public.privacy_requests(workspace_id,requester_contact_id,request_type,identity_status,request_note,created_by) values($1,$2,'EXPORT','VERIFIED','Synthetic privacy test',$3) returning id",[ws,person,maker])).rows[0].id;
 const privacyJob=(await client.query("insert into public.generated_jobs(workspace_id,job_type,privacy_request_id,parameters,created_by) values($1,'PRIVACY_EXPORT',$2,$3,$4) returning id",[ws,privacy,{contactId:person,privacyRequestId:privacy,format:'CSV'},maker])).rows[0].id;
 await as(maker,ws,'crm_worker');const privacyClaim=(await client.query("select * from public.claim_generated_jobs_leased(10,'privacy-test',900)")).rows.find(j=>j.id===privacyJob);assert.ok(privacyClaim);
 await assert.rejects(rpc('document_privacy_records',[privacyJob,randomUUID()]),/lease_lost/);
 // Worker access is lease-scoped RPC access, never direct evidence table access.
 await assert.rejects(client.query('select input_snapshot from public.generated_contract_documents'),/permission denied/);
 await assert.rejects(client.query("update public.generated_contract_documents set status='ERASED' where id=$1",[id]),/permission denied/);
 assert.equal(await rpc('document_erasure_input',[privacyJob,privacyClaim.lease_token]),null);
 await assert.rejects(rpc('finish_document_erasure',[privacyJob,privacyClaim.lease_token]),/lease_lost/);
 const exported=await rpc('document_privacy_records',[privacyJob,privacyClaim.lease_token]);assert.equal(exported.length,2);assert.ok(exported.every(r=>r.subject_fields.every(f=>f.source_id===person)));assert.ok(!JSON.stringify(exported).includes('guardian.name'));
 await client.query('reset role');await client.query("update public.generated_jobs set status='DEAD' where id=$1",[privacyJob]);
 // Renderer/configuration and real filesystem storage failures retry the same logical document.
 await as();const currentRevision=(await rpc('document_generation_context',['CUSTOMER_CONTRACT',contract.id,context])).sourceRevision;
 const retryValues={...confirmed,'service.program_component':'19000.00','service.logistics_component':'3000.00'};
 const retryDocument=await request(templateId,currentRevision,retryValues,randomUUID());await client.query('reset role');
 run(process.execPath,['scripts/process-generated-jobs.mjs'],{...workerEnv,DOCUMENT_CONFIGURATION_ENCRYPTION_KEY:randomBytes(32).toString('hex')});
 assert.equal((await client.query('select status from public.generated_contract_documents where id=$1',[retryDocument])).rows[0].status,'FAILED');
 await client.query('update public.generated_jobs set available_at=now() where document_generation_id=$1',[retryDocument]);
 const blockedRoot=path.resolve('work/v324-phase2/postgres/blocked-storage');await writeFile(blockedRoot,'Synthetic regular file, not a storage directory');
 run(process.execPath,['scripts/process-generated-jobs.mjs'],{...workerEnv,OBJECT_STORAGE_LOCAL_ROOT:blockedRoot});
 assert.equal((await client.query('select status from public.generated_contract_documents where id=$1',[retryDocument])).rows[0].status,'FAILED');
 await client.query('update public.generated_jobs set available_at=now() where document_generation_id=$1',[retryDocument]);run(process.execPath,['scripts/process-generated-jobs.mjs'],workerEnv);
 assert.equal((await client.query('select status from public.generated_contract_documents where id=$1',[retryDocument])).rows[0].status,'GENERATED');
 assert.equal((await client.query('select count(*)::int n from public.generated_jobs where document_generation_id=$1',[retryDocument])).rows[0].n,1);
 // Privacy clears consumed personal evidence and makes download unavailable, Finance is retained.
 await client.query("delete from public.students where id=$1",[student]);
 assert.equal((await client.query("select status,input_snapshot,evidence from public.generated_contract_documents where id=$1",[id])).rows[0].status,"ERASURE_PENDING");
 assert.equal((await client.query("select count(*)::int n from public.contracts where id=$1",[contract.id])).rows[0].n,1);
 await mkdir("work/v324-phase2/postgres",{recursive:true});
 await writeFile("work/v324-phase2/postgres/student-generated.docx",artifact);
 run(process.execPath,["scripts/process-generated-jobs.mjs"],workerEnv);
 assert.equal((await client.query("select status from public.generated_contract_documents where id=$1",[id])).rows[0].status,"ERASED");
 await assert.rejects(readFile(path.join(storageRoot,output.key)),/ENOENT/);
 await client.query("delete from public.contacts where id=$1",[channelPerson]);assert.equal((await client.query("select status from public.generated_contract_documents where id=$1",[channelDocument])).rows[0].status,"ERASURE_PENDING");run(process.execPath,["scripts/process-generated-jobs.mjs"],workerEnv);assert.equal((await client.query("select status from public.generated_contract_documents where id=$1",[channelDocument])).rows[0].status,"ERASED");assert.equal((await client.query("select count(*)::int n from public.channel_agreements where id=$1",[agreement])).rows[0].n,1);
 await writeFile("work/v324-phase2/postgres/verification.json",JSON.stringify({status:"PASS",documentId:id,artifactSHA256:output.sha256,sourceRevision:revision,templateStatus:"TEST_ONLY_APPROVED",realCatalog:"DRAFT",tests:["RLS workspace","maker-checker","source revision","cross-enrollment","canonical override","idempotency","payload reuse","enqueue","lease","Node renderer","actual local object storage","actual existing worker CLI","concurrent request","audit rollback","Channel rule context","percentage rejection","real DRAFT rejection","retired historical download","no Agreement activation","no Commission mutation","completion","download authorization","evidence immutability","audit minimization","leased subject-only privacy export","privacy erasure","hidden same-workspace source","retry after source revision changed","Contract retained","no Contract mutation","actual worker renderer failure","actual filesystem storage failure","retry same document/job after failure","Channel Contact erasure/Agreement retention","worker direct evidence access denied","erasure wrong-origin lease denied"]},null,2)+"\n");
 console.log("PASS: disposable PostgreSQL document pipeline and targeted security/privacy assertions");
}finally{if(client)await client.end().catch(()=>{});spawnSync("docker",["rm","--force",container],{encoding:"utf8",timeout:10000,windowsHide:true});}
