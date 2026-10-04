# v3.22 Phase 1 — Student Success Case & Plan verification

Verdict: **V322_PHASE1_STUDENT_SUCCESS_FOUNDATION_COMPLETE**.

## Baseline

- Branch: `main`.
- Starting and final HEAD: `96607c7fffb5b164b91ddf92c1e3e75d9689b9f4`.
- v3.21 checkpoint: `feat: release channel commercial management v3.21.0`.
- Starting worktree: clean. Phase 1 ends as an unstaged, uncommitted candidate.
- Current version remains `3.21.0`; no promotion to `3.22.0`.
- Formal runtime: Node `26.10.0`, npm `12.2.0`.
- No commit, push, deploy or Production access in this phase.

## Implementation

Scoped inspection established that Progression is Student grade advancement, Academic
Records hold actual academic facts, and Pathways hold Student destination planning.
None is an Enrollment delivery Case. Their semantics remain unchanged.

Migration `202610050103_student_success_foundation.sql` establishes Cases, Goals, Case
Status History and links to existing CRM Tasks. Enrollment identity is immutable and
unique per workspace. Student/Product/Cohort are derived through permission-filtered
views. Status and human-confirmed Health remain independent of Enrollment and Tasks.
No automatic Case creation, Health update or Goal achievement exists.

Case and Goal saves validate active owner assignment, lifecycle, strict revision and
actor/payload-bound retry receipts. History, minimal audit and receipts commit atomically.
Task links require Case and Task access, matching Student context and consistent optional
Goal/Admissions Workflow Enrollment context. Ordinary Task and Admissions mutation remain
authoritative. Case read does not widen Task access or counts.

The workspace and detail UI support filters, explicit Enrollment start, Overview, Goals,
Tasks and History, including conflict reload and identical-request uncertain retry.
Student entry is split by Enrollment. All new labels and validation have zh-CN/en text.

Student export adds Cases, History, Goals, Task relationships and each linked Task fact once.
Privacy purge removes personal Success data, Tasks and receipts while retaining Contracts,
Finance, Agreements, Commission Ledger and Settlement. Existing quality rules are preserved;
four contextual Success rules never change Health or lifecycle.

Migration 103 SHA256:
`a9478c99a1af8d93b0ff9df08b66fb395ef822a9dbc89109849a35a23f673e20`.
All 107 prior migration raw hashes, including 091–102, match the opening baseline.
`.gitattributes` protects raw migration bytes. No dependency or lockfile change.

## Verification

| Required check | Result | Evidence |
| --- | --- | --- |
| Migration verification / prior raw-byte checks | PASS | Formal verifier and baseline SHA256 reconciliation |
| Student Success unit/domain tests | PASS | 7 tests, 0 failures |
| Student Success PostgreSQL | PASS | Golden path, 0..1 identity, multiple Enrollments, revision, retry, concurrency, rollback, RLS, owners, privacy, quality |
| Enrollment regression | PASS | Targeted unit tests and real PostgreSQL attribution/identity/privacy regression |
| Ordinary / Admissions / Success Tasks | PASS | Existing CRM completion, hidden Task filtering and link consistency; Admissions golden path |
| Admissions regression | PASS | Applications/Milestones/Workflows unit tests and real DB sequential golden path; legacy journey unchanged |
| Privacy export and physical purge | PASS | Real worker grants; Case/Goal/History/Task/receipt cleanup; retained Finance |
| Channel / Commission retention | PASS | Real privacy-deletion path removes Success Case/history and retains ledger, rules and PAID settlement |
| Data Quality | PASS | Findings appear and resolve; UNKNOWN assessed only after documented 30-day warning threshold; no Health mutation |
| Bounded dependent domain regression | PASS | 67 tests, 0 failures |
| Typecheck | PASS | Declared runtime, `npm run typecheck` |
| Scoped lint | PASS | All 26 changed/new JS/TS source files; no errors or warnings |
| Production build | PASS | One `npm run build`, declared runtime; database URLs restricted to local non-service endpoint |
| Affected Chromium | PASS | 5 scenario groups; 1440/375, zh-CN/en; uncertain retry and conflict reload |
| Architecture / version / candidate reverse-check | PASS | Architecture, current version 3.21.0, complete patch reverse-check |

PostgreSQL tests use disposable local `postgres:18.4-bookworm` containers, with no
Production credentials or network target. Four bounded scripts cover Success, Enrollment,
Admissions and Commission. No whole-repository regression suite was run.

Browser: `ms-playwright/chromium-1243`, version `153.0.8010.12`, executable
`<workspace>`.
Evidence: `work/browser-qa-chromium-1243/v322-phase1/phases/student-success/report.json`.
Tests exercise actual components and production CSS with mocked business APIs. This is
**not authenticated browser-to-real-database E2E**. Real RLS, transaction, concurrency,
canonical Task completion and privacy behavior are verified by PostgreSQL tests.
Unauthenticated real API GET/POST/PATCH return 401; ordinary DELETE is unavailable.

Recovery evidence, raw candidate snapshots, manifest, patch and verification JSON are in
Git-ignored `work/v322-phase1/`; opening baseline and detailed logs are in
`work/v322-phase1-baseline/`. QA server is stopped after verification.

## Acceptance and explicit non-scope

One Student can have independent Cases for two Enrollments; one Enrollment cannot gain
two Cases. Cases do not store duplicate identity. Enrollment completion does not complete
a Case, overdue Tasks do not change Health, and unassessed Cases remain UNKNOWN. Multiple
Goals are legitimate and distinct from Tasks; existing CRM Tasks remain canonical. Success
does not modify Application, Milestone or Admissions Workflow facts.

Not implemented: Check-ins, Risk Signals/Scoring, Interventions, Outcomes, Success Analytics,
retention/completion dashboards, attendance/grade ingestion, Guardian Success Portal,
automated Success Workflow, Management Intelligence, AI, Success Milestones or Success Rate.
Existing Admissions, Finance and Channel Commercial facts remain authoritative.
