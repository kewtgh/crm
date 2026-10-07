# Revenue R5F — Read Models & Operational UI

## Baseline and preservation

The current working tree, including uncommitted R5A–R5E, was the implementation baseline. No reset, checkout, stash, clean, or reconstruction from HEAD was performed.

| Item | Opening | Closing |
|---|---|---|
| Branch | `main` | `main` |
| HEAD | `cd19e48c19343536a9ad5f97e3c7bd89228f63f8` | unchanged |
| Formal version | `3.31.0` | unchanged |
| Logical migration head | 119 | 120 |
| SQL files | 124 | 125 |
| Staging | empty | empty |

Private opening Git state, tracked diff, staging, 124 SQL hashes, 53 existing phase/shared-runtime fingerprints, and additional UI integration fingerprints are under `work/revenue-r5f/`. All opening SQL and all 53 existing phase fingerprints remain byte-identical. This includes migrations 115–119, historical phase reports/tests, and the opening capability implementation. R5F adds compatibility entries; it does not rewrite historical tests.

## IA, routes, and reusable components

Revenue is a destination in the existing **Commercial** navigation space, adjacent to Finance and Commissions. It is also linked from Finance. No new global navigation group was added.

- `/finance/revenue`: operational queue, Contract context, services/bindings, fulfillment, recognized history, configuration, and authorized cash context.
- Existing Contract workspace: capability-gated Revenue tab with canonical financial summary and a scoped service → evidence → candidate → fact workspace link.
- `/api/revenue`: bounded reads and a finite, validated dispatch surface for existing R5A–E commands. There is no generic financial CRUD endpoint.
- `components/revenue-workspace.tsx`: operational workspace using the existing `AccessibleDrawer`, buttons, API client, localization provider, and mutation-outcome helper.
- `components/contract-revenue-section.tsx`: Contract integration.
- `lib/revenue-workspace-labels.ts`: English and zh-CN labels, financial distinctions, and actionable domain errors.

The UI uses compact records with labeled fields on desktop and stacked records on narrow screens. Details and confirmations use the existing focus-managed drawer. Filters for Contract/service search, status, and currency persist in URL state, including page and tab navigation.

## Read architecture and migration justification

`202610080120_revenue_workspace_reads.sql` adds **functions only**. There are no tables, materialized views, summary caches, financial writes, new business authorities, or new capabilities.

A read/security migration was necessary: R5C's public health helper and RLS admit preparers/reviewers, while the independently designated poster needs the same immutable review basis. Foundation and evidence RLS are similarly partitioned by phase. Application-side joins or an elevated system repository would either omit necessary review context or bypass user scope. The new security-definer projection validates the authenticated workspace, entity designation, and canonical record visibility, with fixed `search_path` and explicit grants. Internal health/history helpers are not executable by app/system/worker roles.

| Projection | Authoritative source and behavior |
|---|---|
| Overview | `recognized_revenue_facts`, including every signed correction, grouped by currency |
| Recognition queue | 25 candidates per page; exact basis health resolved by the existing evaluators; lifecycle status and health remain separate |
| Candidate amounts | Latest unconsumed live semantic-unit basis only; consumed candidates and cumulative ORIGINAL bases for already-posted units are excluded from pending sums. Multiple correction intents are not summed as separate earnings. Totals explicitly cover the current queue page |
| Candidate detail | Pinned Contract/service/policy/binding, amount explanation, evidence references, business date/period, reviewer and basis digest |
| Fact history | 100 facts per page; immutable original/correction rows plus server-derived current root balance, grouped within currency |
| Contract summary | Existing `contract_finance_snapshot`; outbound Commission is a separately labeled aggregate from `commission_accruals` |
| Configuration | Entity profile, explicit designations, periods, policy versions and Binding assessment; bounded lists |
| Cash context | R5E `cash_source_status` / `cash_target_status`, permitted outstanding targets, and server-derived unreversed application capacity |
| Evidence options | `revenue_source_options`: explicit CRM Activity / Student Enrollment resolvers, bounded source references, no private source payload |

Evidence options are resolved when a form opens, rather than resolving every possible source for every Binding in the workspace list. Health evaluation is bounded by the queue page; no dashboard snapshot/cache or worker was introduced.

Historical Revenue uses a separate read-permission helper rather than cash-target applicability. A cancelled Contract must not disappear from retained Revenue history or lower its recognized total. Operational Finance/cash projections continue to require R5E's stricter applicability. Existing accounting and cash commands are unchanged.

## Financial semantic separation

All money is rendered from server decimal strings. React performs no Revenue, allocation, correction, outstanding, or available-cash arithmetic. No accounting FX or combined-currency total exists.

Verified real PostgreSQL projections include:

