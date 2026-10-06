# CRM workflow and experience repair

Status: implemented and verified as v3.26.0 — Business workflows and interface upgrade. Baseline: 3.25.3.

## Design principles

- Put actions beside the record they change. Reuse canonical mutations and their permissions, revisions and duplicate checks.
- Present students and their family context together without merging Contact, Household and Student identities in storage. Display family roles from recorded relationships, never infer legal authority.
- Use compact, accessible search/filter groups with responsive wrapping. Advanced filters should not obscure primary actions.
- Use business language. Keep protocol versions and implementation identifiers out of ordinary navigation.
- Automatic academic progression needs an explicit calendar, idempotent execution, recorded outcomes and manual corrections.

## Repair sequence

| Area | Observed condition | Planned change | Verification |
|---|---|---|---|
| Organization contacts | Detail lists link out but lack local editing | Reuse contact editor and scoped creation | Create/edit and permission regression |
| Organization business | Activation, agreements, analytics and profile stack together | Separate overview, cooperation and contact intelligence | Accessible tabs and responsive QA |
| Contracts/products | Read-only lists obscure owning operations | Contextual create/edit using existing domain forms | Context preserved, no duplicate mutation path |
| List filters | Inconsistent toolbar/grid sizing | Shared search/filter component and compact layouts | Desktop/mobile and keyboard QA |
| Contact directory | Generic customer naming; limited filtering | Organization-contact naming and explicit filters | Server filtering and pagination |
| Family/student workflow | Separate parallel lists | Student-centered entry, family details and participation tabs | Parent/child search and role labels |
| Academic progression | Manual batch initiation | September 1 execution in workspace timezone and exception correction | Calendar, retry and concurrency tests |
| Participation | Standalone list competes with student context | Student and cohort detail access | Enrollment lifecycle unchanged |
| Student support | Technical name and reported loading failure | Plain-language support workflow; harden collection route handling and actionable error reporting | Repository/API regression |
| Leads | Spacious filters and dense cards | Compact filters and clearer card hierarchy | Affected browser QA |
| Imports | Version choices and reference jargon | Latest templates by default, contextual relationship guidance | Template/protocol compatibility |
| Data quality | Internal rule identifiers exposed | Localized rule descriptions | Known and unknown rule presentation |

## Boundaries

Revenue candidate specifications remain uncommitted and untouched. No Revenue implementation, production access or deployment. Historical migrations remain immutable. Any necessary schema change uses a forward migration and targeted database verification.

## Completion

All listed workflow changes are implemented. Organization editing reuses domain forms; draft contract
editing adds a guarded canonical mutation. The family/student UI is unified without changing the
identity model. Existing standalone participation URLs remain usable for deep links, but no longer
compete as a primary navigation tab. Existing import protocols remain internal; the user chooses only
the latest applicable template. No compatibility-only product controls were added.

Annual execution uses the existing reminder worker, a workspace/year idempotency key and a
worker-only function. Manual requests cannot reserve the annual key. It catches up the current
September boundary after downtime, advances only the immediately preceding year, and records
missing rules or stale records as failures. Later exceptions are corrected manually. It does not
infer grade mappings or replay arbitrary missing academic years.

| Verification | Result | Boundary |
|---|---|---|
| Targeted domain/UI contracts | PASS — 89 tests | Contacts, education, support, products/cohorts, imports, leads, enrollment, metadata |
| Targeted PostgreSQL | PASS | Disposable postgres:18.4-bookworm; family roles/visibility, workspace isolation, timezone cutoff, annual retry, manual correction preservation, contract version conflict/history |
| Student support PostgreSQL | PASS | Existing canonical support mutations; reported production failure not reproduced |
| Typecheck | PASS | Full TypeScript check |
| Scoped lint | PASS | This task's source/tests/QA |
| Production build | PASS | 3.26.0; repeated only after browser-discovered source fixes |
| Chromium 1243 | PASS — 37 checks | zh-CN/en × 1440/375; actual components + production CSS + mocked synthetic APIs; contextual contact/contract drawers, commercial sections, family tabs, participation |
| Public privacy regression | PASS — 13 tests | New candidates included; no private fixture data |
| Migration verification | PASS | Opening migrations byte-identical; new forward 113 |
| QA server | STOPPED | Local server only |

The original Student Success loading error has no supplied request reference and was not reproduced
in local PostgreSQL. The collection handler now tolerates missing route parameters and presents safe
request-specific errors. This is a bounded repair, not evidence that an unobserved production failure
has been conclusively diagnosed. If it persists, investigate its request reference separately.

No authenticated browser-to-real-database E2E, full ten-phase browser campaign, production deploy or
push was performed. Revenue candidates remain outside this commit. Version and release metadata
are 3.26.0. Evidence and screenshots are Git-ignored under work/.
