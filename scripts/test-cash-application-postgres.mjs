import assert from "node:assert/strict";
import { randomBytes, randomUUID as uuid } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

// Explicitly disposable: no .env, no supplied database URL, no persistent volume.
const name = `lumina-revenue-r5e-${randomBytes(6).toString("hex")}`;
const password = randomBytes(32).toString("hex");
const database = `cash_${randomBytes(6).toString("hex")}`;
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
    "--label", "com.lumina.crm.test=revenue-r5e", "--publish", "127.0.0.1::5432",
    "--tmpfs", "/var/lib/postgresql:rw,noexec,nosuid,size=768m", "--env", `POSTGRES_DB=${database}`,
    "--env", "POSTGRES_USER=postgres", "--env", "POSTGRES_PASSWORD", image], { ...process.env, POSTGRES_PASSWORD: password });
  const port = run("docker", ["inspect", "--format", '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', name]);
  assert.match(port, /^\d+$/);
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
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
    await client.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)", [user, `r5e-${i}@example.test`, `r5e-${i}`]);
    await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)", [ws, user, user === superAdmin ? "SUPER_ADMIN" : "ADMIN"]);
  }
  await client.query("insert into public.workspaces(id,slug,name) values($1,'r5e-other','Example Other')", [otherWs]);
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
  const profile = (await one("select public.provision_revenue_profile($1,$2,$3,$4,$5) x", [entity, maker, checker, { legal_name: "Example Evidence Entity", accounting_framework: "Example Framework", business_timezone: tz, allowed_currencies: ["USD", "CNY", "EUR"], cutoff_reference: "EX-CUTOFF", correction_reference: "EX-CORRECTION", retention_reference: "EX-RETENTION", authority_reference: "EX-ONBOARDING" }, uuid()])).x;
  await context(); await approve(await foundation("PROFILE_SUBMIT", profile.id, {}, 1));

  for (const user of [verifier, verifier2, maker]) {
    const a = await foundation("AUTHORITY_ASSIGN", uuid(), { user_id: user, authority: "EVIDENCE_VERIFIER", effective_from: "2020-01-01T00:00:00Z", reference: "EX-EVIDENCE-AUTHORITY" });
    await approve(a);
  }
  await foundation("PERIOD_CREATE", uuid(), { period_key: "EX-2026-H1", start_on: "2026-01-01", end_on: "2026-06-30" });
  await foundation("PERIOD_CREATE", uuid(), { period_key: "EX-2026-H2", start_on: "2026-07-01", end_on: "2026-12-31" });
  const org = uuid(), product = uuid();
  await client.query("insert into public.organizations(id,workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,'示例机构','Example Organization',$3,$3)", [org, ws, maker]);
  await client.query("insert into public.products(id,workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en) values($1,$2,'EVIDENCE-EXAMPLE','示例服务','Example Service','PROJECT','一期','One period')", [product, ws]);
  const contract = (await client.query("select * from public.create_buyer_contract('R5E-CONTRACT',$1,null,$2,'2026-01-01','2026-12-31','USD',900000)", [org, product])).rows[0];
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

  for (const [user, authority] of [[maker,"RECOGNITION_PREPARER"],[maker,"RECOGNITION_REVIEWER"],[verifier,"RECOGNITION_REVIEWER"],[verifier2,"RECOGNITION_REVIEWER"],[poster,"POSTING_AUTHORITY"],[poster2,"POSTING_AUTHORITY"],[maker,"POSTING_AUTHORITY"],[verifier,"POSTING_AUTHORITY"],[maker,"CASH_APPLICATION_MANAGER"],[poster2,"CASH_APPLICATION_MANAGER"]]) {
    const assigned = await foundation("AUTHORITY_ASSIGN",uuid(),{user_id:user,authority,effective_from:"2020-01-01T00:00:00Z",reference:"EX-RECOGNITION-AUTHORITY"});
    await approve(assigned);
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
  const approved=async c=>{await context();const pending=await submit(c);await context(verifier);const result=await review(pending);await context();return result;};
  const post=async c=>(await one("select public.revenue_post_candidate($1,$2,$3,'EX-POST',$4) x",[entity,c.id,c.revision,uuid()])).x;
  const cash=async(command,payment,data,key=uuid(),connection=client,ent=entity)=>(await one("select public.cash_application_command($1,$2,$3,$4,$5) x",[ent,command,payment,data,key],connection)).x;
  const status=async p=>(await one("select public.cash_source_status($1,$2) x",[entity,p.id])).x;
  const receipt=async(x,amount="100.00",targets=[x],key=uuid(),reference=`EX-CASH-${uuid()}`,connection=client)=>{
    return (await one("select to_jsonb(public.record_payment(null,null,$1,$2,$3,'2026-01-31T12:00:00Z',$4,$5)) x",[amount,x.s.currency,reference,{entity,intent:`EX-DECLARE-${reference}`,reference:"EX-CUSTODY-TERMS",terms_service_id:x.s.id,custody_role:"CONDITIONAL_SETTLEMENT_HOLDER",beneficiary_kind:"CONTRACT_BUYER",permitted_service_ids:targets.map(t=>t.s.id)},key],connection)).x;
  };
  const apply=(p,x,amount,key=uuid(),intent=uuid(),connection=client)=>cash("APPLY",p.id,{service_id:x.s.id,receivable_id:x.schedule.id,amount,intent,reference:"EX-APPLY"},key,connection);
  const reverse=(p,entry,amount,key=uuid(),intent=uuid())=>cash("REVERSE",p.id,{application_id:entry.id,amount,intent,reference:"EX-RELEASE"},key);
  const requestRefund=async(p,amount,connection=client)=>(await one("select to_jsonb(public.request_refund($1,$2,'Example refund',$3)) x",[p.id,amount,uuid()],connection)).x;
  async function target(key,amount="100.00",currency="USD") {
    await context();const c=(await client.query("select * from public.create_buyer_contract($1,$2,null,$3,'2026-01-01','2026-12-31',$4,$5)",[`EX-${key}-${uuid()}`,org,product,currency,amount])).rows[0];
    const v=await one("select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1",[c.id]);await foundation("CONTRACT_ACCEPT",v.id,{reference:"EX-ACCEPTANCE"},v.version);
    const x=await service(key,undefined,undefined,[a],true,undefined,{contract:c,cv:v,accepted:amount,currency});
    x.contract=c;x.schedule=(await client.query("select * from public.save_receivable_schedule($1,$2)",[c.id,JSON.stringify([{dueDate:"2026-01-01",amount}])])).rows[0];return x;
  }
  const earned=await target("EARNED");await evidence(earned);const earnedC=await approved(await evaluate(earned));await context(poster);const fact=await post(earnedC);assert.equal(fact.amount,"100.00");
  await context();const counts=await one("select (select count(*) from public.recognized_revenue_facts)::int facts,(select count(*) from public.revenue_recognition_candidates)::int candidates");
  const receiptKey=uuid(),reference=`EX-CASH-${uuid()}`,p=await receipt(earned,"100.00",[earned],receiptKey,reference);
  assert.equal(p.purpose,"CUSTODY_RECEIPT");assert.equal(p.contract_id,null);assert.equal(p.receivable_schedule_id,null);
  assert.equal((await receipt(earned,"100.00",[earned],receiptKey,reference)).id,p.id);
  await assert.rejects(receipt(earned,"99.00",[earned],receiptKey,reference),/conflict/);
  assert.equal((await one("select collected from public.contract_finance_snapshot where contract_id=$1",[earned.contract.id])).collected,"0");
  assert.equal((await status(p)).available,"100.00");
  const applyKey=uuid(),intent=uuid(),entry=await apply(p,earned,"100.00",applyKey,intent);assert.equal(entry.amount,"100.00");
  assert.equal((await apply(p,earned,"100.00",applyKey,intent)).id,entry.id);assert.equal((await apply(p,earned,"100.00",uuid(),intent)).id,entry.id);
  await assert.rejects(apply(p,earned,"99.00",uuid(),intent),/intent_conflict/);
  assert.equal((await one("select paid_amount::text from public.receivable_schedules where id=$1",[earned.schedule.id])).paid_amount,"100.00");
  assert.equal((await one("select collected from public.contract_finance_snapshot where contract_id=$1",[earned.contract.id])).collected,"100.00");
  await assert.rejects(apply(p,earned,"1.00"),/source_ceiling|target_ceiling/);
  assert.deepEqual(await one("select (select count(*) from public.recognized_revenue_facts)::int facts,(select count(*) from public.revenue_recognition_candidates)::int candidates"),counts);
  await assert.rejects(requestRefund(p,"50.00"),/reserved_or_applied/);
  const revKey=uuid(),revIntent=uuid(),released=await reverse(p,entry,"30.00",revKey,revIntent);assert.equal((await status(p)).available,"30.00");
  assert.equal((await reverse(p,entry,"30.00",uuid(),revIntent)).id,released.id);assert.equal((await status(p)).available,"30.00");
  await assert.rejects(reverse(p,entry,"80.00"),/reversal_ceiling/);
  await reverse(p,entry,"70.00");assert.equal((await status(p)).available,"100.00");
  await assert.rejects(reverse(p,entry,"1.00"),/reversal_ceiling/);
  await apply(p,earned,"60.00");const refund=await requestRefund(p,"40.00");assert.equal((await status(p)).available,"0.00");
  await assert.rejects(apply(p,earned,"1.00"),/source_ceiling/);
  await context(poster2);await client.query("select public.decide_approval($1,'APPROVED','EX-REFUND-REVIEW')",[refund.approval_request_id]);await client.query("select public.complete_refund($1,'EX-PAID',$2)",[refund.id,uuid()]);await context();
  const afterRefund=await status(p);assert.equal(afterRefund.refunded,"40.00");assert.equal(afterRefund.reserved,"0.00");assert.equal(afterRefund.available,"0.00");
  assert.equal((await one("select amount::text from public.recognized_revenue_facts where id=$1",[fact.id])).amount,"100.00");
  console.log("PASS custody without receivable, declaration, source/target settlement, retry, reversal, refund reservation/completion and Revenue independence");

  const t1=await target("SPLIT_A","150.00"),t2=await target("SPLIT_B","100.00");const split=await receipt(t1,"100.00",[t1,t2]);
  await apply(split,t1,"60.00");await apply(split,t2,"40.00");await assert.rejects(apply(split,t1,"1.00"),/source_ceiling/);
  assert.equal((await one("select outstanding from public.contract_finance_snapshot where contract_id=$1",[t1.contract.id])).outstanding,"90.00");
  const partial=await target("PARTIAL","150.00");const partialCash=await receipt(partial);await apply(partialCash,partial,"100.00");assert.equal((await one("select outstanding from public.contract_finance_snapshot where contract_id=$1",[partial.contract.id])).outstanding,"50.00");
  const overTarget=await receipt(t2,"100.00");await assert.rejects(apply(overTarget,t2,"61.00"),/target_ceiling/);
  const euro=await target("CURRENCY","100.00","EUR");await assert.rejects(receipt(t1,"100.00",[euro]),/targets_invalid/);
  await assert.rejects(receipt({...t1,s:{...t1.s,currency:"EUR"}},"100.00",[euro]),/terms_invalid/);
  await assert.rejects(apply(overTarget,euro,"1.00"),/target_invalid|currency/);
  for(const actor of [plain,superAdmin,poster]){await context(actor);await assert.rejects(apply(overTarget,t2,"1.00"),/authority_required/);}
  await context(maker,ws,"aal1");await assert.rejects(apply(overTarget,t2,"1.00"),/authority_required|aal2/);
  await context();await assert.rejects(cash("APPLY",p.id,{service_id:t2.s.id,receivable_id:t2.schedule.id,amount:"1.00",intent:uuid(),reference:"EX"},uuid(),client,uuid()),/authority_required/);
  await context(maker,otherWs);await assert.rejects(status(p),/workspace|authority/);assert.equal((await one("select count(*)::int n from public.cash_applications")).n,0);
  await context(maker,ws,"aal2",null);await assert.rejects(client.query("update public.cash_applications set amount=1 where id=$1",[entry.id]),/immutable/);await assert.rejects(client.query("delete from public.cash_applications where id=$1",[entry.id]),/immutable/);await assert.rejects(client.query("update public.payments set purpose='TRADE_RECEIPT' where id=$1",[p.id]),/purpose_immutable/);
  await context();await assert.rejects(client.query("insert into public.cash_applications(id) values($1)",[uuid()]),/permission denied/);
  console.log("PASS partial/split application, ceilings, currency/entity/workspace, designated authority, AAL2 and immutable history");

  rival=new pg.Client({connectionString:url,statement_timeout:6000});await rival.connect();await context(poster2,ws,"aal2","crm_app",rival);
  const raceA=await target("RACE_A"),raceB=await target("RACE_B"),raceCash=await receipt(raceA,"100.00",[raceA,raceB]);
  const uses=await Promise.allSettled([apply(raceCash,raceA,"80.00"),apply(raceCash,raceB,"80.00",uuid(),uuid(),rival)]);assert.equal(uses.filter(x=>x.status==="fulfilled").length,1);assert.equal((await status(raceCash)).available,"20.00");
  const raceRefundTarget=await target("RACE_REFUND"),raceRefundCash=await receipt(raceRefundTarget);
  const raceRefund=await Promise.allSettled([apply(raceRefundCash,raceRefundTarget,"100.00"),requestRefund(raceRefundCash,"100.00",rival)]);assert.equal(raceRefund.filter(x=>x.status==="fulfilled").length,1);assert.equal((await status(raceRefundCash)).available,"0.00");
  const directTarget=await target("DIRECT_RACE"),directSource=await receipt(directTarget);
  const direct=async(connection=client,amount="100.00")=>(await one("select to_jsonb(public.record_payment($1,$2,$3,'USD',$4,now())) x",[directTarget.contract.id,directTarget.schedule.id,amount,`EX-TRADE-${uuid()}`],connection)).x;
  const directRace=await Promise.allSettled([apply(directSource,directTarget,"100.00"),direct(rival)]);assert.equal(directRace.filter(x=>x.status==="fulfilled").length,1);
  assert.equal((await one("select paid_amount::text from public.receivable_schedules where id=$1",[directTarget.schedule.id])).paid_amount,"100.00");
  const ordinary=await target("ORDINARY");const trade=(await one("select to_jsonb(public.record_payment($1,$2,60,'USD',$3,now())) x",[ordinary.contract.id,ordinary.schedule.id,`EX-TRADE-${uuid()}`])).x;assert.equal(trade.purpose,"TRADE_RECEIPT");
  await assert.rejects(client.query("select public.record_payment($1,$2,50,'USD',$3,now())",[ordinary.contract.id,ordinary.schedule.id,uuid()]),/exceeds_receivable/);
  const tradeRefund=await requestRefund(trade,"20.00");await context(poster2);await client.query("select public.decide_approval($1,'APPROVED','EX-TRADE-REFUND')",[tradeRefund.approval_request_id]);await client.query("select public.complete_refund($1,'EX-TRADE-PAID')",[tradeRefund.id]);await context();
  assert.equal((await one("select paid_amount::text from public.receivable_schedules where id=$1",[ordinary.schedule.id])).paid_amount,"40.00");
  await client.query("select public.refresh_receivable($1)",[ordinary.schedule.id]);assert.equal((await one("select collected from public.contract_finance_snapshot where contract_id=$1",[ordinary.contract.id])).collected,"40.00");
  await assert.rejects(cash("DECLARE_CUSTODY",trade.id,{intent:uuid(),reference:"EX"}),/source_invalid/);
  console.log("PASS application/application, refund/application and direct-settlement races; ordinary trade/refund regression");
  const atomic=await target("ATOMIC"),atomicCash=await receipt(atomic);await context(maker,ws,"aal2",null);
  await client.query("create function public.fail_cash_audit() returns trigger language plpgsql as $$begin if new.action='CASH_APPLY' then raise exception 'injected_cash_audit';end if;return new;end$$;create trigger fail_cash_audit before insert on public.audit_events for each row execute function public.fail_cash_audit()");
  await context();await assert.rejects(apply(atomicCash,atomic,"100.00"),/injected_cash_audit/);assert.equal((await status(atomicCash)).available,"100.00");assert.equal((await one("select paid_amount::text from public.receivable_schedules where id=$1",[atomic.schedule.id])).paid_amount,"0.00");
  await context(maker,ws,"aal2",null);await client.query("drop trigger fail_cash_audit on public.audit_events;drop function public.fail_cash_audit()");await context();
  assert.deepEqual(await one("select (select count(*) from public.recognized_revenue_facts)::int facts,(select count(*) from public.revenue_recognition_candidates)::int candidates"),counts);
  console.log("PASS audit rollback and no cash-triggered Candidate/Fact changes");
  const refundRetry=await target("REFUND_RETRY"),refundCash=await receipt(refundRetry);const refundKey=uuid();
  const requestOnce=async(amount="40.00")=>(await one("select to_jsonb(public.request_refund($1,$2,'Example retry',$3)) x",[refundCash.id,amount,refundKey])).x;
  const retryRefund=await requestOnce();assert.equal((await requestOnce()).id,retryRefund.id);await assert.rejects(requestOnce("50.00"),/conflict/);
  await assert.rejects(client.query("select public.decide_approval($1,'APPROVED','EX-SELF')",[retryRefund.approval_request_id]),/independent/);
  await context(plain);await assert.rejects(client.query("select public.decide_approval($1,'APPROVED','EX-UNDESIGNATED')",[retryRefund.approval_request_id]),/authority/);
  await context(poster2);await client.query("select public.decide_approval($1,'APPROVED','EX-REVIEW')",[retryRefund.approval_request_id]);
  const completeKey=uuid();const completeOnce=()=>client.query("select public.complete_refund($1,'EX-COMPLETE',$2)",[retryRefund.id,completeKey]);await completeOnce();await completeOnce();await context();assert.equal((await status(refundCash)).available,"60.00");
  const invalid=await target("REMOVED_TARGET"),invalidCash=await receipt(invalid);await context(maker,ws,"aal2",null);await client.query("update public.contracts set archived_at=now() where id=$1",[invalid.contract.id]);await context();await assert.rejects(apply(invalidCash,invalid,"1.00"),/declaration_required|target_invalid/);
  const changedTarget=await target("CHANGED_TARGET"),changedCash=await receipt(changedTarget);await context(maker,ws,"aal2",null);await client.query("update public.receivable_schedules set amount=50,updated_at=clock_timestamp() where id=$1",[changedTarget.schedule.id]);await context();await assert.rejects(apply(changedCash,changedTarget,"60.00"),/target_ceiling/);
  const cashFirst=await target("CASH_FIRST"),early=await receipt(cashFirst);await assert.rejects(evaluate(cashFirst),/fulfillment_required/);
  assert.deepEqual(await one("select (select count(*) from public.recognized_revenue_facts)::int facts,(select count(*) from public.revenue_recognition_candidates)::int candidates"),counts);
  await evidence(cashFirst);const laterCandidate=await approved(await evaluate(cashFirst));await context(poster);const laterFact=await post(laterCandidate);await context();await apply(early,cashFirst,"100.00");
  assert.equal((await one("select sum(amount)::text total from public.recognized_revenue_facts where contract_id=$1",[cashFirst.contract.id])).total,"100.00");
  assert.equal((await one("select amount::text from public.recognized_revenue_facts where id=$1",[laterFact.id])).amount,"100.00");
  const targetRead=(await one("select public.cash_target_status($1,$2,$3) x",[entity,cashFirst.s.id,cashFirst.schedule.id])).x;assert.equal(targetRead.applied_cash,"100.00");assert.equal(targetRead.outstanding,"0.00");
  assert.equal((await one("select count(*)::int n from public.payments where purpose='CUSTODY_RECEIPT'")).n,0,"legacy receipt reads exclude custody");
  console.log("PASS refund receipts/review, removed/amended target rejection, cash-before-Revenue and classified reads");
  console.log("REVENUE_R5E_POSTGRES_PASS");
} finally {
  await rival?.end().catch(()=>{});await client?.end().catch(()=>{});
  run("docker",["rm","--force",name]);
}
