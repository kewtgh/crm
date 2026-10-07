# v3.28.0 — Final release review and version promotion

**V328_RELEASE_READY — COMMIT READY**. This records independent review of the complete uncommitted
Phase 0–5 candidate and local version promotion. It is not Git checkpoint authorization, deployment
approval or Production acceptance.

## Baseline and candidate integrity

| Item | Opening | Final |
|---|---|---|
| Branch | main | main |
| HEAD | b74984e764214caf0383c2e7ca3425d0da536280 | unchanged |
| Formal version | 3.27.0 | 3.28.0 |
| Node / npm | 26.10.0 / 12.2.0 | unchanged |
| Candidate files, including excluded Revenue specifications | 105 | 112 |
| Intended release files | not yet classified | 106 |
| Migration files / logical head | 118 / 113 | unchanged |
| Staging | EMPTY | EMPTY |

All 105 opening candidates remain present: 100 byte-identical, five with bounded closure changes.
Seven additional files become candidates. The 63 final untracked files are individually classified:
57 INCLUDE IN V3.28 RELEASE and six DEFER / EXCLUDE. No untracked file remains ambiguous.

Ignored `work/v328-release/` holds opening/final path, size, SHA256 and tracked/untracked manifests,
complete HEAD-relative patches, an opening-to-final closure patch, raw candidate copies, the intended
release manifest and final integrity results. No reset, old-commit restoration, patch reapplication,
history rewrite or staging was performed.

### Closure-only delta

| Files | Closure change |
|---|---|
| `package.json` | Version and focused release-review test registration |
| `package-lock.json` | Root and root-package version only; dependency entries unchanged |
| `lib/version.ts` | APP_VERSION 3.28.0 |
| `README.md`, `docs/IMPLEMENTATION_STATUS.md` | Current version and new top release summary; historical content retained |
| `docs/RELEASE_V3.28.0.md`, this document | Release notes and final verification record |
| `components/customer-360-page.tsx` | Source-aware timeline presentation regression correction |
| `tests/fixtures/record-workspaces.ts`, `tests/release-ux-review.test.mjs` | Canonical synthetic activity kind and rendered timeline regression |
| `scripts/qa-ux-closure.cjs`, `scripts/qa-record-workspaces.cjs` | Runtime version and timeline browser assertions |

These 12 paths are the release-closure delta, distinct from Phase 0–5 implementation. Dependencies,
engines and overrides remain unchanged. Historical README and implementation-status content was
compared with HEAD after newline normalization and retained. Earlier phase baseline versions were
not rewritten.

## Independent architecture review

Review used implemented components, navigation metadata, candidate diffs and canonical contracts.
Old reports provided context; fresh tests independently verified the candidate.

| Area | Verdict | Notes |
|---|---|---|
| Global IA | PASS | Seven spaces; query-aware Student/Family destinations; real capabilities and existing deep links |
| Executive | PASS | Canonical overview/trends; Attention, PERIOD changes, KPIs and bounded domain disclosure |
| Student/Family | PASS | Focus workspace, lightweight Household context; no nested Family route strip or inferred parent/legal authority |
| Organization Account | PASS | One primary identity, six local sections, canonical contextual editors |
| Lead Queue | PASS | One permitted state-aware action; original ownership/revision/uncertain retry |
| Dashboard | PASS | Today, bounded signals and snapshot before launchpad; isolated preference grants no access |
| Contracts | PASS | Programmatic selection, compact context, focus deep link and same-record sections |
| Products | PASS | Locale identity/responsive alignment; Catalog, Bundles and FX remain one workspace |
| Imports/Data Quality | PASS | Human explanation before safe identifier diagnostics; workflows unchanged |
| Responsive | PASS | 1920/1440/375 core set; actual record bounding boxes and no mobile page overflow |
| Accessibility | PASS | Bounded keyboard/focus/drawer/menu/disclosure/navigation regression |
| Terminology | PASS | Safe fallback; source-specific enum labels; missing/unset/restricted/unavailable/zero distinguished |
| Domain boundaries | PASS | Context composition introduces no canonical ownership or duplicated store |
| Security/permission presentation | PASS | Existing capability/record gates; no server/security-policy change |
| Privacy | PASS | Synthetic fixtures, ignored evidence and fresh public privacy regression |

### Ownership and business facts

Dashboard remains personal work context plus snapshot; Action Center is the operational exception
queue; Executive is management interpretation. Overlapping counts are not summed into unique tasks.
Student and Account workspaces compose context through existing read contracts and canonical actions.

No API route, repository, RPC, mutation, worker, RLS, schema or permission-taxonomy change is introduced.
No duplicate task, Student lifecycle, Organization, Contract or management aggregation backend exists.
Revision controls, request keys, receipts, maker-checker and AAL2 remain authoritative. Navigation
visibility is not authorization, and browser mock evidence does not prove database/RLS behavior.

