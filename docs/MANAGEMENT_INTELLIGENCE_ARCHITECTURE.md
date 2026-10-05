# Management Intelligence — v3.23

## Metric Contract

Management Intelligence is a **permission-filtered read model**. It owns no business facts.
Every count uses visible canonical records before aggregation; zero means an observed empty
set, while unavailable modules and unknown ratios return null/restricted. SNAPSHOT ignores
the report period; PERIOD uses inclusive workspace business dates converted to half-open
timestamp bounds. Default period is the last 30 calendar days, not a business threshold.
No browser-local timezone, combined currency total or implicit FX is allowed.

| Metric / business meaning | Canonical source / formula | Mode / business date | Currency | Permission / limitations |
| --- | --- | --- | --- | --- |
| Open Leads; qualified Leads | Visible leads in NEW/QUALIFYING/QUALIFIED; qualified = QUALIFIED | SNAPSHOT | None | Existing Lead and subject RLS; claim is not qualification |
| Leads created; converted | Count created_at in period; current CONVERTED with converted_at in period | PERIOD / created_at, converted_at | None | Not a full transition funnel; reliable Lead status history absent |
| Open Opportunities | Visible DISCOVERY/EVALUATION/HESITATION/PAYMENT deals | SNAPSHOT | None | Organization/Household and optional primary Contact access, Opportunity RLS |
| Won / lost Opportunities | Current WON / LOST with canonical closed_at in period | PERIOD / closed_at | None | Not every historical stage transition; NULL close time excluded |
| Open Pipeline Value; Won Opportunity Value | Sum visible opportunity.amount for open / current WON closed in period | SNAPSHOT / PERIOD | Separate currency, numeric decimal strings | Opportunity value is not Revenue; manual probability unused |
| Active Products | Visible products with active=true | SNAPSHOT | None | Existing Product membership RLS |
| Recruiting / active / completed Cohorts | Exact RECRUITING / ACTIVE / COMPLETED cohort statuses | SNAPSHOT | None | No capacity inference; Product and Cohort remain distinct |
| Enrollment status distribution / current open / ACTIVE | Each visible Enrollment once; open = LEAD+INTERESTED+REGISTERING+ACTIVE | SNAPSHOT | None | Enrollment/Student owner-team RLS; not unique Students |
| Enrollments created / activated / completed / withdrawn / cancelled | Created_at; distinct Enrollment per target status in noninitial genuine status history in period | PERIOD / created_at, history.changed_at | None | Repeated transitions to one target counted once per Enrollment; targets overlap |
| Contracted | Visible contract.contract_value, once per Contract | SNAPSHOT | Separate currency | Existing Contract/Finance visibility; not Revenue or revenue recognition |
| Receivable; outstanding; overdue | Official Finance schedule sum(amount); sum(amount-paid_amount); unpaid schedule before current_business_date | SNAPSHOT | Contract currency | Exact existing 094 semantics, including its schedule scope; no schedule means zero scheduled exposure, not zero Contract obligation |
| Gross confirmed receipts; refunded; collected; net collected | Official Finance CONFIRMED/REFUNDED Payments sum(amount), sum(refunded_amount), sum(amount-refunded_amount) | SNAPSHOT | Payment/Contract currency | Collected already means **net** in v3.19; Net Collected is an explicit alias, not a second refund deduction |
| Payments confirmed in period | Sum canonical CONFIRMED/REFUNDED Payment amount by paid_at | PERIOD / paid_at | Separate currency | Gross receipt activity, not current net collection or recognized Revenue |
| Refunds completed in period | Visible PAID Refund amount joined to visible Payment/Contract | PERIOD / refunded_at | Payment currency | Inherits Refund participant RLS; not all workspace refunds for a scoped actor |
| Visible Channel Accounts; available public leads; active channel Opportunities; held Events | Reuse channel_analytics snapshot/totals | SNAPSHOT / PERIOD / event starts_on | None | Canonical channel account set, permission-filtered Contact edges; Event is not conversion |
| PRIMARY / ASSIST contributions; accounts contributing them | Reuse channel_analytics distinct Enrollment contribution counts and canonical account rows | SNAPSHOT | None | Contributions kept separate; first 50 account rows shown with full summary and link to complete Channel Analytics |
| Commission accrued / open / accrued in period | Reuse channel_analytics commission_accruals aggregation, including negative REVERSAL once | SNAPSHOT / PERIOD / accrued_at | Separate currency decimal strings | Existing channel_commercial_access money roles; no Payments × Rules recalculation |
| Paid settlements in period | Reuse canonical settlement/line report paid_in_period | PERIOD / paid_at | Separate currency | Does not create customer Payment; no Channel Revenue or ROI |
| Applications / Admission Decisions distributions | Visible student_applications grouped by exact status / nonnull decision | SNAPSHOT | None | Application/Enrollment/target institution RLS; Decisions are not Success Outcomes |
| Admissions work in progress; due soon; past deadline | SUBMITTED+UNDER_REVIEW; DRAFT/PREPARING deadline today..today+7 / before today | SNAPSHOT / workspace business today | None | Seven days is presentation window; missing deadlines are unknown and excluded |
| Open / overdue Milestones | Nonterminal PENDING/SCHEDULED/IN_PROGRESS/BLOCKED; due_at before current instant | SNAPSHOT / due_at | None | Existing Milestone/Application/Enrollment access |
| Active / blocked / completed Workflows | Exact canonical workflow_instances ACTIVE/BLOCKED/COMPLETED statuses | SNAPSHOT | None | Existing workflow_instance_access including linked Task/source visibility |
| Visible / ACTIVE / attention / AT_RISK Cases; Health distribution | Reuse student_success_analytics snapshot exactly | SNAPSHOT | None | Visible Cases mother set; attention=ATTENTION+AT_RISK, UNKNOWN independent |
| Stale Check-in Cases; open/high open Risks; active support; recorded Outcomes | Reuse student_success_analytics exact counts, 30-calendar-day recency and nonvoided Outcomes | SNAPSHOT | None | Risk≠Health; resolved/completed support does not imply Outcome |
| Check-ins; Health assessments; Outcomes in period | Reuse student_success_analytics period | PERIOD / occurred_at, assessed_at, occurred_on | None | Explicit business dates, not insert timestamps; no Student PII |
| Risks observed / resolved; Interventions started / completed; Goals achieved | Reuse student_success_analytics period counts | PERIOD / observed_at, resolved_at, started_on, completed_at, achieved_at | None | Independent domain events, not causal claims or successful Student counts |
| Goal attainment | Reuse ACHIEVED/(ACHIEVED+NOT_ACHIEVED); zero denominator=null | SNAPSHOT | None / fraction | PLANNED/ACTIVE/CANCELLED excluded; never whole-student Success Rate |
| Open Data Quality by domain / severity | OPEN/ASSIGNED findings intersect supported currently visible source IDs | SNAPSHOT | None | Narrow source whitelist below; unknown cached entities excluded; quality is not business Risk |

