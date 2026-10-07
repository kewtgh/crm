# Core workspace UI redesign — v3.30.0

## Baseline and scope

Opening branch: `main`. Opening HEAD: `0ba1157b90b9e1ba13d260ed7aa66ee1665d6b76`.
Opening version: `3.29.0`; final candidate version: `3.30.0`, promoted following the user's
explicit follow-up authorization. Migration head: `114`, with 119 SQL files. Opening staging
was empty and the tracked worktree was clean. The ten untracked Revenue historical/R1 files
are preserved separately; opening byte fingerprints are retained in ignored private evidence.

This phase changes presentation and interactions on the requested workspaces. The four private
reference images guide information grouping and action placement; their identities and private
content are not copied into fixtures or public documentation. Existing shell, palette and domain
owners remain authoritative.

## Findings and implemented plan

| Confirmed issue | Implemented correction |
|---|---|
| Duplicate record identity and independent governance strips | One RecordHeader; privacy/completeness and destructive actions move to More |
| Account facts spread across nested panels | Overview main column plus business-context rail; bounded related records and recent activity |
| Channel information shown as a long sequence | Cooperation/progress first, then product/cohort and school context; secondary details disclosed |
| Contact identity mixed with privacy editing | Single Contact Workspace with compact profile, relationships and follow-ups; explicit consent summary in rail |
| Student context required traversing domain sections | Overview composes participation/application tables, support summaries, family context and actual query totals |
| Contextual create controls stretched to page width | Inline action wrappers and shared SectionHeader keep Contact/Opportunity toolbars compact |
| Product actions used a separate disclosure consumer | Shared MoreActions retains original permission and confirmation owners |
| Academic correction showed only a selector | Actual selected Student identity, grade and academic year appear before editing |
| Import workspace had duplicated navigation | One mounted DetailTabs selector preserves End/Home focus while switching content |
| Mobile record header rules were overridden | Semantic responsive rules follow their base definitions; actions and identity wrap safely |
| Icon presentation lacked a shared vocabulary | Decorative Lucide registry, common sizes/stroke and semantic tones; text remains authoritative |

Implementation followed shared header/action/card work, Organization Overview and Channel composition,
Contact and Student workspaces, bounded operational cleanup, then responsive and keyboard verification.
Screenshot review also corrected stretched Contact creation, wrapped Opportunity actions, broken table
detail links and academic-correction heading alignment. Existing Lead Queue hierarchy was reviewed and
preserved rather than replaced with another action engine.

## Organization Account

The six local sections remain Overview, People, Opportunities, Contracts & Products, Channels & Outreach
and Activity. The header has one current-locale identity, alternate identity, status, owner/location/course
context, record-activity action, edit and More. Privacy requests remain reachable for permitted users;
completeness stays a secondary data-quality signal.

Overview main column contains current opportunities and linked contracts, compact Organization profile,
recorded background and recent follow-ups. The rail contains owner, latest recorded interaction and next
step, visible-record facts, an existing follow-up plan and quick navigation. Currencies stay explicit and
separate. Counts from bounded CustomerOperations lists are labelled currently visible records and retain
the existing limited-result warning; they are not presented as universal business totals.

People retains the existing contextual Contact create/edit entry and record list. Opportunity actions form
a compact toolbar above the existing authorized summary. Related lists use dividers instead of another
layer of bordered cards.

Channels & Outreach prioritizes actual partnership stage, recorded next action, open/claimed Lead counts,
explicit key-contact evidence and active opportunities. Additional counts and history are disclosed.
Product/cohort Opportunity context, school profile, contact intelligence, decision relationships and
school outcomes use the existing commercial read model and editors. Strategy, agreements, performance,
events and referrals remain reachable as secondary detail. Mandatory activation count fields are validated;
malformed data produces a module error, not manufactured zero counts.

## Contact Workspace

