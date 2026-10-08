# v3.34.0 verification

## Baseline and scope

Opening checkpoint: `0af04c7aec3a534b38b726a768ce680548d609cf`, version 3.33.0,
migration 123, 128 SQL files. The audit and plan were saved before implementation.
The final release candidate is 3.34.0, migration 124, 129 SQL files. No staging, commit,
push, deployment or Production access is authorized or performed for this task.

Private opening evidence, logs and browser screenshots remain in ignored `work/v334/`
and `work/browser-qa-chromium-1243/`. All 165 protected opening fingerprints, including
128 historical SQL files and historical Revenue artifacts, remain unchanged.

## Implementation and acceptance

| Acceptance question | Answer and evidence |
| --- | --- |
| Can Organization activity distinguish event types without full-card color? | YES. `app/workspace-density.css` uses neutral cards, accent rails, icons and text; desktop/mobile activity browser checks. |
| Is the Lead row materially shorter? | YES. Compact desktop grid, one action row and collapsed qualification strip; three-width browser checks. |
| Does Revenue unconfigured state avoid a blank viewport? | YES. `components/revenue-workspace.tsx` renders bounded configuration/authority states and a separate configured-empty queue. No provisioning command added. |
| Is Channel Agreement understandable before document forms? | YES. `components/channel-agreements-panel.tsx` defaults to Overview; rules, documents, settlement and history have separate sections. |
| Can a many-step template be edited one step at a time? | YES. `components/workflow-template-editor.tsx`; one selected editor, step navigator, keyboard reorder, add/remove, blank/preset switching, inherited titles and advanced override tested. |
| Are Contact Commercial and Follow-up views compact and readable? | YES. Summary grids, muted unknown values, collapsible editing and neutral timeline styling; dedicated browser captures. |
| Does communication consent grant Contact visibility? | NO. PostgreSQL grant-without-share and queued-delivery tests deny access. |
| Does visibility grant communication consent? | NO. Explicit READ share leaves `contact_channel_allowed` false without a grant. |
| Can a manager read subordinate-owned Contacts? | YES, through the actual reporting chain within one active canonical department/team, including indirect ancestors. |
| Can a subordinate read manager-owned Contacts by default? | NO. PostgreSQL downward-access denial. |
| Can peers read one another's private Contacts by default? | NO. PostgreSQL peer denial and explicit share/revoke tests. |
| Is this server enforced? | YES. Migration 124 predicates, restrictive RLS, scoped security-definer projections and export/queued-delivery guards; disposable SQL adversarial tests. |
| Are parent details stored per person/member? | YES. Canonical Contacts hold occupation/employer/title; Household membership holds relationship/primary flag. Atomic three-person creation and independent edit tests. |
| Are Outcomes hierarchy and empty states improved? | YES. `SuccessOutcomesPanel` uses a section heading, compact empty state and no first-page empty pagination. |
| Are Revenue/Commission financial semantics unchanged? | YES. No financial migration is edited; current-schema compatibility suites and Finance/Commission regressions pass. |
| Are uncertain-write and refresh-only guarantees preserved? | YES. Browser exact-byte uncertain family retry; template, consent and role accepted-refresh recovery without repeated mutations; DB receipts and conflicts. |
| Can ADMIN grant ADMIN/SUPER_ADMIN or change privileged users? | NO. Current membership is locked and checked in `change_staff_role`; direct SQL tests. |
| Can SUPER_ADMIN change administrator roles? | YES, with AAL2, audit, receipt, concurrency and last-active-super-admin protection. |

## Contact governance and linked records

`contact_actor_access` is the single Contact-specific predicate. Ownership and explicit user READ/EDIT
shares are authoritative. Management visibility follows `sales_team_members.manager_member_id` and
carries one fixed ACTIVE `sales_teams` identity through the entire chain. A higher title, unrelated
team membership or overlapping multi-team chain does not manufacture access. Missing relationships
fail closed; no hierarchy or legacy owner is guessed during migration.

The user's final governance supplements supersede the initial no-admin-bypass proposal: ADMIN may
read employee-owned Contacts, but not another ADMIN/SUPER_ADMIN's records merely through role.
SUPER_ADMIN has full Contact read/edit/share within the active workspace. Management/ADMIN read
alone does not grant editing; editing additionally requires the existing capability and an editing
relationship. Role membership does not grant Revenue business designation.