## Domain map and reuse

Commercial → Lead / Opportunity. Delivery → Product / Cohort / Enrollment.
Finance → Contract / Receivable / Payment / Refund. Channel → Organization / Attribution /
Commission. Admissions → Application / Milestone / Workflow. Student Success → Case / Goal /
Risk / Intervention / Outcome. All authority stays with these domains.

The old personal Dashboard includes actionable Tasks and an older consumption report; it
does not define this contract. Executive Overview lives in existing Reports at
`/reports/executive`, with one GET `/api/management/overview` and a pure-read repository.
No replacement Lead, Enrollment, Finance, Case or Management issue list is created.

Forward **106** is necessary for one coherent security-invoker query and reusable
**contract_finance_snapshot** over the exact existing 094 formulas. Enrollment Finance
reuses that projection with unchanged columns/semantics. Contracts without Enrollment
links remain included in company Finance; shared Contracts count once, never split.
106 contains only views and STABLE security-invoker read functions; no fact table, business
mutation, trigger, new permission framework or speculative index. 103–105 remain frozen.
Channel and Success invoke their existing functions rather than copying their formulas.

## Authorization and availability

Page/API reuse `education.view`; all existing six Education roles may enter, including
manager roles, without `management.view`. SQL independently validates internal active
workspace membership and supported role. Each module uses canonical RLS independently.
All existing roles currently have finance.view, but this does not imply access to every
Contract. Finance returns restricted/null for a scoped actor with no visible Contracts;
SUPER_ADMIN/ADMIN/SALES_DIRECTOR retain an available empty view. An actor with visible
Contracts sees only those Contracts and their visible Finance sources. This is a scoped
availability presentation, not a new Finance permission. Commission money retains its
existing SUPER_ADMIN/ADMIN/SALES_DIRECTOR/SALES_MANAGER and Organization boundaries.
No client flag can grant money access. Restricted is never represented as zero.

Attention and Quality intersect sources visible to the actor before emitting IDs/counts.
Supported Quality sources: Organization, Contact, Opportunity, Contract (Finance visible),
Enrollment, Application, Milestone, Workflow, Success Case/Goal/Risk/Intervention. Unknown
source types are omitted rather than leaking stale cached findings. No narrative text,
Student name/email/phone/guardian/passport or hidden Task content is returned. Source IDs
are minimal drill-down references, only for authorized sources.

