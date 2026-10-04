# Channel commercial architecture — v3.21.0

The complete channel model retains existing master identities and canonical domain facts:

```text
Organization
├── Business Profile / Commercial Intelligence
├── Published School Admission Outcomes
├── Contacts / Contact Intelligence / Decision Map
├── SCHOOL Lead / Assignment History
├── Partnership Stage / Operational Stage History
├── Opportunities / Outreach Events
├── Explicit Enrollment Attribution → Enrollment
└── Channel Agreement → Agreement Version → Commission Rule
    └── Canonical eligibility → Immutable Accrual / Reversal Ledger → Settlement

Channel Analytics reads these domains; it never updates them.
```

Reuse Organization and Contact identities. Extend `organization_business_profiles`
for human-confirmed commercial tier, potential and strategy; current Opportunity,
Product and Cohort context is a permission-filtered projection, not copied facts.

Frozen boundaries:

- Organization ≠ Opportunity; Operational Status ≠ Commercial Tier.
- Contact Decision Role ≠ Decision Power; Contact ≠ Relationship.
- Unknown ≠ Zero; unknown Tier ≠ D. Scores are NULL or integers 10–100.
- Organization Admission Outcome ≠ Student Admission: school research never
  creates student application decisions. Published counts can be unknown or zero.
- AI inference ≠ Business Fact. This phase neither infers nor automatically scores.
- Commission ≠ Channel Profile. Commission and channel activation are later phases.

## Field gaps and canonical ownership

Existing Organization fields supply type, affiliation, curriculum/course categories,
city, website, student/faculty/campus counts, overview and structure. The existing
business profile supplies roles, partnership stage, primary contact, regions,
agreement expiry and next action. Do not duplicate them.

Missing school subtype, grade span and tuition belong to the existing business
profile; street address belongs to Organization. Grades use integer 0 (kindergarten)
through 12, with ordered known bounds. Tuition is nonnegative and requires currency
when an amount is known; unknown amounts stay NULL. Currency follows the existing
three-uppercase-letter Finance convention. No implicit conversion occurs.

Commercial tier S/A/B/C/D is nullable and independent of Organization status.
Partnership potential is nullable 10–100. BD plan is long-term strategy; next action
remains the existing near-term field. Competitor analysis is separate from overview.

`organization_admission_outcomes` records organization/year/region intelligence,
nullable offer and matriculation counts, structured notable destinations, source
and as-of date. One summary per organization/academic-year/region is edited by revision.
It is not student-level admission data.

`organization_contact_intelligence` is one extension per Contact in its Organization,
not a second Contact identity. Existing title, decision_role, follow-up and contact
preferences remain authoritative. Key assessment is UNKNOWN/KEY/NON_KEY, independently
of nullable decision-power/contribution scores. Operational notes are internal CRM
data; they are not sent to guardian/customer portals or external APIs. WeChat identifier
belongs to Contact communication, never to commercial intelligence.

Decision Map stores same-Organization relationships with ACTIVE/INACTIVE lifecycle.
REPORTS_TO, INFLUENCES and ASSISTANT_TO are directed; PEER and WORKS_WITH are symmetric.
Active duplicates and self-relations are rejected. Direct two-node reporting cycles
are rejected under a relation lock; deeper cycle analysis is deferred. Moving a
Contact requires resolving its old relationship/intelligence context explicitly.

## Security and operations

Use existing education.manage and customer_subject_access / owner-team boundaries.
Contact intelligence and edges require Organization and Contact access; an edge with
either hidden endpoint is hidden entirely. There is no new role or channel permission
framework. Templates, financial facts and Admissions are unaffected.

Contact intelligence, relationships and outcomes enforce strict revisions,
workspace/composite identities, actor/payload-bound retry receipts and atomic minimal
audit. Organization profiles extend the existing `save_education_business` exact-payload
revision/retry contract; omitted new fields are preserved for legacy callers. WeChat
uses the existing Contact timestamp concurrency convention in a communication mutation.
Audit stores IDs, changed field names and
revision, not internal narrative text. Relationships deactivate instead of ordinary
hard delete. Contact privacy export includes intelligence/relationships once; identity
cleanup removes personal extensions, edges and receipts while retaining Organization,
school outcome intelligence, Students and financial records.

Quality rules are contextual reminders for missing owner, key contact, next action
or assessment. Low scores and low tiers are valid, never automatic downgrade triggers.
Structured responsive cards/lists provide the Decision Map without a graph engine.
Account list filters and metrics use the same permission-filtered commercial projection.
Has/missing-key-contact filtering describes visible contacts, without disclosing hidden
contacts. Contextual quality checks do not manufacture a missing-key warning when an
existing key contact is outside the viewer's contact scope.

## Explicit non-scope

