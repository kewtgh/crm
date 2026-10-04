# v3.20 Phase 3 — Workflow Foundation verification

Verdict: **V320_PHASE3_WORKFLOW_FOUNDATION_COMPLETE**.

## Baseline and checkpoint

- Branch `main`; starting/final HEAD `702d23596f46f60042c332781a38590df2f41863`.
- Version remains `3.19.0`; declared runtime verified: Node `26.10.0`, npm `12.2.0`.
- Started with 54 unstaged/uncommitted Phase 1–2 files. Combined patch, byte
  snapshots, manifest, baseline and verification references are protected under
  `work/v320-phase3-baseline/`. No earlier patch was reapplied.
- Phase 3 changes 39 files relative to those snapshots; combined worktree has
  76 changed/new files. Staging is empty. No commit, push, deploy or production access.
- Independent delta, manifest and snapshots are under `work/v320-phase3/`.
  `git apply --check --reverse work/v320-phase3/phase3.patch` passes; the patch
  was not applied. Local evidence and screenshots remain Git-ignored.
- All 101 prior migrations remain byte-identical, including 091–096.
  095 SHA-256: `6eb055645a1bda23dc9b3010152282ea5fca2d55751ba0a3bb848b9b59334a7c`.
  096 SHA-256: `2bebf07e194c128ec228af2c2b3a648a3e416ff7dab151544524f8f65ccd8e21`.
  New 097 SHA-256: `8211e641d46aeb8b3ddde49dcd15fae80a8102a2c7dd16a0d60ede0eebe1cf99`.

## Implementation

Forward-only `202610040097_admissions_workflows.sql` creates `workflow_templates`,
`workflow_template_steps`, `workflow_instances` and `workflow_step_instances`.
Logical templates have integer versions; instances bind the exact physical version.
Draft structure is editable; active/used versions require a new version. Retired
versions remain visible to historical instances and cannot start new instances.
Composite identities protect workspace, template/version and Enrollment/Application
context; Enrollment/Application/template identity is immutable after instantiation.

Strict, whitelisted TASK/MILESTONE/CHECKPOINT configs support explicit sequential
execution. TASK generates a real existing `crm_task`; MILESTONE uses the canonical
milestone save/history/audit contract. CHECKPOINT generates no business record.
Its finite catalog is APPLICATION_SUBMITTED, APPLICATION_DECIDED and any matching
MILESTONE_COMPLETED in explicitly selected context. No application or payment facts
are duplicated. Missing Application context rejects the whole start; multiple
applications are never resolved by guessing. Product-specific scope is enforced.

Task, Milestone and Application mutations reevaluate execution transactionally.
Read-only views project canonical status/due/owner; private dispatch cursors retain
event identity. Completed/waived steps advance the sequence, required cancellation
blocks it, and catalog-managed waivers require a reason. Real domain facts are not
rewritten by workflow overrides or cancellation. Due offsets use Workspace local
time, including DST, and unknown dates remain NULL with a context warning.

Templates reuse catalog.manage (SUPER_ADMIN, ADMIN, SALES_DIRECTOR). Instance
operations reuse education.manage, existing owner/team and assignment scope,
Enrollment and optional Application access. Reads also protect linked and matching
Checkpoint source visibility. Ordinary callers cannot arbitrarily PATCH step
completion or hard-delete workflows. Save/version/start/waive/cancel operations use
strict revision, actor/payload-bound receipts, transaction locks and minimal audit.
Instantiation is atomic across generated facts/history/audit/automation/receipts.

Separate template/instance repositories and GET/POST/PATCH APIs serve the domains.
The bilingual template workspace supports create, add/reorder/edit steps, activate,
retire and create new version. Application and Enrollment details have Workflow
sections with explicit Template + Version selection, owner/context, current step,
progress and real linked Task/Milestone controls. Timeline adds only source-labelled
WORKFLOW start/completion summaries. Existing drawers, fields, badges, dates and
conflict/uncertain retry feedback are reused.