## Attention contract

Attention is an on-demand projection, not a persisted alert or new Domain status. Each item
has source_domain, source_type, source_id, context_id, reason_code, presentation severity
and due/occurred date. One source/ reason pair is unique; separate source facts stay separate.
The first 30 items sort by presentation priority, oldest date then stable source identity;
the response declares this bounded limit and full visible total. No inferred escalation.

| Reason | Source | Presentation severity | Drill-down |
| --- | --- | --- | --- |
| OVERDUE_RECEIVABLE | Visible unpaid schedule due before business today | ATTENTION | Existing Contract selected by escaped canonical reference and ID |
| OVERDUE_MILESTONE | Visible nonterminal milestone due before current time | ATTENTION | Enrollment detail (Admissions context) |
| BLOCKED_WORKFLOW | Visible canonical BLOCKED instance | ATTENTION | Enrollment detail (Workflow context) |
| HIGH_OPEN_RISK | Confirmed HIGH OPEN/MONITORING Success Risk | CRITICAL | Existing Success Case |
| STALE_CHECKIN | ACTIVE Case past the existing 30-calendar-day convention | ATTENTION | Existing Success Case |
| HIGH_QUALITY_FINDING | HIGH OPEN/ASSIGNED finding intersected with visible source | ATTENTION | Existing source record; no Quality-to-Risk inference |

These colors/priorities only present source facts; they never mutate severity, Health or
status. Blocked workflows are not inferred from management heuristics. No new Automation
event, recommendation, prediction or AI summary is emitted.

## Frozen boundaries and non-scope

Management Metric ≠ Business Fact; Dashboard ≠ Domain Ledger. Opportunity Amount ≠ Revenue;
Contract Amount ≠ Collected Revenue; Receivable ≠ Collected Revenue. Commissionable Base ≠
Channel Revenue; Enrollment Attribution ≠ Revenue Attribution. Enrollment COMPLETED ≠
Student Success; Goal Attainment ≠ Student Success Rate. Data Quality Finding ≠ Business
Risk; Management Attention ≠ Domain Status; AI inference ≠ Business Fact.

Deferred: Revenue Attribution/Recognition, Channel Revenue/ROI, P&L/Gross Margin/Product
Profitability, Sales Targets/Quota, forecasts, persisted Management Alerts, Management AI,
predictive Risk, Success Rate/Success or Risk scores and user-configurable KPI builder.
Phase 1 deferred period comparison, trends and deeper drill-down consistency; Phase 2
implements the contracts below. Targets remain deferred.
Phase 1 retains **3.22.0**, with no commit/push/deploy/Production access.

## Phase 2 Trend Contract

`GET /api/management/trends` is an independently loaded, no-store, authenticated read.
The existing Overview response remains compatible and adds filter applicability metadata.
Forward **107** is necessary to express workspace-local buckets, exact numeric comparison
and the same predicates in existing domain list row/count queries under invoker RLS.
It owns no tables, triggers, mutations, receipts or permission framework. 103–106 retain
their frozen bytes. No speculative indexes were added: the bounded seven-day trend plan
was about 502 ms. The filtered Overview retains canonical contract Finance projection and
calls existing Channel/Student Success analysis functions; trends extract their PERIOD
values rather than copying commission, refund or Goal formulas.

Only registered PERIOD metrics support trends/comparison. Admissions adds explicit
Applications Submitted (`submitted_at`), Applications Decided (`decision_at`), Completed
Milestones (`completed_at`, current COMPLETED), Workflows Started (`started_at`) and
Completed Workflows (`completed_at`, current COMPLETED). These are lifecycle activities,
not a historical funnel or Outcome. Snapshot metrics have no historical-as-of comparison.
Opportunity won/lost and won value use current WON/LOST plus `closed_at`; Lead conversion
uses current CONVERTED plus `converted_at`. Neither reconstructs a full transition funnel.

Inclusive business dates become `[local start midnight, local day after end midnight)`.
DAY/WEEK/MONTH buckets are computed in PostgreSQL using workspace business timezone.
Calendar weeks begin Monday; calendar months begin on day one. First/last buckets are
clipped to the selected interval. Empty buckets return zero for available metrics, while
restricted Finance/commission series are absent and permissions report restricted.
Maximum interval is **730 inclusive calendar days**. DAY is allowed through 45 days,
WEEK through 180; longer intervals use MONTH. A too-fine requested granularity is upgraded;
coarser granularity is allowed. At most 45 buckets are returned, never thousands.

