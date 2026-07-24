import fs from "node:fs";
import path from "node:path";
import { runBounded } from "./lib/bounded-process.mjs";

const rootOutput = path.resolve(process.env.QA_OUTPUT_DIR || "work/browser-qa-chromium-1228");
const browserScript = path.resolve("scripts/browser-qa-chromium-1228.cjs");
const baseEnvironment = { ...process.env, QA_BASE_URL: process.env.QA_BASE_URL || process.env.APP_URL || "http://localhost:3200" };
fs.mkdirSync(rootOutput, { recursive: true });

const phases = [
  { name: "01-public", timeout: 45, env: { QA_SCOPE: "public" } },
  {
    name: "02-manager-core-a", timeout: 75,
    env: {
      QA_SCOPE: "routes", QA_LABEL: "core-a",
      QA_ROUTES: "/dashboard,/schools,/people,/calendar,/tasks,/messages,/products",
      QA_MOBILE_ROUTES: "/dashboard,/calendar,/messages",
      QA_TABLET_ROUTES: "/dashboard",
    },
  },
  {
    name: "03-manager-core-b", timeout: 90,
    env: {
      QA_SCOPE: "routes", QA_LABEL: "core-b",
      QA_ROUTES: "/finance,/students,/households,/leads,/opportunities,/contracts",
      QA_MOBILE_ROUTES: "/finance,/students,/households,/leads,/opportunities,/contracts",
      QA_TABLET_ROUTES: "/finance,/students",
    },
  },
  {
    name: "04-manager-operations", timeout: 90,
    env: {
      QA_SCOPE: "routes", QA_LABEL: "operations",
      QA_ROUTES: "/imports,/duplicates,/data-quality,/guardian-portal,/progression,/growth,/privacy-requests",
      QA_MOBILE_ROUTES: "/imports,/duplicates,/data-quality,/guardian-portal",
      QA_TABLET_ROUTES: "/imports",
    },
  },
  {
    name: "05-manager-insights", timeout: 90,
    env: {
      QA_SCOPE: "routes", QA_LABEL: "insights",
      QA_ROUTES: "/sales/performance,/sales/allocation,/analytics/consumption,/automation,/ai,/reports,/reports/exports,/reports/marketing,/help",
      QA_MOBILE_ROUTES: "/analytics/consumption,/reports,/reports/exports,/help",
    },
  },
  {
    name: "06-settings", timeout: 60,
    env: {
      QA_SCOPE: "routes", QA_LABEL: "settings",
      QA_ROUTES: "/settings/profile,/settings/account,/settings/notifications,/settings/security,/settings/privacy",
      QA_MOBILE_ROUTES: "/settings/notifications,/settings/security,/settings/privacy",
    },
  },
  {
    name: "07-admin", timeout: 75,
    env: {
      QA_SCOPE: "routes", QA_LABEL: "admin", QA_ROLE: "SUPER_ADMIN",
      QA_ROUTES: "/admin,/admin/approvals,/admin/operations,/admin/users,/admin/security",
      QA_MOBILE_ROUTES: "/admin,/admin/approvals,/admin/operations,/admin/users,/admin/security",
    },
  },
  { name: "08-notification", timeout: 45, env: { QA_SCOPE: "notification" } },
  { name: "09-workflows", timeout: 90, env: { QA_SCOPE: "workflows" } },
  { name: "10-support", timeout: 45, env: { QA_SCOPE: "support" } },
];