- Contract Value **1000.00**, Receivable **1000.00**, Collected **700.00**, Recognized Revenue **400.00**.
- Custody received **100.00**, applied **60.00**, available **40.00**, independently recognized **80.00**.
- Original **100.00** and correction **−30.00** remain separate; the root's current recognized amount is **70.00**.
- Cancelled Contract: posted **100.00** remains in authorized Revenue history, while inapplicable cash sources/targets are not actionable.

The browser fixture additionally displays outbound Commission **100.00** separately from the Contract/Receivable/Collected/Revenue values, and CNY/ USD summaries independently. Cash application changes settlement context, never the Revenue metric.

## Operational actions and governance

Server-returned eligibility drives mutation controls. Generic ADMIN/SUPER_ADMIN membership is insufficient. Every write still passes existing database designation, workspace/entity, state/revision, maker/checker, AAL2, receipt, audit, and financial-basis guards.

| Surface | Commands exposed |
|---|---|
| Candidate | Explicit evaluate; submit; approve/reject; revalidate |
| Posting | Separate confirmation showing immutable amount/currency, date/period, Contract/service/unit, policy/binding, reviewer, and health; posting reference only |
| Corrections | Select existing root and current approved revised-entitlement Candidate; server derives delta; submit → independent review → independent post |
| Policy | Create/next version; configure constrained draft correction rule; submit; approve/reject |
| Binding | Select approved non-test policy; explicit role/presentation/amount/allocation/variance and unit schedule; configure per-unit evidence requirement; submit; approve/reject |
| Evidence | Select server-returned qualifying source; create; submit; verify/reject; governed withdrawal |
| Period | View and close an OPEN period with reference; no invented reopen operation |
| Cash | Apply to server-returned permitted outstanding targets; release unreversed application capacity; neither action is a refund or Revenue event |

Preparer, reviewer and poster remain **three distinct actors**. Posting authority is not cash-management authority. Policy approval is not recognition review. A candidate approval never posts a fact. Posted facts have no edit/delete/restore control.

The API validates a finite operation union, checks trusted origin and the appropriate existing capability, and requires AAL2 for mutations. MFA recovery uses the existing challenge route. It does not introduce another authentication or approval engine. Client-supplied Candidate/Fact amounts, dates, policy decisions or source snapshots are not dispatched as authoritative evaluation inputs.

Initial reporting-profile provisioning, authority bootstrap, accepted commercial-version/service onboarding, and period creation remain controlled operations through the existing R5A repository commands. They are not self-service administrator buttons. This preserves the established provisioning and accepted-price authority boundary. A provisioned disposable tenant can manage policies, Bindings, fulfillment, review and posting through the new UI. Advanced multi-source requirement editing and custody receipt/refund initiation remain on existing governed repository/Finance paths; R5F does not add a second refund form or bank workspace.

## Reliability, privacy, and accessibility

- Existing `apiFetch` and `settleMutation` separate the write result from refresh failure.
- An uncertain outcome retains the same payload/request key, including across a same-user/entity page reload. Retry is explicit, never automatic financial replay.
- After an accepted write with failed refresh, further financial controls are held until a successful refresh. Recovery is read-only.
- Newer read requests supersede older responses. Source-picker responses are tied to the current form request.
- AAL2 elevation retains request identity. Revoked authority/state is rechecked by the DB; known domain failures are translated and eligibility is refreshed.
- Evidence contains opaque references, versions/hashes, dates and verification lineage. Full source payloads are not returned. Canonical source links are offered only after resolver access succeeds and remain subject to their own route permissions.
- Drawers use existing keyboard/focus management; status and health have text labels, not color-only meaning. Form controls have labels; errors use alerts and accepted outcomes use status announcements.
- Fixtures and screenshots contain independently fictional information only. Browser screenshots/logs remain under ignored `work/` paths.

## Verification

All PostgreSQL verification used fresh, disposable containers with random identities/credentials, tmpfs, loopback-only ports and finally-cleanup. Local PostgreSQL 18.6 was unavailable; the actual tested image was **`postgres:18.4-bookworm`**. No application/Production database was used for the integration suites.

