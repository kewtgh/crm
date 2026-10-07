# v3.29.0 — Operational deletion and workspace verification

## Baseline and scope

The opening branch was `main`, HEAD `ec36f3f0be84d7db6c25784bfa1c392c259c63c9`,
formal version 3.28.1 and logical migration 113. The six excluded Revenue specifications
were already untracked. The private opening fingerprint was captured after the first
timestamp repair and contains 11 candidate paths, including those six specifications.
No earlier candidate work was reset, restored or reapplied.

Final release metadata is 3.29.0. The declared verification runtime is Node 26.10.0 /
npm 12.2.0. Migration 114 is additive; 119 SQL files now exist and the 118 opening SQL
files remain byte-identical. No Production environment was accessed or migrated.

The [audit](UX_OPERATIONS_AUDIT.md) reconciles the previous plans and the
[integrated plan](UX_OPERATIONS_REPAIR_PLAN.md) records the completed follow-up scope.

## Removal coverage and reliability

`lib/record-deletion-contract.ts` defines 44 distinct business resource kinds. Record cleanup
provides search and paged review across this complete allowlist. Daily Lead, Organization,
Opportunity, Contract, Enrollment, Application, Support, Academic, Education Business,
Cohort and channel draft surfaces expose contextual removal. Existing Student, Family,
Contact, Product and Task removal owners remain available.

The API accepts typed resource names rather than arbitrary table identifiers. Existing
capabilities, workspace membership, record ownership, AAL2, optimistic revision/timestamp,
request receipts and audit remain authoritative. Recycle restore is SUPER_ADMIN/AAL2.
Records without a configured expiry remain recoverable until formal purge; expiry is not
invented for the newly covered resources.

PostgreSQL table reads retain timestamptz microseconds. The isolated database regression
reproduces valid Organization deletion using a `.123456` token and rejects a stale `.123`
token. Editors load an authorized current snapshot before opening and preserve genuine
conflict feedback. An accepted deletion followed by failed refresh does not offer a second
save. Uncertain attempts retain the original request identity.

Removed rows are excluded by guarded canonical reads and restrictive RLS. New links to
removed parents are rejected, including a stale Enrollment editor referencing an archived
Cohort. Existing historical links are retained. Product pricing excludes removed prices,
and a new current price can replace an archived current row without corrupting currency
or effective-date semantics.

Unused channel agreement drafts can be removed/restored. Signed contracts, earned terms,
executed imports and financial evidence retain their formal cancellation, rollback,
refund/reversal or document-governance owner. This release provides recoverable operational
deletion, not unrestricted physical erasure of ledgers, storage evidence or audit history.

## Workspace changes

| Area | Implemented behavior |
|---|---|
| Communications | Household portal is nested under Self-service communications; URLs and capability checks remain. |
| Organizations | Aligned Search/Status/Owner controls; city, curriculum, organization type and existing commercial advanced filters execute on the server before paging/counts. |
| Contacts | Shared primary Search/Status/Organization controls; Owner/Type use advanced draft filtering. |
| Students / Families | Student year/status and advanced grade selectors; Household status; server paging and counts remain consistent. |
| Enrollment / Applications | Compact desktop primary controls, advanced related scope in an accessible drawer, Cancel does not apply draft conditions. |
| Student Support | Formal page heading, compact case scope, readable operational rows and contextual child-record cleanup; analytics/outcome ownership remains separate. |
| Academic progression | Direct searchable Student correction uses the existing full Student update snapshot; September 1 workspace-timezone scheduler is unchanged. |
| Leads | Wide scanning regions, locale-aware identity, one primary action and permitted deletion in More; claim/convert/retry/revision contracts remain. |
| Account | Compact privacy/completeness utilities and authorized direct deletion; one identity header and contextual editors remain. |
| Commissions | Organization/currency/status scope, advanced UTC date bounds before the server row limit, and independent unfiltered settlement candidates. |
| Executive / Channel analysis | Attention/change/KPI ordering retained; compact applied scope, four explicit account summary metrics and disclosed distributions; currencies remain separate. |
| Imports | Workflow navigation and optional mapping disclosure are clearer; strict preflight, repair, apply and rollback remain unchanged. |