const requestedPhase = process.env.QA_PHASE?.trim();
const mergeOnly = process.env.QA_MERGE_ONLY === "1";
const selectedPhases = mergeOnly ? [] : requestedPhase ? phases.filter((phase) => phase.name === requestedPhase) : phases;
if (!mergeOnly && !selectedPhases.length) throw new Error(`Unknown QA_PHASE ${requestedPhase}`);
for (const phase of selectedPhases) {
  const index = phases.indexOf(phase);
  const phaseOutput = path.join(rootOutput, "phases", phase.name);
  fs.mkdirSync(phaseOutput, { recursive: true });
  process.stdout.write(
    `\n[QA stage ${index + 1}/${phases.length}] ${phase.name}: `
    + `hard limit=${phase.timeout}s\n`,
  );
  await runBounded({
    command: process.execPath,
    args: [browserScript],
    label: `Chromium ${phase.name}`,
    timeoutMs: phase.timeout * 1_000,
    idleTimeoutMs: Math.min(30_000, phase.timeout * 1_000),
    heartbeatMs: 10_000,
    env: { ...baseEnvironment, ...phase.env, QA_OUTPUT_DIR: phaseOutput },
  });
  const report = JSON.parse(fs.readFileSync(path.join(phaseOutput, "report.json"), "utf8"));
  process.stdout.write(
    `[QA stage ${index + 1}/${phases.length}] passed: `
    + `${report.pages.length} page/viewports, identities ${report.identity.cleaned}/${report.identity.created}\n`,
  );
}

const completedReports = phases.flatMap((phase) => {
  const filename = path.join(rootOutput, "phases", phase.name, "report.json");
  if (!fs.existsSync(filename)) return [];
  const report = JSON.parse(fs.readFileSync(filename, "utf8"));
  const durationMs = report.durationMs
    ?? Math.max(0, fs.statSync(filename).mtimeMs - Date.parse(report.runAt));
  return [{ name: phase.name, timeoutSeconds: phase.timeout, durationMs, report }];
});
if (completedReports.length !== phases.length) {
  process.stdout.write(
    `[QA staged] ${completedReports.length}/${phases.length} phases currently complete; `
    + "the combined report will be written after the final phase.\n",
  );
  process.exit(0);
}

function evidenceSignature(report) {
  return JSON.stringify({
    browser: report.browser,
    executable: report.executable,
    browserVersion: report.browserVersion,
    gitSha: report.evidence?.gitSha,
    appVersion: report.evidence?.appVersion,
    migrationHead: report.evidence?.migrationHead,
    buildHash: report.evidence?.buildHash,
    baseUrl: report.evidence?.baseUrl,
  });
}

const expectedEvidence = evidenceSignature(completedReports[0].report);
const inconsistentPhases = completedReports
  .filter(({ report }) => evidenceSignature(report) !== expectedEvidence)
  .map(({ name }) => name);
if (inconsistentPhases.length) {
  if (requestedPhase && !mergeOnly) {
    process.stdout.write(
      `[QA staged] ${requestedPhase} passed, but the combined report still contains older evidence. `
      + `Continue rerunning: ${inconsistentPhases.join(", ")}\n`,
    );
    process.exit(0);
  }
  throw new Error(
    "Refusing to merge Chromium phases from different builds, versions, runtimes, or base URLs. "
    + `Rerun these phases against the same production build: ${inconsistentPhases.join(", ")}`,
  );
}

const first = completedReports[0]?.report ?? {};
const combined = {
  runAt: new Date().toISOString(),
  browser: first.browser,
  executable: first.executable,
  browserVersion: first.browserVersion,
  evidence: first.evidence,
  staged: true,
  totalElapsedMs: completedReports.reduce((total, phase) => total + phase.durationMs, 0),
  phases: completedReports.map(({ name, timeoutSeconds, durationMs, report }) => ({
    name,
    timeoutSeconds,
    durationMs,
    pages: report.pages.length,
    errors: report.errors.length,
    warnings: report.warnings.length,
    identity: report.identity,
  })),
  pages: completedReports.flatMap(({ report }) => report.pages),
  errors: completedReports.flatMap(({ name, report }) => report.errors.map((error) => ({ phase: name, ...error }))),
  warnings: completedReports.flatMap(({ name, report }) => report.warnings.map((warning) => ({ phase: name, ...warning }))),
  identity: completedReports.reduce(
    (total, { report }) => ({
      created: total.created + report.identity.created,
      cleaned: total.cleaned + report.identity.cleaned,
    }),
    { created: 0, cleaned: 0 },
  ),
};
fs.writeFileSync(path.join(rootOutput, "report.json"), JSON.stringify(combined, null, 2));
process.stdout.write(
  `\nStaged Chromium 1228 QA passed ${combined.pages.length} page/viewports in `
  + `${Math.round(combined.totalElapsedMs / 1_000)}s across ${phases.length} bounded stages.\n`,
);