| Check | Result |
|---|---|
| R5F read-model PostgreSQL | PASS: scoped reads, real financial separation, source choices, retained cancelled-Contract history, designation, poster access, cash separation |
| R5F correction-read PostgreSQL | PASS: R5D financial assertions plus original/correction history and root aggregate |
| R5A unchanged PostgreSQL | PASS |
| R5B unchanged PostgreSQL | PASS |
| R5C current-schema compatibility | PASS; only the two superseded owner-absence assertions differ in the generated private entry |
| R5D current-schema compatibility with R5F read assertions | PASS; financial assertions preserved |
| R5E unchanged PostgreSQL | PASS |
| Finance/Commission PostgreSQL | PASS |
| R5C unchanged historical PostgreSQL | FAIL at line 246: expects `recognized_revenue_facts` absent; R5D legitimately introduced it |
| R5D unchanged historical PostgreSQL | FAIL at line 232: expects `cash_applications` absent; R5E legitimately introduced it |
| R5A–E unchanged static + R5F static | 27/27 PASS |
| Typecheck | PASS |
| Lint | PASS, zero errors/warnings |
| Production build | PASS, version 3.31.0 |
| Scoped browser verification | 18 checks PASS; pinned Chromium 1243, actual version 153.0.8010.12 |
| Public privacy | 13/13 PASS |
| Migration verification | PASS: head 120, 125 SQL files; read/security extension only |
| Final protection and Git checks | All opening 124 SQL files and 53 protected fingerprints unchanged; staging empty; `git diff --check` PASS |

Historical failures are neither relabeled PASS nor counted as R5F functional regressions. Original files remain byte-identical. The compatibility entries are explicit new files, and their generated substitutions/hashes are retained privately.

Browser verification uses the repository's pinned **Chromium 1243** workflow, scoped to `QA_PHASE=revenue-workspace`, with actual components and production CSS against fictional API fixtures. It covers overview/queue, Candidate detail and keyboard focus, approval, posting confirmation, accepted-write/failed-refresh recovery, history/corrections, Contract Revenue integration, policy/configuration, evidence verification, cash context/application, same-identity retry, zh-CN, and desktop/tablet/mobile widths. Browser fixtures demonstrate presentation/interaction, not database authorization; the disposable PostgreSQL suites independently verify the latter.

## Acceptance answers

| Question | Answer and implementation/test evidence |
|---|---|
| Revenue comes only from recognized facts? | YES — migration 120 recognized aggregate; real read-model and correction-read suites |
| Contracted, Receivable, Collected and Revenue separate? | YES — canonical Finance projection plus independent fact aggregate; 1000/1000/700/400 test |
| Custody/applied settlement separate from Revenue? | YES — R5E projections; 100/60/40/80 test |
| Mixed currencies remain separate? | YES — currency grouping and decimal-string rendering; multi-currency fixtures |
| Can approval be mistaken for posting? | NO — separate actions, status/health and confirmation; browser approval leaves recognized total unchanged |
| Can generic ADMIN expose approval/posting without designation? | NO — read eligibility and every DB mutation require entity designation; ordinary-admin and super-admin denial tests |
| Can frontend override Candidate/Fact amounts? | NO — finite API dispatch accepts target references only for evaluation/posting; financial calculation remains in existing RPCs |
| Can posted Revenue be edited/deleted? | NO — no UI/API operation; unchanged R5D immutability tests |
| Are corrections append-only and understandable? | YES — original, signed correction, root/prior and current aggregate; real 100 − 30 = 70 test |
| Can Contract explain service → evidence → Candidate → Fact? | YES — Contract Revenue entry, pinned services/bindings, evidence and immutable detail/history |
| Are blocked/stale reasons visible? | YES — evaluator-derived health/reasons, separate from lifecycle status; stale/closed-period posting unavailable |
| Can failed refresh repeat a financial mutation? | NO — accepted/refresh-failed mode is refresh-only; uncertain retry preserves exact identity |
| Three-actor boundary preserved? | YES — server action eligibility excludes creator/reviewer from posting; DB revalidates; correction UI keeps stages separate |
| Can cash application change Revenue? | NO — existing cash commands only; R5E/current read and browser financial-independence checks |
| New financial canonical owner? | NO — migration 120 is read/security functions only; static ownership test |

## Limits and phase boundary

Queue totals are explicitly page-scoped, not executive analytics. Other reference/configuration lists and source pickers are bounded; they are not bulk exports. There is no automated candidate generation, automatic policy decision, posting worker, P&L, general ledger, tax engine, accounting FX, provider AP, forecast, or attribution.

No R5A–E accounting command, strategy, amount rule, posting identity, correction rule, cash ceiling, or canonical owner was changed. The only database extension is the scoped read surface. Existing workspace selection still fails closed on mismatched Revenue context; this inherited boundary was not rewritten.

Staging: **EMPTY**. Commit: **NOT RUN**. Push: **NOT RUN**. Deploy: **NOT RUN**. Production: **NONE**. Version remains **3.31.0**. Release closure/version promotion belongs to R5G.

Final verdict:

```text
REVENUE_R5F_READ_UI_COMPLETE
REVENUE_R5G_INTEGRATED_CLOSURE_READY
```

```text
R5F Revenue UI complete
≠ R5 integrated release closed

R5 Revenue runtime complete
≠ General Ledger complete

Lumina Revenue capability
≠ tenant accounting policy independently validated
```