Shared fixes remove inherited selector bottom margins and mobile 180px row spacers. Inline
record actions no longer inherit an unrelated vertical grid. Expansive primary filter controls
are verified to align within 3px and remain at most 40px tall. Advanced conditions retain
draft/apply/cancel/reset semantics rather than client-side filtering of an incomplete page.

Purpose-based tones distinguish operational scope, business context, analysis, finance and
governance. Headings and written labels remain; status badges, risk colors and neutral change
direction are unchanged. High-contrast mode retains visible borders. Channel section tones
have distinct computed backgrounds and functional heading contrast of at least 4.5:1.

## Verification evidence

Browser checks use the pinned `ms-playwright/chromium-1243` executable, reported browser
153.0.8010.12, actual React components, final production CSS and independently fictional
mocked APIs. Raw reports and screenshots remain ignored under `work/`. Browser mocks do
not prove database mutation, RLS or Production acceptance.

Each selected browser phase has a 55-second limit. The complete ten-phase Chromium matrix
and full release gate were not run. The selected checks cover the changed surfaces and
their shared consumers; unexpected browser errors fail the phase. Only explicitly injected
test errors are classified as expected.

| Selected browser phase | Checks | Result |
|---|---:|---|
| Operational repair | 22 | PASS |
| UX foundation / Organization filters | 23 | PASS |
| Channel analysis | 7 | PASS |
| Commission ledger | 7 | PASS |
| Organization Account | 18 | PASS |
| Lead queue | 18 | PASS |
| Executive / Support analytics | 25 | PASS |
| Contracts / Products / Imports / Quality | 15 | PASS |
| Student Support operational workflow | 7 | PASS |
| Student / Household workspaces | 31 | PASS |

The selected reports total 173 page/viewport/behavior checks with zero unexpected browser
errors. Shared behavior was rechecked after the actual alignment and tone fixes; unrelated
phases were not repeated solely because a screenshot had been captured.

The operational samples include 1920×1080, 1440×900 and 375×812, filter draft cancellation,
44 cleanup choices, exact deletion token/request identity, and direct searchable academic
correction. Record positions and overflow are checked from DOM bounds. Existing phases also
verify keyboard/focus restoration, long bilingual identities, restricted/zero/unavailable,
partial failures, minimum creation and accepted-save/failed-refresh separation.

The isolated PostgreSQL test uses a cached local image, random disposable container, tmpfs
database and random localhost port. It applies migrations and checks Lead ownership/actions,
tenant bounds, audit/receipt replay, AAL1 refusal, precise timestamp conflict behavior,
resource cleanup, restore, Product prices, channel drafts, deleted-reference guards and
new directory filters. It does not use configured application database URLs.

| Gate | Result |
|---|---|
| Timestamp and operational contract tests | PASS |
| Existing bounded contract suite | PASS — 281 contracts and 8 CAPTCHA tests |
| Isolated PostgreSQL targeted integration | PASS |
| Typecheck | PASS |
| Lint | PASS |
| Production build / 3.29.0 metadata | PASS |
| Public privacy regression | PASS — 13 checks |
| Migration manifest / historical bytes | PASS — 119 files, head 114; prior 118 unchanged |
| Final browser tone / alignment checks | PASS |
| Local health version | PASS — 3.29.0 |
| QA server stopped | PASS — stopped, status not running |
| Revenue fingerprints and exclusion | PASS — six unchanged, untracked and unstaged |

## Deferred boundary and Git checkpoint

Revenue remains `V326_REVENUE_POLICY_INPUT_REQUIRED` and DEFERRED / UNTOUCHED. Its six
files stay untracked, unstaged, byte-identical and outside the intended commit. Activity
bilingual API relaxation, automatic identity matching, external integrations, forecasting,
bulk destructive workflows and a full CSS rewrite remain separate policy-dependent work.

Dependencies are unchanged; the lockfile changes only its root release versions. Existing
domain identities, permission taxonomy, annual progression and immutable financial facts
are preserved. The intended local commit is created from an explicit reviewed file manifest.
The final candidate contains 73 reviewed files, excluding the six Revenue candidates and
all private evidence. Excess blank lines were removed only from modified Markdown files;
historical SQL and Revenue bytes were excluded from formatting. Staging was empty before
the checkpoint; the committed file set is independently compared with the manifest.
Push, deployment and Production access are outside this checkpoint.

Verification verdict: `V329_OPERATIONAL_UX_REPAIR_VERIFIED`.