For Enrollment transitions, each distinct Enrollment is counted once per target in the
whole selected period. The first genuine entry to that target within that period determines
its bucket. Thus bucket sum reconciles with the Overview period total even after repeated
entries. Different targets can overlap for one Enrollment. Initial history is excluded.
Check-ins use occurred_at; Health assessments assessed_at; Risks observed_at/resolved_at;
Interventions started_on/completed_at; Goals achieved_at; recorded Outcomes occurred_on.
VOIDED Outcomes are excluded. Goal attainment is snapshot-only and has no trend.

Money is calculated as PostgreSQL numeric and serialized as decimal strings per currency.
Commission uses the accrued ledger including EARNED and REVERSAL exactly once; Finance
refund activity is not subtracted from commission a second time. Paid settlement activity
uses paid_at. Trend is not Forecast; historical change is not a causal explanation.

## Comparison Contract

Previous comparable period is the immediately preceding business-date interval with the
same number of calendar days. Sep 1–30 compares with Aug 2–31, **not MoM**. Both boundaries
and timezone are returned and shown explicitly. Current/previous values are observed
period activity; absolute change is current minus previous. Percent change is
`100 * (current - previous) / previous`; **previous zero returns NULL**, never infinity or
an invented 100%. Currencies compare only with themselves. Previous-only currencies have
zero current activity. No unlabelled mixed-currency total or implicit FX is returned.
No historical snapshot warehouse, Outstanding trend, Open Pipeline trend, current Health
delta, Goal attainment trend or generic good/bad judgment is implemented.

## Filter Contract

| Module | Product/Cohort applicability | Canonical field / limitation |
| --- | --- | --- |
| Commercial | Opportunity only; Leads unaffected | opportunity.product_id/cohort_id; Leads have no invented product scope |
| Delivery | Product/Cohort catalog and Enrollment | Enrollment → Cohort → Product; no copied identity |
| Finance | Contract context | declared Contract product; Cohort via an ACTIVE Enrollment link; Contract remains counted once and never allocated |
| Channel | Existing Channel Analytics convention | matching visible opportunities/events/attributions/ledger context; account coverage/Leads remain account-wide within selected accounts |
| Admissions | Enrollment context | Application/Milestone/Workflow → Enrollment → Cohort → Product |
| Student Success | Existing Success Analytics convention | Case → Enrollment → Cohort → Product |

Response includes applied productId/cohortId and per-module `filterApplied`. Attention and
Quality continue intersecting their canonical visible sources: sources with Enrollment or
Opportunity context follow that context; account/contact findings have no invented Product.
Owner filtering is deferred because Lead, Opportunity, Enrollment and Case Owners differ.
The default last 30 calendar days is presentation only. No Target/Quota/Budget is introduced.

## Drill-down Contract

Exact drill-downs reuse existing `/leads`, `/opportunities`, `/enrollments`, `/finance` and
`/student-success` pages and existing list APIs/repositories. Typed `reportMetric` and
business-date/context parameters select a shared read-only SQL predicate. The gateway
applies it to both row and exact-count queries before pagination, alongside ordinary list
filters and authoritative domain RLS. No Management-only list API or copied record store
exists. List reloads/pagination retain the report scope. URL changes cannot grant access.

Exact count reconciliation covers Open/Qualified Leads, current Open Opportunities across
currencies, ACTIVE/open Enrollments, current AT_RISK/ATTENTION/active/visible Cases, period
Lead creation/conversion, Enrollment creation and distinct target transitions, confirmed
Payment activity by currency, and nonvoided Outcomes by occurred_on. Global Outcomes reuse
the existing Success repository/API and its Case-inherited access. Per-Case Outcomes can
also be filtered by the same inclusive occurred_on dates. Finance Payment drill-down uses
the same confirmed/refunded statuses, visible Contract and paid_at business interval.
Finance amounts reconcile by summing matching payment amounts within each currency.

Reconciliation is for the same actor, filters and live read context; fixture checks execute
without intervening business changes. Separate browser requests are fresh reads, not a
frozen historical snapshot. A real business edit between opening a card and a list can
change the result. Management does not pretend it can reconstruct past current statuses.

Metrics lacking an exact native list filter link to their canonical workspace/analytics,
labelled **Open workspace**, with exact drill-down explicitly unavailable. Such a link is
navigation, not a claim of count/amount reconciliation. Shared Channel/Success analysis
metrics retain their domain filter conventions. No unsafe Student detail is returned by
Management aggregates; individual detail remains subject to normal domain authorization.

Attention links locate the Contract by exact reference/context, Enrollment Admissions or
Workflow tab, or Success Case. Known DQ subjects use their canonical record route; an
unknown route falls back to the real Data Quality workspace, never a guessed School URL.
Attention remains an on-demand source projection, not a persisted Management Alert.

## Phase 2 frozen boundaries and non-scope

