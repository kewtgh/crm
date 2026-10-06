# v3.21 Release Closure

Verdict: **V321_RELEASE_READY** — **COMMIT READY**; no commit, push or deploy performed.

## Baseline

- Branch: main.
- Starting / final HEAD: afd0e2b1c5e54f3618e3f8382de6a50060afcc3f (v3.20 checkpoint).
- Starting version: 3.20.0; final release candidate version: 3.21.0.
- Runtime: Node 26.10.0 / npm 12.2.0, local repository runtime switch.
- Opening worktree: Phase 1–3, 93 changed/new files, unstaged/uncommitted.
- Phase 4 raw snapshots: `work/v321-phase4-baseline/`; no recovery patch applied.
- Closure-only raw baseline: `work/v321-release/closure-baseline/`.
- Candidate patches, raw snapshots, manifest, logs and verification: `work/v321-release/`.
- Staging: EMPTY; Commit: NOT RUN / candidate only; Push: NOT RUN; Deploy: NOT RUN.
- Production access: NONE. All databases are isolated local disposable PostgreSQL containers.

## Implementation

Phase 1 extends existing commercial profiles, school research outcomes, Contact Intelligence
and Decision Map. Phase 2 reuses Leads with explicit pool visibility, atomic assignment and
operational stage histories. Phase 3 adds versioned agreements, explicit rules, canonical
eligibility, immutable earned/reversal ledger and separate currency-safe settlements.
Phase 4 adds a read-only security-invoker projection, validated GET API, bilingual reports
and Account Performance. No metric updates domain facts or emits Automation events.

The report separates current snapshot from selected-period activity. Distinct Enrollment
counts prevent join amplification and cross-account double counting; PRIMARY and ASSIST
remain separately named contributions. Commission totals read the ledger and reservations,
with decimal strings per currency. Hidden contacts, Organizations and unauthorized amounts
are excluded. No Student PII or sensitive narrative is returned. Existing indexes suffice
for the bounded real query-plan fixture; no speculative reporting indexes were added.

## Verification

| Gate | Result | Evidence / scope |
| --- | --- | --- |
| Migration verification | PASS | Official db:migrations:verify; forward 101 / 102 |
| 091–100 raw bytes frozen | PASS | All 105 historical migration hashes unchanged against opening snapshots |
| 098 / 099 / 100 / 101 / 102 checksum | PASS | Raw SHA values in release notes and ignored frozen manifest; 101 unchanged by forward 102 |
| Declared runtime | PASS | Node 26.10.0, npm 12.2.0 |
| npm ci | PASS | --no-audit --no-fund; lockfile unchanged before version promotion |
| Channel Intelligence / Decision Map | PASS | Real PostgreSQL + targeted domain tests |
| Lead Pool / Activation | PASS | Real two-client claim race, retry, release/reassign, stage history, Household regression |
| Commission / Settlement | PASS | Golden integration includes all Phase 3 financial/state/security assertions |
| Channel Analytics | PASS | Real RLS, hidden Org/Contact, redaction, manager money access, date/period and currency tests |
| Golden Channel Path | PASS | Explicit Organization/profile/people/relations/Lead claim/qualification/stage/Opportunity/Event/Attribution/Agreement/payment/accrual/settlement/report |
| Shared Contract negative path | PASS | Shared percentage source creates 0 accrual; explicit blocker; fixed commission still valid |
| Refund after Paid | PASS | -2,000 reversal; original earned entry and Paid settlement unchanged; analytics counts reversal once |
| Security | PASS | Workspace isolation, inaccessible subject/count protection, sensitive terms/settlement permissions |
| Privacy | PASS | Contact intelligence/relations removed; Student personal references cleared; retained ledger/settlements/Finance survive |
| Automation | PASS | Real status events, disabled rules, retry deduplication, TASK/NOTIFICATION actions |
| Data Quality | PASS | Phase 1–3 appearance/resolution tests; low score/tier valid; amounts excluded; analytics narrows cached finding scope |
| No invented revenue attribution | PASS | Counts/contributions/exposure only; no Channel Revenue/ROI |
| No currency mixing | PASS | CNY/USD separate; server decimal aggregation |
| No shared-contract double count | PASS | Existing Finance/commission negative and mixed-contract tests |
| Targeted unit regression | PASS | 96 tests including Organization/Contact, Education, Commercial Links, Operational Readiness, signed commission display and release metadata |
| Typecheck | PASS | Final source/version, declared runtime |
| Scoped lint | PASS | 95 changed/new source/test files, zero warnings/errors |
| Production build | PASS | Final 3.21.0 build; required rebuild after negative monetary display correction |
| Affected Chromium | PASS | Five bounded affected phases, 29 groups; Chromium 1243; 1440/375, zh-CN/en; zero unexpected errors |
| Architecture docs | PASS | Final canonical, privacy, permission and analytics semantics documented |
| Release notes / version metadata | PASS | package, lockfile root, APP_VERSION, README and implementation status aligned to 3.21.0 |
| Candidate reverse checks | PASS | Independent Phase 4, closure-only and combined patches; raw manifests retained |
| Whitespace / Git index | PASS | git diff --check clean; no staged files |

PostgreSQL uses `postgres:18.4-bookworm`, a locally available PostgreSQL 18 image, without
network image pulls. Each script has a 50-second deadline and cleans its container.
The final analytics plan fixture measured approximately 15 ms; this is bounded fixture evidence,
not a production-scale benchmark. `npm ci` reported existing eslint-plugin peer warnings;
no dependency, engine or audit-fix changes were made.

Browser evidence uses actual components, production CSS and mocked business APIs.
It is **not authenticated browser-to-real-database E2E**. PostgreSQL owns RLS, concurrent
claim/reservation, monetary calculation, source-event atomicity and retained privacy facts.
Full repository regression and the complete ten-phase browser matrix: NOT RUN (outside scope).

The final affected browser evidence is retained under
`work/browser-qa-chromium-1243/v321-release-final/`. Each phase uses the same final build:
Channel Intelligence, Lead Pool/Activation, Agreements, Commission Ledger and Analytics.
Pinned executable:
`%LOCALAPPDATA%/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
browser version 153.0.8010.12 / playwright-core 1.63.0. Local QA server: STOPPED.
The first Analytics attempt exposed negative reversal/open-exposure rendering; it was fixed
using exact signed decimal formatting, with a meaningful regression and required source
rebuild. A valid empty-settlement count edge was fixed by forward 102, preserving frozen 101.
Final evidence supersedes the failed attempt; no unchanged-source builds were repeated.

## Git candidate

Final candidate has an empty index, matching frozen hashes, a complete manifest,
`v321-checkpoint.patch`, independent `phase4-delta.patch`, `closure-only.patch`, raw final
snapshots and successful `git apply --check --reverse` evidence. Ignored `work/`, screenshots,
patches, temporary containers and logs are excluded from the product candidate.

Suggested message: `feat: add channel commercial management and commission foundation`.
Commit requires separate authorization. No push, deploy or Production workflow configuration.

## Deferred

Revenue Attribution; Channel Revenue / ROI; Contract Allocation; FX; Partial Settlement;
Bank Payout; Accounting; Sales Targets; Management Intelligence; AI; Automated Research.
No Documents, complex BPMN, production template seed or automatic business configuration.
