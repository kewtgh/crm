# v3.20 Phase 2 — Admission Milestones verification

Verdict: **V320_PHASE2_ADMISSION_MILESTONES_COMPLETE**.

## Baseline and checkpoint

- Branch `main`; starting/final HEAD `702d23596f46f60042c332781a38590df2f41863`.
- Version stays `3.19.0`; verified Node `26.10.0`, npm `12.2.0`.
- Started with 38 unstaged/uncommitted Phase 1 files. Its patch, manifest,
  baseline and verification were preserved under `work/v320-phase2-baseline/`.
- Phase 2 changes 30 files relative to those snapshots; combined worktree has
  54 changed/new files. No staging, commit, push, deploy or production access.
- Independent patch, byte snapshots and manifest: `work/v320-phase2/`.
  `git apply --check --reverse work/v320-phase2/phase2.patch` passes; it was
  not applied. Local evidence stays Git-ignored.
- All 100 prior migration bytes remain frozen, including 091–095.
  095 SHA-256: `6eb055645a1bda23dc9b3010152282ea5fca2d55751ba0a3bb848b9b59334a7c`.
  New 096 SHA-256: `2bebf07e194c128ec228af2c2b3a648a3e416ff7dab151544524f8f65ccd8e21`.

## Implementation

Forward-only `202610040096_admission_milestones.sql` creates
`admission_milestones` and append-only `admission_milestone_status_history`.
Enrollment is required and immutable; optional Application is protected by a
workspace/Enrollment/Application composite FK. Repeated interview/visa appointment
types are allowed. Student/Product/Cohort facts are not repeated on this table.
Due, scheduled and completed times have distinct meanings; early completion is valid.

Database and Zod validate type-specific metadata and lifecycle requirements.
Indexed enrollment/application ordering, owner/status, open due dates and history
support bounded queries. Existing six Education roles, ownership/team access,
assignment and Enrollment access remain authoritative. Optional Application access
is checked separately. No ordinary hard delete is exposed.

`save_admission_milestone` provides strict revision, actor/payload-bound receipts,
atomic initial/real status history and audit. Ordinary metadata edits do not create
status history; failure rolls back the save. Audit copies references/type/status/
revision, excluding interview summaries and visa reasons. Milestones do not change
Application status, legacy journey, tasks or Finance implicitly.

Domain repository and GET/POST/PATCH APIs serve milestone records/history;
Enrollment admissions-timeline API is read-only. Its security-invoker projection
merges canonical Application submission/decision/withdrawal and current milestone
facts with explicit APPLICATION/MILESTONE sources, deterministic time/sequence/ID
ordering and pagination. It does not duplicate Application or Finance facts or
mechanically mix status history into the business timeline.

Application detail has a Milestones tab filtered to its Application. Enrollment
detail has the unified Admissions Timeline and enrollment-wide milestone editor.
Create/edit/history, independent owner, type-specific inputs, all timestamps,
outcome, revision conflict and uncertain retry feedback are bilingual. Existing
date, select, badge, drawer and feedback controls are reused. The shared Application
selector additionally scopes choices to the current Enrollment.

Privacy export includes milestone/history facts once; Student cleanup removes those
facts and receipts while preserving real Contract/Receivable/Payment records.
Overdue/blocked/missing visa outcome are contextual MEDIUM quality findings that
resolve after correction. Overdue uses absolute timestamptz instants, without browser
timezone inference. `work/` checkpoint source snapshots are excluded from TypeScript
compilation; normal application source remains checked.

Architecture: [Admissions](ADMISSIONS_ARCHITECTURE.md),
[Cohort and Enrollment](COHORT_ENROLLMENT_ARCHITECTURE.md).

## Bounded verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Migration verification / frozen 091–095 | PASS | Official command; all 100 prior byte hashes checked |
| Declared runtime | PASS | Node 26.10.0 / npm 12.2.0 |
| Milestone targeted tests | PASS | 7 domain/repository/timeline/privacy/i18n tests |
| Application / Enrollment / Education / structured input regression | PASS | 32 targeted tests |
| Milestone PostgreSQL integration | PASS | Disposable postgres:18.4-bookworm, 55-second bound |
| Application PostgreSQL regression | PASS | 1:N, target/owner/tenant access, tasks/journey/privacy |
| Enrollment PostgreSQL regression | PASS | Identity, attribution, revision, privacy |
| Security | PASS | Composite context, owner scope, tenant isolation, read-only history/API |
| History/audit atomicity | PASS | Injected failures roll back; genuine concurrent stale revision fails |
| Privacy / retained Finance | PASS | Export, marker cleanup and physical purge; real Finance rows retained |
| No duplicated Application/Finance facts | PASS | Forbidden types rejected; canonical submission appears in timeline |
| Data quality | PASS | Trigger, context, resolution and workspace scope |
| Typecheck | PASS | Standard npm run typecheck |
| Scoped lint | PASS | 23 Phase 2 source/test files |
| Production build | PASS | One build; later edits only QA fixture/scripts and docs |
| Affected Chromium QA | PASS | Pinned Chromium 1243 / 153.0.8010.12; 14 groups |
| Independent Phase 2 rollback check | PASS | Reverse-check only; Phase 1 evidence unchanged |
| Full repository/database/browser matrix | NOT RUN | Outside this phase |

Browser groups: Milestones 4 (zh-CN/en × 1440/375), Applications 5,
Enrollments 5. They cover actual detail/editor components and production CSS,
interview create/edit/status/history, placement fields, visa nodes/repeated types,
Enrollment-only I-20 and explicit timeline sources, retry/conflict and legacy tasks.
Business API responses are mocked for component fixtures; unauthenticated HTTP
boundaries are real and database/RLS/transactions are separately verified by PostgreSQL.
Screenshots, exact executable, source/build fingerprints and reports remain under
`work/browser-qa-chromium-1243/phases/`. Initial QA fixture/mock issues were fixed;
final phases have zero unexpected errors. No alternative browser was installed.

## Explicit non-scope

Documents, Workflow Templates/Step Instances, Commission, Student Success, P&L,
Management Intelligence and AI are not implemented. Finance timeline events and
Milestone automation are deferred optional work. Financial facts remain authoritative
in Finance; no payment/deposit milestones or duplicate financial states were created.
