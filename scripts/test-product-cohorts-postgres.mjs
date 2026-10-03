import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

// Only a fresh, disposable local container. No .env.local or application DB access.
const container = `lumina-crm-cohorts-it-${randomBytes(5).toString("hex")}`;
const deadline = Date.now() + 50_000, password = randomBytes(32).toString("hex");
const image = process.env.COHORT_TEST_POSTGRES_IMAGE || "postgres:18.6-trixie";
assert.match(image, /^postgres:18\.\d+-(trixie|bookworm)$/);
let client;
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {env, encoding: "utf8", timeout: Math.max(1, Math.min(15_000, deadline - Date.now())), windowsHide: true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}
try {
  run("docker", ["run", "--detach", "--rm", "--pull=never", "--name", container, "--label", "com.lumina.crm.test=product-cohorts", "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql:rw,noexec,nosuid,size=768m", "--env", "POSTGRES_DB=lumina_cohorts_test", "--env", "POSTGRES_USER=postgres", "--env", "POSTGRES_PASSWORD", image], {...process.env, POSTGRES_PASSWORD: password});
  const port = run("docker", ["inspect", "--format", "{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}", container]);
  assert.match(port, /^\d+$/);
  const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/lumina_cohorts_test`;
  for (let attempt = 0; attempt < 20; attempt++) {
    client = new pg.Client({connectionString, connectionTimeoutMillis: 500, statement_timeout: 5000});
    try { await client.connect(); break; } catch (error) {
      await client.end().catch(() => {}); client = undefined;
      if (attempt === 19) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  const env = {...process.env, NODE_ENV: "test", DATABASE_SSL: "false", DATABASE_ADMIN_URL: connectionString, MIGRATION_DATABASE_URL: connectionString};
  for (const role of ["APP", "SYSTEM", "WORKER", "MIGRATOR", "BACKUP"]) env[`CRM_${role}_DB_PASSWORD`] = randomBytes(32).toString("hex");
  run(process.execPath, ["scripts/db-bootstrap.mjs"], env);
  run(process.execPath, ["scripts/db-migrate.mjs"], env);
  const ws = "00000000-0000-4000-8000-000000000001", actor = randomUUID(), otherWs = randomUUID(), foreignActor = randomUUID();
  await client.query("insert into app_auth.accounts(id,email,username) values($1,'cohorts-admin@example.test','cohorts-admin'),($2,'cohorts-other@example.test','cohorts-other')", [actor, foreignActor]);
  await client.query("insert into public.workspaces(id,slug,name) values($1,'cohorts-other','Other')", [otherWs]);
  await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'ADMIN'),($3,$4,'ADMIN')", [ws, actor, otherWs, foreignActor]);
  const products = (await client.query("insert into public.products(workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en) values($1,'COHORT-PARENT','批次产品','Cohort product','PROJECT','一次','Once'),($2,'FOREIGN-PARENT','其他产品','Other product','PROJECT','一次','Once'),($1,'SECOND-PARENT','第二产品','Second product','PROJECT','一次','Once') returning id,code", [ws, otherWs])).rows;
  const product = products.find(row => row.code === "COHORT-PARENT").id, foreignProduct = products.find(row => row.code === "FOREIGN-PARENT").id, secondProduct = products.find(row => row.code === "SECOND-PARENT").id;
  const data = {product_id: product, code: "GAPP-FALL-2027", name_zh: "GAPP 秋季", name_en: "GAPP Fall", intake_type: "FALL", academic_year: "2027-28",
    application_open_on: "2027-01-01", application_deadline: "2027-06-01", start_on: "2027-09-01", end_on: "2028-05-31",
    target_enrollment: 20, capacity: 30, status: "RECRUITING", default_currency: "USD", owner_id: actor};
  await client.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal','aal2',false)", [actor, ws]);
  await client.query("set role crm_app");
  const save = async (id, revision, input = data, key = randomUUID()) => (await client.query("select * from public.save_product_cohort($1,$2,$3,$4)", [id, revision, input, key])).rows[0];
  const id = randomUUID(), key = randomUUID(), first = await save(id, null, data, key);
  assert.equal(first.revision, 1); assert.equal(first.product_id, product); assert.equal(first.workspace_id, ws); assert.equal(first.created_by, actor);
  assert.deepEqual(await save(id, null, data, key), first);
  await assert.rejects(save(id, null, {...data, name_en: "Changed"}, key), /cohort_request_conflict/);
  await assert.rejects(save(randomUUID(), null, {...data, code: "gapp-fall-2027"}), /product_cohorts_workspace_id_code_key/);
  await assert.rejects(save(randomUUID(), null, {...data, code: "FOREIGN", product_id: foreignProduct}), /cohort_product_not_found/);
  await assert.rejects(save(randomUUID(), null, {...data, code: "FOREIGN-OWNER", owner_id: foreignActor}), /cohort_owner_invalid/);
  for (const patch of [{application_deadline: "2027-10-01"}, {end_on: "2027-08-01"}, {application_deadline: null, application_open_on: "2027-10-01"}, {start_on: null, end_on: "2027-05-01"}])
    await assert.rejects(save(randomUUID(), null, {...data, code: randomUUID(), ...patch}), /product_cohorts_dates_check/);
  for (const patch of [{target_enrollment: -1}, {capacity: -1}, {capacity: 19}])
    await assert.rejects(save(randomUUID(), null, {...data, code: randomUUID(), ...patch}), /product_cohorts_(target_enrollment|capacity|target_capacity)_check/);
  await assert.rejects(save(randomUUID(), null, {...data, code: "BAD-CURRENCY", default_currency: "usd"}), /default_currency_check/);
  const unknown = await save(randomUUID(), null, {...data, code: "UNKNOWN-DATES", application_open_on: null, application_deadline: null, start_on: null, end_on: null, target_enrollment: 0, capacity: null});
  assert.equal(unknown.target_enrollment, 0); assert.equal(unknown.capacity, null);
  await assert.rejects(save(id, 1, {...data, product_id: secondProduct}), /cohort_parent_immutable/);
  const second = await save(id, 1, {...data, status: "CLOSED"}); assert.equal(second.revision, 2);
  await assert.rejects(save(id, 1, {...data, status: "ACTIVE"}), /cohort_version_conflict/);
  await assert.rejects(save(id, null), /cohort_version_conflict/);
  await assert.rejects(save(randomUUID(), 1), /cohort_not_found/);
  await assert.rejects(client.query("update public.product_cohorts set status='ACTIVE' where id=$1", [id]), /permission denied/);
  await assert.rejects(client.query("delete from public.product_cohorts where id=$1", [id]), /permission denied/);
  await client.query("select set_config('app.aal','aal1',false)");
  await assert.rejects(save(id, 2), /cohort_update_forbidden/);
  await client.query("select set_config('app.aal','aal2',false)");
  for (const role of ["SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"]) {
    await client.query("reset role"); await client.query("update public.workspace_memberships set role=$1 where user_id=$2", [role, actor]); await client.query("set role crm_app");
    assert.equal((await client.query("select count(*)::int n from public.product_cohorts where id=$1", [id])).rows[0].n, 1);
    await assert.rejects(save(id, 2), /cohort_update_forbidden/);
    await assert.rejects(save(id, null, data, key), /cohort_update_forbidden/);
  }
  for (const role of ["SALES_DIRECTOR", "SUPER_ADMIN", "ADMIN"]) {
    await client.query("reset role"); await client.query("update public.workspace_memberships set role=$1 where user_id=$2", [role, actor]); await client.query("set role crm_app");
    await save(randomUUID(), null, {...data, code: role.replaceAll("_", "-")});
  }
  await client.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false)", [foreignActor, otherWs]);
  assert.equal((await client.query("select count(*)::int n from public.product_cohorts")).rows[0].n, 0);
  await assert.rejects(save(id, 2, {...data, product_id: foreignProduct, owner_id: foreignActor}), /cohort_not_found/);
  // The same code is valid in another workspace.
  await save(randomUUID(), null, {...data, product_id: foreignProduct, owner_id: foreignActor});
  await client.query("reset role");
  assert.equal((await client.query("select count(*)::int n from public.audit_events where entity_id=$1 and action='PRODUCT_COHORT_CREATED'", [id])).rows[0].n, 1);
  const audit = (await client.query("select before_data,after_data from public.audit_events where entity_id=$1 and action='PRODUCT_COHORT_UPDATED'", [id])).rows[0];
  assert.equal(audit.before_data.revision, 1); assert.equal(audit.after_data.revision, 2);
  assert.equal((await client.query("select status from public.product_cohorts where id=$1", [id])).rows[0].status, "CLOSED");
  // Database-level invariants hold even for maintenance SQL bypassing the RPC.
  await assert.rejects(client.query("insert into public.product_cohorts(workspace_id,product_id,code,name_zh,name_en) values($1,$2,'DB-FOREIGN','测试','Test')", [ws, foreignProduct]), /foreign key constraint/);
  await assert.rejects(client.query("update public.product_cohorts set product_id=$1 where id=$2", [secondProduct, id]), /cohort_parent_immutable/);
  await assert.rejects(client.query("delete from public.products where id=$1", [product]), /foreign key constraint/);
  await client.query("update public.workspace_memberships set status='SUSPENDED' where user_id=$1", [actor]);
  await client.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false)", [actor, ws]); await client.query("set role crm_app");
  assert.equal((await client.query("select count(*)::int n from public.product_cohorts")).rows[0].n, 0);
  await assert.rejects(save(id, 2), /cohort_update_forbidden/);
  console.log(`PASS ${(await client.query("select version() v")).rows[0].v} (${image}) Cohorts: create, case-insensitive unique code, tenant FKs/RLS, all nullable date pairs, capacity, currency, roles/AAL2/suspension, immutable product, stale revisions, atomic audit and idempotent receipts`);
} finally {
  await client?.end().catch(() => {});
  assert.match(container, /^lumina-crm-cohorts-it-[a-f0-9]{10}$/);
  const cleanup = spawnSync("docker", ["rm", "--force", container], {encoding: "utf8", timeout: 10_000, windowsHide: true});
  if (cleanup.status !== 0 && !cleanup.stderr?.includes("No such container")) throw new Error(`Could not remove isolated test container ${container}: ${cleanup.stderr}`);
}
