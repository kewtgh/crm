# v3.20 Phase 1 — Application Foundation verification

Verdict: **V320_PHASE1_APPLICATION_FOUNDATION_COMPLETE**.

## Baseline

- Branch: `main`; starting and final HEAD: `702d23596f46f60042c332781a38590df2f41863`.
- Version remains `3.19.0`; Node `26.10.0`, npm `12.2.0`.
- Starting worktree clean. Phase 1 remains an independently identifiable unstaged
  worktree change. No commit, push, deploy or production access.

## Implementation

Migration `202610040095_student_applications.sql` adds formal Applications and
append-only status history. Enrollment identity is immutable and one-to-many;
Student/Product/Cohort are derived, not repeated on the Application table.
Composite workspace foreign keys, lifecycle/decision constraints, owner membership,
read RLS and the existing Education authorization/assignment model protect saves.
The mutation retains strict revisions, actor/payload-bound retry receipts and atomic
history/audit. Sensitive student profile data is not copied into audit JSON.

Existing preparation tasks gain an optional Application reference with database-level
Student consistency. Legacy NULL tasks and omitted-field callers remain compatible.
`admission_journeys` is preserved without backfill or synchronization. Target institution
access is separately checked; external provider IDs are not assigned speculative uniqueness.

Domain repository, GET/POST/PATCH APIs, bilingual list/filter/editor and Overview/Tasks/
History detail are implemented. Enrollment detail exposes Applications and continues to
offer Create when applications already exist. Existing Student → Enrollment entry remains.
Privacy export includes applications/history and adds a reference to the original task
export once; cleanup removes personal application facts/receipts and retains Finance.
A past-deadline unsubmitted Application creates a contextual MEDIUM quality warning.
Architecture: [Admissions](ADMISSIONS_ARCHITECTURE.md),
[Cohort and Enrollment](COHORT_ENROLLMENT_ARCHITECTURE.md).

## Bounded verification

| Check | Result | Evidence / scope |
| --- | --- | --- |
| Migration verification | PASS | Official `db:migrations:verify`; all 99 historical checksums match baseline, including 091–094 |
| Application tests | PASS | 8 targeted domain/repository/privacy/i18n tests |
| Existing targeted regression | PASS | 30 Enrollment, Education checklist, Cohort and shared-input tests; combined run 38/38 |
| Application PostgreSQL | PASS | Disposable `postgres:18.4-bookworm`, loopback only; Enrollment 1:N, lifecycle, immutable identity, true concurrent revision, receipts, owner/target/tenant scope, atomic history/audit rollback |
| Task / journey regression | PASS | Student mismatch rejected; legacy NULL tasks, omitted-field preservation and retry pass; existing journey unchanged |
| Privacy / Finance retention | PASS | Real worker export and Student cleanup; Contract, receivable schedule and Payment retained, linked personal facts and receipts removed |
| Existing Enrollment PostgreSQL | PASS | Workspace, Student privacy, revisions, attribution and history/audit regressions |
| Existing Education PostgreSQL | PASS | Checklist/pathway and family purchasing regressions; local installed PostgreSQL image selected explicitly |
| Data quality | PASS | Warning appears, resolves after submission, and is scoped to authorized workspace/application |
| Declared runtime | PASS | Actual Node 26.10.0 / npm 12.2.0; engines unchanged |
| Typecheck | PASS | Required `npm run typecheck` |
| Scoped lint | PASS | 32 new/modified source files |
| Production build | PASS | Final `npm run build`; rebuilt only after editor source changed to preserve a NULL owner |
| Application browser QA | PASS | Chromium 1243 (153.0.8010.12); 5 affected groups, zh-CN/en, 1440/375; list/create/multiple/detail/tasks/history/status/decision/retry/conflict/NULL-owner preservation |
| Enrollment / Student browser regression | PASS | Same production build and pinned browser; 5 existing affected groups |
| Release metadata | PASS | Current release remains aligned at 3.19.0 |
| Git whitespace / staging | PASS | `git diff --check`; staging empty |
| Full repository regression | NOT RUN | Outside Phase 1 scope |
| Application automation | NOT RUN | Optional extension deferred to Phase 3 |

Browser boundary: real production CSS and actual affected components with mocked business
API; unauthenticated API gates are checked against the production server. Database access,
constraints, authorization and transactions are independently exercised in real PostgreSQL.
No new browser installed, no broad Chromium matrix, no production database migration.
QA fixture controls required wrapping on mobile; product layout did not require a CSS change.
Local QA server stopped after verification. Reports/screenshots remain Git-ignored under
`work/browser-qa-chromium-1243/phases/applications/` and `phases/enrollments/`.

Migration 095 SHA256:
`6eb055645a1bda23dc9b3010152282ea5fca2d55751ba0a3bb848b9b59334a7c`.
`.gitattributes` preserves its bytes across platforms. Independent baseline, manifest,
patch, file snapshots and verification evidence are under `work/v320-phase1/`.

## Explicit non-scope

Milestones, Interview, Offer/Deposit workflows, Documents, I-20, SEVIS, Visa, Workflow
Templates, Commission, Student Success, P&L, Management Intelligence and AI are deferred.
Contract/Receivable/Payment/Refund models are unchanged. Version 3.20.0 and a formal
release checkpoint require a separate release closure.
