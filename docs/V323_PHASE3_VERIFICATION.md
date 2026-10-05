# v3.23 Phase 3 — Management Attention & Decision Support

## Verdict

`V323_PHASE3_MANAGEMENT_ATTENTION_COMPLETE`

## Baseline

| Item | Result |
| --- | --- |
| Branch | main |
| Starting HEAD / Final HEAD | 99bbee8941917c1bb7a623c115b3f7edf6564873 |
| Version | 3.22.0 throughout Phase 3 |
| Runtime | Node 26.10.0 / npm 12.2.0 |
| Opening worktree | 63 combined Phase 1–2 candidate files, unstaged/uncommitted; index empty |
| Phase 1–2 baseline | Complete patch, raw snapshots, candidate manifest, source fingerprint, architecture/contract snapshot, both verification references and opening status in ignored `work/v323-phase3-baseline/` |
| Final worktree | Expected combined Phase 1–3 candidate; independently reversible Phase 3 delta |
| Commit / Push / Deploy | NOT RUN / NOT RUN / NOT RUN |
| Production access | NONE — disposable local PostgreSQL and localhost QA only |

No existing patch was applied. Opening fingerprints cover all 112 migration files through
107. Final manifests, raw snapshots, complete candidate, Phase 3 delta, source fingerprint,
migration hashes and verification JSON are saved in ignored `work/v323-phase3/`.

## Attention contract

The [Management architecture](MANAGEMENT_INTELLIGENCE_ARCHITECTURE.md) defines each reason's
canonical predicate, date, presentation severity, finite context, Product/Cohort applicability,
money visibility, route and natural exit. Attention is current derived state, not a persisted
Alert, Task, DQ finding, score, recommendation or business status.

| Reason | Canonical source / predicate | Source date / presentation severity | Decision context | Route / natural exit |
| --- | --- | --- | --- | --- |
| OVERDUE_RECEIVABLE | Visible schedule amount > paid_amount, due_date < workspace business today | due_date at business midnight / ATTENTION | Contract reference, due date, calendar days overdue, authorized currency and amount-paid_amount | Exact Contract reference/focus; exits when unpaid/overdue predicate no longer matches |
| OVERDUE_MILESTONE | Visible nonterminal milestone due_at < current instant | due_at / ATTENTION | Type/status, due date and calendar days overdue; derived Enrollment context | Enrollment Admissions tab/source; exits when completed/waived/cancelled or no longer overdue |
| BLOCKED_WORKFLOW | Visible canonical Workflow status=BLOCKED | started_at / ATTENTION | Status, template ID/version, started_at; no inferred blocked duration/reason | Enrollment Workflow tab/source; exits when status leaves BLOCKED |
| HIGH_OPEN_RISK | Visible confirmed Risk HIGH and OPEN/MONITORING | observed_at / CRITICAL | Type/severity/status, current human Health, actual last Check-in, active support count for that Risk | Success Case; exits when severity/status stops matching |
| STALE_CHECKIN | ACTIVE Case whose last actual Check-in or creation fallback is before today minus existing 30 calendar days | Last Check-in or created_at fallback / ATTENTION | Actual Check-in (NULL if none), next review, Health, open Risk and active support counts | Success Case; exits after recent Check-in or non-ACTIVE Case |
| HIGH_QUALITY_FINDING | HIGH OPEN/ASSIGNED finding intersecting a visible supported source | last_seen_at / ATTENTION | Rule key, DQ severity/state, entity type/ID; no details/narrative | Canonical entity or safe DQ workspace fallback; exits when finding/source stops matching |

Stable identity is reason + source type + source ID. DQ uses the actual finding ID, retaining
separate formal findings for one entity rather than collapsing different rules. The context
separately identifies its underlying entity. Unknown/invisible cached sources are omitted.
One Risk with three active Interventions is one row, count=3. Stale Case plus High Risk are
two independent items, not a deduplicated generic “Student problem”.

## Implementation

- Full workspace `/reports/executive/attention`, linked from Overview's first-30 summary.
- Authenticated, no-store, read-only `GET /api/management/attention`; no write endpoint.
- STABLE/security-invoker source projection and paginated read function; Overview calls
  that same contract, so total and first 30 reconcile with the full queue.
