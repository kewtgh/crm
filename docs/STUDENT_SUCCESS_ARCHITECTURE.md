# Student Success architecture — v3.22

## Scoped gap analysis

`progression_batches` and `progression_batch_items` preview/apply Student grade advancement
between academic years, including ADVANCE / GRADUATE / HOLD. They are Student-scoped batch
operations, not ongoing Enrollment delivery cases, goals or health assessments.
`student_academic_records` records curriculum, grade, academic year and validity periods.
`student_pathways` records Student-level destination planning, language-test context and
legacy pathway stages. None provides an Enrollment-scoped Success Case or plan lifecycle.
These existing domains retain their meanings; no renaming, synchronization or backfill.

```text
Student → Enrollment → Student Success Case (0..1)
                       ├ Goals (1:N)
                       ├ links to existing CRM Tasks
                       ├ Case Status History
                       ├ Check-ins → optional Health Assessments
                       ├ Risk Signals → Risk Status History
                       ├ Interventions → Intervention Status History
                       └ Outcomes → optional same-Case Goal

Student Success Analytics = read-only projection of authorized Cases and child facts
```

Case derives Student / Cohort / Product through immutable Enrollment. No duplicated identity
columns are stored. There is no evidence requiring multiple cases for one Enrollment, so
workspace + Enrollment is unique. The same Student may have independent cases for different
Enrollments. Start is explicit and allowed only in REGISTERING / ACTIVE / COMPLETED.
Existing cases remain editable after Enrollment status changes; statuses never synchronize.
Creation does not copy cohort dates, create admissions facts or default Health to ON_TRACK.

## Canonical boundaries

Student ≠ Enrollment; Enrollment ≠ Success Case; Success Case ≠ Application / Academic Record /
Task. Goal ≠ Task. Health ≠ Enrollment Status. Outcome ≠ Admission Decision.
Enrollment COMPLETED ≠ Success Case COMPLETED. AI inference ≠ Business Fact.
Academic Records, Progression, Admissions, Finance and Channel Commission retain authority.
Success operations never write those facts.

Case lifecycle is PLANNING / ACTIVE / PAUSED / COMPLETED / CLOSED. Current Health is
UNKNOWN / ON_TRACK / ATTENTION / AT_RISK, explicitly human confirmed. Health changes are
audited by changed field name without copying narratives. Phase 2 adds append-only Health
Assessments for real changes, including saves through the existing Phase 1 Case mutation.
Initial UNKNOWN creates no assessment. Initial explicitly assessed Health creates one.
Case Status History is the operational lifecycle fact. Audit is governance evidence.
Creation and real transitions append history atomically; ordinary edits do not.

Goals are prospective targets, not actions, retrospective outcomes or actual grades. They have independent owner, target date,
revision and audited status; ACHIEVED requires achieved_at. No title uniqueness or inferred
achievement. Goal history beyond audit is deferred.

Tasks retain existing CRM title, status, owner and due date. A small relationship table links
one real Task to one Case, optionally to a Goal and/or Intervention in the same Case. Linked tasks must have the
same Student context; a task already in an Admissions Workflow for another Enrollment cannot
be linked. Link authorization requires Case edit and Task edit access. Existing Task mutation
and completion remain authoritative. Case read never widens Task permissions or counts hidden
Tasks. Normal unlink removes only the relationship, with revision, retry receipt and audit.

## Access, privacy and quality

Existing education.view / education.manage capabilities and six Education roles are reused.
Case reads require Enrollment access and owner/team scope; writes also require Enrollment edit
context. Goals inherit Case access. Assignment requires active workspace membership and
can_assign_crm_task. Mutations use strict revisions and actor/payload-bound retry receipts,
parent/privacy locking, history and minimal audit in one transaction. No ordinary hard delete.

Student export includes Cases, History, Goals and Task relationship references; each linked
CRM Task fact is exported once through a worker-only privacy view, without duplicate Task
snapshots in Case/Goal records. Personal cleanup cascades from Enrollment,
erases receipts and linked personal tasks without touching Contracts, Finance, Agreements,
Commission Ledger or Settlements. Shared business records retain their existing privacy policy.

Data Quality finding ≠ Success Health; Task overdue ≠ AT_RISK; Missing assessment ≠ ON_TRACK.
Human-confirmed Health is authoritative in Phases 1–3. Contextual owner/review/overdue-goal
warnings never rewrite status or health. ACTIVE + UNKNOWN Health is a warning only after
30 calendar days in the workspace business timezone; this is a quality convention, not a score.

## Check-ins, assessments, risks and support

Check-in is an occurred event, with no task lifecycle. Its `occurred_at`, not creation time,
orders the list and derives the last check-in. Backdated recording and revision-protected
corrections are supported. Conducted-by and support owners must be active, assignable
workspace staff. Case ownership remains immutable on every child.

Recording a Check-in alone never updates Health or next review. Explicit assessment and
explicit next-review controls require the expected Case revision and save atomically with
the Check-in, Case, assessment, minimal audit and actor/payload-bound receipt. An explicit
same-Health reassessment is a new assessment; ordinary unchanged Case edits are not.
Historical assessments cannot be edited. Editing a Check-in does not rewrite its historical
assessments; recording a new judgment appends another assessment. No history is backfilled.

