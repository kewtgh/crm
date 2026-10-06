# Product and workflow audit — 3.27

Baseline: main at 7f2058e1b11367e4ad55981f0ca9c477becc6d9e, version 3.26.0.
Scope: bounded source/flow review of the shell, dashboard/action center, organization/contact,
student/family, product/cohort/enrollment, shared controls and relevant canonical boundaries.
This is not a production penetration test or a claim that every repository subsystem is defect-free.

## Business model

Staff work starts with a person or organization, their need, an agreed offering, participation and
service delivery. The UI should preserve that context instead of asking staff to reselect identities.
Contact, Household, Student, Product, Cohort, Enrollment and Contract remain distinct facts.
Read views must not become alternate mutation owners. Financial collection does not imply Revenue.
Permissions remain enforced by the owning API/database, even when a shortcut is visible.

## Findings and executable improvements

| ID | Finding and evidence | Impact | Resolution |
|---|---|---|---|
| UX-01 | AccessibleDrawer independently handles Escape; nested drawers do not isolate background dialogs (components/ui.tsx) | Multiple windows may close; focus may escape | Portal-based modal stacking, background inert state, topmost Escape; regression with nested editors |
| UX-02 | Editing drawers close without warning when fields changed | Accidental loss of staff work | Opt-in unsaved form guard for contact, contract and enrollment editors; explicit discard/keep editing |
| UX-03 | StudentEnrollmentsSection and CohortParticipants mainly link to another workspace | Identity must be selected again | Contextual enrollment creation through the existing EnrollmentEditor and canonical mutation |
| UX-04 | EnrollmentEditor awaits post-save refresh without recovery | Successful write can leave a stuck busy editor | Separate committed save from refresh failure; do not repeat the mutation |
| UX-05 | Student directory loads can race; cohort participant pagination retains stale content | Wrong search/page can appear | Latest-request sequencing and explicit loading/error states |
| UX-06 | Shell omits student-support active navigation; related picker can display a raw UUID | Confusing context and technical identifiers | Correct active family navigation and neutral selected-record label |
| UX-07 | Filters have no consistent visible reset action | Users can overlook active filters | Shared active-count/reset control; contact and organization filters use it |
| UX-08 | Dashboard contains many counters but no concise task-oriented starting point | Navigation learning cost | Capability-filtered workflow launchpad with concise next-step descriptions |
| UX-09 | Action center sums overlapping categories and renders an old snapshot without refresh | Sum can be mistaken for distinct work; stale priorities | Explicit overlapping-count semantics, freshness time and manual refresh of the existing server read model |
| UX-10 | Dense controls/cards lack a consistent interaction hierarchy | Visual noise and mobile scanning cost | Shared spacing, cards, focus treatment and reduced-motion support; affected browser verification |

## Architecture assessment

Existing canonical mutations, permission checks, revision/receipt boundaries and domain separation
are reusable. This iteration needs no new schema or parallel workflow engine. UI context should be
passed as a preselection, never treated as authorization. No stored PII, record names or form drafts
will be added to browser persistent storage. New shortcuts must not bypass permissions or business
state transitions. Audit/finance/enrollment history remains owned by existing domains.

## Suggestions requiring separate policy or scope

- Revenue, margin and staff compensation: unresolved finance/accounting policies; not approved here.
- Customer/guardian self-service changes: consent, access and service ownership decisions first.
- Automatic identity merge or inferred guardian authority: unsafe without explicit governed rules.
- New messaging providers and outbound automation: external service/communication authorization first.
- Offline editing and bulk destructive actions: conflict, retention and recovery design required.

These are recorded as future decisions, not advertised as implemented features. Existing Revenue
candidate files remain uncommitted. Only independently fictional fixtures enter public Git.

## Additional confirmed architecture findings

- UX-11: dashboard_snapshot and optional growth statistics were coupled by Promise.all. A failed
  growth read blanked otherwise usable work. Isolate that read and explicitly mark its data
  unavailable; omit affected cards/signals rather than presenting missing data as a successful zero.
- UX-12: growth-workspace computed ROI from won opportunity value minus planned budget. Those
  are neither recognized Revenue nor actual cost. Remove this misleading derived metric and label
  opportunity value correctly. No new financial interpretation or Revenue calculation is introduced.

Inspected boundaries include the CRM layout's authentication/AAL gate, capability-filtered
navigation, action-center aggregation, canonical enrollment schemas and the documented commercial,
management and enrollment contracts. Existing broad database/domain behavior is not re-audited here.

Frontline and management workflows have equal priority. The dashboard presents equally prominent
Daily operations and Management & improvement switches. Management links reuse the formal
executive overview, channel reporting and team performance views, with import/data-quality tools.
These links do not grant permissions, create Revenue metrics or infer employee compensation.