- Exact server count, summary by domain/reason/presentation severity, bounded page size
  (existing 10/20/50 convention plus max 100), stable PRIORITY/OLDEST/NEWEST ordering.
  Internal Overview alone uses 30. No browser-wide preload or per-row request.
- Domain, reason, presentation severity, Product/Cohort filters; canonical context rules
  continue applying only where real. Organization/Contact quality findings stay unfiltered.
  Owner, full-text search, historical Attention and date-range filters remain unavailable.
- Finite typed, discriminated context unions. Authorized money stays a per-currency decimal
  string; restricted is NULL, never zero. No Student identity, hidden Task or narrative text.
- Existing Finance Contract RLS is authoritative. All six current Education roles have
  finance.view; no existing role has a separate “visible Contract, hidden amount” capability.
  SQL verifies invisible sources/counts are omitted; hypothetical restricted context is
  defensively masked and tested in unit/browser fixtures without inventing a role framework.
- Open source is navigation only. No Resolve, Acknowledge, Dismiss, Snooze, Assign, Pay now,
  Complete, automatic Task, Management mutation, Automation trigger or external notification.
- Bilingual labels, reason/source context, restricted/empty states and mobile stacked cards.
  “No current items in your visible scope” makes no claim that the entire business is healthy.

## Migration

Frozen raw bytes remain unchanged:

| Migration | SHA256 |
| --- | --- |
| 106 | 3b58df3169aeb191a601611bf7eb92dc8af863efda409a6265087d5ba13539ac |
| 107 | 21d18fcfd20c10d8d1d49e03d427dd70866502a77fd2392757eb0cf4ef12cd83 |
| Forward 108 | 7385bc29a1d5f8a20249c714ecd802b098bd081a5ff44087fcc88f76de842fc2 |