Trend ≠ Forecast. Comparison ≠ Target Attainment. Historical change ≠ causal explanation.
Opportunity Value ≠ Revenue; Contracted Amount ≠ Revenue. Enrollment Attribution ≠ Revenue
Attribution. Commissionable Base ≠ Channel Revenue. Goal Attainment ≠ Student Success Rate.
Drill-down ≠ new domain. Attention ≠ persisted Alert. AI inference ≠ Business Fact.

Still deferred: Targets/Quota/Budget; forecasts; Revenue Attribution/Recognition; Channel
Revenue/ROI; P&L/Gross Margin/Product Profitability; historical snapshots; persisted Alerts;
Management AI; whole-student Success Rate/Success or Risk scores; configurable KPI builder.
Phase 2 retains **3.22.0**, with no commit/push/deploy/Production access.

## Per-metric Phase 2 support

All period metrics support DAY/WEEK/MONTH subject to the interval limits above.
The source, formula, mode, date, currency and permissions remain those of the Metric Contract.
The table distinguishes exact filtered lists from workspace navigation. All filters continue
intersecting visible mother sets; applicability follows the module-specific Filter Contract.

| Metric key | Source / bucket date | Trend | Comparison | Canonical route | Exact reconciliation | Supported filters | Historical limitation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openLeads | leads / current status | NO | NO | /leads | YES | None | No historical-as-of snapshot; no comparison |
| qualifiedLeads | leads / current status | NO | NO | /leads | YES | None | No historical-as-of snapshot; no comparison |
| openOpportunities | opportunities / current stage | NO | NO | /opportunities | YES | productId, cohortId | No historical-as-of snapshot; no comparison |
| leadsCreated | leads / created_at | YES | YES | /leads | YES | None; date range | Canonical business dates; visible records only |
| leadsConverted | leads / converted_at | YES | YES | /leads | YES | None; date range | Canonical business dates; visible records only |
| opportunitiesWon | opportunities / closed_at | YES | YES | /opportunities | YES | productId, cohortId; date range | Current WON/LOST with closed_at; not historical funnel |
| opportunitiesLost | opportunities / closed_at | YES | YES | /opportunities | YES | productId, cohortId; date range | Current WON/LOST with closed_at; not historical funnel |
| open_value | opportunities / current stage | NO | NO | /opportunities | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| won_value | opportunities / closed_at | YES | YES | /opportunities | Unavailable; workspace navigation | productId, cohortId; date range | Current WON/LOST with closed_at; not historical funnel |
| activeProducts | products / current active | NO | NO | /enrollments | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| recruitingCohorts | product_cohorts / current status | NO | NO | /enrollments | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| activeCohorts | product_cohorts / current status | NO | NO | /enrollments | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| completedCohorts | product_cohorts / current status | NO | NO | /enrollments | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| openEnrollments | student_enrollments / current status | NO | NO | /enrollments | YES | productId, cohortId | No historical-as-of snapshot; no comparison |
| activeEnrollments | student_enrollments / current status | NO | NO | /enrollments | YES | productId, cohortId | No historical-as-of snapshot; no comparison |
| enrollmentsCreated | student_enrollments / created_at | YES | YES | /enrollments | YES | productId, cohortId; date range | Canonical business dates; visible records only |
| enrollmentsActivated | student_enrollment_status_history / changed_at | YES | YES | /enrollments | YES | productId, cohortId; date range | Canonical business dates; visible records only |
| enrollmentsCompleted | student_enrollment_status_history / changed_at | YES | YES | /enrollments | YES | productId, cohortId; date range | Canonical business dates; visible records only |
| enrollmentsWithdrawn | student_enrollment_status_history / changed_at | YES | YES | /enrollments | YES | productId, cohortId; date range | Canonical business dates; visible records only |
| enrollmentsCancelled | student_enrollment_status_history / changed_at | YES | YES | /enrollments | YES | productId, cohortId; date range | Canonical business dates; visible records only |
| contracted | contract_finance_snapshot / current contract | NO | NO | /finance | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| receivable | contract_finance_snapshot / current schedule | NO | NO | /finance | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| collected | contract_finance_snapshot / current net confirmed receipts | NO | NO | /finance | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| netCollected | contract_finance_snapshot / alias of collected | NO | NO | /finance | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| refunded | contract_finance_snapshot / current completed refund balance | NO | NO | /finance | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| gross_confirmed | contract_finance_snapshot / current confirmed gross receipts | NO | NO | /finance | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| outstanding | contract_finance_snapshot / current schedule balance | NO | NO | /finance | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| overdue | contract_finance_snapshot / workspace business date | NO | NO | /finance | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| payments_in_period | payments / paid_at | YES | YES | /finance | YES | productId, cohortId; date range | Canonical business dates; visible records only |
| refunds_in_period | refunds / refunded_at | YES | YES | /finance | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| visibleAccounts | channel_analytics / current visible organizations | NO | NO | /reports/channels | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| availablePublicLeads | channel_analytics / current pool availability | NO | NO | /reports/channels | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| channelOpenOpportunities | channel_analytics / current stage | NO | NO | /reports/channels | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| primaryContributions | channel_analytics / current explicit attribution | NO | NO | /reports/channels | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| assistContributions | channel_analytics / current explicit attribution | NO | NO | /reports/channels | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| eventsHeld | channel_analytics / event starts_on | YES | YES | /reports/channels | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| commissionNet | commission_accruals via channel_analytics / ledger entries | NO | NO | /reports/channels | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| commissionOpen | commission_accruals via channel_analytics / noncancelled settlement reservation | NO | NO | /reports/channels | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| commissionPeriod | commission_accruals via channel_analytics / accrued_at | YES | YES | /reports/channels | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| commissionPaid | commission_settlements via channel_analytics / paid_at | YES | YES | /reports/channels | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| applicationsSubmitted | student_applications / submitted_at | YES | YES | /applications | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| applicationsDecided | student_applications / decision_at | YES | YES | /applications | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| milestonesCompleted | admission_milestones / completed_at | YES | YES | /applications | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| workflowsStarted | workflow_instances / started_at | YES | YES | /applications | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| workflowsCompleted | workflow_instances / completed_at | YES | YES | /applications | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| applicationsInProgress | student_applications / current status | NO | NO | /applications | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| applicationsDueSoon | student_applications / deadline_on in next 7 calendar days | NO | NO | /applications | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| applicationsPastDeadline | student_applications / deadline_on before business date | NO | NO | /applications | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| openMilestones | admission_milestones / current nonterminal status | NO | NO | /applications | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| overdueMilestones | admission_milestones / due_at before asOf | NO | NO | /applications | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| activeWorkflows | workflow_instances / current status | NO | NO | /applications | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| blockedWorkflows | workflow_instances / current status | NO | NO | /applications | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| completedWorkflows | workflow_instances / current status | NO | NO | /applications | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| visibleCases | student_success_analytics / current visible cases | NO | NO | /student-success | YES | productId, cohortId | No historical-as-of snapshot; no comparison |
| activeCases | student_success_analytics / current status | NO | NO | /student-success | YES | productId, cohortId | No historical-as-of snapshot; no comparison |
| attentionCases | student_success_analytics / ATTENTION or AT_RISK | NO | NO | /student-success | YES | productId, cohortId | No historical-as-of snapshot; no comparison |
| atRiskCases | student_success_analytics / current AT_RISK | NO | NO | /student-success | YES | productId, cohortId | No historical-as-of snapshot; no comparison |
| openRisks | student_success_analytics / OPEN or MONITORING | NO | NO | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| highOpenRisks | student_success_analytics / HIGH and OPEN or MONITORING | NO | NO | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| activeInterventions | student_success_analytics / current status | NO | NO | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| withoutRecentCheckin | student_success_analytics / 30 calendar day convention | NO | NO | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| recordedOutcomes | student_success_analytics / non-VOIDED | NO | NO | /student-success | YES | productId, cohortId | No historical-as-of snapshot; no comparison |
| goalAttainment | student_success_analytics / ACHIEVED / (ACHIEVED + NOT_ACHIEVED); null denominator zero | NO | NO | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId | No historical-as-of snapshot; no comparison |
| checkins | student_success_analytics / occurred_at | YES | YES | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| healthAssessments | student_success_analytics / assessed_at | YES | YES | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| risksObserved | student_success_analytics / observed_at | YES | YES | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| risksResolved | student_success_analytics / resolved_at | YES | YES | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| interventionsStarted | student_success_analytics / started_on | YES | YES | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| interventionsCompleted | student_success_analytics / completed_at | YES | YES | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| goalsAchieved | student_success_analytics / achieved_at | YES | YES | /student-success?view=analytics | Unavailable; workspace navigation | productId, cohortId; date range | Canonical business dates; visible records only |
| outcomesRecorded | student_success_analytics / occurred_on | YES | YES | /student-success | YES | productId, cohortId; date range | Canonical business dates; visible records only |