The following boundaries remain intact:

- Organization differs from Opportunity and Contact; Product differs from Cohort.
- Student differs from Enrollment and Household. Household membership does not grant guardian
  authorization or imply father/mother identity.
- Enrollment, Application and Admission Milestone differ. Referral and Event Participation do not
  imply Enrollment. Enrollment completion does not complete Student Support.
- Contract, Enrollment and Payment differ; Receivable differs from Payment.
- Channel Agreement differs from Commission Accrual. Contribution/commission are not Revenue
  attribution; AI inference is not a business fact.

Journey displays canonical Enrollment, Application and Support facts with owning links. Household
participation remains labeled as Household context. No automatic cross-domain transition is added.
Minimum creation preserves duplicate checks/defaults; full-input editing preserves untouched values.
Accepted save plus failed refresh remains distinct from failed save.

Management comparison uses only canonical PERIOD series, with no fabricated SNAPSHOT history.
Null comparison and null goal-attainment denominator are not zero. Currencies remain separate and
visible. Restricted and unavailable are not valid zero. Confirmed payment, Contract value, Receivable,
Outstanding and Commission are not renamed Revenue.

### Confirmed release presentation defect

Timeline presentation assumed missing translations returned their keys, which conflicts with Phase
1's safe fallback. Canonical timeline SQL was reviewed: Contact summary is recorded communication
context, Activity summary is kind, Opportunity summary is stage, and other sources use their own
statuses. The correction presents each accordingly. Unknown enums stay neutral; no raw token is
substituted into business UI.

The synthetic ACTIVITY fixture uses valid MEETING instead of invalid CREATED. No production enum or
data contract was extended. A rendered-component regression covers both locales, known source labels,
recorded contact context and unknown enums; the final Account browser check verifies the Activity label.
This is release regression closure, not new UX feature development.

## Version metadata and release notes

| Metadata | Final value |
|---|---|
| `package.json` | 3.28.0 |
| Lock root / `packages[""].version` | 3.28.0 / 3.28.0 |
| APP_VERSION | 3.28.0 |
| README current release candidate | v3.28.0 |
| Implementation-status first heading | v3.28.0 release candidate |
| Built health and visible sidebar version | 3.28.0 |

`release:check` and release metadata tests pass. Lock dependency entries remain unchanged.
[Release notes](RELEASE_V3.28.0.md) were checked against actual implementation: they describe
presentation, interaction and canonical reuse, without claiming Production acceptance, RLS proof,
new backend behavior, Revenue or a universal Student lifecycle. The frozen
[architecture](UX_ARCHITECTURE_V328.md) and [implementation plan](UX_IMPLEMENTATION_PLAN_V328.md)
remain the UX contract.

## Fresh verification

The bounded combined contract run passes **198 tests**, including Phase 1–5 UX/domain presentation,
two release metadata tests and the rendered timeline review. Required typecheck and full lint pass;
subsequent bounded closure edits pass focused lint. One production build of the promoted final
runtime source passes. Dependency audit finds **zero vulnerabilities** without dependency upgrades.
Public privacy passes **13 tests**. Migration manifest verification passes.

All **118 migration SQL files** were independently compared by raw-byte SHA256 with the opening
snapshot: unchanged. Latest logical migration remains **113**, with no migration 114.

### Pinned Chromium core regression

Seven fresh reports contain **37 checks**, all PASS, with zero unexpected errors and zero warnings.
All identify one build hash and one source fingerprint matching final runtime source, version 3.28.0.
Pinned runtime: `ms-playwright/chromium-1243`, browser 153.0.8010.12, Playwright 1.63.0. Exact executable
evidence stays in private reports.

| Browser phase | Checks | Coverage |
|---|---|---|
| UX closure | 15 | Contract 1440 plus 1920/375; Action Center, Products, Imports/Quality samples |
| UX foundation | 3 | Organization Directory 1920/1440/375 and mobile filters |
| Record students | 6 | Student Directory 1920/375, Workspace 1440/375, Household samples |
| Record accounts | 3 | Organization Workspace 1920/375 and Activity timeline |
| Frontline leads | 3 | Lead Queue 1920/1440/375 |
| Frontline dashboard | 3 | Dashboard Daily/Management, 1920/375 |
| Management experience | 4 | Executive 1920/1440/375 and Student Support Analytics mobile |

At 1920, Executive Attention/Changes begin around 285px and KPIs around 698px; Dashboard
Today/Attention around 329px and Snapshot around 622px. Mobile Organization and Lead first records
begin around 551px and 465px, within 812px. Gates use real DOM bounding boxes. Executive's default
full-page evidence shows collapsed details, without an arbitrary page-height threshold.