108 is necessary because 107's first-30 response cannot provide full filtered pagination,
exact counts and safe context without reimplementing queries in another layer. It contains
only read functions and forward replacements for Overview reuse. No table, trigger, mutation,
index or new permission framework. All 112 opening migration raw fingerprints match, including
103–107; no existing migration was edited. 108 is frozen at the final hash above.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Phase 1–2 baseline / independent Phase 3 delta | PASS | Raw snapshots, complete patch, manifest and both prior verification references |
| Migration verification / historical raw bytes | PASS | `npm run db:migrations:verify`; 112 opening fingerprints unchanged |
| Declared runtime / retained version | PASS | Node 26.10.0 / npm 12.2.0; version 3.22.0 |
| Attention filters / repository / API / typed contract | PASS | 6 `tests/management-attention.test.mjs` tests |
| Existing metric / trend / drill contracts | PASS | 17 Management unit tests |
| PostgreSQL Attention integration | PASS | Six reasons, natural source resolution, finite context, no narrative; final 205+ fixture query **58.494 ms** |
| Exact Overview / full queue / reason counts | PASS | Same source function; byReason sum=total; first 30 and full visible total reconcile |
| Pagination / ordering / Product-Cohort filters | PASS | Multiple pages have unique complete identities; repeated first page stable; PRIORITY, OLDEST, NEWEST and filtered Overview reconciliation |
| Risk / Health / support independence | PASS | ON_TRACK with HIGH OPEN Risk allowed; three ACTIVE supports produce one Risk item with count=3; stale Case remains separate |
| Finance / shared-contract no fanout | PASS | Two overdue and one future fixture schedule; payment balance change removes one; shared/multiple links never duplicate schedule identity |
| Milestone / Workflow / Risk natural exit | PASS | Completion, exit from BLOCKED and Risk resolution remove items; MONITORING still qualifies |
| Stale / DQ natural exit | PASS | Real recent Check-in removes stale item; DQ resolution removes its finding without Management state |
| Tenant / hidden parent / source security | PASS | Hidden source actor and foreign workspace return 0 rows/counts, not merely hidden IDs |
| Money restriction / currencies | PASS | Canonical Finance RLS; unit/browser restricted decimal context masks amount/currency as NULL; CNY/USD never combined |
| No PII / narrative leakage | PASS | Explicit SQL fields and output assertions exclude Student identity, Risk/Check-in/support/Outcome narratives and DQ details |
| Pure reads | PASS | READ ONLY transaction; facts, Audit, receipts and commission ledger unchanged before/after query |
| Trends / exact drill-down PostgreSQL regression | PASS | Existing six-module test: equal previous period, previous zero, currencies, Taipei/DST, snapshot exclusion and 9 exact reconciliation scenarios |
| Finance / Enrollment / DQ / Automation regression | PASS | Dedicated operational-readiness PostgreSQL suite; canonical receipts/refunds, shared links, currency, rules, TASK/NOTIFICATION and retries |
| Admissions regression | PASS | Dedicated Workflow PostgreSQL suite: Tasks/Milestones, histories, RLS, privacy, DQ, Automation and rollback |
| Student Success / privacy regression | PASS | Dedicated Outcomes/Analytics PostgreSQL suite: status independence, business dates, current/period, VOIDED, Goal denominator, permissions/export/purge |
| Finance / Commission retention | PASS | Reused Channel/Commission Golden fixture and Student cleanup; Finance and immutable financial/commercial facts retained |
| No persisted Alert / score / inference / AI | PASS | SQL/API contract scans and pure-read assertions; no automatic Health/Risk/Task/state changes |
| Typecheck | PASS | `npm run typecheck` on final UI |
| Scoped lint | PASS | Phase 1–3 JS/TS sources/tests/QA; final mobile file and QA selector also checked |
| Production build | PASS | Final build; one justified repeat for real English 375px focus-button overflow fix |
| Affected Chromium | PASS | Chromium 1243 / 153.0.8010.12; zh-CN/en × 1440/375, four scenario groups |
| QA server | PASS — STOPPED | Official stop/status: running=false, pid=null |
| Complete candidate / Phase 3 reverse-check / whitespace | PASS | Both patches reverse-check; `git diff --check` |
| Commit / Push / Deploy | NOT RUN | No Phase 3 Git publishing instruction |
| Authenticated browser-to-real-DB E2E | NOT RUN | Boundary below; real database behavior tested separately |

No failure was waived. Fixture development corrected formal installment identity/status and
source revision/history requirements; no schema/permission bypass was used to make tests pass.
Browser QA corrected a selector to match native select label text, then detected a real English
mobile focus-button overflow. Wrapping was added to the UI; final typecheck/lint, rebuild and
the affected Chromium matrix passed. No full-repository audit or full ten-phase QA was run.

## Browser boundary

Actual React components, production CSS, mocked business APIs and a QA navigation harness.
This is not authenticated browser-to-real-database E2E. Real RLS, counts, projection, money,
source resolution, read-only behavior, timezone and privacy are verified separately in
PostgreSQL. Unknown DQ route fallback and restricted-context states use explicit fixtures.

Evidence: `work/browser-qa-chromium-1243/v323-phase3/phases/management-attention/`.
The report retains executable, exact revision/version, migration head, source fingerprint
and production build hash. Per-language/viewport checks include Overview/full total=46,
20-row pagination without duplicates, domain/reason/severity filters, precise Admissions
tabs and source routes, CNY/USD context, restricted amount, careful empty state, anonymous
GET 401, POST 405, bilingual labels and no horizontal body overflow. QA server is stopped.

## Explicit non-scope

Persisted Alerts; acknowledgement/assignment/snooze; Sales Targets, Quota, Budget; forecasts;
Revenue Attribution/Recognition; Channel Revenue/ROI; P&L, Gross Margin, Product Profitability;
historical snapshot warehouse; Management AI summaries/recommendations/forecasts and predictive
Risk; whole-student Success Rate, Success/Risk scores; configurable KPI builder. No ownership,
search, historical Attention trend, CRM Task creation or outbound notification was added.

Phase 4 is Operational Readiness & Release Closure over Overview, Trends, Comparison,
Drill-down, Attention and Decision Context; version promotion is deferred to that phase.
