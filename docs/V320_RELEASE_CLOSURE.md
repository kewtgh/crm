# v3.20 release closure

Verdict: **V320_RELEASE_READY**. Source checkpoint is **COMMIT READY**, with
empty staging and no automatic commit. Suggested message:
`feat: add admissions application milestone and workflow foundation`.

## Baseline and reconciliation

- Branch: `main`; starting HEAD: `702d23596f46f60042c332781a38590df2f41863`.
- Starting version: `3.19.0`; 76 unstaged/uncommitted Phase 1–3 files.
- Final version: `3.20.0`; final HEAD remains the starting HEAD. Combined candidate
  contains 83 changed/new files; the independently reversible closure delta has 9
  files (test/script registration, current metadata, architecture and release docs).
- No phase patch was reapplied. Opening candidate SHA256:
  `5b75a1ca0b45ab7b11898abaadc383ea3a2cd48dead094560e1cac337d7c55da`.
- Opening snapshots/manifest reconcile exactly with Phase 3 evidence. All 102
  migration raw-byte hashes match; 091–097 are frozen. See release notes for 095–097 SHA256.
- Local evidence is under `work/v320-release/`. The previous approval-login block
  was resolved before formal commands resumed; no approval was bypassed.
- No production access, staging, commit, push or deploy is part of this closure.

## Regression evidence

Actual portable Node 26.10.0 / npm 12.2.0 is used. Clean `npm ci --no-audit --no-fund`
passed without dependency/lockfile changes. Existing ESLint peer/deprecation warnings
remain informational; engines and dependencies were not changed to bypass checks.

66 targeted tests and 2 release-metadata tests cover Applications, Milestones,
Workflows, Enrollment, Education, Operational Readiness and structured inputs.
Eight separate PostgreSQL groups run
against disposable loopback-only `postgres:18.4-bookworm`, each bounded to 55 seconds:
Applications, Milestones, Workflows, release Golden Path, Enrollment, Education and
Operational Readiness, plus required cancellation/waiver and combined financial
retention verification. Containers never load `.env.local` or production credentials.

The new `npm run test:admissions-release:postgres` executes:
Product → Cohort → Student → Enrollment → two Applications → explicit Workflow start →
real Task completion → Application submission checkpoint → Interview completion →
Application decision checkpoint → Workflow completion. It asserts canonical identities,
no automatic workflow start, exact histories/events, explicit timeline sources and
idempotent retries. Missing Application context and injected late audit failure leave
all generated facts, history, audit, automation and receipts unchanged. Initial test
fixture errors (private receipt inspection and view naming) were corrected; product
permissions and frozen SQL were not modified.

Existing regressions cover true concurrent revisions, template immutability/retirement,
owner/target/tenant and checkpoint-source authorization, no duplicate Application/Finance
facts, repeated milestone types, legacy generic/linked Tasks and unchanged journey data.
Task/Notification actions, disabled rules, genuine transitions and retry-safe due dispatch
pass. Quality findings appear and resolve. Personal Admissions cleanup retains shared
definitions and existing Finance; shared contracts and multiple currencies remain safe.

The supplemental disposable fixture proves a cancelled required milestone blocks
execution, required waiver needs a reason and catalog authorization, and its audit
does not rewrite the cancelled milestone. Combined cleanup removes Applications,
Milestones, Workflows, their histories, generated personal Tasks and receipts while
preserving actual Contract/Receivable/Payment/Refund and Template/Product/Cohort rows.

## Release gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Migration verification / frozen 091–097 | PASS | Official verification; all 102 raw-byte hashes unchanged |
| 095 / 096 / 097 checksums | PASS | SHA256 in release notes; protected raw bytes |
| Declared Node / npm | PASS | Actual Node 26.10.0 / npm 12.2.0 |
| npm ci | PASS | Clean install; no dependency changes; only project root version changes in final lockfile |
| Application / Milestone / Workflow regression | PASS | 66 domain tests plus bounded PostgreSQL groups |
| Golden Path / negative context / atomicity | PASS | Four sequential canonical steps; no context guessing; complete rollback |
| Security / Privacy | PASS | Tenant/owner/target/checkpoint visibility; export/purge and retained financial facts |
| No duplicate domain facts | PASS | No Application identity copies, no Application/Finance milestones or Finance checkpoints |
| Automation / Data Quality / legacy | PASS | Genuine events, disabled/retry behavior, resolved findings, compatible Tasks/journey |
| Typecheck | PASS | Formal npm run typecheck |
| Scoped lint | PASS | 67 affected source/test files; no errors or warnings |
| Production build | PASS | One final 3.20.0 build on declared runtime |
| Affected Chromium release QA | PASS | 22 groups across five 55-second phases; same build/source fingerprint |
| Architecture / release notes | PASS | Current model and explicit boundaries; historical docs retained |
| Version 3.20.0 | PASS | package.json, lockfile roots, APP_VERSION, README and implementation status aligned |
| Candidate / closure-only reverse-check | PASS | Complete HEAD-relative candidate and separate opening-relative closure delta |
| Staged whitespace | PASS with frozen exception | 097 line 629 has existing trailing spaces; frozen SQL bytes preserved; all other files clean |
| Full CRM browser matrix / full repository audit | NOT RUN | Outside requested closure scope |

## Browser boundary

The affected Chromium phases use pinned ms-playwright/chromium-1243, actual components
and production CSS with isolated mocked business APIs in zh-CN/en at 1440/375.
Unauthenticated HTTP boundaries are real. This is **not authenticated browser-to-real-
database E2E**; real RLS/constraints/transactions are covered separately by PostgreSQL.
The full CRM browser matrix and repository-wide regression are outside this closure.

Five phases cover Applications (5), Milestones (4), Workflow Templates (4), Workflow
Instances (4) and Enrollment/Student integration (5). Exact browser is
`ms-playwright/chromium-1243`, version `153.0.8010.12`, executable
`<workspace>`.
Reports, screenshots and combined affected-only report are under
`work/browser-qa-chromium-1243/v320-release-final/`. No other browser was installed.
The local QA server is stopped after verification. Later changes only finalize
documentation/evidence; build-affecting product source is unchanged.

## Deferred

Documents, Commission, Student Success, P&L, Management Intelligence, AI and complex
BPMN are not included. Cohort default workflows, Finance checkpoints and actual
business template configuration require separate future work. No production workflow
was seeded or configured.