Pipeline redesign, channel agreements, Commission, Channel Revenue/ROI, Sales Targets,
Management Intelligence, AI ranking/scoring and deeper reporting-cycle analysis remain
deferred. Development keeps version 3.20.0; no Production workflow or channel
configuration is seeded.

## Public Lead Pool and Channel Activation — Phase 2

The [funnel mapping](V321_PHASE2_FUNNEL_MAPPING.md) maps the requested commercial journey
to existing canonical domains before adding schema. `leads` remains the Lead master;
there is no second Lead, Organization, Opportunity or channel pipeline identity.

`pool_visibility` is PRIVATE or WORKSPACE_PUBLIC. Existing records default to PRIVATE.
Available pool records require SCHOOL subject, WORKSPACE_PUBLIC, NULL owner, and
NEW/QUALIFYING/QUALIFIED status. Public means internal workspace CRM discovery, never
anonymous Internet or portal access. Claim preserves visibility and lifecycle; release
returns an open public Lead to the pool without disqualifying it. NULL owner alone
does not mean public. My Leads includes private and claimed public open Leads.

`leads.owner_id` is the current assignment fact; append-only `lead_assignment_history`
records CLAIMED/RELEASED/REASSIGNED. Dedicated row-locked assignment mutations enforce
strict revision, actor/payload-bound receipts, authorized assignment, minimal audit and
existing Automation dispatch in one transaction. Ordinary Lead saving cannot change
owner or pool visibility and direct application-role DML is revoked. Concurrent claims
have exactly one winner. Release/reassignment require a reason. Terminal Leads cannot
be claimed or released through pool operations.

Read roles follow existing Lead capability: SUPER_ADMIN, ADMIN, SALES_DIRECTOR,
SALES_MANAGER, SALES_SPECIALIST and SALES_SUPPORT. Writes/claim exclude SALES_SUPPORT.
Claim requires underlying Organization access. Release requires ownership or authorized
manager assignment scope. Visibility and reassign require existing manager roles/team
assignment capability; target owners must be active workspace members in Lead write
roles. Assignment grants no new Organization/Contact access. Private Lead reads retain
owner/team scope, while public Lead reads still require subject access.

Channel current stage remains `organization_business_profiles.partnership_stage`.
PROSPECT/CONTACTING/ACTIVE/PAUSED/ENDED remain legal, with additional explicit operational
values KEY_PERSON_ENGAGED, NEEDS_QUALIFIED, SOLUTION_PROPOSED, PARTNERSHIP_AGREED,
RECRUITMENT_ACTIVATED and ONGOING_ENABLEMENT. No legacy dates/stages are inferred or
backfilled. Human-confirmed updates and regressions append
`organization_channel_stage_history`; ordinary profile edits create no stage history.
The reason-bearing wrapper uses the existing Education mutation and its concurrency
lock, with revision, receipts, audit and CHANNEL_STAGE_CHANGED dispatch. History is
the operational funnel record; audit remains governance evidence.

The read-only security-invoker activation projection queries permission-filtered Lead,
Contact intelligence, Activity, Opportunity, Outreach Event and Enrollment Attribution
facts. Hidden Contact endpoints and activities referencing hidden Contacts are excluded.
It reports open/claimed Leads, key people/decision makers, current stage/time, active
Opportunities, noncancelled recruitment Events within 90 business days, distinct
PRIMARY/ASSIST Enrollment counts and next action. Sources remain visible in the UI.
An Event does not advance a stage; Enrollment Attribution does not settle Commission.
No revenue, settlement or ROI calculation is included.

Qualified Lead conversion extends the existing `lead_conversions` path. The UI explicitly
selects Product, optional matching Cohort, title and owner. It references the existing
Organization and never creates a copy. Legacy conversion callers remain supported by
defaulted new parameters; Lead GET retains its original camel-case fields alongside
the pool projection. Existing Household Leads stay private and retain lifecycle/privacy
behavior. Their privacy export includes Leads and assignment references once, scoped by
explicit Household membership. Contact cleanup does not erase staff assignment history
or Organization stage history. Lead removal clears its personal mutation receipts.

LEAD_CLAIMED, LEAD_RELEASED and CHANNEL_STAGE_CHANGED extend the existing Automation
catalog and existing TASK/NOTIFICATION actions; no new event bus or default rules are
seeded. Quality warnings are contextual: missing follow-up/key contact/account owner,
recruitment without key people, or solution without an active Opportunity. Low scores,
unknown tiers and Lead age do not automatically qualify/disqualify or change an account.

Frozen Phase 2 boundaries:

