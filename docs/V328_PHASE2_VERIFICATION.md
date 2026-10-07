# v3.28 Phase 2 — Executive Overview & Student Support Analytics

Verdict: `V328_PHASE2_MANAGEMENT_EXPERIENCE_COMPLETE`.

## Baseline and boundaries

| Item | Opening / final state |
|---|---|
| Branch | `main` |
| Opening / final HEAD | `b74984e764214caf0383c2e7ca3425d0da536280` |
| Formal version | `3.27.0`, unchanged in package, lock and APP_VERSION metadata |
| Verification runtime | Node `26.10.0`, npm `12.2.0` |
| Latest migration | `113`; no migration 114 |
| Opening worktree | 45 candidate files: 21 tracked modifications and 24 untracked files, including Phase 0 documents, legitimate Phase 1 work and six Revenue candidates |
| Opening / final staging | Empty |
| Git actions | Commit NOT RUN; push NOT RUN; deploy NOT RUN; Production NONE |

The opening baseline was the actual working tree, not HEAD alone. Ignored evidence contains opening status, a Phase 1 patch, raw copies of all opening candidates, candidate fingerprints and every opening migration fingerprint. No reset, restore, clean, patch reapplication, history rewrite or staging operation was performed. Phase 1 remains uncommitted and is the foundation of Phase 2.

No API, repository, RPC, canonical mutation, permission taxonomy, worker or database behavior changed. Existing domain ownership, revisions, receipts, maker/checker and RLS remain authoritative. Presentation response guards reject malformed required fields; they do not normalize, aggregate or reconstruct business facts.

## Executive structure

Default ordering is scope/as-of context → attention and period changes → key facts → six domain summaries → quality → optional detailed trends. At expansive desktop widths attention and changes share a row; domain summaries use three columns. Standard desktop uses two domain columns. Mobile retains the same ordering, with scope editing in the existing AccessibleDrawer.

Attention uses only the Overview response's `attention.total` and the first three supplied canonical items. The count is explicitly labelled management attention signals, with supplied urgency, reason, domain, business date and source links. It is not a task count, unique subject count or Action Center total. The bounded summary links to the existing full management attention queue. Empty scope text makes no claim of universal system health.

Action Center remains the operational execution queue. Executive attention remains an investigation surface. Neither component creates tasks or deduplicates signals.

### Default KPI contract

| Key | Module | Mode | Unit | Action |
|---|---|---|---|---|
| `openOpportunities` | Commercial | SNAPSHOT | COUNT | Canonical matching-record drill |
| `activeEnrollments` | Delivery | SNAPSHOT | COUNT | Canonical matching-record drill |
| `applicationsInProgress` | Admissions | SNAPSHOT | COUNT | Open workspace; no false exact-match claim |
| `atRiskCases` | Student Support | SNAPSHOT | COUNT | Canonical matching-record drill |
| `outstanding` | Finance | SNAPSHOT | MONEY | Open workspace; no false exact-match claim |
| `overdue` | Finance | SNAPSHOT | MONEY | Open workspace; no false exact-match claim |

The fixed priority list selects existing metrics, not the first API entries. All available currencies for each selected money key remain separate, explicitly labelled items; currency order is deterministic. Restricted/unavailable domain KPIs are omitted and the domain summary supplies the corresponding human-readable state. Valid zero is displayed. Every metric retains its supplied mode and as-of/date context. No SNAPSHOT comparison is fabricated.

All actions use `metricDrillHref` or `metricContextHref`. Exact drills retain only supported date, Product, Cohort and currency parameters. Context links say Open workspace. Shared contracts are not allocated, currencies are not summed, and Contracted/Receivable/Collected/Outstanding/Overdue/Refunded retain their existing meanings.

### Period-change contract

| Priority | Key | Module | Mode | Unit |
|---|---|---|---|---|
| 1 | `leadsCreated` | Commercial | PERIOD | COUNT |
| 2 | `leadsConverted` | Commercial | PERIOD | COUNT |
| 3 | `enrollmentsActivated` | Delivery | PERIOD | COUNT |
| 4 | `applicationsSubmitted` | Admissions | PERIOD | COUNT |
| 5 | `payments_in_period` | Finance | PERIOD | MONEY, separate currencies |
| 6 | `outcomesRecorded` | Student Support | PERIOD | COUNT |

