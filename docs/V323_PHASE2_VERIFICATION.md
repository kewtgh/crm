# v3.23 Phase 2 — Operating Trends & Drill-down Consistency

## Verdict

`V323_PHASE2_OPERATING_TRENDS_COMPLETE`

## Baseline

| Item | Result |
| --- | --- |
| Branch | main |
| Starting HEAD / Final HEAD | 99bbee8941917c1bb7a623c115b3f7edf6564873 |
| Version | 3.22.0 throughout Phase 2 |
| Runtime | Node 26.10.0 / npm 12.2.0 |
| Opening worktree | 26 unstaged/untracked Phase 1 candidate files; index empty |
| Phase 1 checkpoint | Full patch, raw snapshots, manifest, source fingerprint, architecture/contract snapshot and verification in ignored `work/v323-phase2-baseline/` |
| Final worktree | Expected combined Phase 1–2 candidate; Phase 2 independently reversible |
| Commit / Push / Deploy | NOT RUN / NOT RUN / NOT RUN |
| Production access | NONE — disposable local PostgreSQL and localhost QA only |

No saved patch was applied. Opening raw fingerprints cover all 111 migrations through 106.
The complete candidate and Phase 2 delta, raw snapshots, manifest, migration fingerprints,
source fingerprint and verification JSON are retained in ignored `work/v323-phase2/`.

## Trend and comparison contract

[Management architecture](MANAGEMENT_INTELLIGENCE_ARCHITECTURE.md) contains the complete
per-metric source, formula, mode, date, currency, permission, trend/comparison support,
filter and exact-versus-context drill-down table. Typed contracts live in
`lib/management-metric-contract.ts` and `lib/management-trend-contract.ts`.

| Module | Supported period trends | Canonical bucket date / limitations |
| --- | --- | --- |
| Commercial | Leads created/converted; Opportunities won/lost; Won Opportunity Value by currency | created_at / converted_at / closed_at; current WON/LOST with closed_at, not a historical funnel |
| Delivery | Enrollments created, activated, completed, withdrawn, cancelled | created_at / genuine status history.changed_at; distinct Enrollment per target over the period, first entry selects its bucket; different targets may overlap |
| Finance | Confirmed Payment and completed Refund activity | paid_at / refunded_at; unchanged canonical statuses and per-currency amounts; shared Contract counted once, never allocated |
| Channel | Recruitment Events, net Commission accrued, Settlements paid | event starts_on / accrued_at / paid_at; canonical Channel Analytics and ledger, including REVERSAL once |
| Admissions | Applications submitted/decided; Milestones completed; Workflows started/completed | submitted_at / decision_at / completed_at / started_at; existing current lifecycle eligibility, not reconstructed historical status snapshots |
| Student Success | Check-ins, assessments, Risks observed/resolved, Interventions started/completed, Goals achieved, Outcomes recorded | Existing Success Analytics occurred_at / assessed_at / observed_at / resolved_at / started_on / completed_at / achieved_at / occurred_on; VOIDED excluded |

All aggregation is server-side and permission-filtered. Workspace business timezone defines
inclusive dates converted to half-open timestamp bounds. DAY through 45 days, WEEK through
180, otherwise MONTH; coarser granularity is allowed, excessively fine requests are upgraded.
Range is capped at 730 inclusive days. Monday weeks and calendar months are clipped to the
requested interval; available empty buckets are zero, restricted series are absent.

Previous comparable period is adjacent and has the same calendar-day length: Sep 1–30
compares with Aug 2–31. Both date ranges are explicit. Absolute change is current minus
previous; percent change is `100 * (current - previous) / previous`, or NULL when previous
is zero. Money comparisons use PostgreSQL numeric and decimal strings per currency, with
no FX or mixed-currency total. Neutral styling makes no generic good/bad judgment.

Snapshots have no trend or previous-period comparison: Open Pipeline, Outstanding, current
Health, Goal attainment and current status distributions cannot be reconstructed historically.
No created_at/updated_at approximation is presented as formal historical state.

## Drill-down contract and reconciliation

