import assert from "node:assert/strict";
import { randomBytes, randomUUID as uuid } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

// Explicitly disposable: no .env, no supplied database URL, no persistent volume.
const name = `lumina-revenue-r5b-${randomBytes(6).toString("hex")}`;
const password = randomBytes(32).toString("hex");
const image = process.env.REVENUE_TEST_POSTGRES_IMAGE || "postgres:18.4-bookworm";
assert.match(image, /^postgres:18\.\d+-(bookworm|trixie)$/);
const deadline = Date.now() + 55_000;
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
    "--label", "com.lumina.crm.test=revenue-r5b", "--publish", "127.0.0.1::5432",
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
    await client.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)", [user, `r5b-${i}@example.test`, `r5b-${i}`]);
    await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)", [ws, user, user === superAdmin ? "SUPER_ADMIN" : "ADMIN"]);
  }
  await client.query("insert into public.workspaces(id,slug,name) values($1,'r5b-other','Example Other')", [otherWs]);
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
  const profile = (await one("select public.provision_revenue_profile($1,$2,$3,$4,$5) x", [entity, maker, checker, { legal_name: "Example Evidence Entity", accounting_framework: "Example Framework", business_timezone: tz, allowed_currencies: ["USD"], cutoff_reference: "EX-CUTOFF", correction_reference: "EX-CORRECTION", retention_reference: "EX-RETENTION", authority_reference: "EX-ONBOARDING" }, uuid()])).x;
  await context(); await approve(await foundation("PROFILE_SUBMIT", profile.id, {}, 1));
  const assignments = [];
  for (const user of [verifier, verifier2, maker]) {
    const a = await foundation("AUTHORITY_ASSIGN", uuid(), { user_id: user, authority: "EVIDENCE_VERIFIER", effective_from: "2020-01-01T00:00:00Z", reference: "EX-EVIDENCE-AUTHORITY" });
    await approve(a); assignments.push(a);
  }
  await foundation("PERIOD_CREATE", uuid(), { period_key: "EX-2026", start_on: "2026-01-01", end_on: "2026-12-31" });
  const org = uuid(), product = uuid();
  await client.query("insert into public.organizations(id,workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,'示例机构','Example Organization',$3,$3)", [org, ws, maker]);
  await client.query("insert into public.products(id,workspace_id,code,name_zh,name_en,billing_unit,duration_zh,duration_en) values($1,$2,'EVIDENCE-EXAMPLE','示例服务','Example Service','PROJECT','一期','One period')", [product, ws]);
  const contract = (await client.query("select * from public.create_buyer_contract('R5B-CONTRACT',$1,null,$2,'2026-01-01','2026-12-31','USD',900)", [org, product])).rows[0];
  const cv = await one("select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1", [contract.id]);
  await foundation("CONTRACT_ACCEPT", cv.id, { reference: "EX-ACCEPTANCE" }, cv.version);
  const activity = async (day = "2026-01-31", organization = org) => {
    return (await one("select (public.record_customer_activity($1,null,null,'MEETING',($2::date+time '12:00') at time zone $3,'示例交付','Example delivery','确认交付','Confirm delivery')).id", [organization, day, tz])).id;
  };
  const a = await activity(), a2 = await activity(), later = await activity("2026-02-15");
  async function service(key, strategy = "POINT_IN_TIME_ON_APPROVED_EVIDENCE", units = [{ key: "DELIVERABLE", units: "1" }], sources = [a, a2], configure = true, domain = "CRM_ACTIVITY") {
    const p = await foundation("POLICY_CREATE", uuid(), { policy_key: `EX_${key}`, recognition_strategy: strategy, amount_strategy: "ACCEPTED_SERVICE_CONSIDERATION", presentation: "GROSS", fulfillment_rule_reference: "EX-EXPLICIT-EVIDENCE", refund_correction_reference: "EX-REFUND", currency: "USD", effective_from: "2020-01-01" });
    await approve(await foundation("POLICY_SUBMIT", p.id, {}, 1));
    const s = await foundation("SERVICE_CREATE", uuid(), { contract_id: contract.id, contract_version_id: cv.id, stable_service_key: key, product_id: product, accepted_amount: "100.00", accepted_quantity: "1", currency: "USD", accepted_price_source: "CONTRACT_VERSION", accepted_price_reference: "EX-ACCEPTED", service_classification: "OWN_SERVICE", description_snapshot: "Example evidence service" });
    const b = await foundation("BINDING_CREATE", uuid(), { specified_service_id: s.id, policy_version_id: p.id, principal_agent_role: "PRINCIPAL", presentation: "GROSS", assessment_basis_reference: "EX-ASSESSMENT", assessment_sources: ["EX-V1"], amount: "100.00", recognition_unit_schedule: units });
    let rev = 1;
    if (configure) {
      const requirements = Object.fromEntries(units.map(u => [u.key, { source_domain: domain, source_ids: sources, evidence_type: strategy === "OVER_TIME_BY_VERIFIED_UNITS" ? "COVERAGE" : "DELIVERABLE", condition: domain === "CRM_ACTIVITY" ? "MEETING" : "COMPLETED", date_basis: domain === "CRM_ACTIVITY" ? "OCCURRED_ON" : "COMPLETED_ON" }]));
      rev = (await one("select public.revenue_set_fulfillment_requirements($1,$2,1,$3,$4) x", [entity, b.id, requirements, uuid()])).x.revision;
    }
    await approve(await foundation("BINDING_SUBMIT", b.id, {}, rev));
    return { s, b, p };
  }
  const base = await service("DIRECT");
  const input = (x = base, source = a, extra = {}) => ({ specified_service_id: x.s.id, binding_id: x.b.id, recognition_unit_key: "DELIVERABLE", evidence_type: "DELIVERABLE", source_domain: "CRM_ACTIVITY", source_id: source, business_date: "2026-01-31", verified_units: "1", ...extra });
  const pending = async (data, key = uuid()) => { const draft = await att("CREATE", uuid(), data, null, key); return att("SUBMIT", draft.id, {}, 1); };
  const accept = (x, connection = client, key = uuid()) => att("ACCEPT", x.id, { reference: "EX-VERIFICATION" }, x.revision, key, connection);
  const first = await pending(input());
  await assert.rejects(accept(first), /review_invalid/);
  for (const user of [plain, superAdmin, checker]) { await context(user); await assert.rejects(accept(first), /authority_required/); }
  await context(verifier, ws, "aal1"); await assert.rejects(accept(first), /authority_required|aal2_required/);
  await context(verifier); const key = uuid(); const accepted = await accept(first, client, key); assert.equal(accepted.status, "ACCEPTED"); assert.equal(accepted.verified_units, "1.000000");
  const auditBefore = (await one("select count(*)::int n from public.audit_events where entity_id=$1", [first.id])).n;
  assert.deepEqual(await accept(first, client, key), accepted);
  assert.equal((await one("select count(*)::int n from public.audit_events where entity_id=$1", [first.id])).n, auditBefore);
  await assert.rejects(att("ACCEPT", first.id, { reference: "Changed" }, first.revision, key), /request_conflict/);
  await context(); const duplicate = await pending(input(base, a2)); await context(verifier); await assert.rejects(accept(duplicate), /already_satisfied/);
  await context();
  await assert.rejects(pending(input(base, a, { recognition_unit_key: "UNKNOWN" })), /rule_required/);
  await assert.rejects(pending(input(base, a, { source_domain: "arbitrary_table" })), /domain_unsupported/);
  await assert.rejects(pending(input(base, a, { source_hash: "caller-hash" })), /input_invalid/);
  await assert.rejects(pending(input(base, a, { specified_service_id: uuid() })), /binding_not_approved/);
  const noRule = await service("NO_RULE", undefined, undefined, undefined, false);
  await assert.rejects(pending(input(noRule)), /rule_required/);
  console.log("PASS lifecycle, independent designation/AAL2, no implicit completion, exact rule/unit, retry and duplicate prevention");
  const changed = await service("CHANGED"); const stale = await pending(input(changed));
  await context(maker, ws, "aal2", null);
  await client.query("update public.crm_activities set summary_en='Example revised delivery',updated_at=clock_timestamp() where id=$1", [a]);
  await context(verifier); await assert.rejects(accept(stale), /source_changed/);
  assert.equal((await one("select public.revenue_attestation_health($1) x", [first.id])).x, "SOURCE_CHANGED");
  await att("REJECT", stale.id, { reference: "EX-STALE-REJECT" }, stale.revision);
  await att("WITHDRAW", first.id, { reference: "EX-WITHDRAW" }, accepted.revision);
  await context(); const replacement = await pending(input(base, a, { supersedes_attestation_id: first.id }));
  await context(verifier); await accept(replacement);
  await context(); const removed = await pending(input(changed, a2));
  const stamp = (await one("select updated_at::text stamp from public.crm_activities where id=$1", [a2])).stamp;
  await client.query("select public.archive_business_record('ACTIVITY',$1,null,$2::timestamptz,$3)", [a2, stamp, uuid()]);
  await context(verifier); await assert.rejects(accept(removed), /source_unavailable/);
  assert.equal((await one("select status from public.revenue_fulfillment_attestations where id=$1", [first.id])).status, "WITHDRAWN");
  await assert.rejects(client.query("delete from public.revenue_fulfillment_attestations where id=$1", [first.id]), /permission denied/);
  console.log("PASS source changed/removed blockers and immutable withdrawal/replacement lineage");
  await context();
  const coverage = await service("COVERAGE", "OVER_TIME_BY_VERIFIED_UNITS", [{ key: "PERIOD", units: "3", from: "2026-01-01", to: "2026-03-31" }], [a, later]);
  const coverageInput = (source, day, from, to, units = "1") => input(coverage, source, { recognition_unit_key: "PERIOD", evidence_type: "COVERAGE", business_date: day, coverage_from: from, coverage_to: to, verified_units: units });
  const ca = await pending(coverageInput(a, "2026-01-31", "2026-01-01", "2026-01-31"));
  const cb = await pending(coverageInput(later, "2026-02-15", "2026-01-15", "2026-02-15"));
  rival = new pg.Client({ connectionString: url, statement_timeout: 6000 }); await rival.connect();
  await context(verifier2, ws, "aal2", "crm_app", rival); await context(verifier);
  const coverageRace = await Promise.allSettled([accept(ca), accept(cb, rival)]);
  assert.equal(coverageRace.filter(r => r.status === "fulfilled").length, 1);
  assert.match(coverageRace.find(r => r.status === "rejected").reason.message, /coverage_overlap/);
  await context(); const ceiling = await pending(coverageInput(later, "2026-02-15", "2026-02-15", "2026-02-15", "3"));
  await context(verifier); await assert.rejects(accept(ceiling), /already_satisfied/);
  await context(); const raceService = await service("RACE", undefined, undefined, [a]); const raceAtt = await pending(input(raceService));
  await context(verifier); const race = await Promise.allSettled([accept(raceAtt), accept(raceAtt, rival)]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  await context(); const withdrawalRace = await pending(input(changed));
  await context(verifier);
  const decisions = await Promise.allSettled([accept(withdrawalRace), att("WITHDRAW", withdrawalRace.id, { reference: "EX-RACE" }, withdrawalRace.revision, uuid(), rival)]);
  assert.equal(decisions.filter(r => r.status === "fulfilled").length, 1);
  await rival.end(); rival = null;
  console.log("PASS locked coverage overlap/ceiling and two-verifier serialization");
  await context();
  const contact = uuid(), student = uuid(), cohort = uuid();
  await context(maker, ws, "aal2", null);
  await client.query("insert into public.contacts(id,workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,'示例学生','Example Student',$3,$3)", [contact, ws, maker]);
  await client.query("insert into public.students(id,workspace_id,person_id,owner_id,created_by) values($1,$2,$3,$4,$4)", [student, ws, contact, maker]);
  await client.query("insert into public.product_cohorts(id,workspace_id,product_id,code,name_zh,name_en,status,capacity,target_enrollment) values($1,$2,$3,'EX-EVIDENCE','示例批次','Example Cohort','RECRUITING',0,0)", [cohort, ws, product]);
  const enrollmentData = { student_id: student, cohort_id: cohort, household_id: null, opportunity_id: null, sales_owner_id: null, withdrawn_at: null, status: "COMPLETED", owner_id: maker, enrolled_at: "2026-01-01T12:00:00Z", completed_at: "2026-01-31T12:00:00Z", withdrawal_reason: "" };
  await context();
  const enrollment = (await client.query("select * from public.save_student_enrollment($1,null,$2,$3)", [uuid(), enrollmentData, uuid()])).rows[0];
  await client.query("select public.link_contract_enrollment($1,$2,$3,$4)", [uuid(), contract.id, enrollment.id, uuid()]);
  await assert.rejects(pending(input(noRule, enrollment.id, { source_domain: "STUDENT_ENROLLMENT" })), /rule_required/);
  const es = await service("ENROLLMENT", undefined, undefined, [enrollment.id], true, "STUDENT_ENROLLMENT");
  const ed = await pending(input(es, enrollment.id, { source_domain: "STUDENT_ENROLLMENT" }));
  assert.equal(ed.source_version, "1");
  await context(verifier); await accept(ed);
  await context(); const eChanged = await pending(input(es, enrollment.id, { source_domain: "STUDENT_ENROLLMENT", supersedes_attestation_id: null }));
  await client.query("select public.save_student_enrollment($1,1,$2,$3)", [enrollment.id, { ...enrollmentData, sales_owner_id: checker }, uuid()]);
  await context(verifier); await assert.rejects(accept(eChanged), /source_changed/);
  await context(); const eRace = await pending(input(es, enrollment.id, { source_domain: "STUDENT_ENROLLMENT" }));
  rival = new pg.Client({ connectionString: url, statement_timeout: 6000 }); await rival.connect();
  await context(maker, ws, "aal2", "crm_app", rival); await rival.query("begin");
  await rival.query("select public.save_student_enrollment($1,2,$2,$3)", [enrollment.id, { ...enrollmentData, sales_owner_id: verifier2 }, uuid()]);
  await context(verifier); const blockedReview = assert.rejects(accept(eRace), /source_changed/);
  await rival.query("commit"); await blockedReview; await rival.end(); rival = null;
  await context(); const rollbackDraft = await pending(input(raceService));
  await context(maker, ws, "aal2", null);
  await client.query("create function public.r5b_fail_audit() returns trigger language plpgsql as $$begin if new.action='REVENUE_ATTESTATION_REJECT' then raise exception 'synthetic_audit_failure';end if;return new;end$$; create trigger r5b_fail_audit before insert on public.audit_events for each row execute function public.r5b_fail_audit()");
  await context(verifier); const rollbackKey = uuid();
  await assert.rejects(att("REJECT", rollbackDraft.id, { reference: "EX-ROLLBACK" }, rollbackDraft.revision, rollbackKey), /synthetic_audit_failure/);
  assert.equal((await one("select status from public.revenue_fulfillment_attestations where id=$1", [rollbackDraft.id])).status, "IN_REVIEW");
  await context(maker, ws, "aal2", null); await client.query("drop trigger r5b_fail_audit on public.audit_events; drop function public.r5b_fail_audit()");
  await assert.rejects(client.query("update public.revenue_fulfillment_attestations set business_date='2026-02-01' where id=$1", [first.id]), /immutable/);
  await assert.rejects(client.query("delete from public.revenue_fulfillment_attestations where id=$1", [first.id]), /retention/);
  await context(verifier); await att("REJECT", rollbackDraft.id, { reference: "EX-ROLLBACK" }, rollbackDraft.revision, rollbackKey);
  await context();
  const unrelatedOrg = uuid();
  await client.query("insert into public.organizations(id,workspace_id,name_zh,name_en,owner_id,created_by) values($1,$2,'示例其他机构','Example Unrelated',$3,$3)", [unrelatedOrg, ws, maker]);
  const unrelatedActivity = await activity("2026-01-31", unrelatedOrg);
  await assert.rejects(pending(input(raceService, unrelatedActivity)), /source_unavailable/);
  const milestone = await service("MILESTONE", "OVER_TIME_BY_APPROVED_MILESTONES", [{ key: "DELIVERABLE", units: "1" }], [a]);
  const milestoneAtt = await pending(input(milestone));
  await context(verifier); await accept(milestoneAtt);
  await context(); const milestoneDuplicate = await pending(input(milestone));
  await context(verifier); await assert.rejects(accept(milestoneDuplicate), /already_satisfied/);
  await context(maker, ws, "aal2", null);
  await client.query("update public.contracts set contract_value=1000 where id=$1", [contract.id]);
  const amendment = await one("select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1", [contract.id]);
  await context(); await foundation("CONTRACT_ACCEPT", amendment.id, { reference: "EX-AMENDMENT" }, amendment.version);
  const successor = await foundation("SERVICE_CREATE", uuid(), { contract_id: contract.id, contract_version_id: amendment.id, stable_service_key: "DIRECT", supersedes_service_id: base.s.id, product_id: product, accepted_amount: "100.00", accepted_quantity: "1", currency: "USD", accepted_price_source: "CONTRACT_VERSION", accepted_price_reference: "EX-ACCEPTED", service_classification: "OWN_SERVICE", description_snapshot: "Example successor" });
  const successorBinding = await foundation("BINDING_CREATE", uuid(), { specified_service_id: successor.id, policy_version_id: base.p.id, principal_agent_role: "PRINCIPAL", presentation: "GROSS", assessment_basis_reference: "EX-ASSESSMENT", assessment_sources: ["EX-V2"], amount: "100.00", recognition_unit_schedule: [{ key: "DELIVERABLE", units: "1" }] });
  await one("select public.revenue_set_fulfillment_requirements($1,$2,1,$3,$4)", [entity, successorBinding.id, { DELIVERABLE: { source_domain: "CRM_ACTIVITY", source_ids: [a], evidence_type: "DELIVERABLE", condition: "MEETING", date_basis: "OCCURRED_ON" } }, uuid()]);
  await approve(await foundation("BINDING_SUBMIT", successorBinding.id, {}, 2));
  const amendedEvidence = await pending(input({ s: successor, b: successorBinding }));
  await context(verifier); await assert.rejects(accept(amendedEvidence), /already_satisfied/);
  await context(); await assert.rejects(pending(input(base)), /service_superseded/);
  console.log("PASS withdraw/accept race, audit rollback and privileged retention guards");
  await context(plain, otherWs); assert.equal((await one("select count(*)::int n from public.revenue_fulfillment_attestations")).n, 0);
  await context(); await assert.rejects(att("CREATE", uuid(), input(), null, uuid(), client, uuid()), /authority_required/);
  await context(checker); await foundation("AUTHORITY_REVOKE", assignments[0].id, { reference: "EX-REVOKE" }, 2);
  await context(verifier); await assert.rejects(accept(removed), /authority_required/);
  console.log("PASS canonical Enrollment revision/contract link, workspace/entity RLS and immediate revocation");
  console.log("REVENUE_R5B_POSTGRES_PASS");
} finally {
  await rival?.end().catch(() => {});
  await client?.end().catch(() => {});
  run("docker", ["rm", "--force", name]);
}
