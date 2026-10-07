import assert from "node:assert/strict";
import { randomBytes, randomUUID as uuid } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

// Explicitly disposable: no .env, no supplied database URL, no persistent volume.
const name = `lumina-revenue-r5d-${randomBytes(6).toString("hex")}`;
const password = randomBytes(32).toString("hex");
const image = process.env.REVENUE_TEST_POSTGRES_IMAGE || "postgres:18.4-bookworm";
assert.match(image, /^postgres:18\.\d+-(bookworm|trixie)$/);
const deadline = Date.now() + 90_000;
let client;
let rival;
function run(command, args, env = process.env) {
  const r = spawnSync(command, args, { env, encoding: "utf8", windowsHide: true, timeout: Math.max(1, Math.min(25000, deadline - Date.now())) });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} failed: ${r.stderr}`);
  return r.stdout.trim();
}
try {
  run("docker", ["run", "--detach", "--rm", "--pull=never", "--name", name,
    "--label", "com.lumina.crm.test=revenue-r5d", "--publish", "127.0.0.1::5432",
    "--tmpfs", "/var/lib/postgresql:rw,noexec,nosuid,size=768m", "--env", "POSTGRES_DB=revenue_test",
    "--env", "POSTGRES_USER=postgres", "--env", "POSTGRES_PASSWORD", image], { ...process.env, POSTGRES_PASSWORD: password });
  const port = run("docker", ["inspect", "--format", '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', name]);
  assert.match(port, /^\d+$/);
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/revenue_test`;
  for (let n = 0; n < 25; n++) {
    client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 500, statement_timeout: 6000 });
    try { await client.connect(); break; } catch (e) { await client.end().catch(() => {}); client = null; if (n === 24) throw e; await new Promise(r => setTimeout(r, 200)); }
  }
  const env = { ...process.env, NODE_ENV: "test", DATABASE_SSL: "false", DATABASE_ADMIN_URL: url, MIGRATION_DATABASE_URL: url };
  for (const role of ["APP", "SYSTEM", "WORKER", "MIGRATOR", "BACKUP"]) env[`CRM_${role}_DB_PASSWORD`] = randomBytes(32).toString("hex");
  run(process.execPath, ["scripts/db-bootstrap.mjs"], env);
  run(process.execPath, ["scripts/db-migrate.mjs"], env);
  console.log("PASS migration apply (disposable PostgreSQL)");
  const ws = "00000000-0000-4000-8000-000000000001", otherWs = uuid(), entity = uuid();
  const maker = uuid(), checker = uuid(), verifier = uuid(), verifier2 = uuid(), plain = uuid(), superAdmin = uuid(), poster = uuid(), poster2 = uuid();
  for (const [i, user] of [maker, checker, verifier, verifier2, plain, superAdmin, poster, poster2].entries()) {
    await client.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)", [user, `r5d-${i}@example.test`, `r5d-${i}`]);
    await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)", [ws, user, user === superAdmin ? "SUPER_ADMIN" : "ADMIN"]);
  }
  await client.query("insert into public.workspaces(id,slug,name) values($1,'r5d-other','Example Other')", [otherWs]);
  const context = async (user = maker, workspace = ws, aal = "aal2", role = "crm_app", connection = client) => {
    await connection.query("reset role");
    await connection.query("select set_config('app.user_id',$1,false),set_config('app.workspace_id',$2,false),set_config('app.aal',$3,false)", [user, workspace, aal]);
    if (role) await connection.query(`set role ${role}`);
  };
  const one = async (sql, args = [], connection = client) => (await connection.query(sql, args)).rows[0];
  const foundation = async (command, target, data = {}, rev = null, key = uuid()) => (await one("select public.revenue_foundation_command($1,$2,$3,$4,$5,$6) x", [entity, command, target, rev, data, key])).x;
  const approve = async row => { await context(checker); await client.query("select public.decide_revenue_approval($1,$2,'APPROVED','Example review',$3)", [row.approval_reference, row.revision, uuid()]); await context(); };
  const att = async (command, target, data = {}, rev = null, key = uuid(), connection = client, ent = entity) => (await one("select public.revenue_attestation_command($1,$2,$3,$4,$5,$6) x", [ent, command, target, rev, data, key], connection)).x;
  await context(maker, ws, "aal2", null);
  const tz = (await one("select business_timezone from public.workspaces where id=$1", [ws])).business_timezone;
  const profile = (await one("select public.provision_revenue_profile($1,$2,$3,$4,$5) x", [entity, maker, checker, { legal_name: "Example Evidence Entity", accounting_framework: "Example Framework", business_timezone: tz, allowed_currencies: ["USD", "CNY", "JPY"], cutoff_reference: "EX-CUTOFF", correction_reference: "EX-CORRECTION", retention_reference: "EX-RETENTION", authority_reference: "EX-ONBOARDING" }, uuid()])).x;
  await context(); await approve(await foundation("PROFILE_SUBMIT", profile.id, {}, 1));
  const assignments = [];
  for (const user of [verifier, verifier2, maker]) {
    const a = await foundation("AUTHORITY_ASSIGN", uuid(), { user_id: user, authority: "EVIDENCE_VERIFIER", effective_from: "2020-01-01T00:00:00Z", reference: "EX-EVIDENCE-AUTHORITY" });
    await approve(a); assignments.push(a);
  }
  const period = await foundation("PERIOD_CREATE", uuid(), { period_key: "EX-2026-H1", start_on: "2026-01-01", end_on: "2026-06-30" });
  await foundation("PERIOD_CREATE", uuid(), { period_key: "EX-2026-H2", start_on: "2026-07-01", end_on: "2026-12-31" });
  const org = uuid(), product = uuid();
  await client.query("insert into public.organizations(id,workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,'示例机构','Example Organization',$3,$3)", [org, ws, maker]);
  await client.query("insert into public.products(id,workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en) values($1,$2,'EVIDENCE-EXAMPLE','示例服务','Example Service','PROJECT','一期','One period')", [product, ws]);
  const contract = (await client.query("select * from public.create_buyer_contract('R5D-CONTRACT',$1,null,$2,'2026-01-01','2026-12-31','USD',900000)", [org, product])).rows[0];
  const cv = await one("select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1", [contract.id]);
  await foundation("CONTRACT_ACCEPT", cv.id, { reference: "EX-ACCEPTANCE" }, cv.version);
  const activity = async (day = "2026-01-31", organization = org) => {
    return (await one("select (public.record_customer_activity($1,null,null,'MEETING',($2::date+time '12:00') at time zone $3,'示例交付','Example delivery','确认交付','Confirm delivery')).id", [organization, day, tz])).id;
  };
  const a = await activity(), a2 = await activity();
  async function service(key, strategy = "POINT_IN_TIME_ON_APPROVED_EVIDENCE", units = [{ key: "DELIVERABLE", units: "1" }], sources = [a, a2], configure = true, domain = "CRM_ACTIVITY", options = {}) {
    const p = await foundation("POLICY_CREATE", uuid(), { policy_key: `EX_${key}`, recognition_strategy: strategy, amount_strategy: options.amountStrategy || "ACCEPTED_SERVICE_CONSIDERATION", presentation: options.agent ? "NET" : "GROSS", fulfillment_rule_reference: "EX-EXPLICIT-EVIDENCE", refund_correction_reference: "EX-REFUND", currency: options.currency || "USD", effective_from: "2020-01-01" });
    await one("select public.revenue_set_correction_rule($1,$2,1,$3,$4) x",[entity,p.id,{method: options.blockCorrections ? "BLOCKED" : "REVISED_ENTITLEMENT",allow_prior_period: !!options.priorPeriod,reference:"EX-CORRECTION-RULE"},uuid()]);
    await approve(await foundation("POLICY_SUBMIT", p.id, {}, 2));
    const s = await foundation("SERVICE_CREATE", uuid(), { contract_id: options.contract?.id || contract.id, contract_version_id: options.cv?.id || cv.id, stable_service_key: options.stableKey || key, supersedes_service_id: options.supersedes, product_id: product, accepted_amount: options.accepted || "842.60", accepted_quantity: "1", currency: options.currency || "USD", source_quote_line_reference: options.quoteLine, accepted_price_source: options.quoteLine ? "QUOTE_VERSION" : "CONTRACT_VERSION", accepted_price_reference: "EX-ACCEPTED", service_classification: "OWN_SERVICE", description_snapshot: "Example evidence service" });
    const b = await foundation("BINDING_CREATE", uuid(), { specified_service_id: s.id, policy_version_id: p.id, principal_agent_role: options.agent ? "AGENT" : "PRINCIPAL", presentation: options.agent ? "NET" : "GROSS", assessment_basis_reference: "EX-ASSESSMENT", assessment_sources: ["EX-V1"], amount: options.amount || options.accepted || "842.60", agent_fee: options.agent ? options.amount : undefined, allocation_decision_reference: options.allocation, recognition_unit_schedule: units });
    let rev = 1;
    if (configure) {
      const requirements = Object.fromEntries(units.map(u => [u.key, { source_domain: domain, source_ids: sources, evidence_type: strategy === "OVER_TIME_BY_VERIFIED_UNITS" ? "COVERAGE" : "DELIVERABLE", condition: domain === "CRM_ACTIVITY" ? "MEETING" : "COMPLETED", date_basis: domain === "CRM_ACTIVITY" ? "OCCURRED_ON" : "COMPLETED_ON" }]));
      rev = (await one("select public.revenue_set_fulfillment_requirements($1,$2,1,$3,$4) x", [entity, b.id, requirements, uuid()])).x.revision;
    }
    await approve(await foundation("BINDING_SUBMIT", b.id, {}, rev));
    return { s, b, p };
  }
  // The preparer and reviewers have explicit designations independent of role.
  const recognitionAssignments = [];
  for (const [user, authority] of [[maker,"RECOGNITION_PREPARER"],[maker,"RECOGNITION_REVIEWER"],[verifier,"RECOGNITION_REVIEWER"],[verifier2,"RECOGNITION_REVIEWER"],[poster,"POSTING_AUTHORITY"],[poster2,"POSTING_AUTHORITY"],[maker,"POSTING_AUTHORITY"],[verifier,"POSTING_AUTHORITY"]]) {
    const assigned = await foundation("AUTHORITY_ASSIGN",uuid(),{user_id:user,authority,effective_from:"2020-01-01T00:00:00Z",reference:"EX-RECOGNITION-AUTHORITY"});
    await approve(assigned); recognitionAssignments.push(assigned);
  }
  const candidate = async(command,target=null,data={},rev=null,key=uuid(),connection=client,ent=entity)=>(await one("select public.revenue_candidate_command($1,$2,$3,$4,$5,$6) x",[ent,command,target,rev,data,key],connection)).x;
  const evaluate = (x,unit="DELIVERABLE",connection=client,key=uuid())=>candidate("EVALUATE",null,{specified_service_id:x.s.id,binding_id:x.b.id,recognition_unit_key:unit},null,key,connection);
  const submit = c=>candidate("SUBMIT",c.id,{},c.revision);
  const review = (c,connection=client,key=uuid())=>candidate("APPROVE",c.id,{reference:"EX-REVIEW"},c.revision,key,connection);
  const evidence = async(x,{unit="DELIVERABLE",source=a,day="2026-01-31",units="1",from,to}={})=>{
    await context();
    const draft = await att("CREATE",uuid(),{specified_service_id:x.s.id,binding_id:x.b.id,recognition_unit_key:unit,evidence_type:from?"COVERAGE":"DELIVERABLE",source_domain:"CRM_ACTIVITY",source_id:source,business_date:day,verified_units:units,coverage_from:from,coverage_to:to});
    const submitted = await att("SUBMIT",draft.id,{},draft.revision);
    await context(verifier); const accepted = await att("ACCEPT",draft.id,{reference:"EX-EVIDENCE"},submitted.revision); await context(); return accepted;
  };
  const approved = async c => { await context();const pending=await submit(c);await context(verifier);const result=await review(pending);await context();assert.equal(result.status,"APPROVED");return result; };
  const post = async(c,key=uuid(),connection=client,ent=entity,reference="EX-POST")=>(await one("select public.revenue_post_candidate($1,$2,$3,$4,$5) x",[ent,c.id,c.revision,reference,key],connection)).x;
  const correction = async(root,revised,kind="ADJUSTMENT",intent=uuid(),extra={})=>(await one("select public.revenue_evaluate_correction($1,$2,$3) x",[entity,{original_fact_id:root.id,revised_candidate_id:revised.id,candidate_kind:kind,correction_intent_key:intent,reason_reference:"EX-REVISED-ENTITLEMENT",...extra},uuid()])).x;
  const lineage = async x=>(await one("select public.revenue_recognized_lineage($1,$2,$3,'DELIVERABLE') x",[entity,contract.id,x.s.stable_service_key])).x;
  const prepare = async(key,options={})=>{await context();const source=await activity();const x=await service(key,undefined,undefined,[source],true,undefined,options);x.e=await evidence(x,{source});x.c=await approved(await evaluate(x));return x;};
  const base=await prepare("DIRECT");
  assert.equal((await one("select count(*)::int n from public.recognized_revenue_facts")).n,0,"approval does not post");
  for(const actor of [plain,superAdmin]) {await context(actor);await assert.rejects(post(base.c),/authority_required/);}
  await context(poster,ws,"aal1");await assert.rejects(post(base.c),/aal2|authority_required/);
  for(const actor of [maker,verifier]) {await context(actor);await assert.rejects(post(base.c),/independent_poster/);}
  await context(poster);await assert.rejects(post({...base.c,revision:1}),/not_approved/);
  const key=uuid(), first=await post(base.c,key);assert.equal(first.amount,"842.60");assert.equal(first.fact_kind,"ORIGINAL");
  assert.equal((await post(base.c,key)).id,first.id);assert.equal((await post(base.c)).id,first.id);
  await assert.rejects(post(base.c,key,client,entity,"EX-CHANGED"),/conflict/);
  await context(maker,ws,"aal2",null);
  assert.equal((await one("select count(*)::int n from public.payments")).n,0,"earned posting requires no cash");
  await assert.rejects(client.query("update public.recognized_revenue_facts set amount=1 where id=$1",[first.id]),/immutable/);
  await assert.rejects(client.query("delete from public.recognized_revenue_facts where id=$1",[first.id]),/immutable/);
  await context();await assert.rejects(client.query("insert into public.recognized_revenue_facts(id) values($1)",[uuid()]),/permission denied/);
  await context(poster);await assert.rejects(post(base.c,uuid(),client,uuid()),/authority_required/);
  await context(poster,otherWs);assert.equal((await one("select count(*)::int n from public.recognized_revenue_facts")).n,0);await assert.rejects(post(base.c),/workspace|authority/);
  await context(poster,ws,"aal2","crm_worker");await assert.rejects(post(base.c),/permission denied/);
  console.log("PASS independent designated poster, AAL2, cash-independent posting, retry, RLS and privileged immutability");

  const concurrent=await prepare("CONCURRENT");
  rival=new pg.Client({connectionString:url,statement_timeout:6000});await rival.connect();await context(poster2,ws,"aal2","crm_app",rival);await context(poster);
  const posts=await Promise.all([post(concurrent.c),post(concurrent.c,uuid(),rival)]);assert.equal(posts[0].id,posts[1].id);
  const unhealthy=await prepare("WITHDRAWN");await context(verifier);await att("WITHDRAW",unhealthy.e.id,{reference:"EX-WITHDRAW"},unhealthy.e.revision);await context(poster);await assert.rejects(post(unhealthy.c),/stale_basis/);
  const changed=await prepare("CHANGED");await context(maker,ws,"aal2",null);await client.query("update public.crm_activities set summary_en='Example revised evidence' where id=$1",[changed.e.source_id]);await context(poster);await assert.rejects(post(changed.c),/stale_basis/);
  console.log("PASS concurrent posting, accepted-then-withdrawn and source-change rejection");

  const absent=await prepare("SOURCE_REMOVED");await context(maker,ws,"aal2",null);await client.query("update public.crm_activities set archived_at=now() where id=$1",[absent.e.source_id]);await context(poster);await assert.rejects(post(absent.c),/stale_basis/);
  const testOnly=await prepare("TEST_ONLY_DEFENSE");await context(maker,ws,"aal2",null);
  // Privileged corruption fixture isolates the final defense, bypassing earlier guards only in this test.
  await client.query("alter table public.revenue_policy_versions disable trigger user");await client.query("update public.revenue_policy_versions set test_only=true,status='DRAFT' where id=$1",[testOnly.p.id]);
  await client.query("alter table public.revenue_policy_versions enable trigger user");await context(poster);await assert.rejects(post(testOnly.c),/test_only_forbidden/);
  const withdrawRace=await prepare("WITHDRAW_RACE");await context(verifier,ws,"aal2","crm_app",rival);await rival.query("begin");await att("WITHDRAW",withdrawRace.e.id,{reference:"EX-RACE"},withdrawRace.e.revision,uuid(),rival);
  await context(poster);const withdrawing=assert.rejects(post(withdrawRace.c),/stale_basis/);await rival.query("commit");await withdrawing;
  await context(poster,ws,"aal2","crm_app",rival);await rival.query("begin");const beforeWithdrawal=await prepare("POST_WINS");const postedFirst=await post(beforeWithdrawal.c,uuid(),rival);
  await context(verifier);const afterPosting=att("WITHDRAW",beforeWithdrawal.e.id,{reference:"EX-AFTER-POST"},beforeWithdrawal.e.revision);await rival.query("commit");await afterPosting;await context(poster);assert.equal((await post(beforeWithdrawal.c)).id,postedFirst.id);
  console.log("PASS unavailable source, TEST_ONLY defense and both serial outcomes of posting versus withdrawal");

  await context();const noEvidence=await service("PAYMENT_ONLY");
  const schedule=(await client.query("select * from public.save_receivable_schedule($1,$2)",[contract.id,JSON.stringify([{dueDate:"2026-01-01",amount:"900000.00"}])])).rows[0];
  const cash=(await client.query("select * from public.record_payment($1,$2,'842.60','USD','EX-CASH',now())",[contract.id,schedule.id])).rows[0];
  const refund=(await client.query("select * from public.request_refund($1,842.60,'Example pre-delivery refund')",[cash.id])).rows[0];
  await context(maker,ws,"aal2",null);await client.query("update public.refunds set status='APPROVED' where id=$1",[refund.id]);await context();await client.query("select public.complete_refund($1,'EX-REFUND')",[refund.id]);
  await assert.rejects(evaluate(noEvidence),/fulfillment_required/);await assert.rejects(correction({id:uuid()},base.c,"REVERSAL",uuid(),{refund_id:refund.id}),/original_fact_required/);
  await context(poster);await assert.rejects(post({id:uuid(),revision:3}),/not_approved/);
  for(const [label,options,expected] of [["AGENT",{agent:true,amountStrategy:"APPROVED_AGENT_FEE",amount:"193.10"},"193.10"],["CHANNEL",{},"842.60"],["RESELLER",{accepted:"271.30"},"271.30"],["INBOUND",{accepted:"409.20"},"409.20"],["BUNDLE",{accepted:"842.60",amount:"219.35",amountStrategy:"APPROVED_ALLOCATED_CONSIDERATION",allocation:"EX-ALLOCATION"},"219.35"]]) {
    const x=await prepare(label,options);await context(poster);assert.equal((await post(x.c)).amount,expected);
  }
  console.log("PASS cash/refund non-triggers and principal, agent, channel, reseller, inbound and allocated consideration");

  // Rebinding creates approved revised entitlement; no caller-supplied correction amount.
  async function revise(x,amount,day="2026-01-31") {
    await context(verifier);await att("WITHDRAW",x.e.id,{reference:"EX-REVISED-BASIS"},x.e.revision);await context();
    const source=await activity(day);
    const b=await foundation("BINDING_CREATE",uuid(),{specified_service_id:x.s.id,policy_version_id:x.p.id,predecessor_id:x.b.id,principal_agent_role:"PRINCIPAL",presentation:"GROSS",assessment_basis_reference:"EX-REASSESSMENT",assessment_sources:["EX-V2"],amount,allocation_decision_reference:"EX-APPROVED-ALLOCATION",recognition_unit_schedule:[{key:"DELIVERABLE",units:"1"}]});
    const v=(await one("select public.revenue_set_fulfillment_requirements($1,$2,1,$3,$4) x",[entity,b.id,{DELIVERABLE:{source_domain:"CRM_ACTIVITY",source_ids:[source],evidence_type:"DELIVERABLE",condition:"MEETING",date_basis:"OCCURRED_ON"}},uuid()])).x;
    await approve(await foundation("BINDING_SUBMIT",b.id,{},v.revision));
    x.b=b;x.e=await evidence(x,{source,day});x.c=await approved(await evaluate(x));return x.c;
  }
  const corrected=await prepare("CORRECTED",{accepted:"200.00",amount:"100.00",amountStrategy:"APPROVED_ALLOCATED_CONSIDERATION",allocation:"EX-ALLOCATION",priorPeriod:true});
  await context(poster);const root=await post(corrected.c);await context();
  await revise(corrected,"70.00");
  await assert.rejects(correction({id:uuid()},corrected.c,"REVERSAL"),/original_fact_required/);
  await assert.rejects(correction(root,corrected.c,"REVERSAL",uuid(),{amount:"-80.00"}),/input_invalid/);
  const intent=uuid(), negative=await approved(await correction(root,corrected.c,"REVERSAL",intent,{refund_id:refund.id}));assert.equal(negative.amount,"-30.00","full cash refund does not dictate reversal amount");
  await context(poster);await assert.rejects(post(corrected.c),/correction_required/);const reversal=await post(negative);assert.equal(reversal.original_fact_id,root.id);assert.equal((await lineage(corrected)).current_amount,"70.00");
  await context();assert.equal((await correction(root,corrected.c,"REVERSAL",intent,{refund_id:refund.id})).id,negative.id);await context(poster);assert.equal((await post(negative)).id,reversal.id);
  await revise(corrected,"120.00");
  await assert.rejects(correction(root,corrected.c,"ADJUSTMENT",uuid(),{amount:"60.00"}),/input_invalid/);
  const positive=await approved(await correction(root,corrected.c));assert.equal(positive.amount,"50.00");await context(poster);await post(positive);assert.equal((await lineage(corrected)).current_amount,"120.00");
  await revise(corrected,"80.00");const replacement=await approved(await correction(root,corrected.c,"REPLACEMENT"));assert.equal(replacement.amount,"-40.00");
  await context(maker,ws,"aal2",null);
  await client.query("create function public.test_fail_post_audit() returns trigger language plpgsql as $$ begin if new.action='REVENUE_FACT_POSTED' then raise exception 'injected_audit_failure';end if;return new;end $$; create trigger test_fail_post_audit before insert on public.audit_events for each row execute function public.test_fail_post_audit()");
  await context(poster);await assert.rejects(post(replacement),/injected_audit_failure/);assert.equal((await lineage(corrected)).current_amount,"120.00");
  await context(maker,ws,"aal2",null);await client.query("drop trigger test_fail_post_audit on public.audit_events;drop function public.test_fail_post_audit()");
  await context(poster);await post(replacement);assert.equal((await lineage(corrected)).current_amount,"80.00");
  assert.equal((await one("select amount::text from public.recognized_revenue_facts where id=$1",[root.id])).amount,"100.00");
  await revise(corrected,"0.00");const full=await approved(await correction(root,corrected.c,"REVERSAL"));await context(poster);await post(full);assert.equal((await lineage(corrected)).current_amount,"0.00");await context();await assert.rejects(correction(root,corrected.c,"REVERSAL"),/amount_invalid/);
  console.log("PASS partial/full reversal, bounded positive adjustment, net replacement, atomic audit rollback and correction replay");

  await context();const source1=await activity("2026-01-10"),source2=await activity("2026-02-10"),source3=await activity("2026-03-10");
  const cumulative=await service("CUMULATIVE","OVER_TIME_BY_VERIFIED_UNITS",[{key:"DELIVERABLE",units:"6",from:"2026-01-01",to:"2026-06-30"}],[source1,source2,source3],true,undefined,{accepted:"100.00"});
  await evidence(cumulative,{source:source1,day:"2026-01-10",from:"2026-01-01",to:"2026-01-10",units:"1"});
  const c1=await approved(await evaluate(cumulative));assert.equal(c1.amount,"16.66");await context(poster);const cumulativeRoot=await post(c1);
  await evidence(cumulative,{source:source2,day:"2026-02-10",from:"2026-02-01",to:"2026-02-10",units:"1"});
  const c2=await approved(await evaluate(cumulative));assert.equal(c2.amount,"33.33");await context(poster);await assert.rejects(post(c2),/correction_required/);await context();
  const delta=await approved(await correction(cumulativeRoot,c2));assert.equal(delta.amount,"16.67");await context(poster);const incremental=await post(delta);assert.equal((await post(delta)).id,incremental.id);
  await evidence(cumulative,{source:source3,day:"2026-03-10",from:"2026-03-01",to:"2026-03-10",units:"4"});
  const final=await approved(await evaluate(cumulative));assert.equal(final.amount,"100.00");
  const d1=await approved(await correction(cumulativeRoot,final));const d2=await approved(await correction(cumulativeRoot,final));assert.equal(d1.amount,"66.67");
  await context(poster);await context(poster2,ws,"aal2","crm_app",rival);const races=await Promise.allSettled([post(d1),post(d2,uuid(),rival)]);assert.equal(races.filter(r=>r.status==="fulfilled").length,1);assert.match(races.find(r=>r.status==="rejected").reason.message,/stale_basis/);assert.equal((await lineage(cumulative)).current_amount,"100.00");
  console.log("PASS cumulative 16.66 + 16.67 + 66.67, one ORIGINAL, correction race and exact final remainder");

  // Frozen fact basis survives mutable catalog and operational Contract snapshots.
  await context(maker,ws,"aal2",null);
  const frozen=await one("select to_jsonb(f) x from public.recognized_revenue_facts f where id=$1",[first.id]);
  await client.query("update public.contracts set contract_number='R5D-OPERATIONAL' where id=$1",[contract.id]);
  await client.query("insert into public.product_prices(product_id,workspace_id,currency,amount,effective_from) values($1,$2,'USD',120,current_date)",[product,ws]);
  assert.deepEqual((await one("select to_jsonb(f) x from public.recognized_revenue_facts f where id=$1",[first.id])).x,frozen.x);
  for(const assignment of ["currency='EUR'","business_date='2026-02-01'","source_basis_digest=repeat('a',64)","fact_kind='REPLACEMENT'","original_fact_id=id","policy_version_id=gen_random_uuid()"])
    await assert.rejects(client.query(`update public.recognized_revenue_facts set ${assignment} where id=$1`,[first.id]),/immutable/);
  const forged={...first,id:uuid(),candidate_id:changed.c.id,stable_service_key:changed.s.stable_service_key,specified_service_id:changed.s.id,binding_id:changed.b.id,policy_version_id:changed.p.id};
  await assert.rejects(client.query("insert into public.recognized_revenue_facts select * from jsonb_populate_record(null::public.recognized_revenue_facts,$1)",[forged]),/posting_receipt_required/);
  const quotedId=uuid(),quoteV2=uuid();
  await client.query("insert into public.quotes(id,workspace_id,quote_number,organization_id,product_id,currency,valid_until,status,current_version,owner_id,created_by) values($1,$2,'EX-FACT-QUOTE',$3,$4,'CNY',current_date+30,'ACCEPTED',2,$5,$5)",[quotedId,ws,org,product,maker]);
  await client.query("insert into public.quote_versions(id,workspace_id,quote_id,version,subtotal,line_items,created_by) values($1,$2,$3,2,622.17,'[{\"description\":\"Example service\",\"referencePricingFx\":\"6.2\"}]',$4)",[quoteV2,ws,quotedId,maker]);
  await context();const quotedContract=(await client.query("select * from public.convert_quote_to_contract($1,'EX-FACT-QUOTED','2026-01-01','2026-12-31')",[quotedId])).rows[0];
  const quoteCv=await one("select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1",[quotedContract.id]);await foundation("CONTRACT_ACCEPT",quoteCv.id,{reference:"EX-QUOTE",quote_version_id:quoteV2},quoteCv.version);
  const quoted=await service("QUOTED",undefined,undefined,[a],true,undefined,{contract:quotedContract,cv:quoteCv,currency:"CNY",accepted:"622.17",quoteLine:"LINE_1"});await evidence(quoted);const quotedC=await approved(await evaluate(quoted));
  await context(maker,ws,"aal2",null);await client.query("insert into public.quote_versions(id,workspace_id,quote_id,version,subtotal,line_items,created_by) values($1,$2,$3,3,999,'[]',$4)",[uuid(),ws,quotedId,maker]);await client.query("update public.quotes set current_version=3 where id=$1",[quotedId]);
  await context(poster);const quotedFact=await post(quotedC);assert.equal(quotedFact.currency,"CNY");assert.equal(quotedFact.amount,"622.17");assert.equal(quotedC.source_fact_references.accepted_quote_version,quoteV2);
  await context();const oldService=await service("AMEND","OVER_TIME_BY_APPROVED_MILESTONES",[{key:"A",units:"1"}],[a]);await evidence(oldService,{unit:"A"});const oldC=await approved(await evaluate(oldService,"A"));await context(poster);const oldFact=await post(oldC);
  await context(maker,ws,"aal2",null);await client.query("update public.contracts set contract_value=900001 where id=$1",[contract.id]);const newCv=await one("select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1",[contract.id]);await context();await foundation("CONTRACT_ACCEPT",newCv.id,{reference:"EX-AMENDMENT"},newCv.version);
  const amended=await service("AMEND_NEXT","OVER_TIME_BY_APPROVED_MILESTONES",[{key:"B",units:"1"}],[a],true,undefined,{cv:newCv,stableKey:"AMEND",supersedes:oldService.s.id});await evidence(amended,{unit:"B"});const newC=await approved(await evaluate(amended,"B"));await context(poster);const newFact=await post(newC);assert.equal(newFact.contract_version_id,newCv.id);assert.equal(oldFact.contract_version_id,cv.id);
  console.log("PASS privileged insert/update denial, frozen catalog/Quote/FX provenance and amended future-unit ownership");

  const closeTarget=await prepare("CLOSE_RACE");await context(checker,ws,"aal2","crm_app",rival);await rival.query("begin");
  await rival.query("select public.revenue_foundation_command($1,'PERIOD_CLOSE',$2,1,$3,$4)",[entity,period.id,{reference:"EX-CLOSE"},uuid()]);
  await context(poster);const closing=assert.rejects(post(closeTarget.c),/stale_basis|period_closed/);await rival.query("commit");await closing;
  // The historical root stays in H1; an explicitly permitted revised H2 basis posts in H2.
  await revise(corrected,"25.00","2026-07-10");const prior=await approved(await correction(root,corrected.c));await context(poster);const priorFact=await post(prior);assert.equal(priorFact.prior_period_flag,true);assert.equal(priorFact.original_business_date,"2026-01-31");assert.equal(priorFact.business_date,"2026-07-10");
  await context(checker,ws,"aal2","crm_app",rival);await rival.query("begin");await rival.query("select public.revenue_foundation_command($1,'AUTHORITY_REVOKE',$2,2,$3,$4)",[entity,recognitionAssignments[4].id,{reference:"EX-REVOKE"},uuid()]);
  await context(poster);const revoked=assert.rejects(post(prior),/authority_required/);await rival.query("commit");await revoked;
  await context(maker,ws,"aal2",null);assert.equal((await one("select count(*)::int n from (select 1 from public.recognized_revenue_facts where fact_kind='ORIGINAL' group by workspace_id,reporting_entity_id,contract_id,stable_service_key,recognition_unit_key having count(*)>1) d")).n,0);
  assert.equal((await one("select to_regclass('public.cash_applications') x")).x,null);
  assert.equal((await one("select count(*)::int n from public.recognized_revenue_facts f where not exists(select 1 from public.audit_events a where a.entity_id=f.id::text and a.action='REVENUE_FACT_POSTED')")).n,0);
  console.log("PASS period-close and authority-revocation races, explicit prior-period correction and no cash-application owner");
  console.log("REVENUE_R5D_POSTGRES_PASS");
} finally {
  await rival?.end().catch(()=>{});await client?.end().catch(()=>{});
  run("docker",["rm","--force",name]);
}