| Metric | Canonical target / predicate | Reconciliation |
| --- | --- | --- |
| Open Leads | Existing Leads list; NEW/QUALIFYING/QUALIFIED | PASS — exact current visible count |
| Qualified Leads | Existing Leads list; QUALIFIED | PASS — exact current visible count |
| Open Opportunities | Existing Pipeline list; non-WON/LOST, visible parents, all currencies | PASS — exact count; report scope removes legacy single-currency list constraint and mixed-currency summary |
| ACTIVE Enrollments | Existing Enrollments list; ACTIVE and derived Product/Cohort | PASS — exact visible count |
| AT_RISK Cases | Existing Success Cases list; AT_RISK, Case-inherited Enrollment access | PASS — nonzero fixture and exact count |
| Leads created in period | Existing Leads list; created_at business interval | PASS — exact count |
| Enrollments created in period | Existing Enrollments list; created_at business interval | PASS — exact count |
| Payments confirmed / currency | Existing Finance payments list; confirmed/refunded payment eligibility, paid_at, currency and visible Contract context | PASS — matching per-currency amount sum; same row/count predicate |
| Outcomes recorded in period | Existing Success Outcomes list/API; RECORDED, occurred_on, visible Case | PASS — exact count; VOIDED removed |

Additional typed exact filters cover Lead conversion, won/lost Opportunities, current open
Enrollments, distinct Enrollment transitions, current visible/active/attention Cases, and
current nonvoided Outcomes. Existing APIs/repositories and pagination are reused. URLs do
not grant access; the read predicate is applied to both rows and count before pagination.
Current recorded Outcomes ignore period bounds; period Outcomes use occurred_on.

Metrics without an exact native list filter link to their canonical workspace, explicitly
labelled Open workspace. Exact drill-down is unavailable for these metrics and is not claimed.
Channel/Success context links retain their respective canonical filter conventions.
Reconciliation assumes the same actor, filters and live read context; intervening business
edits can change subsequent reads. No historical snapshot is promised.

Attention links retain exact Contract reference/context, Enrollment Admissions/Workflow tab,
Success Case or known DQ source. Unknown source routes safely fall back to Data Quality.
No copied Management issue detail or persisted Alert was created.

## Implementation

- Read-only forward migration 107 provides STABLE/security-invoker Overview filter support,
  canonical period extraction, trends/comparison and shared domain-list predicates.
- No new business table, fact store, trigger, mutation, index or permission framework.
  Existing Channel/Success analytics are invoked directly; Finance uses the frozen shared
  Finance projection. EXPLAIN ANALYZE on the bounded seven-day fixture: **544.977 ms**.
- Separate authenticated/no-store `GET /api/management/trends`; Overview remains compatible
  and independently usable if the trend request fails. Same-filter Apply refreshes both.
- Product/Cohort context is derived per domain. Leads remain unaffected; Finance uses declared
  Contract Product / ACTIVE Enrollment-link Cohort without allocation; Owner remains deferred.
- Six modules show one or two primary period metrics, simple count bars or currency tables,
  explicit periods, neutral deltas, restricted states and bilingual feedback. No new dependency.
- No new DQ rule or Automation trigger. Attention remains a pure read of visible source facts.

## Frozen migrations

| Migration | SHA256 |
| --- | --- |
| 103 | a9478c99a1af8d93b0ff9df08b66fb395ef822a9dbc89109849a35a23f673e20 |
| 104 | dfaa74f7900bd918b669580e944fcd9af12135850991e87f556c060ae695d0d4 |
| 105 | c4da811b190d4bea35c6ccf634475b0304d58b68bd04766eda84f6c5f86fa5af |
| 106 | 3b58df3169aeb191a601611bf7eb92dc8af863efda409a6265087d5ba13539ac |
| 107 | 21d18fcfd20c10d8d1d49e03d427dd70866502a77fd2392757eb0cf4ef12cd83 |