Risk Signals are manually confirmed support concerns, with LOW / MEDIUM / HIGH severity
and OPEN / MONITORING / RESOLVED / DISMISSED lifecycle. RESOLVED requires a timestamp.
An optional source Check-in must be in the same Case. Repeated types are legitimate.
Interventions are support strategies, optionally referencing a same-Case Risk. They use
PLANNED / ACTIVE / COMPLETED / CANCELLED lifecycle; COMPLETED requires a timestamp.
Proactive support without a Risk is valid. Repeated support types are valid.

Risk and Intervention creation and real status changes append operational history.
Severity, owner and narrative edits do not fabricate status transitions. Their histories
and Health assessments remain separate from audit and are aggregated by a security-invoker
read view with CASE / HEALTH / RISK / INTERVENTION source labels.

Check-in ≠ Task; Check-in ≠ Health Assessment; Risk Signal ≠ Health / Data Quality Finding /
Academic Record. Intervention ≠ Task / Goal. Task Overdue ≠ Risk Signal. Open Risk ≠ AT_RISK.
Risk Resolved ≠ Intervention Completed. Intervention Completed ≠ Health Improved.
No database trigger, quality rule or UI save infers any of these transitions.

All child reads inherit Case/Enrollment access; writes require existing education.manage
and Case owner/team edit scope. Task access stays authoritative, including visible counts.
Composite database references enforce same workspace and Case for Check-in, Risk,
Intervention, Goal and Task relationships. Public APIs expose typed domain mutations,
never arbitrary child status PATCH or ordinary DELETE. Parent locks, strict revisions and
receipts make saves atomic and retry-safe; actor or payload changes invalidate a receipt.

Privacy export includes personal Check-ins, Assessments, Risks, Interventions and both
status histories, plus Task relationship references. Tasks are exported once. Physical
Student cleanup removes all these rows and personal receipts while retaining Finance and
Channel commercial facts. Audit stores IDs, revisions and changed field names, without
copying operational narrative or assessment rationale.

Five additional MEDIUM contextual quality rules identify an ACTIVE Case without a recent
Check-in (after 30 calendar days from the latest occurred check-in, or Case creation if none),
AT_RISK without an open/monitoring Risk, HIGH open/monitoring Risk without an ACTIVE linked
Intervention, ACTIVE Intervention past its target, and open/monitoring Risk without owner.
Findings inherit subject access, carry no personal narrative, and never generate Risks or
change Health. LOW severity is valid. Optional Success Automation triggers remain deferred;
existing TASK / NOTIFICATION automation is unchanged and no default rule is seeded.

## Explicit Outcomes

Academic Records store curriculum/grade/year facts; Progression advances grades; Pathways
store destination planning; Application owns Admission Decision. Scoped inspection found no
equivalent retrospective Enrollment-scoped outcome resource. Migration 105 adds
`student_success_outcomes`, without renaming, copying or backfilling those existing facts.

Case 1:N Outcomes. Types are ACADEMIC / LANGUAGE / ENGAGEMENT / ATTENDANCE / PROJECT /
TRANSITION / CAREER / PERSONAL_DEVELOPMENT / OTHER. Results are ACHIEVED /
PARTIALLY_ACHIEVED / NOT_ACHIEVED / OBSERVED. An observed result need not evaluate a Goal.
The optional Goal reference is constrained to the same workspace and Case by a composite FK.
Multiple Outcomes can share the same Goal/type; neither is a unique business identity.
Student, Product and Cohort are derived through Case → immutable Enrollment. Outcome owner
is an independently saved active, assignable staff member. No numeric outcome score.

`occurred_on` is the actual confirmed business date, supporting late recording. Outcome
creation/edit is explicit. A RECORDED record can be corrected using strict revision. VOIDED
requires a reason, authorized actor and audit; the record remains but cannot be edited or
revived, and is excluded from all normal counts. No ordinary hard delete. Case/Enrollment
locks, same-Case checks, actor/payload-bound receipts and minimal audit are atomic. Retry
cannot duplicate an Outcome, audit or receipt. Audit never copies title, summary or reason
text. Student export includes recorded and voided personal Outcomes once. Personal cleanup
cascades Outcomes and receipts while retaining Contracts, Finance and Channel Commission.

Outcome ≠ Goal / Enrollment Status / Case Status / Health / Academic Record / Admission
Decision / Risk Resolution / Intervention Completion. Case COMPLETED ≠ Successful Outcome.
Goal ACHIEVED ≠ Whole Case Success. No transition in either domain automatically writes
another domain's fact. Academic grades/GPA are not copied into Outcomes. Case completion
without a recorded Outcome is allowed; the detail UI gives an informational warning.

## Student Success Analytics