Changes use only `ManagementTrends.series.comparison.current`, `previous`, `absoluteChange` and `percentChange`. No previous-period value is reconstructed from Overview. Null percentage means Not comparable, including a zero previous value. Increase/decrease/unchanged language is neutral; neither direction nor currency movement receives an automatic favorable/unfavorable judgment.

Overview and Trends load independently for the applied query. A Trends HTTP failure leaves valid attention, KPIs and domains available with a bounded error and retry. An Overview HTTP failure is prominently reported; independently valid Trends can remain visible, with no complete-dashboard claim. Query-bound stored state and abort guards prevent old-scope data from appearing under a newly applied scope. Same-scope refresh failures retain the prior result with an explicit as-of notice.

Detailed trends consume the already-loaded response through `ManagementTrendsView`; opening disclosure makes no duplicate request. The existing standalone trends component remains available. Detailed series remain PERIOD-only and respect module and commission-money permissions.

### Domain summary priorities

| Domain | Explicit priority keys |
|---|---|
| Commercial | `openOpportunities`, `qualifiedLeads`, `won_value` |
| Delivery | `activeEnrollments`, `recruitingCohorts`, `enrollmentsActivated` |
| Finance | `outstanding`, `overdue`, `payments_in_period` |
| Channel | `visibleAccounts`, `primaryContributions`, `eventsHeld` |
| Admissions | `applicationsInProgress`, `applicationsDueSoon`, `applicationsPastDeadline` |
| Student Support | `activeCases`, `atRiskCases`, `highOpenRisks` |

Each domain exposes a summary, accurate availability/permission state, context action and default-collapsed native details. Full metrics, distributions and channel contribution rows remain accessible. Mixed SNAPSHOT/PERIOD summaries retain each item's semantic cue. `filterApplied` is translated into human-readable scope limitations; missing/unrecognized applicability is explicitly undeclared rather than falsely described as applied. Quality remains secondary, with its supplied count and optional distribution. The current quality contract has a permission flag, not a separate availability flag; no additional availability fact is invented.

## Scope and shared primitives

`FilterBar` now supports compact supplied scope summaries as well as the existing Organization search/primary-filter consumer. `ManagementScope` uses its draft drawer, original Product/Cohort/User selectors and existing strict filter schemas. It introduces no filtering engine or query interpretation.

- Opening creates a fresh draft; Cancel/Escape discards it and restores focus.
- Apply validates the existing schema. Invalid dates leave the editor open and send no requests.
- A valid Executive apply causes one request per independent source.
- Product selection clears the Cohort draft; no compatibility is inferred from names or client data.
- Reset draft and Clear applied filters remain separate actions.
- Scope count includes one date-range condition and one each for selected Product, Cohort, Owner and Health. It excludes display labels and as-of/timezone context.
- Applied date range, Product, Cohort, timezone and as-of remain visible. Support analytics additionally shows Owner and Health.

`MetricStrip` now accepts supplied canonical links; `AttentionPanel` accepts supplied summary/action slots. Both remain presentation-only. `EnrollmentRelation` adds only an optional selected-label callback; its search endpoints and selection values are unchanged. Locale identity and safe missing/enum/translation helpers are preserved. Default management labels use 项目参与 and 支持个案; health filtering is explicitly 健康状态.

## Student Support Analytics

| Region | Default state | Supplied facts |
|---|---|---|
| Scope | Compact, drawer editing | Existing from/to/Product/Cohort/Owner/Health filters |
| Health & Risk | Expanded, first | Active, attention and at-risk cases; high open risks; secondary visible-case/open-risk/check-in/review context |
| Goals & Interventions | Expanded | Active goals/interventions; supplied goal attainment and achieved/evaluated denominator |
| Outcomes | Expanded | Recorded outcome snapshot; contextual outcomes workspace action |
| Period activity | Compact summary | `checkins`, `risksResolved`, `outcomesRecorded`; full nine supplied period metrics in collapsed detail |
| Product/Cohort comparison | Collapsed | All fourteen existing comparison counts and locale-aware Product/Cohort identities |
| Historical trends | Collapsed | Supplied month/count rows |
| Status/type distributions | Collapsed | Supplied distribution counts, with safe enum presentation |

Cohort comparison is explicitly not a previous-period comparison. Goal attainment remains null/not evaluated when evaluated denominator is zero. An absent optional historical count is Not recorded, never synthesized zero. Missing required analytics fields make the module unavailable/error. Permission restriction, source unavailability and valid zero remain distinct. Period activity retains the existing explanation about current completed/resolved records and their business dates, rather than claiming historical transition totals.