The server's existing ContactPrivacy read supplies identity and profile. CustomerOperations supplies
authorized related records, follow-ups and manage authority. Overview has a compact profile grid, actual
Household memberships and recent follow-ups. The rail shows do-not-contact and explicit channel/purpose
consent states, visible-record facts and quick navigation. A Household membership is not inferred guardian
or legal authorization. Missing consent is not displayed as granted permission.

Information Overview, Follow-up & Goals, Contracts & Products, Commercial Operations, and Record &
Communication Authorization keep their existing local semantics. Embedded consent editing omits the
duplicate identity while retaining the original workflow. Accepted record saves followed by failed
refresh show a saved/display-unavailable notice instead of inviting another save.

## Student Workspace

Local sections are Overview, Family & Contacts, Participation & Applications, Services & Support, Activity
and Academic. Academic records remain accessible rather than inventing a Contract/Payment tab without
an appropriate Student-scoped contract. The header uses the shared identity presentation and actual
grade/year/status. Its primary navigation opens Journey; it does not pretend that a new Student progress
mutation exists.

Overview groups canonical domains, displays compact participation and application tables, support case
health/active-goal/risk/review facts, and recent follow-ups from the Student's existing Contact. The rail
shows actual family members, query totals, recorded support needs and quick navigation. Desktop tables
expose product/cohort or target, status, owner, recorded update/deadline and owning-record links. Mobile
rows preserve these priority fields without page-level scrolling. Query totals are reused from the
existing reads, not computed from the first page; loading, restricted, unavailable and valid zero differ.

| Visible content | Canonical source | Destination / write owner |
|---|---|---|
| Participation | `/api/enrollments?studentId=…` | Enrollment focus route and existing EnrollmentEditor |
| Application | `/api/applications?studentId=…` | Application focus route and existing editor |
| Support cases | `/api/student-success?studentId=…` | Student Support focus route and existing case/goal owners |
| Family | Existing Household detail read | Family focus route, original memberships and guardian facts |
| Recent follow-ups | CustomerOperations, `CONTACT`, Student personId | Existing Contact follow-up workflow |
| Additional education context | Existing EducationBusiness workspace | Canonical pathway/participation owners |

Journey grouping is not a universal lifecycle, completed-stage timeline or recognition event. The design
does not manufacture admission outcomes, goal descriptions, historic comparisons, money or a universal
Student health status from unrelated fields. Partial module failures leave the record identity intact.

## Operational cleanup and navigation

Products keep Catalog, Bundles and FX together. Row/detail deletion uses MoreActions and the existing
confirmation/recoverable contract; money includes its currency code. Lead Queue retains existing state,
ownership, capability gates, request keys and revision handling. No Lead mutation or query change is made.

Academic correction reads the selected Student's current snapshot before opening its existing drawer.
Untouched values continue through `studentUpdateInput`; revision conflicts remain explicit. The annual
worker, workspace timezone and September policy are unchanged. Accepted save plus refresh failure is
reported separately.

Imports have one same-workspace tab control, compact download controls and a resource/file workflow.
Existing mapping, preflight, batch/row review, repair, execute, rollback and Import Set owners are retained.
Technical diagnostics remain under the existing native disclosure after human guidance. The unified tab
control stays mounted when its panel changes, fixing keyboard focus loss.

Customer communications is primary in Work. The portal has no separate navigation or page command;
its route and access rules remain intact as an internal communications feature.

## Shared components, icons and CSS

Reused/evolved: RecordHeader/RecordIdentity, SectionHeader, ResponsiveDetailLayout, DetailTabs, FilterBar,
MoreActions/ActionDisclosure, QueueItem, MetricStrip, AttentionPanel, AccessibleDrawer and existing
confirmation machinery. New ContactWorkspace is a domain presentation consumer, not a shared backend.

`UiIcon` has three shared consumers (SectionHeader, MetricStrip and AttentionPanel), plus record metadata
and related-record consumers. Its vocabulary covers organization, people, student, family, program,
application, support, activity, metric, attention, finance, governance, channel, product, opportunity,
queue, calendar, import, action, location and generic section. Sizes are 16/18/20/24/30px with consistent
stroke. Icons are decorative, hidden from accessibility APIs and cannot replace action/status text.
Context, operational, finance and governance tones do not redefine business status. Existing navigation
and button icons remain Lucide; adoption through shared consumers improves multiple product areas, not
a claim that every legacy field has been individually redesigned.