Current recordedOutcomes drill-down excludes VOIDED records without a period constraint;
period outcomesRecorded uses occurred_on. Both share the same Case-inherited visibility.

## Attention Queue Contract — Phase 3

Attention is **current derived state**. It has no acknowledgement, assignment, snooze,
independent resolution or persisted lifecycle. A row disappears when its source no longer
matches. Management never mutates a source fact, creates a CRM Task or emits Automation.
The full queue lives at `/reports/executive/attention`, entered through View all attention
in Executive Overview. It is not a second business list or a Data Quality/Task queue.

Forward **108** is necessary because frozen 107 only exposes the first 30 Attention rows,
not full filtered pagination/counts or safe context. It adds STABLE/security-invoker reads,
and replaces live Overview implementations to invoke the same `management_attention`
contract. Frozen 106/107 raw bytes remain untouched. No table, trigger, mutation, index,
receipt, permission framework or speculative future reason is added.

`GET /api/management/attention` returns SNAPSHOT/asOf/workspace timezone, page/pageSize,
exact visible total, by-domain/reason/presentation-severity counts, applied filters and rows.
Rows carry stable reason/source-type/source-ID identity, context ID, canonical route,
source/due date, optional derived Product/Cohort and a typed reason-specific context.
References identify business objects; no Student identity or personal narrative is needed.

