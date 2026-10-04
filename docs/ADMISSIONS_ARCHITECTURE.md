# Admissions architecture — v3.20

```text
Student → Enrollment → Application (1:N)
                       ├─ Application Tasks
                       ├─ Application Status History
                       └─ optional context for Milestones / Workflows
Enrollment → Admission Milestones → Milestone Status History
Enrollment → Workflow Instances → Step Instances
                                 ├─ real Task
                                 ├─ real Milestone
                                 └─ Domain Checkpoint projection
```

- **Enrollment 1:N Application**: one enrollment can apply to several institutions.
  `student_applications` is the canonical formal application fact for v3.20+.
  The immutable `enrollment_id` supplies Student, Cohort and Product; those facts
  are not duplicated on Application. Target institution is independent of buyer,
  channel, referral school and current student school.
- **Application ≠ Milestone. Application ≠ Task. Status ≠ Decision.** Lifecycle
  is DRAFT / PREPARING / SUBMITTED / UNDER_REVIEW / DECIDED / WITHDRAWN / CLOSED.
  Decision is independently ADMITTED / CONDITIONAL_ADMIT / WAITLISTED / REJECTED /
  DEFERRED / OTHER, or unknown. Decisions are not financial or visa facts.
- Application deadline is explicitly entered. Cohort deadline is displayed as
  context, never silently copied. Provider IDs are optional and not assumed
  globally or provider-unique; program-level uniqueness needs confirmed semantics.
- Application owner is independent of Enrollment/Sales owner. Reads require
  Enrollment and target-institution access plus the existing owner/team scope.
  Writes reuse `education.manage` and existing assignment checks for SUPER_ADMIN,
  ADMIN, SALES_DIRECTOR, SALES_MANAGER, SALES_SPECIALIST and SALES_SUPPORT.
- `save_student_application` uses strict revision and actor/payload-bound mutation
  receipts. Initial/real status transitions append `student_application_status_history`
  atomically with save and audit. Ordinary edits and decision-only changes do not
  fabricate transitions. History is admissions operational funnel history; audit
  is governance evidence and contains references, not copied Student profiles.
- `student_application_tasks.application_id = NULL` remains a generic Student
  preparation checklist; non-NULL links a formal Application for the same Student.
  Existing task save/access/revision behavior remains authoritative. Legacy callers
  omitting the new field preserve an existing link. Explicit NULL removes context.
- `admission_journeys` remains legacy compatibility workflow data. There is no
  deletion, rename, automatic migration, inference, backfill or bidirectional sync.
  A future explicit deprecation plan must precede any retirement.
- Privacy exports include Applications/history and add the Application reference
  to the existing task export once. Student privacy cleanup removes personal
  application facts, history and receipts. Contract/Receivable/Payment retention
  remains unchanged; Application finance facts remain external in Finance.
- Database constraints enforce lifecycle validity. An unsubmitted Application
  past its own deadline is a contextual MEDIUM warning, not a submission barrier.
  Application automation uses the existing rules/events/runs; events cannot replace history.

## Admission milestones and timeline

`Enrollment 1:N Admission Milestone`, with optional `Application` context.
Milestones do not repeat Student/Product/Cohort facts. Enrollment is immutable;
the composite Application/Enrollment/workspace FK enforces consistent context.
Repeated types (two interviews or visa appointments) are legitimate. Positive
sequence orders records and is not a unique business identity.

**Application ≠ Milestone. Milestone ≠ Task. Milestone ≠ Document.
Milestone ≠ Payment. Milestone ≠ Finance State.** Application submission,
review and admission decisions remain Application facts. Fees, deposits,
payments and refunds remain Finance facts and are excluded from milestone types.
Supplementary materials is an operational request, not the document itself.

Types cover interview, supplementary materials, placement test, I-20 request /
issue, SEVIS requirement / completion, visa application / appointment / training /
result, flight confirmation, orientation, arrival and OTHER. Status is PENDING /
SCHEDULED / IN_PROGRESS / COMPLETED / WAIVED / BLOCKED / CANCELLED. WAIVED means
not applicable or explicitly exempted; CANCELLED means a created node was cancelled.
Scheduled requires its appointment time; completed requires its completion time.
Due and scheduled times are independent. Early completion and retrospective entry
are valid: no blanket completed-after-scheduled constraint is imposed.

Metadata has a database and domain whitelist: interview summary/result/interviewer,
placement-test score/scale/result, visa-result result/reason, OTHER label; all other
types accept an empty object. Controlled interview and visa results apply only to
those types. Text/number bounds reject oversized or arbitrary dumps. Files, identity
images, financial credentials and full forms belong outside this metadata.

Owner is independent of Application/Enrollment/Sales owner. Read access requires
Enrollment access, optional Application visibility and existing owner/team scope.
Writes reuse the six existing education.manage roles and assignment checks,
Enrollment edit context and optional Application read access. There is no new role.
`save_admission_milestone` combines strict revision, actor/payload-bound retry receipt,
initial/real status history and audit in one transaction. Ordinary edits do not
fabricate status transitions. Audit contains references/status/type/revision, not
interview summaries or visa reasons. History is append-only operational evidence.
Milestones never implicitly update Application, legacy journey, tasks or Finance.

The read-only invoker timeline projects Application submission/decision/withdrawal
and current milestone facts with explicit APPLICATION / MILESTONE sources. It does
not mechanically merge status history. Milestone timestamp priority is completed,
scheduled, due, created; deterministic ordering is timestamp, sequence, source type,
source ID, event type. Optional Finance timeline projection is deferred. Existing
automation handles genuine Milestone status changes and configured due reminders.