- Lead ≠ Assignment; Claim ≠ Qualification; Lead ≠ Organization.
- Organization ≠ Opportunity; Channel Stage ≠ Event / Enrollment / Commission.
- Event ≠ Student Conversion; Enrollment Attribution ≠ Revenue Attribution.
- Audit ≠ Operational Stage History; Public Pool ≠ Public Internet Access.

Lead imports are deferred: the existing Import catalog has no Lead resource. Open-Lead
deduplication beyond existing subject/pipeline identity requires a separate business
decision; no guessed uniqueness rule prevents valid future Leads or product deals.

## Phase 3 — Channel agreements and commission

Organization owns a logical Channel Agreement with independent integer versions and
explicit Rules. DRAFT terms are editable; activation freezes terms. New commercial
terms require a new version. No historical agreement-expiry hint is backfilled.
Rules explicitly select ALL_PRODUCTS / PRODUCT / COHORT, PRIMARY / ASSIST, and either
FIXED_PER_ENROLLMENT or PERCENT_OF_NET_COLLECTED. No Event or Referral relationship
infers a commission beneficiary: source_organization_id attribution is required.

Fixed obligations use the first matching canonical Enrollment ACTIVE / COMPLETED
history event. Percentage obligations use existing CONFIRMED / REFUNDED Payments;
completed refunds are PAID Refund records. Business dates use workspace timezone.
Receipt and refund dates must fall within the agreement period. Refunds correct earned
entries using the original rate even after agreement termination or settlement payment;
an out-of-period refund has no automatic commission consequence under V1 eligibility.
No Contract or Receivable amount implies collection. No FX is applied.

An exclusive Contract has exactly one ACTIVE Enrollment link. Shared Contract payment
sources return SHARED_CONTRACT_UNALLOCATED and cannot accrue percentage commission.
Mixed shared/exclusive coverage is evaluated per Contract; fixed obligations remain
independent of contract allocation. Historical accrued amounts preserve the allocation
context accepted at their source event; later link changes do not rewrite the ledger.

Commission Accrual is an append-only EARNED / REVERSAL ledger. Receipt earnings and
negative refund entries preserve exact numeric(14,2) snapshots and integer basis points.
The server calculates all amounts and locks/rechecks current canonical sources. Source
identity and actor-bound request receipts prevent duplicates. Normal source events have
atomic domain consequences; explicit per-source generation supports late configuration.
No cron repeatedly recalculates history, and Automation cannot choose monetary amounts.

Settlement has one Organization and currency. Draft lines reserve complete ledger
entries; concurrent reservation is protected by a partial unique index and transaction
lock. Approval requires positive net commission and freezes lines. PAID requires an
external reference and freezes the header. Reason-bearing Draft/Approved cancellation
releases reservations while retaining cancelled history. Paid cannot be cancelled in V1.
Mark Paid confirms an external payout; it never creates a customer Payment/Receivable.

Configuration uses existing catalog.manage roles SUPER_ADMIN / ADMIN / SALES_DIRECTOR.
Money reads additionally allow SALES_MANAGER, always with Organization access. Ordinary
BD roles receive agreement summaries with financial terms redacted. Eligibility also
checks Enrollment and Contract access; it never reveals hidden Student PII. Settlement
writes use existing finance.payment.record roles SUPER_ADMIN / ADMIN. No new capability
framework or external/portal exposure is introduced.

Student privacy export includes explicitly referenced accrual records via the established
worker. Purge clears Enrollment / Attribution / fixed-event personal references and
personal mutation receipts while preserving Agreement, Rule, financial ledger and
Settlement. No Student name, email, guardian or passport snapshot is stored in this domain.
Audit records references/actions; the ledger remains the authority for commission money.
COMMISSION_ACCRUAL_CREATED (including explicit REVERSAL entry type),
COMMISSION_SETTLEMENT_APPROVED and COMMISSION_SETTLEMENT_PAID reuse existing Automation
TASK / NOTIFICATION actions without seeded rules or external messages. Contextual quality
findings contain no amounts and do not change domain facts.

Frozen boundaries:

- Channel Agreement ≠ Customer Contract; Commission Rule ≠ Channel Profile.
- Enrollment Attribution ≠ Revenue Attribution; Commissionable Base ≠ Channel Revenue.
- Commission Accrual ≠ Settlement; Commission Settlement ≠ Customer Payment / Receivable.
- Shared Contract ≠ Revenue Allocation; Audit ≠ Commission Ledger.

Deferred: explicit Contract allocation / line items, revenue attribution, channel revenue
and ROI, cross-currency agreement conversion, partial settlements, paid correction,
out-of-period refund commercial policy, bank payout, accounting/tax/invoice generation,
Sales Targets, Management Intelligence, Documents and AI agreement parsing/recommendation.

## Phase 4: Channel analytics (read-only)