Keyboard checks cover sidebar, global search, Organization filters, Student local tabs, Lead More,
Contract sections, Executive scope and Action Center. Escape, focus trap/restoration, focus-visible,
skip link, ARIA current/tab semantics, native disclosure and reduced motion remain. Existing guarded
dialogs, pending states, form labels and error association are preserved and tested by affected
contracts. This bounded regression is not WCAG certification.

Synthetic long Organization, Student, Lead, Product and Contract-customer names retain locale
hierarchy and reachable actions. Desktop width, mobile progressive disclosure and no page-level
horizontal overflow pass. Fresh contract tests retain read-only, partial failure, null/zero,
save-refresh and fallback behavior.

Browser evidence uses actual React components, production CSS and synthetic mocked business APIs.
It does not prove RLS, real DB mutations or Production acceptance. Raw evidence remains ignored and
was not publicly uploaded. QA server final status: **STOPPED**, with no retained PID.

### Full release gate safety decision

**`release:gate`: NOT RUN — local environment safety not proven.**

Read-only environment classification found configured application/database/delivery targets on
loopback. Loopback does not establish database disposability. Read-only Compose/container inventory
did not identify the controlled disposable service corresponding to the configured database port.
The broad gate performs auth/RLS and business writes, so its non-Production/disposable safety could
not be positively established.

No DB connection/startup, auth identity creation or Production access was attempted to finish this
check. Full PostgreSQL, database-backed HTTP/device-auth smokes and the full ten-phase Chromium
campaign were not run. With no API/repository/RPC/mutation/RLS/schema change, a new full database
campaign is not required. All release-critical safe component gates below were independently rerun.
This is the task's permitted non-blocking safety exclusion, not a PASS for the broad gate or a claim
of database/security integration validation.

## Release closure verification matrix

| Gate | Result |
|---|---|
| Phase 0 architecture | PASS |
| Phase 1 | PASS |
| Phase 2 | PASS |
| Phase 3 | PASS |
| Phase 4 | PASS |
| Phase 5 | PASS |
| Independent architecture review | PASS |
| Domain boundaries | PASS |
| Version metadata 3.28.0 | PASS |
| `release:check` | PASS |
| Release metadata tests | PASS |
| UX targeted contracts | PASS — 198 combined tests |
| Core Chromium | PASS — 37 checks, zero unexpected errors |
| 1920 | PASS |
| 1440 | PASS |
| 375 | PASS |
| Accessibility | PASS — bounded keyboard/focus/semantic regression |
| Terminology/fallback | PASS |
| Public privacy | PASS — 13 tests |
| Migration manifest | PASS |
| 118 migration bytes | PASS — unchanged |
| Dependency audit | PASS — zero vulnerabilities |
| Typecheck | PASS |
| Lint | PASS |
| Production build | PASS |
| QA server stopped | PASS |
| Revenue excluded | PASS — six unchanged, untracked, unstaged files |
| Staging empty | PASS |

## Intended commit set and exclusions

Private `work/v328-release/intended-release-files.json` enumerates the 106 intended files: Phase
0–5 runtime, components, styles, tests, QA scripts and public-safe architecture/verification/release
documents. Every untracked file is classified. No Git add or commit has run.

Six byte-identical, untracked, unstaged Revenue files are excluded:

- `docs/REVENUE_FOUNDATION_ARCHITECTURE.md`
- `docs/V326_PHASE0_VERIFICATION.md`
- `docs/V326_REVENUE_POLICY_DECISION_PACK.md`
- `docs/revenue-foundation-contract.json`
- `tests/revenue-foundation-contract.test.mjs`
- `tests/revenue-policy-decision-pack.test.mjs`

Revenue: **DEFERRED / UNTOUCHED — V326_REVENUE_POLICY_INPUT_REQUIRED**. Raw screenshots, QA logs,
snapshot patches, local environment files and ignored `work/` are PRIVATE / IGNORED and excluded.
Public privacy guards remain non-echoing; no private evidence is embedded.

## Deferred items and Git boundary

Activity bilingual API relaxation; Revenue policy/implementation; Product/Bundles/FX separation;
full CSS rewrite; new global-search capabilities; forecasting; new business fields; unsupported
Student/Lead filters and persistent Lead views; Contract list read-model enrichment remain deferred.
Existing stylesheet order and canonical ownership remain; no full CSS consolidation is claimed.

UX release candidate readiness: **READY**, for review of the intended Git checkpoint only.

| Boundary | Final state |
|---|---|
| Staging | EMPTY |
| Commit | NOT RUN |
| Push | NOT RUN |
| Deploy | NOT RUN |
| Production | NONE |

**V328_RELEASE_READY — COMMIT READY**
