import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

// One product regression on a disposable database, using an already installed image.
// Never loads .env.local or contacts an existing application database.
const container=`lumina-crm-products-it-${randomBytes(5).toString("hex")}`;
const deadline=Date.now()+50_000;
const password=randomBytes(32).toString("hex");
let client;
function run(command,args,env=process.env){
  const result=spawnSync(command,args,{env,encoding:"utf8",timeout:Math.max(1,Math.min(15_000,deadline-Date.now())),windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}
try{
  run("docker",["run","--detach","--rm","--pull=never","--name",container,"--label","com.lumina.crm.test=product-mutations","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=768m","--env","POSTGRES_DB=lumina_products_test","--env","POSTGRES_USER=postgres","--env","POSTGRES_PASSWORD","postgres:18.6-trixie"],{...process.env,POSTGRES_PASSWORD:password});
  const port=run("docker",["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}",container]);
  assert.match(port,/^\d+$/);
  const connectionString=`postgresql://postgres:${password}@127.0.0.1:${port}/lumina_products_test`;
  for(let attempt=0;attempt<20;attempt++){
    client=new pg.Client({connectionString,connectionTimeoutMillis:500,statement_timeout:5000});
    try{await client.connect();break;}catch(error){await client.end().catch(()=>{});client=undefined;if(attempt===19)throw error;await new Promise(resolve=>setTimeout(resolve,200));}
  }
  const env={...process.env,NODE_ENV:"test",DATABASE_SSL:"false",DATABASE_ADMIN_URL:connectionString,MIGRATION_DATABASE_URL:connectionString};
  for(const role of ["APP","SYSTEM","WORKER","MIGRATOR","BACKUP"])env[`CRM_${role}_DB_PASSWORD`]=randomBytes(32).toString("hex");
  run(process.execPath,["scripts/db-bootstrap.mjs"],env);
  run(process.execPath,["scripts/db-migrate.mjs"],env);
  const ws="00000000-0000-4000-8000-000000000001", user=randomUUID(), otherWs=randomUUID();
  await client.query("insert into app_auth.accounts(id,email,username) values($1,'product-admin@example.test','product-admin')",[user]);
  await client.query("insert into public.user_profiles(user_id,username,display_name_zh,display_name_en) values($1,'product-admin','产品管理员','Product admin') on conflict(user_id) do nothing",[user]);
  await client.query("insert into public.workspace_memberships(workspace_id,user_id,role,status) values($1,$2,'SUPER_ADMIN','ACTIVE')",[ws,user]);
  await client.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)",[user,ws]);
  await client.query("set role crm_app");
  // Migration 082: API fallback may supply a single-character Chinese name or
  // a 120-character English name to both legacy storage fields, without truncation.
  const rule=(await client.query("insert into public.automation_rules(name_zh,name_en,trigger_key,action_type) values('一','一','MANUAL','TASK') returning id")).rows[0];
  await assert.rejects(client.query("update public.automation_rules set name_zh='' where id=$1",[rule.id]),/automation_rules_name_zh_check/);
  const create=async(code)=>(await client.query("select * from public.create_product_with_price($1,'测试产品','Test product','PROJECT','一次','Once','','','ACTIVE','CNY',100)",[code])).rows[0];
  const product=await create("PRODUCT-REGRESSION");
  const nameBundleItems=JSON.stringify([{productId:product.id,quantity:1,optional:false,discountCeiling:0}]);
  const longName="E".repeat(120);
  const nameBundle=(await client.query("select * from public.create_product_bundle('SINGLE-NAME-LONG',$1,$1,$2)",[longName,nameBundleItems])).rows[0];
  assert.equal(nameBundle.name_zh,longName);assert.equal(nameBundle.name_en,longName);
  await client.query("select public.create_product_bundle('SINGLE-NAME-SHORT','一','一',$1)",[nameBundleItems]);
  await assert.rejects(client.query("select public.create_product_bundle('SINGLE-NAME-EMPTY','','',$1)",[nameBundleItems]),/product_bundle_invalid/);
  // Version tokens must come from the real catalog, not a JS Date (millisecond precision).
  const catalog=async()=>(await client.query("select public.product_catalog_snapshot() as items")).rows[0].items;
  const original=(await catalog()).find(item=>item.id===product.id);
  assert.match(original.updatedAt,/\+00:00$/);
  const update=async(version)=>client.query("select * from public.update_product_record($1,$2,'PRODUCT-REGRESSION','更新产品','Updated product','PROJECT','一次','Once','介绍','Introduction','ACTIVE',true)",[product.id,version]);
  await update(original.updatedAt);
  await assert.rejects(update(original.updatedAt),/product_version_conflict/);
  const current=(await catalog()).find(item=>item.id===product.id);
  const archive=async(version=current.updatedAt)=>client.query("select * from public.archive_product_record($1,$2)",[product.id,version]);
  await assert.rejects(archive(original.updatedAt),/product_version_conflict/);
  await client.query("select set_config('app.aal','aal1',false)");
  await assert.rejects(archive(),/product_delete_not_authorized/);
  await client.query("select set_config('app.aal','aal2',false)");
  await client.query("reset role");
  await client.query("update public.workspace_memberships set role='SALES_DIRECTOR' where user_id=$1",[user]);
  await client.query("set role crm_app");
  await assert.rejects(archive(),/product_delete_not_authorized/);
  await client.query("reset role");
  await client.query("update public.workspace_memberships set role='ADMIN' where user_id=$1",[user]);
  // Preserve a real historical reference when archiving a product.
  const organization=randomUUID(),contract=randomUUID();
  await client.query("insert into public.organizations(id,workspace_id,name_zh,name_en,organization_type,owner_id,created_by) values($1,$2,'测试客户','Test customer','SCHOOL',$3,$3)",[organization,ws,user]);
  await client.query("insert into public.contracts(id,workspace_id,contract_number,organization_id,product_id,start_date,end_date,contract_value,owner_id,created_by) values($1,$2,'PRODUCT-REF',$3,$4,current_date,current_date+1,100,$5,$5)",[contract,ws,organization,product.id,user]);
  await client.query("insert into public.workspaces(id,slug,name) values($1,'other-products-test','Other workspace')",[otherWs]);
  const foreignProduct=(await client.query("insert into public.products(workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en,created_by) values($1,'OTHER-PRODUCT','其他产品','Other product','PROJECT','一次','Once',$2) returning id",[otherWs,user])).rows[0].id;
  await client.query("set role crm_app");
  await assert.rejects(client.query("select public.archive_product_record($1,$2)",[foreignProduct,current.updatedAt]),/product_not_found/);
  const bundleMain=await create("PRODUCT-BUNDLE-MAIN");
  const bundle=(await client.query("select * from public.create_product_bundle('PRODUCT-BUNDLE','产品套餐','Product bundle',$1)",[JSON.stringify([{productId:bundleMain.id,quantity:1,optional:false,discountCeiling:0},{productId:product.id,quantity:1,optional:true,discountCeiling:0}])])).rows[0];
  const archived=(await archive()).rows[0];
  assert.ok(archived.archived_at);
  assert.equal(archived.active,false);
  assert.equal(archived.is_default,false);
  await archive(); // Retries must not fail or mutate the archive timestamp.
  assert.ok(!(await catalog()).some(item=>item.id===product.id));
  assert.equal((await client.query("select product_id from public.contracts where id=$1",[contract])).rows[0].product_id,product.id);
  await assert.rejects(update(current.updatedAt),/product_not_found/);
  await assert.rejects(client.query("select public.idempotent_set_product_lifecycle($1,'ACTIVE','deleted-product-retry')",[product.id]),/product_not_found/);
  await assert.rejects(client.query("select public.set_product_price($1,'CNY',200,current_date)",[product.id]),/product_not_found/);
  await assert.rejects(client.query("select public.create_quote_v100('ARCHIVED-PRODUCT-QUOTE',$1,null,$2,null,null,'CNY',100,0,current_date+1)",[organization,product.id]),/quote_product_invalid/);
  await assert.rejects(client.query("select public.create_quote_v100('ARCHIVED-BUNDLE-QUOTE',$1,null,null,$2,null,'CNY',100,0,current_date+1)",[organization,bundle.id]),/quote_bundle_invalid/);
  await assert.rejects(client.query("select public.restore_crm_recycle_bin('PRODUCT',$1)",[product.id]),/super_admin_required/);
  await client.query("reset role");
  await client.query("update public.workspace_memberships set role='SUPER_ADMIN' where user_id=$1",[user]);
  await client.query("set role crm_app");
  await client.query("select public.restore_crm_recycle_bin('PRODUCT',$1)",[product.id]);
  const restored=(await catalog()).find(item=>item.id===product.id);
  assert.equal(restored.active,true);
  assert.equal(restored.isDefault,false);
  assert.equal(restored.prices[0].amount,100);
  await client.query("select public.create_quote_v100('RESTORED-BUNDLE-QUOTE',$1,null,null,$2,null,'CNY',100,0,current_date+1)",[organization,bundle.id]);
  await archive(restored.updatedAt);
  const unused=await create("PRODUCT-UNUSED");
  const unusedVersion=(await catalog()).find(item=>item.id===unused.id).updatedAt;
  await client.query("select public.archive_product_record($1,$2)",[unused.id,unusedVersion]);
  await client.query("reset role");
  await client.query("update public.products set archived_at=now()-interval '31 days' where id=any($1::uuid[])",[[product.id,unused.id]]);
  await client.query("select set_config('app.system','true',false)");
  assert.equal((await client.query("select public.purge_expired_crm_recycle_bin() as removed")).rows[0].removed,1);
  assert.equal((await client.query("select count(*)::int as count from public.products where id=$1",[product.id])).rows[0].count,1);
  assert.equal((await client.query("select count(*)::int as count from public.products where id=$1",[unused.id])).rows[0].count,0);
  console.log("PASS PostgreSQL 18.6: update/version conflicts, admin/AAL2/workspace guards, referenced delete, retry, hidden catalog, stale writes, deleted-product and bundle quotes, restore, and unused-product cleanup");
}finally{
  await client?.end().catch(()=>{});
  assert.match(container,/^lumina-crm-products-it-[a-f0-9]{10}$/);
  const cleanup=spawnSync("docker",["rm","--force",container],{encoding:"utf8",timeout:10_000,windowsHide:true});
  if(cleanup.status!==0&&!cleanup.stderr?.includes("No such container"))throw new Error(`Could not remove isolated test container ${container}: ${cleanup.stderr}`);
}