Overdue is `due_at < now()` for nonterminal statuses: COMPLETED, WAIVED and CANCELLED
are excluded. Timestamptz compares absolute instants consistently across workspace
timezones, without browser-local date inference. Overdue, blocked and completed visa
result without outcome/result are contextual MEDIUM warnings, not new hard barriers.
Resolved conditions disappear on the existing data-quality sweep.
Privacy export includes milestone facts/history once. Student cleanup removes
milestones, history and personal mutation receipts; retained Finance parents remain.

## Versioned workflows

`Template → Versioned Template Steps → Workflow Instance → Step Instances
→ Task / Milestone / Domain Checkpoint Projection`.

**Workflow Template ≠ Workflow Instance. Workflow Step ≠ Task or Milestone.
Template ≠ Business Fact. Workflow does not duplicate domain facts.**
Only ADMISSIONS workflows are supported. Physical template rows share a logical
template ID and monotonically increasing integer versions. Draft structure can
be edited; active and used versions require a new version. Instances retain the
exact physical template/version. Retiring a version prevents new starts and leaves
historical instances intact. Templates are human configured; no business workflow
is seeded by migration or selected by hardcoded Product names.

Instances require immutable Enrollment and optional, consistent Application.
Product-specific templates must match the Enrollment's Cohort Product; generic
templates have no Product restriction. Start is explicit and selects Template +
Version. Application-scoped steps without an explicit Application reject the
entire start. Multiple Applications never lead to a guessed selection. Cohort
default-template configuration is deferred.

First version is sequential, with a maximum of 40 ordered steps. TASK creates a
real `crm_task`; MILESTONE creates a real `admission_milestone` through its save
contract. CHECKPOINT creates no domain object. Config keys are whitelisted in SQL
and Zod. Task titles/priority map to the existing Task schema; template instructions
remain in the definition because existing `crm_tasks` has no description field.
Workflow does not introduce a second task description/status/assignment model.
Generated milestones start PENDING; normal milestone edits remain authoritative.

Finite checkpoints are APPLICATION_SUBMITTED (eligible lifecycle plus a real
submission timestamp), APPLICATION_DECIDED (DECIDED with decision and date), and
MILESTONE_COMPLETED (any completed matching type in the explicitly configured
Enrollment or Application scope). No arbitrary expression language, SQL/code,
deposit/full-payment inference or Finance checkpoint is provided.

Task/Milestone/Application mutations reevaluate workflows transactionally.
Current step state, due time and owner are projected from canonical records;
stored dispatch cursors prevent duplicate READY/completion events and are not
independently editable business state. Completed/waived steps advance the next
step; a cancelled required step blocks progress. A later canonical completion
remains a real fact even if prior steps are unfinished. Progress is explicitly
completed-or-waived / total, never an admission probability. Workflow waivers
do not complete real Tasks/Milestones. Required waivers require catalog management
and a reason, including a linked milestone's own waiver path. Workflow cancellation
preserves underlying domain facts. Reopening a canonical fact reevaluates progress.

Offsets are finite basis + signed days: WORKFLOW_START, COHORT_APPLICATION_DEADLINE,
COHORT_START, APPLICATION_DEADLINE. Date-only bases use Workspace business timezone.
Missing bases produce NULL due time and a context warning; dates are never inferred.
Initial due time is instantiation evidence; current due time for Tasks/Milestones
comes from those records. A matching configured default owner role uses the selected
owner, otherwise exactly one assignable active member must resolve; ambiguity fails.

Template writes reuse catalog.manage (SUPER_ADMIN, ADMIN, SALES_DIRECTOR).
Instance operations reuse education.manage (the existing six Education roles),
Enrollment access, optional Application access, owner/team and assignment scope.
Reads additionally require visibility of linked and matching checkpoint domain
sources. Read-only invoker views and access functions protect tenant boundaries;
ordinary API callers cannot PATCH a step to COMPLETED or hard-delete workflows.
Template/start/waive/cancel mutations use strict revision, actor/payload-bound
receipts and transaction locks. Instantiation, generated facts, history, audit,
automation and receipts either all commit or all roll back.

Existing automation gains APPLICATION_CREATED, APPLICATION_STATUS_CHANGED,
MILESTONE_STATUS_CHANGED, MILESTONE_DUE_APPROACHING, WORKFLOW_STARTED,
WORKFLOW_STEP_READY and WORKFLOW_COMPLETED. Only existing TASK/NOTIFICATION actions
are used. History triggers emit genuine transitions; ordinary edits create no
false status event. The existing reminder worker scans configured milestone due
rules using workspace business dates and due-instant/day dispatch identities.
Disabled rules do not execute, retries do not duplicate runs, and starting an
Enrollment does not automatically instantiate a workflow.

Admissions timeline adds explicit WORKFLOW start/completion summaries only.
Step READY changes remain operational detail, not noisy Student timeline events.
Blocked, overdue and missing-context workflow findings are contextual MEDIUM
warnings on the existing quality sweep. Current linked domain due dates drive overdue.
Privacy export includes instances/steps and only template ID/name/version references.
Student purge removes personal instances, generated Tasks and mutation receipts;
existing milestone/application cleanup handles their facts. Shared definitions and
retained Contract/Receivable/Payment facts are not deleted. Audit records references,
version/revision and actions, without large configs, interview summaries or visa reasons.

Documents, Commission, Student Success, P&L, Management Intelligence, AI and complex
BPMN/parallel/branching workflows remain outside this implementation. AI inference
is not a business fact. Cohort default workflows and Finance checkpoints require
separate future design. Formal business templates require a business-confirmed
configuration task; the source release does not configure Production workflows.