Contact tables, student/person joins, household members, linked activities/tasks/appointments,
communication threads/messages, consent reads, organization timeline/duplicate projections and
linked audit snapshots use the Contact boundary. Security-definer readers use explicitly filtered
Contacts. Worker exports filter rows for the requesting actor, not the worker's privileges. Queued
outbound delivery rechecks sender access and consent. Source-private bodies are not exposed by a
share summary. Direct Contact collaborator writes are blocked; governed sharing is audited and
receipt protected. API authorization remains an additional boundary.

Consent remains a current permission projection plus newly appended decision events. No invented
historical event backfill occurs. DND changes do not rewrite decision history. New person fields are
cleared by the existing controlled privacy-deletion marker; retained consent/audit evidence follows
the existing restricted historical-evidence model. This is not a new legal retention certification.

## Family, workflow and staff reliability

`create_household_with_people` commits Household, independent canonical people, memberships,
audit and receipt together. It supports up to ten people, at most one primary member and no automatic
guardian authorization. Partial person details without a name cannot silently disappear in the form.
`save_household_person` uses the exact person revision timestamp and receipt identity. Legacy
unattributed household occupation fields are preserved, not guessed or copied onto arbitrary parents.

Workflow editing changes presentation and normalizes an empty task-title override to its step title.
The existing Task owner, template activation/freeze and next-version behavior are unchanged. The
real PostgreSQL workflow suite verifies frozen versions and runtime Tasks/Milestones/checkpoints.

Staff role changes are purpose-specific, AAL2 protected and atomic. Current actor/target memberships
are locked after a workspace identity advisory lock; authority and expected role are rechecked under
lock. Audit failure rolls back both change and receipt. Competing changes cannot silently overwrite
one another. Status changes use a compatible lock and no longer write a stale role snapshot. Existing
sessions are revoked after a role change. UI options are conveniences, not the security boundary.

## Verification matrix

| Check | Result / boundary |
| --- | --- |
| `test-v334-contact-access-postgres.mjs` | PASS: owner/direct/indirect manager, peer/downward denial, ADMIN/SUPER_ADMIN, share/revoke, changed owner/manager, foreign workspace, duplicate/organization projection, consent separation, worker delivery/export, linked audit filtering, privacy field cleanup, three people and independent edits. Includes shared Finance/Commission fixture regressions. |
| `test-v334-staff-roles-postgres.mjs` | PASS: allowed/denied transitions, AAL1, stale role, revoked actor, cross-workspace, last Super Admin, exact retry/conflict, concurrent role changes, audit rollback and revoked sessions. |
| `test:operations:postgres` | PASS: existing identity, numbering, Pipeline and finance regressions. |
| `test-admissions-workflows-postgres.mjs` | PASS using `WORKFLOW_TEST_POSTGRES_IMAGE=postgres:18.4-bookworm`: immutable templates, tasks/milestones, sequential progression, concurrent retry/revision, rollback, RLS and privacy. |
| `test-revenue-v334-current-postgres.mjs` | PASS: eight current-compatible upgrade/foundation/fulfillment/candidate/correction/integrated/workspace/commission suites. |
| Standard contracts | PASS: 305 main plus 8 CAPTCHA tests, 313 total; role matrix included in standard command. |
| Typecheck / lint / build | PASS; final 3.34.0 typecheck, metadata validation and build also passed. |
| Public privacy | PASS: 13 tests. |
| Migration inventory | PASS: head 124 / 129 SQL files. All 128 opening SQL bytes unchanged. |
| Pinned browser | PASS: 37 page/viewport checks, Chromium revision 1243, actual version 153.0.8010.12. |
| Whitespace / staging | `git diff --check` PASS; staging EMPTY. |

Database suites use independently fictional data, random disposable containers/credentials, tmpfs,
loopback ports and cleanup, never the configured application database. PostgreSQL 18.4-bookworm
was actually run; the initially requested workflow 18.6-trixie image was unavailable. No 18.6 claim.