`channel_analytics(jsonb)` is a stable **security invoker** report over existing RLS
relations. It writes no facts and exposes only authenticated internal CRM data.
`lib/channel-analytics-repository.ts` and GET `/api/analytics/channels` (including the
Organization detail route) serve `/reports/channels` and the Account Performance summary.
Channel accounts are visible, nonarchived SCHOOL/PARTNER organizations or organizations
with SCHOOL_ENTRY/REFERRAL_PARTNER/TOUR_PARTNER business roles. Unknown tier and potential
remain NULL; unknown tiers have a separate bucket. Coverage includes only visible contacts.

Each response separates `snapshot`, `period`, applied `filters`, `permissions` and
`currencies`. Snapshot metrics describe current ownership, lifecycle, stage, opportunities
and enrollment status regardless of the selected period. Period dates are inclusive
workspace business dates, converted to half-open timestamp bounds in the workspace timezone:

| Metric | Canonical source / date |
| --- | --- |
| Claims, releases, reassignments | Lead assignment history / changed_at |
| Real stage changes | Channel stage history / changed_at; initial history excluded |
| Won/lost opportunities | Opportunity stage / closed_at |
| Held/cancelled events | Explicit COMPLETED/CANCELLED event / starts_on |
| Upcoming events | CONFIRMED event / starts_on on or after business today |
| New attributed enrollments | Enrollment created_at, not attribution creation |
| Current ACTIVE enrollment | Exact current ACTIVE status |
| Commission period | Immutable accrual ledger / accrued_at |
| Approved or paid settlement activity | approved_at or paid_at respectively |

PRIMARY and ASSIST are separately named contributions, never a summed student total.
Enrollment IDs are distinct per account/status; global distinct and ACTIVE counts are
also deduplicated across visible accounts. Explicit `source_event_id` is necessary for
event-attributed counts. Independent aggregates prevent Opportunity/Event joins from
multiplying enrollments or ledger amounts. No inference from proximity or event attendance.

Product/cohort filters select accounts having a matching visible Opportunity, Outreach
Event, attributed Enrollment or ledger Enrollment context. Product-linked metrics then
use that scope; account coverage, Lead and stage metrics remain account-wide. The Owner
filter is the Organization owner. Settlement counts/amounts cover matching ledger lines,
not unrelated lines in the same settlement. Privacy-erased context is never reconstructed:
unfiltered retained financial history remains included, while product-filtered history
without an accessible Enrollment context cannot be attributed to that product.

Commission analytics reads **commission_accruals**, not Payments minus Refunds multiplied
by today's rules. Reversals are counted once. Current open exposure is the sum of entries
without a reserved settlement line. DRAFT, APPROVED and PAID reservations exclude entries
from open exposure; CANCELLED history releases reservations. Settlement reporting reads
headers and lines, including retained cancellation history. All monetary sums happen in
PostgreSQL numeric and return decimal strings grouped by currency. No FX or combined total.
Empty Draft/Cancelled headers count with zero amount without a product filter. Forward
102 corrects that boundary without modifying frozen 101. A product/cohort-filtered report
requires a matching ledger line, so it excludes empty batches with no product context.
Money visibility reuses Phase 3 roles and Organization access; other roles get empty money
arrays and explicit redaction. Student PII, sensitive narratives and hidden subject counts
are absent. Account quality summaries use only a narrow current-visible account-rule set;
cached contact/enrollment findings are excluded to avoid indirect visibility leaks.

Pagination returns 50 accounts per page, with full permission-filtered summary totals.
Sorts are explicit name, primary contributions, ACTIVE enrollments or human-confirmed tier;
no black-box ranking or Account Score. The bounded PostgreSQL fixture exercises the real
query plan; existing indexes suffice for that tested workload, without speculative indexes.

Final boundaries: Organization ≠ Opportunity; Lead ≠ Assignment; Claim ≠ Qualification;
Channel Stage ≠ Event / Enrollment / Commission; Event ≠ Student Conversion;
Enrollment Attribution ≠ Revenue Attribution; Channel Agreement ≠ Customer Contract;
Commissionable Base ≠ Channel Revenue; Commission Accrual ≠ Settlement;
Settlement ≠ Customer Payment; Shared Contract ≠ Allocated Revenue;
Audit ≠ Operational Stage History / Commission Ledger; Analytics ≠ Business Fact;
Commercial Tier ≠ Performance Score; AI inference ≠ Business Fact.

Deferred: claim-to-qualification duration (no reliable lifecycle history), cohort-defined
conversion rates, report CSV export (existing export resources do not cover this projection),
optional trends, revenue attribution, Channel Revenue/ROI, contract allocation, FX,
partial settlement, bank payout, accounting, Sales Targets, Management Intelligence,
AI and automated research/scraping. No production templates or rules are seeded.
