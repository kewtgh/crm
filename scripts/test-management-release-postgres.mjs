import assert from "node:assert/strict";
import { runManagementIntegration } from "./test-management-intelligence-postgres.mjs";

// One disposable canonical fixture; no application or Production connection.
await runManagementIntegration(async ({ client, context, ws, en2, risk, milestone }) => {
  const get = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const filters = { from: "2026-10-01", to: "2026-10-01" };
  const overview = async () => (await get("select public.management_overview_filtered($1) x", [filters])).x;
  const queue = async () => (await get("select public.management_attention('{}') x")).x;
  await client.query("reset role");
  const names = ["organizations", "contacts", "leads", "opportunities", "products", "product_cohorts", "students", "student_enrollments", "student_enrollment_status_history", "contracts", "receivable_schedules", "payments", "refunds", "commission_accruals", "commission_settlements", "student_applications", "admission_milestones", "workflow_instances", "crm_tasks", "student_success_cases", "student_success_goals", "student_success_checkins", "student_success_health_assessments", "student_success_risk_signals", "student_success_interventions", "student_success_outcomes", "data_quality_issues", "audit_events", "mutation_receipts", "automation_events", "automation_runs"];
  const present = (await client.query("select tablename from pg_tables where schemaname='public' and tablename=any($1) order by tablename", [names])).rows.map(row => row.tablename);
  assert.deepEqual(present, [...names].sort(), "Release fingerprint must cover every declared canonical table");
  const fingerprints = async () => {
    const result = {};
    for (const name of present) result[name] = (await get(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) hash from public.${name} t`)).hash;
    return result;
  };
  const before = await fingerprints();
  await context();
  await client.query("begin read only");
  const current = await overview();
  const trend = (await get("select public.management_trends($1) x", [filters])).x;
  const attention = await queue();
  assert.equal(current.asOf, trend.asOf);
  assert.equal(current.attention.total, attention.total);
  assert.equal(Object.values(attention.summary.byReason).reduce((sum, value) => sum + value, 0), attention.total);
  for (const [table, metric, count] of [["lead_pool_records", "openLeads", current.commercial.snapshot.openLeads], ["opportunities", "openOpportunities", current.commercial.snapshot.openOpportunities], ["student_enrollment_records", "activeEnrollments", current.delivery.snapshot.activeEnrollments], ["student_success_records", "atRiskCases", current.studentSuccess.snapshot.atRiskCases]]) {
    assert.equal(Number((await get(`select count(*) n from public.${table} where public.domain_report_record_matches($1,id,$2)`, [table, { reportMetric: metric }])).n), count);
  }
  assert.equal(current.studentSuccess.snapshot.distributions.health.UNKNOWN, 2);
  assert.equal(current.studentSuccess.snapshot.goalAttainment.rate, 0.5);
  assert.equal(Number((await get("select count(*) n from public.student_success_outcomes o join public.student_success_cases c on c.id=o.case_id where c.enrollment_id=$1", [en2.id])).n), 0, "COMPLETED Case does not imply an Outcome");
  assert.equal(current.commercial.money.find(row => row.currency === "CNY").open_value, "100000.00");
  assert.equal(current.finance.money.find(row => row.currency === "CNY").collected, "180000.00", "Collected already excludes the refund");
  assert.equal(current.channel.commissionByCurrency.find(row => row.currency === "CNY").net, "10000.00", "Immutable ledger reversal is counted once");
  assert.ok(!JSON.stringify({ current, trend, attention }).match(/successfulStudent|studentSuccessRate|channelRevenue|revenueForecast|businessScore|Private.*narrative|Private outcome title/i));
  await client.query("rollback");
  await client.query("reset role");
  assert.deepEqual(await fingerprints(), before, "All three Management reads and drill predicates leave exact business/audit/receipt/automation/ledger rows unchanged");
  const functions = (await client.query("select proname,provolatile,prosecdef from pg_proc join pg_namespace ns on ns.oid=pronamespace where ns.nspname='public' and (proname like 'management_%' or proname='domain_report_record_matches')")).rows;
  assert.ok(functions.length >= 6);
  for (const fn of functions) { assert.equal(fn.provolatile, fn.proname === "management_period_values" ? "i" : "s", fn.proname); assert.equal(fn.prosecdef, false, fn.proname); }

  // Additional terminal/severity predicates and the autumn 25-hour business day.
  await client.query("begin");
  for (const status of ["WAIVED", "CANCELLED"]) {
    await client.query("update public.admission_milestones set revision=revision+1,status=$2 where id=$1", [milestone.id, status]);
    await context();assert.ok(!(await queue()).items.some(row => row.source_id === milestone.id));await client.query("reset role");
  }
  await client.query("update public.student_success_risk_signals set severity='MEDIUM' where id=$1", [risk.id]);
  await context();assert.ok(!(await queue()).items.some(row => row.source_id === risk.id));await client.query("reset role");
  await client.query("update public.workspaces set business_timezone='America/New_York' where id=$1", [ws]);
  await client.query("update public.leads set created_at='2026-11-02T04:30:00Z' where id=(select id from public.leads where workspace_id=$1 order by id limit 1)", [ws]);
  await context();
  const autumn = (await get("select public.management_trends($1) x", [{ from: "2026-11-01", to: "2026-11-01" }])).x;
  assert.equal(autumn.period.timezone, "America/New_York");
  assert.equal(autumn.series.find(row => row.key === "leadsCreated").comparison.current, 1, "25-hour DST day includes its final local half hour");
  const next = (await get("select public.management_trends($1) x", [{ from: "2026-11-02", to: "2026-11-02" }])).x;
  assert.equal(next.series.find(row => row.key === "leadsCreated").comparison.current, 0);
  await client.query("rollback");await context();
  console.log("PASS release golden path: Overview/Trend/Attention/exact drill in READ ONLY transaction; 31 exact table fingerprints unchanged including Automation, Audit, receipts and Commission; STABLE invoker functions; no invented Revenue/Success; terminal/severity natural exit; autumn 25-hour DST boundary.");
});