`student_success_analytics(jsonb)` is STABLE, security-invoker and read-only. Existing
education.view roles and Case/Enrollment RLS define the mother set before all aggregation.
Hidden Cases and their children contribute neither rows nor counts. Independent child CTEs
and per-Case aggregates prevent Goal/Risk/Check-in join fanout. No Student PII, Task KPIs,
money, score, materialized analytics facts or inferred results are returned. The dedicated
Analytics repository and GET endpoint expose only aggregates and authorized Product/Cohort
labels. Drill-down continues through normal Case permission checks.

Filters: business-date range, Product, Cohort, Case Owner and current Health. Product/Cohort
are derived through Enrollment; Cohort must match a supplied Product. Default period is the
last 90 calendar days, maximum span 3,660 days. Workspace business timezone controls timestamp
boundaries and month buckets, never browser local timezone. `occurred_on` remains a date.

Current snapshot: visible/ACTIVE Cases, Case statuses, all four independent Health buckets,
attention Cases (ATTENTION or AT_RISK), open/monitoring and HIGH open Risks, active Goals and
Interventions, upcoming review within 7 days, recorded Outcomes and their type/result
distributions. Check-in recency reuses Phase 2's 30-calendar-day convention for ACTIVE Cases,
falling back to Case creation when no Check-in exists. It is an operational quality signal,
not a risk or Health prediction.

Period activity uses Check-in `occurred_at`, Assessment `assessed_at`, Risk `observed_at` /
`resolved_at`, Intervention `started_on` / `completed_at`, Goal `achieved_at` and Outcome
`occurred_on`. The resolved/completed/achieved counts describe currently resolved/completed/
achieved records with those business dates in the selected period; they are not totals of
all historical transitions. Backdated entries use business dates, not insert timestamps.
Period NOT_ACHIEVED Goal transitions are deferred: Goals have no authoritative evaluation
timestamp/history. Their current distribution remains available, without inventing dates.

Goal attainment is exactly ACHIEVED / (ACHIEVED + NOT_ACHIEVED), excluding PLANNED, ACTIVE
and CANCELLED. Denominator zero returns null, displayed as Not evaluated. It does not use
Outcome results and is never named Student Success Rate. Risk/Intervention/Case completion
ratios are intentionally omitted. Outcome distribution includes partial and observed results
and excludes VOIDED. Analytics never writes domain facts or emits Automation events.

Product/Cohort comparison labels each current versus period measure. Monthly tables show
Check-ins, confirmed Risks observed and recorded Outcomes; no new chart dependency. Unknown
Health is separate. No Product/Student/Mentor score, ranking, causal claim or whole-student
success rate. Analytics ≠ Business Fact; aggregate correlation ≠ causation; AI inference ≠
Business Fact. Existing Data Quality remains independent of Health/Risk and unchanged by
Analytics. No new quality rule or default Automation is seeded in Phase 3.

## Deferred

Numeric Success/Risk Scoring, whole-student Success Rate, automatic Risk detection,
attendance/grade ingestion, Parent/Guardian Success Portal, automated Success Workflow,
Management Intelligence and AI. No Success Milestone, numeric Health Score or Success Rate.
Outcome Automation and Goal evaluation-time history remain deferred. Release Closure adds
verification and version metadata, without expanding the domain model or changing frozen
migrations 103–105. The v3.22 release candidate uses version 3.22.0.

## Final frozen boundaries

- Student ≠ Enrollment; Enrollment ≠ Success Case.
- Success Case ≠ Application; Success Case ≠ Academic Record; Success Case ≠ Task.
- Goal ≠ Task; Goal ≠ Outcome.
- Check-in ≠ Task; Check-in ≠ Health Assessment.
- Health ≠ Enrollment Status; Health ≠ Risk.
- Risk Signal ≠ Data Quality Finding; Risk Signal ≠ Academic Record.
- Intervention ≠ Task; Intervention ≠ Goal.
- Risk Resolved ≠ Intervention Completed; Intervention Completed ≠ Health Improved.
- Outcome ≠ Goal; Outcome ≠ Academic Record; Outcome ≠ Admission Decision.
- Outcome ≠ Enrollment Status; Outcome ≠ Health; Outcome ≠ Risk Resolution.
- Outcome ≠ Intervention Completion; Case COMPLETED ≠ Successful Outcome.
- Analytics ≠ Business Fact; aggregate correlation ≠ causation.
- AI inference ≠ Business Fact.

Case/Risk/Intervention Status Histories and Health Assessments are operational facts.
Audit is governance evidence and never replaces those histories. Data Quality findings
never change Health, create or resolve Risk, or create Interventions/Outcomes. Task overdue
does not imply Risk or AT_RISK; missing assessment does not imply ON_TRACK. Human-confirmed
Health remains authoritative. Academic Records, Progression, Admissions, Finance and
Channel Commission retain their independent authority and privacy-retention contracts.

The bounded release PostgreSQL Golden Path links a real CRM Task, explicitly performs
support transitions and records an Outcome before closing the Case. Negative paths reject
cross-Case references, retain ON_TRACK with a HIGH open Risk, and close a Case without
inventing an Outcome. Audit failure rolls back the complete Check-in/Health operation.
Analytics runs in a read-only transaction and leaves canonical rows unchanged.
