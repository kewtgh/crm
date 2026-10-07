import assert from "node:assert/strict";
import { randomBytes, randomUUID as uuid } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

// Explicitly disposable: no .env, no supplied database URL, no persistent volume.
const name = `lumina-revenue-r5c-${randomBytes(6).toString("hex")}`;
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
    "--label", "com.lumina.crm.test=revenue-r5c", "--publish", "127.0.0.1::5432",
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
  const maker = uuid(), checker = uuid(), verifier = uuid(), verifier2 = uuid(), plain = uuid(), superAdmin = uuid();
  for (const [i, user] of [maker, checker, verifier, verifier2, plain, superAdmin].entries()) {
    await client.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)", [user, `r5c-${i}@example.test`, `r5c-${i}`]);
    await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)", [ws, user, user === superAdmin ? "SUPER_ADMIN" : "ADMIN"]);
  }
  await client.query("insert into public.workspaces(id,slug,name) values($1,'r5c-other','Example Other')", [otherWs]);
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
  const contract = (await client.query("select * from public.create_buyer_contract('R5C-CONTRACT',$1,null,$2,'2026-01-01','2026-12-31','USD',900000)", [org, product])).rows[0];
  const cv = await one("select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1", [contract.id]);
  await foundation("CONTRACT_ACCEPT", cv.id, { reference: "EX-ACCEPTANCE" }, cv.version);
  const activity = async (day = "2026-01-31", organization = org) => {
    return (await one("select (public.record_customer_activity($1,null,null,'MEETING',($2::date+time '12:00') at time zone $3,'示例交付','Example delivery','确认交付','Confirm delivery')).id", [organization, day, tz])).id;
  };
  const a = await activity(), a2 = await activity(), later = await activity("2026-02-15");
  async function service(key, strategy = "POINT_IN_TIME_ON_APPROVED_EVIDENCE", units = [{ key: "DELIVERABLE", units: "1" }], sources = [a, a2], configure = true, domain = "CRM_ACTIVITY", options = {}) {
    const p = await foundation("POLICY_CREATE", uuid(), { policy_key: `EX_${key}`, recognition_strategy: strategy, amount_strategy: options.amountStrategy || "ACCEPTED_SERVICE_CONSIDERATION", presentation: options.agent ? "NET" : "GROSS", fulfillment_rule_reference: "EX-EXPLICIT-EVIDENCE", refund_correction_reference: "EX-REFUND", currency: options.currency || "USD", effective_from: "2020-01-01" });
    await approve(await foundation("POLICY_SUBMIT", p.id, {}, 1));
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
  for (const [user, authority] of [[maker,"RECOGNITION_PREPARER"],[maker,"RECOGNITION_REVIEWER"],[verifier,"RECOGNITION_REVIEWER"],[verifier2,"RECOGNITION_REVIEWER"]]) {
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
  const base = await service("DIRECT");
  await assert.rejects(evaluate(base), /fulfillment_required/);
  const schedules = new Map();
  const pay = async (amount, targetContract=contract) => {
    const schedule=schedules.get(targetContract.id)||(await client.query("select * from public.save_receivable_schedule($1,$2)",[targetContract.id,JSON.stringify([{dueDate:"2026-01-01",amount:"900000.00"}])])).rows[0];
    schedules.set(targetContract.id,schedule);
    return (await client.query("select * from public.record_payment($1,$2,$3,'USD',$4,now())",[targetContract.id,schedule.id,amount,`EX-CASH-${uuid()}`])).rows[0];
  };
  const payment=await pay("842.60");
  await assert.rejects(evaluate(base), /fulfillment_required/);
  const refund=(await client.query("select * from public.request_refund($1,842.60,'Example pre-delivery refund')",[payment.id])).rows[0];
  await context(maker,ws,"aal2",null);await client.query("update public.refunds set status='APPROVED' where id=$1",[refund.id]);await context();
  await client.query("select public.complete_refund($1,'EX-REFUND-RECEIPT')",[refund.id]);
  await assert.rejects(evaluate(base), /fulfillment_required/);
  assert.equal((await one("select count(*)::int n from public.revenue_recognition_candidates")).n,0);
  await context(maker,ws,"aal2",null);
  const person=uuid(),student=uuid(),cohort=uuid();
  await client.query("insert into public.contacts(id,workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,'示例学生','Example Candidate Student',$3,$3)",[person,ws,maker]);
  await client.query("insert into public.students(id,workspace_id,person_id,owner_id,created_by) values($1,$2,$3,$4,$4)",[student,ws,person,maker]);
  await client.query("insert into public.product_cohorts(id,workspace_id,product_id,code,name_zh,name_en,status,capacity,target_enrollment) values($1,$2,$3,'EX-CANDIDATE','示例批次','Example Candidate Cohort','RECRUITING',0,0)",[cohort,ws,product]);
  await client.query("update public.contracts set status='ACTIVE',signed_at=now() where id=$1",[contract.id]);
  await context();
  const enrollment=(await client.query("select * from public.save_student_enrollment($1,null,$2,$3)",[uuid(),{student_id:student,cohort_id:cohort,household_id:null,opportunity_id:null,sales_owner_id:null,withdrawn_at:null,status:"COMPLETED",owner_id:maker,enrolled_at:"2026-01-01T12:00:00Z",completed_at:"2026-01-31T12:00:00Z",withdrawal_reason:""},uuid()])).rows[0];
  await client.query("select public.link_contract_enrollment($1,$2,$3,$4)",[uuid(),contract.id,enrollment.id,uuid()]);
  const completion=await service("COMPLETED_ONLY",undefined,undefined,[enrollment.id],true,"STUDENT_ENROLLMENT");
  await assert.rejects(evaluate(completion),/fulfillment_required/);
  await assert.rejects(evaluate(base),/fulfillment_required/);
  const firstEvidence=await evidence(base);
  const first=await evaluate(base); assert.equal(first.amount,"842.60"); assert.equal(first.currency,"USD");
  assert.equal(first.evidence_references[0].id,firstEvidence.id);
  assert.equal((await evaluate(base)).id,first.id);
  await assert.rejects(candidate("EVALUATE",null,{specified_service_id:base.s.id,binding_id:base.b.id,recognition_unit_key:"DELIVERABLE",amount:"1.00"}),/input_invalid/);
  await assert.rejects(evaluate(base,"UNKNOWN"),/unit_unknown/);
  await assert.rejects(evaluate({s:base.s,b:{id:uuid()}}),/binding_not_approved/);
  const submitted=await submit(first);
  await assert.rejects(review(submitted),/review_invalid/);
  for(const user of [plain,superAdmin,checker]) {await context(user);await assert.rejects(review(submitted),/authority_required/);}
  await context(verifier,ws,"aal1");await assert.rejects(review(submitted),/aal2_required|authority_required/);
  await context(verifier);const reviewKey=uuid();const approved=await review(submitted,client,reviewKey);assert.equal(approved.status,"APPROVED");
  assert.deepEqual(await review(submitted,client,reviewKey),approved);
  await assert.rejects(candidate("APPROVE",submitted.id,{reference:"EX-CHANGED"},submitted.revision,reviewKey),/request_conflict/);
  assert.equal((await one("select count(*)::int n from public.approval_actions where approval_request_id=$1 and action='APPROVED'",[approved.approval_reference])).n,1);
  await context(); await client.query("select public.set_product_price($1,'USD',999.99,current_date)",[product]);
  await context(maker,ws,"aal2",null);await client.query("update public.contracts set contract_number='R5C-OPERATIONAL' where id=$1",[contract.id]);
  await context();assert.equal((await evaluate(base)).id,first.id);
  assert.equal((await evaluate(base)).contract_version_id,cv.id);
  await foundation("POLICY_RETIRE",base.p.id,{reference:"EX-RETIRE"},3);
  assert.equal((await evaluate(base)).id,first.id);
  console.log("PASS exact principal amount, immutable basis, independent authority, AAL2 and approval receipts");
  await context();
  const agent=await service("AGENT",undefined,undefined,[a],true,"CRM_ACTIVITY",{agent:true,amountStrategy:"APPROVED_AGENT_FEE",amount:"193.10"});
  await evidence(agent);assert.equal((await evaluate(agent)).amount,"193.10");
  await pay("842.60");assert.equal((await evaluate(agent)).amount,"193.10");
  const channel=await service("CHANNEL_COLLECTION");await evidence(channel);await pay("631.95");assert.equal((await evaluate(channel)).amount,"842.60");
  const reseller=await service("RESELLER",undefined,undefined,[a],true,"CRM_ACTIVITY",{accepted:"417.25"});await evidence(reseller);assert.equal((await evaluate(reseller)).amount,"417.25");
  assert.equal((await one("select organization_type from public.organizations where id=$1",[org])).organization_type,"SCHOOL");
  const inbound=await service("INBOUND_SERVICE",undefined,undefined,[a],true,"CRM_ACTIVITY",{accepted:"725.40"});await evidence(inbound);assert.equal((await evaluate(inbound)).amount,"725.40");
  await client.query("select public.save_enrollment_attribution($1,$2,$3)",[uuid(),{enrollment_id:enrollment.id,attribution_type:"PRIMARY",source_organization_id:org,source_contact_id:null,source_event_id:null,source_campaign_id:null,source_referral_id:null,note:""},uuid()]);
  const agreement=uuid(),agreementVersion=uuid();
  await client.query("select public.save_channel_agreement($1,$2,null,$3,$4)",[agreement,agreementVersion,{organization_id:org,agreement_code:"EX-CANDIDATE-CHANNEL",name_zh:"示例渠道协议",name_en:"Example Channel Agreement",effective_from:"2026-01-01",effective_to:"2026-12-31",signed_on:null,reference_number:null,notes:"Example independent sourcing terms",rules:[{scope_type:"PRODUCT",product_id:product,cohort_id:null,attribution_type:"PRIMARY",basis_type:"FIXED_PER_ENROLLMENT",fixed_amount:"87.30",fixed_currency:"USD",rate_bps:null,earning_event:"ENROLLMENT_COMPLETED"}]},uuid()]);
  await client.query("select public.change_channel_agreement_status($1,1,'ACTIVE','Example approval',$2)",[agreementVersion,uuid()]);
  const rule=await one("select id from public.channel_commission_rules where agreement_version_id=$1",[agreementVersion]);
  await client.query("select public.generate_commission_accrual($1,$2,null,$3)",[rule.id,enrollment.id,uuid()]);
  assert.equal((await one("select commission_amount::text amount from public.commission_accruals where rule_id=$1",[rule.id])).amount,"87.30");
  assert.equal((await evaluate(inbound)).amount,"725.40");
  const allocated=await service("ALLOCATED",undefined,undefined,[a],true,"CRM_ACTIVITY",{amountStrategy:"APPROVED_ALLOCATED_CONSIDERATION",amount:"201.17",allocation:"EX-ALLOCATION"});
  await evidence(allocated);assert.equal((await evaluate(allocated)).amount,"201.17");
  await assert.rejects(service("MISSING_ALLOCATION",undefined,undefined,[a],true,"CRM_ACTIVITY",{amountStrategy:"APPROVED_ALLOCATED_CONSIDERATION",amount:"201.17"}),/allocation_required/);
  const units=[{key:"A",units:"1"},{key:"B",units:"1"},{key:"C",units:"1"}];
  const thirds=await service("THIRDS","OVER_TIME_BY_APPROVED_MILESTONES",units,[a],true,"CRM_ACTIVITY",{accepted:"100.00"});
  await evidence(thirds,{unit:"A"});const thirdA=await evaluate(thirds,"A");assert.equal(thirdA.amount,"33.34");
  await assert.rejects(evaluate(thirds,"B"),/fulfillment_required/);
  await evidence(thirds,{unit:"B"});await evidence(thirds,{unit:"C"});
  const thirdB=await evaluate(thirds,"B"),thirdC=await evaluate(thirds,"C");assert.equal(thirdB.amount,"33.33");assert.equal(thirdC.amount,"33.33");
  assert.equal([thirdA,thirdB,thirdC].reduce((sum,x)=>sum+BigInt(x.amount.replace(".","")),0n),10000n);
  const weighted=await service("WEIGHTED","OVER_TIME_BY_APPROVED_MILESTONES",[{key:"A",units:"1"},{key:"B",units:"2"},{key:"C",units:"3"}],[a],true,"CRM_ACTIVITY",{accepted:"100.00"});
  await evidence(weighted,{unit:"A"});assert.equal((await evaluate(weighted,"A")).amount,"16.67");
  const coverage=await service("COVERAGE","OVER_TIME_BY_VERIFIED_UNITS",[{key:"PERIOD",units:"6",from:"2026-01-01",to:"2026-06-30"}],[a,later],true,"CRM_ACTIVITY",{accepted:"100.00"});
  await evidence(coverage,{unit:"PERIOD",from:"2026-01-01",to:"2026-01-31"});
  const partial=await evaluate(coverage,"PERIOD");assert.equal(partial.amount,"16.66");
  await evidence(coverage,{unit:"PERIOD",source:later,day:"2026-02-15",from:"2026-02-01",to:"2026-02-15"});
  const partial2=await evaluate(coverage,"PERIOD");assert.equal(partial2.amount,"33.33");assert.notEqual(partial.id,partial2.id);
  assert.equal((await one("select status from public.revenue_recognition_candidates where id=$1",[partial.id])).status,"STALE");
  const june=await activity("2026-06-30"),july=await activity("2026-07-31");
  const across=await service("CROSS_PERIOD","OVER_TIME_BY_VERIFIED_UNITS",[{key:"PERIOD",units:"2",from:"2026-06-01",to:"2026-07-31"}],[june,july],true,"CRM_ACTIVITY",{accepted:"100.00"});
  await evidence(across,{unit:"PERIOD",source:june,day:"2026-06-30",from:"2026-06-01",to:"2026-06-30"});await evaluate(across,"PERIOD");
  await evidence(across,{unit:"PERIOD",source:july,day:"2026-07-31",from:"2026-07-01",to:"2026-07-31"});await assert.rejects(evaluate(across,"PERIOD"),/cross_period_unsupported/);
  console.log("PASS agent and allocated entitlement, largest remainder conservation, partial verified units without elapsed time");
  // Accepted Quote v2 and commercial FX remain provenance, never live repricing.
  await context(maker,ws,"aal2",null);const qid=uuid(),q2=uuid(),q3=uuid();
  await client.query("insert into public.quotes(id,workspace_id,quote_number,organization_id,product_id,currency,valid_until,status,current_version,owner_id,created_by) values($1,$2,'EX-CANDIDATE-QUOTE',$3,$4,'CNY',current_date+30,'ACCEPTED',2,$5,$5)",[qid,ws,org,product,maker]);
  await client.query("insert into public.quote_versions(id,workspace_id,quote_id,version,subtotal,line_items,created_by) values($1,$2,$3,2,622.17,'[{\"description\":\"Example accepted service\",\"referencePricingFx\":\"6.2\"}]',$4)",[q2,ws,qid,maker]);
  await context();const quotedContract=(await client.query("select * from public.convert_quote_to_contract($1,'EX-CANDIDATE-QUOTED','2026-01-01','2026-12-31')",[qid])).rows[0];
  const quotedVersion=await one("select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1",[quotedContract.id]);
  await foundation("CONTRACT_ACCEPT",quotedVersion.id,{reference:"EX-ACCEPTED-QUOTE",quote_version_id:q2},quotedVersion.version);
  const quoteService=await service("QUOTED",undefined,undefined,[a],true,"CRM_ACTIVITY",{contract:quotedContract,cv:quotedVersion,currency:"CNY",accepted:"622.17",quoteLine:"LINE_1"});
  await evidence(quoteService);const quotedCandidate=await evaluate(quoteService);assert.equal(quotedCandidate.amount,"622.17");assert.equal(quotedCandidate.currency,"CNY");assert.equal(quotedCandidate.source_fact_references.accepted_quote_version,q2);
  await context(maker,ws,"aal2",null);await client.query("insert into public.quote_versions(id,workspace_id,quote_id,version,subtotal,line_items,created_by) values($1,$2,$3,3,700,'[{\"description\":\"Example later price\"}]',$4)",[q3,ws,qid,maker]);await client.query("update public.quotes set current_version=3 where id=$1",[qid]);
  await context();assert.equal((await evaluate(quoteService)).id,quotedCandidate.id);
  const amendOld=await service("AMEND", "OVER_TIME_BY_APPROVED_MILESTONES",[{key:"A",units:"1"}],[a]);await evidence(amendOld,{unit:"A"});const oldA=await evaluate(amendOld,"A");
  await context(maker,ws,"aal2",null);await client.query("update public.contracts set contract_value=900001 where id=$1",[contract.id]);const amendedVersion=await one("select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1",[contract.id]);
  await context();await foundation("CONTRACT_ACCEPT",amendedVersion.id,{reference:"EX-AMENDMENT"},amendedVersion.version);
  const amendNew=await service("AMEND_NEXT","OVER_TIME_BY_APPROVED_MILESTONES",[{key:"B",units:"1"}],[a],true,"CRM_ACTIVITY",{cv:amendedVersion,stableKey:"AMEND",supersedes:amendOld.s.id});await evidence(amendNew,{unit:"B"});const newB=await evaluate(amendNew,"B");
  assert.equal((await evaluate(amendOld,"A")).id,oldA.id);assert.equal(newB.contract_version_id,amendedVersion.id);assert.equal(oldA.contract_version_id,cv.id);
  console.log("PASS cash/refund non-triggers, channel/reseller consideration, catalog/Quote pinning, accepted CNY and amendment units");
  // Same-basis evaluation and approval both serialize under the canonical Revenue lock.
  const raceService=await service("RACE");await evidence(raceService);
  rival=new pg.Client({connectionString:url,statement_timeout:6000});await rival.connect();await context(maker,ws,"aal2","crm_app",rival);
  const evaluated=await Promise.all([evaluate(raceService),evaluate(raceService,"DELIVERABLE",rival)]);assert.equal(evaluated[0].id,evaluated[1].id);
  const raceReady=await submit(evaluated[0]);await context(verifier);await context(verifier2,ws,"aal2","crm_app",rival);
  const decisions=await Promise.allSettled([review(raceReady),review(raceReady,rival)]);assert.equal(decisions.filter(x=>x.status==="fulfilled").length,1);
  await rival.end();rival=null;
  await context();const withdrawn=await service("WITHDRAWN");const withdrawEvidence=await evidence(withdrawn);const withdrawalCandidate=await submit(await evaluate(withdrawn));
  await context(verifier);await att("WITHDRAW",withdrawEvidence.id,{reference:"EX-WITHDRAW"},withdrawEvidence.revision);
  assert.equal((await one("select public.revenue_candidate_health($1) x",[withdrawalCandidate.id])).x,"STALE");
  await assert.rejects(client.query("select public.decide_approval($1,'APPROVED','EX-DIRECT')",[withdrawalCandidate.approval_reference]),/stale_basis/);
  assert.equal((await review(withdrawalCandidate)).status,"STALE");
  await context();const auditService=await service("AUDIT");await evidence(auditService);const auditCandidate=await submit(await evaluate(auditService));
  await context(maker,ws,"aal2",null);await client.query("create function public.r5c_fail_audit() returns trigger language plpgsql as $$begin if new.action='REVENUE_CANDIDATE_APPROVED' then raise exception 'synthetic_audit_failure';end if;return new;end$$;create trigger r5c_fail_audit before insert on public.audit_events for each row execute function public.r5c_fail_audit()");
  await context(verifier);const auditKey=uuid();await assert.rejects(review(auditCandidate,client,auditKey),/synthetic_audit_failure/);
  assert.equal((await one("select status from public.revenue_recognition_candidates where id=$1",[auditCandidate.id])).status,"READY_FOR_REVIEW");
  assert.equal((await one("select status from public.approval_requests where id=$1",[auditCandidate.approval_reference])).status,"PENDING");
  await context(maker,ws,"aal2",null);await client.query("drop trigger r5c_fail_audit on public.audit_events;drop function public.r5c_fail_audit()");
  await context(verifier);assert.equal((await review(auditCandidate,client,auditKey)).status,"APPROVED");
  await context();const rejectedService=await service("REJECTED");await evidence(rejectedService);const rejectedCandidate=await submit(await evaluate(rejectedService));
  await context(verifier);assert.equal((await candidate("REJECT",rejectedCandidate.id,{reference:"EX-REJECT"},rejectedCandidate.revision)).status,"REJECTED");
  await context();assert.equal((await evaluate(rejectedService)).id,rejectedCandidate.id);
  await context();const changed=await service("CHANGED");await evidence(changed);const changedCandidate=await submit(await evaluate(changed));
  await context(maker,ws,"aal2",null);await client.query("update public.crm_activities set summary_en='Example amended evidence',updated_at=clock_timestamp() where id=$1",[a]);
  await context(verifier);assert.equal((await review(changedCandidate)).status,"STALE");
  await context();const absent=await service("ABSENT",undefined,undefined,[a2]);await evidence(absent,{source:a2});const absentCandidate=await submit(await evaluate(absent));
  const stamp=(await one("select updated_at::text stamp from public.crm_activities where id=$1",[a2])).stamp;
  await client.query("select public.archive_business_record('ACTIVITY',$1,null,$2::timestamptz,$3)",[a2,stamp,uuid()]);
  await context(verifier);assert.equal((await review(absentCandidate)).status,"STALE");
  console.log("PASS concurrent evaluation/review, withdrawn/changed/unavailable source and generic approval stale denial");
  await context(maker,ws,"aal2",null);
  const unevenSchedule=[{key:"A",units:"0.000001"},{key:"B",units:"999999999999.999999"},{key:"C",units:"1"}];
  for(const total of ["0.01","100.00","999999999999.99"]) {
    const allocation=(await one("select public.revenue_allocate_units($1,$2) x",[total,JSON.stringify(unevenSchedule)])).x;
    assert.equal(allocation.reduce((sum,x)=>sum+BigInt(x.minor_units),0n),BigInt(total.replace(".","")));
  }
  for(const assignment of ["amount=1","currency='EUR'","business_date='2026-02-01'","basis_digest=repeat('a',64)","evidence_references='[]'::jsonb"]) await assert.rejects(client.query(`update public.revenue_recognition_candidates set ${assignment} where id=$1`,[first.id]),/immutable/);
  await assert.rejects(client.query("delete from public.revenue_recognition_candidates where id=$1",[first.id]),/retention/);
  assert.equal((await one("select to_regclass('public.recognized_revenue_facts') x")).x,null);
  assert.equal((await one("select to_regclass('public.cash_applications') x")).x,null);
  await context(plain,otherWs);assert.equal((await one("select count(*)::int n from public.revenue_recognition_candidates")).n,0);
  await context();await assert.rejects(candidate("EVALUATE",null,{specified_service_id:base.s.id,binding_id:base.b.id,recognition_unit_key:"DELIVERABLE"},null,uuid(),client,uuid()),/authority_required/);
  const periodService=await service("PERIOD",undefined,undefined,[later]);await evidence(periodService,{source:later,day:"2026-02-15"});const periodCandidate=await submit(await evaluate(periodService));
  rival=new pg.Client({connectionString:url,statement_timeout:6000});await rival.connect();await context(checker,ws,"aal2","crm_app",rival);await rival.query("begin");
  await rival.query("select public.revenue_foundation_command($1,'PERIOD_CLOSE',$2,1,$3,$4)",[entity,period.id,{reference:"EX-CLOSE"},uuid()]);
  await context(verifier);const closeRace=review(periodCandidate);await rival.query("commit");assert.equal((await closeRace).status,"STALE");
  await context();await assert.rejects(evaluate(periodService),/period_closed/);
  await rival.query("begin");await rival.query("select public.revenue_foundation_command($1,'AUTHORITY_REVOKE',$2,2,$3,$4)",[entity,recognitionAssignments[2].id,{reference:"EX-REVOKE"},uuid()]);
  await context(verifier);const revokeRace=assert.rejects(review(periodCandidate),/authority_required/);await rival.query("commit");await revokeRace;await rival.end();rival=null;
  console.log("PASS immutable payload/retention, workspace/entity isolation, period closure, revocation and no posting owners");
  console.log("REVENUE_R5C_POSTGRES_PASS");
} finally {
  await rival?.end().catch(()=>{});await client?.end().catch(()=>{});
  run("docker",["rm","--force",name]);
}
