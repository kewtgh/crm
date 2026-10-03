# Cohort and Enrollment architecture contract

Phases 1–4 implement **Product → Cohort → Enrollment**, attribution, commercial links
and derived operational projections.
Product defines the enduring offering;
Cohort identifies one recruitment and delivery cycle of that product.

Frozen boundaries:

- Product ≠ Cohort
- Student ≠ Enrollment
- Enrollment ≠ Application
- Opportunity ≠ Enrollment
- Event ≠ Enrollment
- Referral ≠ Enrollment
- Event Participation ≠ Enrollment
- Contract ≠ Enrollment
- Payment ≠ Enrollment
- Contract ≠ Payment
- Receivable ≠ Payment
- Enrollment ≠ Finance State

Reuse existing `products`, `product_prices`, `students`, households, opportunities,
contracts, receivables and payments. Do not duplicate their facts in Cohort.
`product_cohorts` is a new workspace-scoped entity. Its product is immutable;
cancel and recreate a cohort assigned to the wrong product. `CANCELLED` replaces
normal deletion, and product references restrict physical product removal.

Enrollment (Student × Cohort) is implemented by forward-only migration 092.
Cohort exposes `(workspace_id,id)` for those references. No Application,
milestone, commission or Student Success entities are introduced here.
`admission_journeys` remains compatible and is not removed.
`student_application_tasks` retains its existing student preparation-checklist meaning.
Historical names or free text never automatically infer cohorts or enrollments.
AI inference is not a business fact; only explicitly validated domain records establish facts.

Read access follows existing Product membership RLS. Writes follow `catalog.manage`:
SUPER_ADMIN, ADMIN and SALES_DIRECTOR, with AAL2, enforced again inside the RPC.
SALES_MANAGER does not gain catalog mutation permission in this phase.
The only application write entry is `save_product_cohort`: strict revision check,
immutable product, request receipt scoped to workspace and actor/payload, atomic audit.
Dates may be unknown; every pair of known dates must retain chronological order.
Target and capacity are nonnegative, with target ≤ capacity when both are known.
Currency follows the existing Product price three-uppercase-letter constraint.

Indexes serve product lists ordered by start date and optional status filtering.
Workspace-wide start/deadline and owner/status indexes are deferred until those
queries exist; there is no speculative dashboard or copied finance aggregate.

Enrollment identity is unique within a workspace and immutable after creation.
Reuse existing Students; one Student may join multiple Cohorts. Household is the
enrollment's historical business context, not a synchronized copy of the Student's
current household. Opportunity is optional and may originate many enrollments;
its product must match, and its cohort, when specified, must match.

All six existing `education.manage` roles may create/edit within Student access
and Enrollment owner/team scopes. Assignment reuses `can_assign_crm_task` and
requires active workspace membership. Source permissions inherit Enrollment access
and individually reuse Customer/Education authorization. One PRIMARY and multiple
ASSIST attributions refer to real existing organizations, contacts, education
outreach events, growth campaigns and education family referrals. Attribution is
additive in this phase; there is no normal delete or source-rewrite endpoint.
`lead_attribution_touches` retains its separate acquisition meaning.

New enrollments are allowed in DRAFT, RECRUITING and ACTIVE cohorts. CLOSED,
COMPLETED and CANCELLED accept no new records; existing enrollments remain editable.
Capacity is not enforced against enrollment counts. No complex transition graph
or admission/finance states are introduced.

**Enrollment status history is the canonical operational funnel history;
audit_events remains governance evidence.** Initial and changed statuses are
written atomically, with timestamp, actor, enrollment revision and optional reason.
History is append-only for business users; ordinary edits do not add stage facts.
Audit stores governance metadata, without names, notes or student profiles.
Privacy export includes enrollments, history and attribution. Identity deletion
and physical Student cleanup erase these personal business rows and their mutation
receipts; source-contact deletion also erases its attribution context. No existing
financial record is deleted. Deletion is a dedicated privacy/maintenance exception
to normal append-only history, not a business endpoint.

Migration 093 adds **Opportunity → Cohort**, **Event → Campaign / Product / Cohort**,
**Quote → Cohort**, and **Contract ↔ Enrollment**. A specified cohort requires its
product, enforced with workspace/product/cohort composite foreign keys. No text
backfill infers historical cohorts. Event campaigns remain independent; generic
events are valid attribution sources. Explicit event product/cohort context must
match attributed enrollments, including subsequent edits to either side.