The existing Cases/Analytics/Outcomes selector uses shared DetailTabs with selected tab/panel semantics, roving focus, arrows, Home and End. Cases, outcomes, risks, interventions and goals keep their existing APIs and mutations. This is a bounded content-switching change, not an operational Student Support redesign.

## Verification

| Gate | Result / evidence |
|---|---|
| Opening worktree / Phase 1 preservation | PASS — raw checkpoint; only intended shared presentation consumers evolved |
| Phase 1 focused contract regressions | PASS — 31 tests |
| Management, trends, attention, student support and presentation contracts | PASS — 49 tests |
| Combined focused tests | PASS — 80 tests, zero failures |
| Executive hierarchy / attention semantics / Action Center separation | PASS |
| 1920 first viewport | PASS — Attention/Changes start 285px; KPI starts 698.42px; actual category values also fit inside 1080px |
| 1440 / 375 layouts | PASS — correct priority, no document overflow |
| Scope apply/cancel/reset / validation / Product→Cohort draft | PASS — browser and contracts |
| PERIOD-only changes / no fake SNAPSHOT history | PASS |
| Null comparison / neutral direction / exact money and currency separation | PASS |
| Restricted ≠ unavailable ≠ zero | PASS — supplied permission/availability flags and valid-zero responses |
| Partial failure / retry / primary Overview failure | PASS — explicit synthetic HTTP 503 scenarios |
| Domain disclosure / scoped canonical drill contracts | PASS |
| Student analytics hierarchy / cohort comparison semantics | PASS |
| Goal denominator / optional vs required field semantics | PASS |
| Translation / safe fallback / unknown enums | PASS — zh-CN/en and Phase 1 probes |
| Accessibility | PASS — drawer trap/restoration, Escape, native disclosure, selected tabs/panel, Home/End, existing reduced-motion/focus rules retained |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — final QA-only additions also scoped-linted |
| `npm run build` | PASS — final runtime/CSS version 3.27.0 |
| `npm run test:public-privacy` | PASS |
| `npm run db:migrations:verify` | PASS |
| Historical migration raw-byte comparison | PASS — all 118 opening SQL files unchanged; latest 113, no 114 |
| Chromium management-experience | PASS — 25 state/viewport checks |
| Chromium ux-foundation regression | PASS — 23 state/viewport checks |
| QA server stopped | PASS — status running=false |
| Six Revenue candidates byte-identical/untracked/unstaged | PASS |
| Version / staging / whitespace boundaries | PASS — 3.27.0, empty staging, diff check clean |
| PostgreSQL management mutation suites | NOT REQUIRED / NOT RUN — no API/repository/RPC/RLS changes |
| Full Chromium matrix / full database campaign | NOT RUN — bounded affected-phase checks only |
| Deploy / Production | NOT RUN / NONE |

### Browser boundary

Pinned `ms-playwright/chromium-1243`, browser `153.0.8010.12`, Playwright `1.63.0`. Actual AppShell, Executive, Student Support workspace, Organization components and production CSS are used. Business APIs, navigation transport and responses are synthetic mocks. These results prove presentation and interaction behavior; they do not assert authenticated browser-to-real-DB or RLS coverage. The exact executable evidence and raw screenshots remain ignored/private.

Executive 1920 default full-page observation is 2186px, compared with the historical audit reference of about 7231px. The fixtures are not a controlled identical-data benchmark; reduction is achieved structurally by collapsed domain detail, not a universal pixel-height promise. Mobile Student Support health content begins within the first viewport. zh-CN and English samples pass, as do restricted source/role, valid zero, malformed required field and independent request failure states.

Evidence is under ignored `work/v328-phase2/` and `work/browser-qa-chromium-1243/phases/management-experience/` / `ux-foundation/`. No raw screenshots or logs are published. Expected injected HTTP failures are identified separately; unrelated browser errors remain failures.

## Revenue and non-scope

Revenue remains `V326_REVENUE_POLICY_INPUT_REQUIRED` — DEFERRED / UNTOUCHED. All six opening candidates are byte-identical, untracked and unstaged. No Revenue policy approval, ledger, posting, attribution, ROI, P&L, profit, forecast, business field, schema change, migration or version promotion was introduced. Organization Account Workspace, Student Workspace, Lead Queue, Dashboard, Contract and Product redesigns remain later phases.

No future CRM change may introduce real company identity, real customer/counterparty information, Production secrets, private infrastructure data or real transaction evidence into the public repository.