Existing automation gains seven Application/Milestone/Workflow trigger keys and
keeps TASK/NOTIFICATION actions. Genuine domain history transitions drive events;
ordinary edits do not fabricate status changes. The existing reminder worker scans
configured milestone due thresholds using workspace business dates and stable
due-instant/day keys. Disabled rules and retries retain existing behavior.

Existing Data Quality gains MEDIUM blocked/overdue/missing-context findings and
resolution on sweep. Real linked due times drive warnings. Privacy export includes
instances/steps and only template ID/name/version references. Student cleanup removes
personal instances, generated Tasks and receipts; existing Application/Milestone
cleanup remains responsible for those facts. Shared templates and real retained
Contract/Receivable/Payment facts survive. Legacy tasks and admission journeys stay
compatible and are not implicitly synchronized.

## Bounded verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Migration verification | PASS | Official verifier; 102 ordered migrations, 101 prior byte hashes unchanged |
| Workflow unit/domain tests | PASS | 9 tests: whitelist, context, finite checkpoints, retries, repositories, privacy, i18n, automation catalog |
| Relevant domain regression | PASS | 49 Application/Milestone/Enrollment/Education/Operational tests |
| Workflow PostgreSQL integration | PASS | Disposable loopback PostgreSQL 18.4; version freeze, product/context, canonical Tasks/Milestones/checkpoints, listeners, real concurrent retries/revisions, atomic rollback, actions/due idempotency, RLS, quality, privacy |
| Application/Milestone PostgreSQL regression | PASS | One-to-many applications, lifecycle/history/audit, repeated milestones, linked/generic tasks, journey unchanged, tenant/owner scope and retained real Finance |
| Operational PostgreSQL regression | PASS | Existing automation, quality, privacy, import and live Finance semantics remain intact |
| Security | PASS | Tenant isolation, operational ownership, catalog permission, invisible matching checkpoint source rejection and required-waiver authorization |
| Privacy | PASS | Scoped export references; personal purge removes workflow facts/receipts/generated tasks without deleting definitions or Finance parents |
| Typecheck | PASS | Declared runtime |
| Scoped lint | PASS | 33 Phase 3 source/test files; zero errors or warnings |
| Build | PASS | One production build on declared runtime; build hash `6dd96af5c4d0a4cabc5aff61e41958ec8eed7e1d8fed700be0a6a9035aa4c0e0` |
| Affected Chromium QA | PASS | 22 groups: Templates 4, Instances 4, Milestones 4, Applications 5, Enrollments 5; 1440/375, zh-CN/en |
| Architecture/checkpoint | PASS | Updated domain boundaries, independent reverse-checkable delta and preserved baseline |

Browser reports retain exact `ms-playwright/chromium-1243` executable evidence:
`<workspace>`,
browser version `153.0.8010.12`, under `work/browser-qa-chromium-1243/phases/`.
Scenarios use actual UI components and production CSS with mocked business APIs;
real unauthenticated endpoints and database transactions/access are tested separately.
Expected 400/409/503 validation/conflict/retry responses are recorded, not counted as
unexpected failures. Initial QA harness issues were corrected before final PASS.
Changes after build were confined to SQL, test fixtures/scripts and documentation;
build-affecting product source did not change and no second build was run.
No complete CRM browser matrix or repository-wide audit was run.

## Deferred and explicit non-scope

Documents, Commission, Student Success, P&L, Management Intelligence, AI and complex
BPMN/branch/parallel/code-driven workflows are not implemented. Cohort default
templates, Finance checkpoints and real business template configuration remain
future work. Workflows start manually with an explicit version; no unconfirmed
GAPP/Summer School/Camp/Competition process is seeded or created in production.
Template instructions remain in the definition because existing Tasks have no
description field. A separate v3.20 release closure must precede version promotion.