API page sizes follow the existing 10/20/50 list convention, plus 100 maximum; default 20.
The internal Overview call alone uses 30. Page number is bounded 1–100000. Domain, reason,
presentation severity, Product/Cohort and PRIORITY/OLDEST/NEWEST are the only filters/sorts.
No search, owner, date range or history filter is claimed. Summary counts use the same
filtered mother set as the exact rows/count. Out-of-range pages are empty, with honest total.

PRIORITY sorts CRITICAL before ATTENTION, then oldest canonical source timestamp (NULL last),
then reason/type/source UUID. OLDEST/NEWEST use source timestamp with the same stable identity
tie-break. Date types are normalized to timestamps in workspace timezone; ages never become
impact/risk scores. Paging compares a live read context; source changes between requests can
change membership/order, with no promised snapshot warehouse or saved cursor state.

| Reason | Canonical source and predicate | Source date / presentation | Safe context | Product/Cohort | Money | Canonical route | Natural exit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OVERDUE_RECEIVABLE | Visible Finance schedule, amount > paid_amount and due_date < workspace business today | due_date at workspace midnight / ATTENTION | Contract reference, due date, calendar days overdue, currency and amount-paid_amount | Declared Contract Product; ACTIVE Enrollment-link Cohort, Contract/schedule once | Current canonical Contract/Finance visibility; decimal string, restricted NULL supported | Contract filtered by exact reference and focus ID | Unpaid/overdue predicate stops matching |
| OVERDUE_MILESTONE | Visible nonterminal Admissions milestone due_at < current instant | due_at / ATTENTION | Milestone type/status, due date, calendar days overdue; Enrollment ID | Enrollment → Cohort → Product | None | Enrollment Admissions tab and source ID | Completed/waived/cancelled or no longer due |
| BLOCKED_WORKFLOW | Visible canonical Workflow status=BLOCKED | started_at / ATTENTION | Current status, template ID/version, started_at | Enrollment context | None | Enrollment Workflow tab and source ID | Status leaves BLOCKED |
| HIGH_OPEN_RISK | Visible confirmed Risk severity=HIGH and status=OPEN/MONITORING | observed_at / CRITICAL | Risk type/severity/status, current Case Health, last actual Check-in, ACTIVE Interventions for that Risk | Case → Enrollment context | None | Existing Success Case | Severity/status no longer matches |
| STALE_CHECKIN | Visible ACTIVE Case with coalesce(last actual Check-in, Case created_at) before workspace today minus 30 calendar days | Last Check-in or created_at fallback / ATTENTION | Last Check-in (NULL honestly means none), next review, Health, open/monitoring Risk count, active support count | Case → Enrollment context | None | Existing Success Case | New recent Check-in or Case no longer ACTIVE |
| HIGH_QUALITY_FINDING | HIGH OPEN/ASSIGNED finding intersected with currently visible supported source | last_seen_at / ATTENTION | Rule key, DQ severity/state, entity type/ID only | Source context where real; Organization/Contact remain unfiltered | No new amount | Known canonical entity route; unrouteable types fall back to Data Quality | Finding or source no longer matches |

DQ identity is the **finding ID**, not the entity ID: distinct canonical findings for one
entity remain distinct. Its context separately identifies the underlying entity. This avoids
losing a rule through entity-level deduplication. Unknown/invisible cached source types remain
omitted. Known source navigation never relies on narrative or inferred organization context.

## Decision Context Contract

Context is an explicit discriminated union, not an arbitrary context JSON bag. Finance,
Milestone, Workflow, Risk, Case and Quality each have a finite typed field set. SQL projects
only those fields after canonical RLS/mother-set filtering. Context reads are included in one
server query; the browser does not make one request per row. Counts inherit source/Case access.
One High Risk linked to three ACTIVE Interventions remains one row with count=3. A stale
Case and its High Risk are separate reasons, not a generic Student Success problem.

