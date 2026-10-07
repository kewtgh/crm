# Operational usability follow-up audit

Baseline: main, v3.28.1, migration 113. This is a follow-up to the v3.26 repair plan,
v3.27 workflow plan and v3.28 architecture/implementation reports. Examples are synthetic.
Production data, screenshots and credentials are outside the audit and implementation scope.

## Confirmed gaps in previous completion claims

| Finding | Evidence and consequence | Integrated correction |
|---|---|---|
| Deletion was implemented unevenly | Several resource editors had no removal; Lead ownership actions did not include deletion. | Review the resource inventory, add recoverable cleanup across 44 kinds and contextual actions on daily surfaces. |
| Optimistic timestamp precision was lost | PostgreSQL microseconds became JavaScript millisecond dates before returning an update token. A valid snapshot could fail deletion. | Preserve timestamp text in table reads; refresh edit snapshots; retain true stale-version rejection. |
| Shared filtering did not finish migrating consumers | Organizations combined filters; Contacts had five competing controls; Enrollment/Application/Support exposed large forms. The no-search FilterBar branch did not render primary controls. | One shared presentation contract, compact labels/controls, primary filters and applied advanced drafts. |
| Shared row and selector styles created layout gaps | Desktop selector margins displaced filter controls; mobile rows retained a 180px flex basis; row action containers inherited a vertical grid. | Fix shared rules and verify control alignment, compact heights, record position and action layout in real rendered pages. |
| Similar surfaces obscured section purpose | Operational scope, analysis facts and finance detail used similar backgrounds. | Add restrained purpose-based tints and edge accents; retain explicit headings, status labels and the existing warning palette. |
| Student/Family directories lacked useful selectors | Search alone did not offer academic scope or family status. | Server-filter Student grade/year before paging and counts; expose existing Household status filtering. |
| Manual progression was batch-oriented | The annual scheduler existed, but individual correction lacked a direct searchable entry. | Add a short Student selection/correction task using the existing full update contract. |
| Secondary Account utilities took excessive space | Privacy and completeness used separate full-width surfaces. | Compact accessible secondary rail, retaining both functions and adding direct authorized deletion. |
| Commission workspace lacked ledger scope | A large Organization selector preceded agreements, eligibility and ledger content. | Compact Organization/currency/status scope; UTC date range applies to server ledger queries. Settlement candidate queries remain independent. |
| Channel analysis and Imports exposed secondary controls first | Nine scope inputs and detailed mapping forms dominated normal entry. | Draft scope drawer and disclosed distributions; human workflow navigation and optional mapping disclosure. |
| Household portal competed as a primary destination | Utility communication work appeared as an independent product entry. | Nest it under Self-service communications, preserving capability gates and URLs. |

## Deletion inventory and business meaning

The typed allowlist in `lib/record-deletion-contract.ts` is the authoritative implementation
inventory. It includes Organization, Contact, Student, Household, Task, Product, Lead,
Opportunity, Contract, Enrollment, Application, Support Case/Goal/Check-in/Risk/Intervention,
Organization Profile, Family Need, Pathway, Outreach Event, Referral, Event Participation,
Academic Record, Cohort, Bundle, Quote, Campaign, Admission Journey, Milestone, Workflow
Template, Appointment, Exchange Rate, Admission Outcome, Contact Intelligence/Relationship,
Follow-up Plan/Entry, Activity, Import Batch/Mapping/Set, Product Price and Channel
Agreement/Version.

Recoverable deletion removes a record from current operational reads; it does not blindly
delete linked domains. The existing recycle bin restores records under SUPER_ADMIN and AAL2.
Active references and protected states return explicit reasons. Unused channel drafts can be
removed; active/earned agreement terms retain their formal status transitions. Appointments
are cancelled first and workflow templates must be inactive and unused.

Other removal owners remain explicit:

| Content | Existing removal/correction owner |
|---|---|
| Household members, guardian associations and record collaborators | Canonical relation removal/revocation, without inferring legal authority. |
| Saved views and editable draft child items | Existing delete/remove actions in their owning editors. |
| Communication templates, portal invitations and user access | Existing archive, revoke or disable workflows. |
| Executed imports | Bounded rollback; executing/completed evidence is protected from ordinary cleanup. |
| Confirmed payments, refunds, receivables, commission accruals and paid settlements | Financial cancellation/refund/reversal/settlement contracts; no ledger erasure or reassignment of historical facts. |
| Generated/uploaded contract evidence | Existing document governance/privacy erasure workflow; deleting a business record is not a storage-erasure request. |
| Audit events, mutation receipts, assignment/status history and security evidence | Retained system history, rather than user-editable business records. |

The cleanup workspace gives every allowlisted kind a searchable, paged removal entry even
where a low-frequency owning screen lacks a contextual button. It uses existing capabilities
and record authority, not a new permission taxonomy. It does not promise physical erasure of
historical evidence or unrestricted deletion of financial facts.

## Previous plans reconciled

The September 1 progression scheduler, workspace timezone, manual correction policy,
revision controls, accepted-save/failed-refresh distinction, global Student/Family navigation,
and management PERIOD/SNAPSHOT/currency boundaries remain implemented. This follow-up closes
the incomplete operational affordances above instead of rebuilding those domains.

Policy-dependent roadmap items remain separate: Revenue specifications, Activity bilingual
API relaxation, external provider integrations, identity matching/merge policy, offline
operation and a bulk-destructive workflow. Their appearance in earlier recommendations does
not supply a missing business/security contract. No new scoring, forecasting or financial
interpretation is introduced.

Verification and completion evidence are recorded in `V329_OPERATIONS_VERIFICATION.md`.