Contract links are many-to-many relations, not Enrollment or Finance state. Active
pairs are unique; unlinking requires a reason and retains an immutable history row.
Relinking creates a new row. The contract's single product must match; household
buyers match a known Enrollment household context, while organization buyers do not
require that household. Null historical household context remains allowed. Future
multi-product bundles need contract items; relaxing today's product check is not
bundle support. Link/unlink follows existing `contracts.manage` roles (SUPER_ADMIN,
ADMIN, SALES_DIRECTOR, SALES_MANAGER, SALES_SPECIALIST), with access to both the
contract and Enrollment. SALES_SUPPORT retains its Education permissions without
acquiring contract mutation permission.

Existing Opportunity/Event/Quote saves retain their domain authorization and audit.
Opportunity and Quote commercial edits add strict revisions and mutation receipts;
Event reuses its existing revision/retry contract. Relation RPCs share a short
workspace transaction lock to prevent concurrent edits invalidating references.
Selectors retain historical cohorts and require explicit clearing/reselection after
product changes. Suggested new cohorts vary by domain, without database status gates.
Quote conversion preserves `contracts.quote_id` and the original quote's cohort;
Contract does not duplicate a cohort or gain a single enrollment foreign key.
Privacy export includes link history; Student identity erasure removes Enrollment
relations and receipts, while contracts and their financial/legal facts remain.
No new receivable/payment/refund links or financial fact tables exist.

Migration 094 makes operational projections available in the existing domains.
**Enrollment Finance is a projection, not duplicated state. Contract-level financial
facts remain authoritative. Shared contracts are not automatically allocated across
Enrollments. Currency values are never implicitly combined.** ACTIVE links determine
current coverage; historical UNLINKED rows remain commercial history. Exactly one
ACTIVE Enrollment link makes a contract EXCLUSIVE. Count every link, including ones
outside the caller's Student scope, without disclosing other Student identities.
Shared contracts are displayed at contract level and excluded from exclusive totals.
Mixed coverage is PARTIAL_UNALLOCATED; hidden finance prevents a complete allocation
claim. Enrollment and Contract/Finance authorization both apply.

Collected means net CONFIRMED/REFUNDED payment receipts, using the existing
`refunded_amount` fact after completed refunds. Receivable/outstanding come from
installment amount/paid_amount; overdue is unpaid scheduled amount before the local
business date, including partially paid overdue installments. Without a schedule,
scheduled exposure is zero and explicitly does not describe the whole contract balance.
Future allocation requires contract items or explicit contract enrollment allocations.

Imports extend the existing batch preview, repair, bounded processing and rollback.
Product code, workspace-unique Cohort code and Student Number resolve identities.
**Import never infers Student identity from names alone.** Missing, unauthorized or
duplicate identities fail the row; importing does not create Products or Students.
New resources are create-only. Rollback cancels unchanged created records, preserving
domain history, and rejects downstream dependencies. Student privacy cleanup erases
personal import sources; Contract retention remains unchanged.

Cohort snapshots count visible Enrollment records by lifecycle status. totalRecords
includes terminal records; currentOpen is LEAD + INTERESTED + REGISTERING + ACTIVE.
Organization attribution snapshots use explicit `source_organization_id` and count
distinct PRIMARY, ASSIST and ACTIVE Enrollments per product/cohort; they do not infer
organizations from Event/Referral context or attribute revenue. Quality checks are
contextual LOW/MEDIUM warnings, not additional enrollment/contract constraints.
Status-history inserts dispatch Enrollment automation events atomically; ordinary
edits do not create status events. **Automation events do not replace domain history.**
Existing TASK/NOTIFICATION actions and execution/retry identities are reused. Deadline
events use workspace business dates and user-configured daysUntilDeadline conditions,
with one event per cohort/deadline/day-distance. No default reminder thresholds are added.

Future direction: Product → Cohort → Enrollment → Application → Milestones,
connected to existing Contract/Finance and Student Success. Event/Referral attribution
will reference Enrollment separately; neither object becomes Enrollment itself.