Browser checks use actual React components and production CSS with intercepted fictional APIs.
They are not browser-to-database E2E or proof of DB authorization. Security is verified independently
against PostgreSQL. The affected phase covers desktop 1440, tablet 768, mobile 390, activity,
Leads, agreement, Revenue no-configuration/no-designation/configured-empty, Outcomes data/empty,
selected steps/reorder/advanced/title inheritance/add/remove/blank draft, three guardians, Contact
commercial/follow-up/access/consent, manager read-only, grant/withdraw, English, keyboard and recovery.
Role editor checks verify four ADMIN options, six SUPER_ADMIN options and refresh-only recovery.
No full ten-phase browser campaign was run.

## Historical compatibility

The unchanged historical fulfillment fixture used peer ADMIN actors without explicit Contact sharing.
Under the newly requested privacy model its Enrollment evidence correctly becomes inaccessible.
The additive `test-revenue-fulfillment-v334-compat-postgres.mjs` first proves that denial, then has
the owner explicitly share the synthetic Contact with the independent verifiers. It runs the original
financial assertions without rewriting the historical file. The v334 current-schema entry uses this
compatibility adapter and preserves original fingerprints. Historical Revenue stage-only absence
assertions and historical versions remain unchanged; they are not relabeled current failures or PASS.

## Prior-plan omission review

The final review compared `FIRST_PRINCIPLES_PLAN_V333.md`, `V333_VERIFICATION.md`,
`OPERATIONS_USABILITY_VERIFICATION.md` and the current v334 plan with implementation/test entries.
The preceding sixteen-item repair remains implemented: import alignment/localized headers,
editable presets, merged navigation, operations grouping, overview diagnostics/charts, archived
Pipeline parity, product draft copying, direct student/parent creation, institution-head classification,
automatic new identifiers, Lead/quick-link/organization layout and shared account pagination.
Current standard contracts and scoped operations PostgreSQL provide regression evidence; this does
not claim to have rerun every historical screenshot or compare an unavailable external Demo.

The review filled these concrete gaps in current scope:

- Added the requested staff-role UI and database mutation instead of relying on a stale permission read.
- Added linked-contact audit filtering and privacy cleanup of new person fields.
- Prevented silent omission of partially entered family members.
- Hid standalone consent mutation controls from read-only actors.
- Added blank/add/remove template browser assertions and explicit role recovery coverage.
- Kept historical Revenue tests intact and supplied a governed current-schema compatibility entry.

No unresolved implementation omission was identified in this bounded plan comparison. Operational
limitations below remain explicit rather than being disguised as complete features.

## Operational limitations and release

Hierarchy reads require existing canonical manager and active department membership records.
There is no inferred title hierarchy or automatic legacy sharing backfill. This release exposes explicit
user sharing, not optional TEAM/WORKSPACE visibility scopes or a new hierarchy administration system.
Initial Revenue provisioning and tenant business authorities remain controlled. Consent event history
starts at this migration; current legacy grants remain visible without fabricated prior events.
Uncertain request retention lasts while the editor is mounted, not across devices/browser restarts.

Migration 124 must accompany this application release through the normal deployment workflow.
No application/Production database was changed. Canonical versions are promoted only after the
implementation gates pass; public release notes are `RELEASE_V3.34.0.md`. Financial owners and
Revenue/Commission accounting semantics remain unchanged.

Staging: **EMPTY**. Commit: **NOT RUN**. Push: **NOT RUN**. Deploy: **NOT RUN**. Production: **NONE**.

Verdict: `LUMINA_CRM_V3_34_0_UI_ACCESS_REDESIGN_READY`.

## Build cache retention supplement

The user additionally requested 24-hour automated build-cache retention. The environment example,
post-deployment cleanup fallback, storage-maintenance fallback and checked-in BuildKit GC policy
now agree on `LUMINA_BUILDKIT_CACHE_RETENTION_HOURS=24` and
`LUMINA_BUILDKIT_CACHE_MAX_AGE=24h`. Existing scoped automatic cleanup remains enabled;
no actual Docker cleanup, deployment or remote environment change is performed by this task.

Build-cache supplement verification: 9 targeted cleanup/BuildKit tests PASS; changed script lint PASS.
Final public privacy: 13 PASS; release metadata and staff-role contracts: 3 PASS.
