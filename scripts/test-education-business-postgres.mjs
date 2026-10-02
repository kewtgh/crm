import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
const container=`lumina-crm-education-it-${randomBytes(5).toString("hex")}`,deadline=Date.now()+50_000,password=randomBytes(32).toString("hex");
let client;
function run(command,args,env=process.env){const result=spawnSync(command,args,{env,encoding:"utf8",timeout:Math.max(1,Math.min(15_000,deadline-Date.now())),windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed: ${result.stderr.trim()}`);return result.stdout.trim();}
try{
  run("docker",["run","--detach","--rm","--pull=never","--name",container,"--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=lumina_education_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD","postgres:18.4-bookworm"],{...process.env,POSTGRES_PASSWORD:password});
  const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);assert.match(port,/^\d+$/);
  const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/lumina_education_test`;
  for(let attempt=0;attempt<20;attempt++){client=new pg.Client({connectionString,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch(error){await client.end().catch(()=>{});if(attempt===19)throw error;await new Promise(resolve=>setTimeout(resolve,150));}}
  const env={...process.env,DATABASE_ADMIN_URL:connectionString,MIGRATION_DATABASE_URL:connectionString};for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
  run(process.execPath,["scripts/db-bootstrap.mjs"],env);run(process.execPath,["scripts/db-migrate.mjs"],env);
  const ws="00000000-0000-4000-8000-000000000001",admin=randomUUID(),sales=randomUUID(),foreignWs=randomUUID();
  for(const [id,role,name] of [[admin,"ADMIN","admin"],[sales,"SALES_SPECIALIST","sales"]]){
    await client.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)",[id,`${name}@example.test`,name]);
    await client.query("insert into public.workspace_memberships(workspace_id,user_id,role,status) values($1,$2,$3,'ACTIVE')",[ws,id,role]);
  }
  await client.query("insert into public.workspaces(id,slug,name) values($1,'education-other','Other')",[foreignWs]);
  const context=async id=>client.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[id,ws]);
  await context(admin);
  const org=async(name,workspace=ws)=>(await client.query("insert into public.organizations(workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,$2,$3,$3) returning id",[workspace,name,admin])).rows[0].id;
  const school=await org("school"),partner=await org("partner"),unrelated=await org("unrelated"),foreign=await org("foreign",foreignWs);
  const household=(await client.query("insert into public.households(name_zh,name_en,created_by) values('家庭','Family',$1) returning id",[admin])).rows[0].id;
  const contact=(await client.query("insert into public.contacts(name_zh,name_en,email,owner_id,created_by) values('学生','Student','student@example.test',$1,$1) returning id",[admin])).rows[0].id;
  const student=(await client.query("insert into public.students(person_id,household_id,created_by) values($1,$2,$3) returning id",[contact,household,admin])).rows[0].id;
  await client.query("set role crm_app");
  const save=async(resource,id,data,revision=null)=>(await client.query("select public.save_education_business($1,$2,$3,$4::jsonb) as item",[resource,id,revision,JSON.stringify(data)])).rows[0].item;
  const profile={id:school,organization_type:"SCHOOL",roles:["SCHOOL_ENTRY","TOUR_PARTNER"],partnership_stage:"ACTIVE",primary_contact_id:null,focus_regions:["UK"],agreement_expires_on:null,next_action:"Arrange seminar"};
  assert.equal((await save("organizations",school,profile)).revision,1);
  assert.equal((await save("organizations",school,profile)).revision,1);
  await assert.rejects(save("organizations",school,{...profile,next_action:"Different"}),/business_version_conflict/);
  const changed={...profile,organization_type:"PARTNER",roles:["REFERRAL_PARTNER","TOUR_PARTNER"]};
  assert.equal((await save("organizations",school,changed,1)).revision,2);assert.equal((await save("organizations",school,changed,1)).revision,2);
  await assert.rejects(save("organizations",school,{...changed,next_action:"Stale"},1),/business_version_conflict/);
  assert.equal((await client.query("select organization_type from public.organizations where id=$1",[school])).rows[0].organization_type,"PARTNER");
  const needs={id:household,services:["FOUNDATION"],target_regions:["UK"],budget_min:null,budget_max:0,budget_currency:"GBP",target_intake:null,decision_stage:"DISCOVERY",next_action:""};
  assert.equal((await save("needs",household,needs)).budget_min,null);
  await assert.rejects(save("needs",household,{...needs,budget_min:100,budget_max:0},1),/check constraint/);
  await assert.rejects(save("needs",household,{...needs,budget_min:0.555,budget_max:10},1),/business_input_invalid/);
  const eventId=randomUUID(),event={name:"Seminar",organization_id:school,partner_organization_id:partner,kind:"SEMINAR",starts_on:"2026-10-02",ends_on:"2026-10-03",location:"School",capacity:30,attendee_count:null,status:"DRAFT",next_action:"Confirm speaker"};
  await save("events",eventId,event);
  await assert.rejects(save("events",randomUUID(),{...event,partner_organization_id:foreign}),/business_update_forbidden/);
  await assert.rejects(save("events",randomUUID(),{...event,ends_on:"2026-10-01"}),/check constraint/);
  const referralId=randomUUID(),referral={source_organization_id:partner,household_id:household,event_id:eventId,introduced_by_contact_id:null,referred_on:"2026-10-02",status:"NEW",next_action:"Call family"};
  await save("referrals",referralId,referral);assert.equal((await save("referrals",referralId,referral)).revision,1);
  await assert.rejects(save("referrals",randomUUID(),{...referral,source_organization_id:unrelated}),/business_event_source_mismatch/);
  await assert.rejects(save("events",eventId,{...event,partner_organization_id:null},1),/business_event_source_mismatch/);
  assert.equal((await client.query("select revision from public.education_outreach_events where id=$1",[eventId])).rows[0].revision,1);
  const pathwayId=randomUUID(),pathway={student_id:student,program_type:"FOUNDATION",target_organization_id:null,target_region:"UK",target_major:"Economics",intake_date:"2027-09-01",application_deadline:"2027-06-01",language_test:"IELTS",language_score:6.5,stage:"PREPARING",next_action:"Review application"};
  await save("pathways",pathwayId,pathway);await save("pathways",randomUUID(),{...pathway,program_type:"BRIDGE"});
  const concurrent=new pg.Client({connectionString,statement_timeout:5000});await concurrent.connect();
  try{
    await concurrent.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[admin,ws]);await concurrent.query("set role crm_app");
    const outcomes=await Promise.allSettled([
      save("pathways",pathwayId,{...pathway,next_action:"First editor"},1),
      concurrent.query("select public.save_education_business('pathways',$1,1,$2::jsonb)",[pathwayId,JSON.stringify({...pathway,next_action:"Second editor"})]),
    ]);
    const errors=outcomes.filter(result=>result.status==="rejected").map(result=>result.reason.message).join(", ");
    assert.equal(outcomes.filter(result=>result.status==="fulfilled").length,1,errors);assert.equal(outcomes.filter(result=>result.status==="rejected"&&/business_version_conflict/.test(result.reason.message)).length,1,errors);
  }finally{await concurrent.end();}
  await assert.rejects(save("pathways",randomUUID(),{...pathway,language_score:10}),/check constraint/);
  await assert.rejects(save("pathways",randomUUID(),{...pathway,workspace_id:foreignWs}),/business_input_invalid/);
  await assert.rejects(client.query("update public.student_pathways set stage='ENROLLED' where id=$1",[pathwayId]),/permission denied/);
  const permissions=(await client.query("select * from public.education_business_permissions('events',array[$1]::uuid[])",[eventId])).rows;
  assert.equal(permissions[0].can_edit,true);
  await context(sales);
  assert.equal((await client.query("select count(*)::int as n from public.education_outreach_events")).rows[0].n,0);
  await assert.rejects(save("events",eventId,event,1),/business_update_forbidden/);
  await context(admin);await client.query("reset role");
  await client.query("set role crm_worker");assert.equal((await client.query("select count(*)::int as n from public.student_pathways")).rows[0].n,2);
  await assert.rejects(client.query("update public.student_pathways set stage='CLOSED'"),/permission denied/);
  await client.query("reset role");
  await client.query("update public.organizations set organization_type='OTHER' where id=$1",[school]);
  const synced=(await client.query("select organization_type,revision from public.organization_business_profiles where id=$1",[school])).rows[0];assert.equal(synced.organization_type,"OTHER");assert.equal(synced.revision,3);
  // Superuser attempts also exercise the composite FK instead of relying only on RPC permissions.
  await assert.rejects(client.query("update public.education_outreach_events set partner_organization_id=$1 where id=$2",[foreign,eventId]),/foreign key constraint/);
  await client.query("update public.contacts set do_not_contact_reason='PRIVACY_DELETION:test' where id=$1",[contact]);
  assert.equal((await client.query("select count(*)::int as n from public.student_pathways where student_id=$1",[student])).rows[0].n,0);
  await client.query("delete from public.households where id=$1",[household]);
  assert.equal((await client.query("select count(*)::int as n from public.education_family_referrals where id=$1",[referralId])).rows[0].n,0);
  console.log("Education business PostgreSQL: migration, typed constraints, idempotency, revisions, attribution, RLS, tenant FKs, privacy cleanup and lifecycle passed.");
}finally{
  await client?.end().catch(()=>{});
  const cleanup=spawnSync("docker",["rm","--force",container],{encoding:"utf8",timeout:5000,windowsHide:true});
  if(cleanup.status!==0&&!cleanup.stderr?.includes("No such container"))throw new Error(`Temporary education database cleanup failed: ${cleanup.stderr.trim()}`);
}