Only `app/ui-system.css` changes. It owns shared semantic workspace spacing, inline actions, information
grids, compact tables, content-sized empty states and responsive placement. Import order is unchanged.
No old stylesheet is deleted, no unproven selector is retired, no page-specific `!important` chain or full
CSS rewrite is introduced. The existing restrained section tones are retained.

## Verification

| Gate | Result |
|---|---|
| Targeted Organization/Contact/Student/Lead/Product/Import/UI contracts | PASS — 160 tests, including management and release metadata regressions |
| Typecheck | PASS |
| Lint | PASS — no errors or warnings |
| Production build | PASS — 3.30.0 |
| Release metadata alignment | PASS |
| Public privacy | PASS |
| Migration verification | PASS — 119 SQL, latest 114 |
| Opening migration raw bytes | PASS — all unchanged |
| Ten Revenue candidates | PASS — byte-identical, untracked and unstaged; excluded from commit |
| Core record Chromium scope | PASS — 23 page/viewport states |
| Operational Chromium scope | PASS — 13 page/viewport states |
| Shared management presentation regression | PASS — 25 page/viewport states |
| Unexpected browser errors | NONE |
| Local QA server | STOPPED |

Tests cover navigation and safe fallback, record composition, omitted-value preservation, permissions,
canonical creation/deletion owners, accepted-save/refresh handling, Lead uncertain retry and currency,
import contracts, semantic icons and management metric restrictions. Full PostgreSQL and browser release
campaigns are not run: no API/repository/RPC/RLS/data behavior changed. Browser mocks are not RLS or real
mutation evidence.

Pinned runtime: `ms-playwright/chromium-1243`, browser version `153.0.8010.12`. Actual React components,
production CSS and independently fictional APIs produce private screenshots and reports under ignored
`work/ui-redesign/`. Runtime health and sidebar metadata expose `3.30.0`.

| Page | 1920×1080 | 1440×900 | 375×812 |
|---|---|---|---|
| Organization Overview | PASS | PASS | PASS |
| Organization Contacts | PASS | PASS | PASS |
| Organization Opportunities | PASS | PASS | PASS |
| Organization Channels & Outreach | PASS | PASS | PASS |
| Contact Detail | PASS | PASS | PASS |
| Student Detail | PASS | PASS | PASS |
| Products | PASS | PASS | PASS |
| Lead Queue | PASS | PASS | PASS |
| Academic Progression | PASS | PASS | PASS |
| Imports | PASS | PASS | PASS |

Additional captures cover Organization Activity, long bilingual Organization/Contact/Student identities,
read-only Organization and Lead More. Screenshot inspection checks section order, unused whitespace,
action priority, card depth, alignment, wrapping, empty states and context placement. DOM gates assert
single H1 identities, first-panel placement, the initial Lead bounding box and no document overflow.
Keyboard checks cover Student tabs, Import End/Home, Lead More, Escape and delete-dialog focus restoration.
The existing modal/unsaved guards and reduced-motion rules remain in force.

## Boundaries and deferred work

No schema/API/repository/permission expansion, new lifecycle/task engine, Activity bilingual relaxation
or Revenue work is introduced. Missing Demo-only facts are not filled by guesses. Student contract/payment
composition and a new Student progress mutation need separate domain requirements. Product/Bundles/FX
split, full CSS migration and additional low-priority page redesign remain deferred.

The user's final follow-up authorizes version promotion and one local checkpoint after these gates.
Only this UI/version/document/test set is intended for the checkpoint; ten Revenue files and all ignored
raw evidence stay excluded. Push: NOT RUN. Deploy: NOT RUN. Production: NONE. No persistent shutdown
automation or settings are added.

`UI_CORE_WORKSPACE_REDESIGN_READY`
