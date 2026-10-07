import fs from "node:fs";
import path from "node:path";
import { runBounded } from "./lib/bounded-process.mjs";

const rootOutput = path.resolve(process.env.QA_OUTPUT_DIR || "work/browser-qa-chromium-1243");
const browserScript = path.resolve("scripts/browser-qa-chromium-1243.cjs");
const baseEnvironment = { ...process.env, QA_BASE_URL: process.env.QA_BASE_URL || process.env.APP_URL || "http://localhost:3200" };
fs.mkdirSync(rootOutput, { recursive: true });

const phases = [
  { name: "01-public", timeout: 45, env: { QA_SCOPE: "public" } },
  {
    name: "02-manager-core-a", timeout: 75,
    env: {
      QA_SCOPE: "routes", QA_LABEL: "core-a",
      QA_ROUTES: "/dashboard,/action-center,/schools,/people,/calendar,/tasks,/messages,/products",
      QA_MOBILE_ROUTES: "/dashboard,/action-center,/calendar,/messages",
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
      QA_ROLE: "SALES_SPECIALIST",
      QA_ROUTES: "/settings/profile,/settings/account,/settings/notifications,/settings/security,/settings/privacy",
      QA_MOBILE_ROUTES: "/settings/notifications,/settings/security,/settings/privacy",
    },
  },
  {
    name: "07-admin", timeout: 75,
    env: {
      QA_SCOPE: "routes", QA_LABEL: "admin", QA_ROLE: "SUPER_ADMIN",
      QA_ROUTES: "/action-center,/admin,/admin/approvals,/admin/operations,/admin/users,/admin/recycle-bin,/admin/security",
      QA_MOBILE_ROUTES: "/admin,/admin/approvals,/admin/operations,/admin/users,/admin/recycle-bin,/admin/security",
    },
  },
  { name: "08-notification", timeout: 45, env: { QA_SCOPE: "notification" } },
  { name: "09-workflows", timeout: 90, env: { QA_SCOPE: "workflows" } },
  { name: "10-support", timeout: 45, env: { QA_SCOPE: "support" } },
];

