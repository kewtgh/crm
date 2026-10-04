# v3.22 — Student Success

Version **3.22.0** adds continuous delivery support for each Enrollment. Student identity,
Product and Cohort derive through Enrollment; existing Academic Records, Progression,
Admissions, Finance and Channel Commission retain their canonical meanings.

## Success Case & Plan

- Explicit Enrollment-scoped Case, at most one per Enrollment. The same Student may have
  independent Cases for different Enrollments.
- Independent PLANNING / ACTIVE / PAUSED / COMPLETED / CLOSED lifecycle and status history.
- Human-confirmed UNKNOWN / ON_TRACK / ATTENTION / AT_RISK Health; UNKNOWN remains separate.
- Outcome-oriented Goals and permission-filtered relationships to existing CRM Tasks.

## Success Operations

- Check-ins use their actual occurred time, with optional explicit next review and assessment.
- Append-only Health Assessments preserve real judgments and update current Health atomically.
- Manually confirmed Risk Signals and independent Interventions retain lifecycle histories.
- Risk resolution, support completion and Health improvement require their own explicit actions.
- Same-Case Goal/Risk/Intervention/Task relationships enforce context and inherited access.

## Outcomes

- Explicit retrospective Outcomes, optionally linked to a same-Case Goal; repeated records
  and multiple Outcomes per Goal are valid.
- ACHIEVED / PARTIALLY_ACHIEVED / NOT_ACHIEVED / OBSERVED results remain distinct.
- Authorized voiding requires a reason, retains an immutable record and excludes it from
  normal analytics. Revision conflicts and identical-request retry retain existing contracts.
- Goal achievement and Case/Enrollment completion never automatically create Outcomes.

## Analytics

- Read-only, permission-filtered current snapshot and business-date period activity.
- Product/Cohort comparison, Health distribution including UNKNOWN, Check-in coverage,
  Goal, Risk, Intervention and nonvoided Outcome distributions.
- Goal attainment = ACHIEVED / (ACHIEVED + NOT_ACHIEVED), excluding unevaluated/cancelled
  Goals; zero denominator is unknown. This is not a whole-student Success Rate.
- Workspace timezone and actual occurred/assessed/observed/resolved/started/completed/
  achieved dates govern activity; independent aggregates prevent join fanout.

## Security and retention

Tenant, Enrollment, Case owner/team and Task permissions remain authoritative. Hidden Cases
never contribute aggregate counts, and aggregates contain no Student PII. Operational histories
are distinct from minimal governance Audit. Privacy exports include Success facts and Task
relationships once; physical cleanup removes personal Success data and receipts while
retaining the established Contract/Finance/Channel Agreement/Commission/Settlement facts.
Contextual Data Quality warnings never modify delivery state or create Risk/Outcome facts.

Migrations **103–105** are frozen; no new migration is required for release closure.
See [architecture](STUDENT_SUCCESS_ARCHITECTURE.md) and
[bounded release verification](V322_RELEASE_CLOSURE.md).

## Deferred

No whole-student Success Rate, Success Score, Risk Score, automatic Risk detection, automatic
Health algorithm or automatic Outcome inference. Attendance/grade ingestion, automated Success
Workflow, Guardian/Parent Success Portal, Management Intelligence and AI remain deferred.
Outcome Automation and Goal evaluation-time history are also deferred. No bank/payment,
medical/psychological, management scoring or predictive domain is introduced.

The release candidate is COMMIT READY only after all recorded release gates pass. This closure
does not stage, commit, push, deploy or access Production.