All 111 opening migration raw hashes match; 103–106 were not modified. 107 is necessary for
shared server aggregation and safe predicates used by existing domain list/count queries.
It owns no business facts and is frozen at the final hash above.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Phase 1 baseline / independent delta | PASS | Full baseline snapshots; complete-candidate and Phase 2 reverse-check |
| Migration verification / historical raw bytes | PASS | `npm run db:migrations:verify`; 111 baseline raw fingerprints |
| Runtime / version | PASS | Node 26.10.0 / npm 12.2.0; 3.22.0 retained |
| Metric, trend, comparison, drill and repository contracts | PASS | 17 Management tests |
| Direct domain/unit regression | PASS | 58 targeted Finance/Enrollment/Channel/Commission/Admissions/Success/security tests |
| PostgreSQL trend integration / Golden Path | PASS | `test:management:trends:postgres`; six modules, Overview/Trend/domain reconciliation |
| Previous zero / currency / snapshot exclusion | PASS | NULL percent, per-currency numeric strings, no snapshot series |
| Business timezone / DST | PASS | Asia/Taipei midnight; America/New_York 23-hour DST boundary |
| Repeated transitions / no join fanout | PASS | First distinct target entry per period; independent canonical aggregates |
| Finance consistency / shared / Refund | PASS | Canonical Finance comparison and dedicated operational-readiness PostgreSQL regression |
| Channel / Commission / Settlement consistency | PASS | Existing Channel Golden fixture, reversal once, unchanged PAID settlement, real settlement race |
| Admissions consistency | PASS | Canonical dates/statuses and dedicated Workflow PostgreSQL regression |
| Student Success consistency | PASS | Direct canonical report comparison and dedicated Outcomes/Analytics PostgreSQL regression |
| Tenant / parent / role / money security | PASS | Foreign workspace zero; hidden Organization/Enrollment mother sets; restricted Finance/commission unavailable |
| Student / Contact privacy and financial retention | PASS | Student cleanup + retained ledger/Finance; dedicated Contact Intelligence cleanup |
| Data Quality / existing Automation | PASS | Existing bounded domain fixtures; no Management event or rule introduced |
| Pure read / no facts, audit, receipts or automation | PASS | Read-only transaction and before/after business, ledger, audit and receipt assertions |
| No Revenue, Targets, Forecast, AI or Success scores invented | PASS | Typed contract and negative scenarios; no snapshot deltas or inference |
| Typecheck | PASS | `npm run typecheck` against final UI |
| Scoped lint | PASS | Phase 1–2 JS/TS sources/tests/QA, then each final UI correction |
| Production build | PASS | Final `npm run build`; two justified repeats after build-affecting UI fixes described below |
| Affected Chromium | PASS | Chromium 1243 / 153.0.8010.12; 13 checks |
| QA server | PASS — STOPPED | Official stop/status: running=false, pid=null |
| Candidate / Phase 2 reverse-check / whitespace | PASS | Complete-candidate and independent delta; `git diff --check` |
| Commit / Push / Deploy | NOT RUN | Not authorized for this Phase |
| Authenticated browser-to-real-DB E2E | NOT RUN | Browser boundary below |

No failure was waived. Fixture development corrected canonical Channel parameter names,
an actual empty Product fixture, permitted workspace DST timezone and installed PostgreSQL
image selection. Final database gates passed. Final UI review corrected the current Outcome
scope label; browser QA then found Apply with unchanged filters refreshed Overview but not
Trends. That source bug was fixed and verified, requiring the two build repeats. Browser
QA was rerun only after this meaningful change and passed against the final source/build.

## Browser boundary

Actual React components, production CSS and mocked business APIs/router; not authenticated
browser-to-real-database E2E. Real RLS, calculations, timezone, comparison, money, privacy
and reconciliation were tested separately in PostgreSQL. Browser evidence retains revision,
executable, version, source fingerprint, migration head and production build hash under:

`work/browser-qa-chromium-1243/v323-phase2/phases/management-trends/`

The 13 checks comprise four en/zh-CN × 1440/375 views, eight actual canonical domain-list
drill-downs and Product/Cohort/error/retry behavior. Available/restricted Finance, normal and
zero previous values, explicit comparison periods, CNY/USD separation, anonymous GET 401,
POST 405 and no body overflow were verified. QA server is stopped.

## Explicit non-scope

Sales Targets, Quota, Budget, Forecasting; Revenue Attribution/Recognition; Channel Revenue/ROI;
P&L, Gross Margin, Product Profitability; historical snapshot warehouse; persisted Management
Alerts; Management AI, executive summaries/recommendations/forecasts; whole-student Success
Rate, Success Score, Risk Score; configurable KPI builder. Owner filtering, historical Open
Pipeline/Outstanding/Goal-attainment trends and unsupported exact drill-downs remain deferred.