const commissionAgreementPhase={name:"commission-agreements",timeout:55,env:{QA_SCOPE:"commission-agreements"}};
const commissionLedgerPhase={name:"commission-ledger",timeout:55,env:{QA_SCOPE:"commission-ledger"}};
const leadPoolPhase={name:"lead-pool-activation",timeout:55,env:{QA_SCOPE:"lead-pool-activation"}};
const channelPhase={name:"channel-commercial",timeout:55,env:{QA_SCOPE:"channel-commercial"}};
const channelAnalyticsPhase={name:"channel-analytics",timeout:55,env:{QA_SCOPE:"channel-analytics"}};
const successOutcomesPhase={name:"student-success-outcomes",timeout:55,env:{QA_SCOPE:"student-success-outcomes"}};
const managementAttentionPhase={name:"management-attention",timeout:55,env:{QA_SCOPE:"management-attention"}};
const contractExtractionPhase={name:"contract-extraction",timeout:55,env:{QA_SCOPE:"contract-extraction"}};
const contractDocumentsPhase={name:"contract-documents",timeout:55,env:{QA_SCOPE:"contract-documents"}};
const managementTrendsPhase={name:"management-trends",timeout:55,env:{QA_SCOPE:"management-trends"}};
const managementOverviewPhase={name:"management-overview",timeout:55,env:{QA_SCOPE:"management-overview"}};
const successOperationsPhase={name:"student-success-operations",timeout:55,env:{QA_SCOPE:"student-success-operations"}};
const successPhase={name:"student-success",timeout:55,env:{QA_SCOPE:"student-success"}};
const requestedPhase = process.env.QA_PHASE?.trim();
const operationalPhase={name:"operational-readiness",timeout:55,env:{QA_SCOPE:"operational-readiness"}};
const commercialPhase={name:"commercial-links",timeout:55,env:{QA_SCOPE:"commercial-links"}};
const enrollmentPhase={name:"enrollments",timeout:55,env:{QA_SCOPE:"enrollments"}};
const cohortPhase={name:"product-cohorts",timeout:55,env:{QA_SCOPE:"product-cohorts"}};
const workflowTemplatesPhase={name:"admissions-workflow-templates",timeout:55,env:{QA_SCOPE:"admissions-workflow-templates"}};
const workflowInstancesPhase={name:"admissions-workflow-instances",timeout:55,env:{QA_SCOPE:"admissions-workflow-instances"}};
const milestonePhase={name:"admission-milestones",timeout:55,env:{QA_SCOPE:"admission-milestones"}};
const applicationPhase={name:"applications",timeout:55,env:{QA_SCOPE:"applications"}};
const formPhase={name:"forms",timeout:55,env:{QA_SCOPE:"structured-inputs"}};
const customerPhase={name:"customer-operations",timeout:55,env:{QA_SCOPE:"customer-operations"}};
const uiPhase={name:"ui-system",timeout:55,env:{QA_SCOPE:"ui-system"}};
const uxPhase={name:"ux-refinements",timeout:55,env:{QA_SCOPE:"ux-refinements"}};
const educationPhase={name:"education-business",timeout:55,env:{QA_SCOPE:"education-business"}};
const purchasingPhase={name:"family-purchasing",timeout:55,env:{QA_SCOPE:"family-purchasing"}};
const mergeOnly = process.env.QA_MERGE_ONLY === "1";
const selectedPhases = mergeOnly ? [] : ["revenue-workspace","interaction-mutations","interaction-directories","workspace-redesign-records","workspace-redesign-tools","operations-repair","ux-closure","frontline-leads","frontline-dashboard","record-students","record-accounts"].includes(requestedPhase) ? [{name:requestedPhase,timeout:55,env:{QA_SCOPE:requestedPhase}}] : requestedPhase === "management-experience" ? [{name:"management-experience",timeout:55,env:{QA_SCOPE:"management-experience"}}] : requestedPhase === "ux-foundation" ? [{name:"ux-foundation",timeout:55,env:{QA_SCOPE:"ux-foundation"}}] : requestedPhase === "import-sets" ? [{name:"import-sets",timeout:55,env:{QA_SCOPE:"import-sets"}}] : requestedPhase === "import-v2" ? [{name:"import-v2",timeout:55,env:{QA_SCOPE:"import-v2"}}] : requestedPhase === "contract-extraction" ? [contractExtractionPhase] : requestedPhase === "contract-documents" ? [contractDocumentsPhase] : requestedPhase === "management-attention" ? [managementAttentionPhase] : requestedPhase === "management-trends" ? [managementTrendsPhase] : requestedPhase === "management-overview" ? [managementOverviewPhase] : requestedPhase === "student-success-outcomes" ? [successOutcomesPhase] : requestedPhase === "student-success-operations" ? [successOperationsPhase] : requestedPhase === "student-success" ? [successPhase] : requestedPhase === "channel-analytics" ? [channelAnalyticsPhase] : requestedPhase === "commission-agreements" ? [commissionAgreementPhase] : requestedPhase === "commission-ledger" ? [commissionLedgerPhase] : requestedPhase === "lead-pool-activation" ? [leadPoolPhase] : requestedPhase === "channel-commercial" ? [channelPhase] : requestedPhase === "admissions-workflow-templates" ? [workflowTemplatesPhase] : requestedPhase === "admissions-workflow-instances" ? [workflowInstancesPhase] : requestedPhase === "admission-milestones" ? [milestonePhase] : requestedPhase === "applications" ? [applicationPhase] : requestedPhase === "operational-readiness" ? [operationalPhase] : requestedPhase === "commercial-links" ? [commercialPhase] : requestedPhase === "enrollments" ? [enrollmentPhase] : requestedPhase === "product-cohorts" ? [cohortPhase] : requestedPhase === "family-purchasing" ? [purchasingPhase] : requestedPhase === "education-business" ? [educationPhase] : requestedPhase === "ux-refinements" ? [uxPhase] : requestedPhase === "ui-system" ? [uiPhase] : requestedPhase === "forms" ? [formPhase] : requestedPhase === "customer-operations" ? [customerPhase] : requestedPhase ? phases.filter((phase) => phase.name === requestedPhase) : phases;
if (!mergeOnly && !selectedPhases.length) throw new Error(`Unknown QA_PHASE ${requestedPhase}`);
for (const phase of selectedPhases) {
  const index = phases.indexOf(phase);
  const phaseOutput = path.join(rootOutput, "phases", phase.name);
  fs.mkdirSync(phaseOutput, { recursive: true });
  process.stdout.write(
    `\n[QA ${index<0?"targeted":`stage ${index + 1}/${phases.length}`}] ${phase.name}: `
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
    `[QA ${index<0?"targeted":`stage ${index + 1}/${phases.length}`}] passed: `
    + `${report.pages.length} page/viewports, identities ${report.identity.cleaned}/${report.identity.created}\n`,
  );
}

if(["revenue-workspace","interaction-mutations","interaction-directories","workspace-redesign-records","workspace-redesign-tools","ux-closure","frontline-leads","frontline-dashboard","record-students","record-accounts","management-experience","ux-foundation","forms","enrollments","applications","admission-milestones"].includes(requestedPhase))process.exit(0); // Do not merge component fixtures into release acceptance.

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
    gitState: report.evidence?.gitState,
    gitStatusDigest: report.evidence?.gitStatusDigest,
    sourceFingerprint: report.evidence?.sourceFingerprint,
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
  `\nStaged Chromium 1243 QA passed ${combined.pages.length} page/viewports in `
  + `${Math.round(combined.totalElapsedMs / 1_000)}s across ${phases.length} bounded stages.\n`,
);