No summary, rationale, notes, outcome title, Student name/email/phone/guardian/passport,
hidden Task information, prediction, recommendation, numeric score or automatic priority is
returned. Health remains human-confirmed, including legitimate ON_TRACK + HIGH OPEN Risk.
Stale means no recent Check-in, never an inferred Risk.

Finance uses the frozen scheduled amount-minus-paid_amount semantics, not Contract balance
or Revenue. Currency and decimal amount stay together. Existing six Education roles all have
finance.view; Contract visibility currently includes its financial amounts. There is no valid
existing role that reads a Contract but separately loses amount visibility. The typed context
and serializer nevertheless support restricted money as NULL (unit/browser verified), and
canonical SQL omits invisible Finance sources/counts rather than inventing a new role model.

Days overdue uses workspace business today minus the canonical due business date. Workflow
started_at is not blocked_since: no blockedForDays or inferred blocked explanation is shown.
Risk observed date/age is not worsening or business impact. The UI displays careful empty and
restricted states, not “everything is healthy” or zero for unknown/unauthorized values.

## Navigation / Mutation Boundary

Open source is navigation only. The queue offers no Resolve, Dismiss, Acknowledge, Assign,
Snooze, Pay now or Complete action. Any follow-up action belongs in the canonical Domain,
using its existing validation, concurrency, RLS, audit and retry mechanisms. Management
owns no lifecycle, Task, decision or persisted alert. No outbound notification is sent.

Overview first 30 and full queue total share the same source function; reason-filter totals
equal their summary buckets under the same actor/context/filter. Existing Trends and exact
drill predicates are unchanged. Trend/comparison changes never create Attention. Attention
has no historical trend because no historical-as-of Attention facts exist.

Frozen: Attention ≠ Business Fact/Persisted Alert; presentation severity ≠ Domain severity;
sort order ≠ Risk Score; age ≠ impact; Decision Context ≠ recommendation; navigation ≠
automated business action; Management queue ≠ Task/DQ queue; Attention ≠ Automation Event;
historical change ≠ causation; Trend ≠ Forecast; Comparison ≠ Target; AI inference ≠ fact.

Phase 3 retains 3.22.0. Deferred: persisted Alerts/acknowledgement/assignment/snooze; Targets,
Quota/Budget; forecasts; Revenue Attribution/Recognition; Channel Revenue/ROI; P&L/Margin/
Profitability; historical snapshot warehouse; Management/predictive AI; whole-student
Success Rate, Success/Risk scores and configurable KPI builder. Phase 4 is release closure.

## v3.23 release invariants

The Phase 1–3 version statements above describe their development baselines. Release closure
promotes the formal metadata to **3.23.0**, without extending the metric, trend or Attention
catalog. Management Intelligence still owns zero business facts, mutations or independent
lifecycles. The canonical domain map and all contracts above remain authoritative.

Frozen boundaries additionally include Contract Amount ≠ Revenue; Collected ≠ Receivable;
Decision Context ≠ Recommendation; Navigation Action ≠ Business Mutation; Comparison ≠ Target;
Trend ≠ Forecast; Historical Change ≠ Causal Explanation. No score, Target, Forecast, persisted
Alert or AI inference is introduced. Business Health is not an aggregate Management fact.

All 113 migrations retain their opening raw bytes, including frozen 106–108. The JSON-only
`management_period_values` helper is IMMUTABLE; database read projections and drill predicates
are STABLE and security-invoker. No forward 109 or performance index is needed for closure.

The bounded release fixture reads Overview, Trends, Attention and canonical drill predicates
in one READ ONLY transaction, then compares full-row fingerprints across 31 business,
Audit, receipt, Automation and Commission tables. Separate suites verify six-module trends,
nine exact drill-downs, Attention natural exits/stable pagination, current/period separation,
workspace-local midnight and both 23-hour/25-hour DST days. Dependency suites preserve Finance,
Admissions, Success, Data Quality, Automation and personal-data cleanup/financial retention.

Current Attention is not a historical date-range query. Restricted money context remains
NULL; the existing role model has no valid Contract-visible/amount-hidden role, as described
above. Synthetic restricted context is verified in unit/browser tests, while actual SQL
Finance visibility is verified under existing RLS. No unsupported permission claim is made.

See [v3.23 release notes](RELEASE_V3.23.0.md) and
[release verification](V323_RELEASE_CLOSURE.md). Browser QA uses actual components, production
CSS and mocked business APIs; PostgreSQL separately verifies real database semantics.
