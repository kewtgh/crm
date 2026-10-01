import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
const container=`lumina-crm-customer-it-${randomBytes(5).toString("hex")}`,deadline=Date.now()+50_000,password=randomBytes(32).toString("hex");
let client;
function run(command,args,env=process.env){const result=spawnSync(command,args,{env,encoding:"utf8",timeout:Math.max(1,Math.min(15_000,deadline-Date.now())),windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed: ${result.stderr.trim()}`);return result.stdout.trim();}
try{
  run("docker",["run","--detach","--rm","--pull=never","--name",container,"--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=lumina_customer_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD","postgres:18.4-bookworm"],{...process.env,POSTGRES_PASSWORD:password});
  const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);assert.match(port,/^\d+$/);
  const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/lumina_customer_test`;
  for(let attempt=0;attempt<20;attempt++){client=new pg.Client({connectionString,connectionTimeoutMillis:500,statement_timeout:5000});try{await client.connect();break;}catch(error){await client.end().catch(()=>{});if(attempt===19)throw error;await new Promise(resolve=>setTimeout(resolve,150));}}
  const env={...process.env,DATABASE_ADMIN_URL:connectionString,MIGRATION_DATABASE_URL:connectionString};for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
  run(process.execPath,["scripts/db-bootstrap.mjs"],env);run(process.execPath,["scripts/db-migrate.mjs"],env);
  const ws="00000000-0000-4000-8000-000000000001",admin=randomUUID(),sales=randomUUID(),otherWs=randomUUID(),foreign=randomUUID();
  for(const [id,role,name] of [[admin,"ADMIN","admin"],[sales,"SALES_SPECIALIST","sales"]]){
    await client.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)",[id,`${name}@example.test`,name]);
    await client.query("insert into public.workspace_memberships(workspace_id,user_id,role,status) values($1,$2,$3,'ACTIVE')",[ws,id,role]);
  }
  await client.query("insert into public.workspaces(id,slug,name) values($1,'customer-other','Other')",[otherWs]);
  await client.query("insert into public.organizations(id,workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,'外部','Foreign',$3,$3)",[foreign,otherWs,admin]);
  const context=async id=>{await client.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[id,ws]);};
  await context(admin);await client.query("set role crm_app");
  const create=async profile=>(await client.query("select * from public.create_customer_contact($1::jsonb)",[JSON.stringify({nameZh:"客",nameEn:"客",email:"customer@example.test",...profile})])).rows[0];
  const contact=await create({ownerId:sales});assert.equal(contact.owner_id,sales);assert.equal(contact.organization_id,null);assert.equal(contact.title,"");
  await assert.rejects(create({organizationId:foreign}),/related_record_not_found/);
  await assert.rejects(create({nameZh:"",nameEn:""}),/contact_profile_invalid/);
  const save=(kind,id,operation,details)=>client.query("select public.save_customer_follow_up($1,$2,$3,$4::jsonb) as item",[kind,id,operation,JSON.stringify(details)]);
  await save("CONTACT",contact.id,"plan",{title:"跟进",targetLevel:2,targetCount:3,startDate:"2026-10-01",dueDate:"2026-10-31"});
  const entry={requestKey:randomUUID(),kind:"CALL",summary:"了解需求",nextStep:"确认时间",occurredAt:"2026-09-30T01:00:00Z"};
  const saved=(await save("CONTACT",contact.id,"entry",entry)).rows[0].item;
  assert.equal((await save("CONTACT",contact.id,"entry",entry)).rows[0].item.id,saved.id);
  assert.equal((await client.query("select count(*)::int as count from public.customer_follow_up_history where subject_id=$1",[contact.id])).rows[0].count,1);
  await client.query("reset role");
  await client.query("insert into public.crm_activities(contact_id,activity_type,summary_zh,summary_en) values($1,'MEETING','旧活动','Legacy')",[contact.id]);
  await client.query("set role crm_app");
  assert.equal((await client.query("select count(*)::int as count from public.customer_follow_up_history where subject_id=$1",[contact.id])).rows[0].count,2);
  await assert.rejects(save("CONTACT",contact.id,"entry",{...entry,summary:"其他"}),/follow_up_idempotency_conflict/);
  const org=(await client.query("insert into public.organizations(name_zh,name_en,city,curriculum,short_name,owner_id) values('测试','Test','Taipei','IB','简称',$1) returning *",[admin])).rows[0];
  assert.equal((await client.query("select public.crm_resource_metrics('schools','简称','all') as result")).rows[0].result.total,1);
  const stamp=(await client.query("select updated_at::text as stamp from public.organizations where id=$1",[org.id])).rows[0].stamp;
  const profile={nameZh:"测试",nameEn:"Test",city:"Taipei",curriculum:"IB",shortName:"新简称",status:"HEALTHY"};
  const update=()=>client.query("select * from public.update_school_customer_profile($1,$2,$3::jsonb)",[org.id,stamp,JSON.stringify(profile)]);
  assert.equal((await update()).rows[0].short_name,"新简称");await assert.rejects(update(),/crm_version_conflict/);
  await context(sales);
  await create({ownerId:sales,email:"self@example.test"});await assert.rejects(create({ownerId:admin,email:"assign@example.test"}),/contact_owner_not_assignable/);
  await save("CONTACT",contact.id,"entry",{...entry,requestKey:randomUUID()});
  await assert.rejects(save("ORGANIZATION",org.id,"plan",{title:"Unauthorised",targetLevel:2,targetCount:1,startDate:"2026-10-01",dueDate:"2026-10-02"}),/crm_update_forbidden/);
  await assert.rejects(client.query("insert into public.customer_follow_up_entries(subject_kind,subject_id,kind,summary,next_step,request_key) values('CONTACT',$1,'NOTE','x','y',$2)",[contact.id,randomUUID()]),/permission denied/);
  await client.query("reset role");await context(admin);
  const household=(await client.query("insert into public.households(workspace_id,name_zh,name_en,created_by) values($1,'家庭','Family',$2) returning id",[ws,admin])).rows[0].id;
  const contract=(await client.query("insert into public.contracts(workspace_id,contract_number,organization_id,start_date,end_date,contract_value,owner_id,created_by) values($1,'FAMILY-1',$2,current_date,current_date+1,1,$3,$3) returning id",[ws,org.id,admin])).rows[0].id;
  await client.query("set role crm_app");await save("HOUSEHOLD",household,"contract",{contractId:contract});await save("HOUSEHOLD",household,"contract",{contractId:contract});
  assert.equal((await client.query("select count(*)::int as count from public.customer_contract_links where subject_id=$1",[household])).rows[0].count,1);
  await client.query("reset role");await client.query("delete from public.households where id=$1",[household]);
  assert.equal((await client.query("select count(*)::int as count from public.customer_contract_links where subject_id=$1",[household])).rows[0].count,0);
  console.log("PASS PostgreSQL 18.4: contact owner/standalone/foreign guards, follow-up plan/entry idempotency, role and direct-write denial, alias search/update/version, explicit family contract links.");
}finally{
  await client?.end().catch(()=>{});assert.match(container,/^lumina-crm-customer-it-[a-f0-9]{10}$/);
  const result=spawnSync("docker",["rm","--force",container],{encoding:"utf8",timeout:10_000,windowsHide:true});if(result.status!==0&&!result.stderr?.includes("No such container"))throw new Error(`Cleanup failed for ${container}`);
}
