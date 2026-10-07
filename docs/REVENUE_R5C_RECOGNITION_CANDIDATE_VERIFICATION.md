# Revenue R5C — Recognition candidate runtime verification

## Baseline and migration

Opening branch: `main`. HEAD: `cd19e48c19343536a9ad5f97e3c7bd89228f63f8`. Formal version: **3.31.0**. Opening migration: **116**, **121 SQL files**. The 37-file uncommitted working-tree candidate, including R5A and R5B, was the implementation baseline rather than HEAD alone.

Private opening status, tracked diff, staging, candidate fingerprints and all migration SHA256 values are retained in `work/revenue-r5c/opening.json`. All opening migrations, including 115 and 116, remain byte-identical. Historical Revenue documents/specifications and R5A/R5B phase-specific tests, repositories and reports remain unchanged. The only changed opening source is `lib/capabilities.ts`, with three additive candidate capabilities.

New migration: `202610080117_revenue_candidates.sql`. Final migration head: **117**, **122 SQL files**. Formal version remains **3.31.0**. No backfill is performed.

## Canonical owner and surface

Exactly one new relation, `revenue_recognition_candidates`, owns immutable ORIGINAL candidate snapshots. Contract versions, specified services, bindings, policies, fulfillment attestations, accounting periods, approvals, audit and mutation receipts remain the existing owners. There is no recognized fact, cash application, provider AP, correction or posting owner.

`lib/revenue-candidate-repository.ts` exposes evaluation, lifecycle commands and health through the existing database gateway. RPCs are `revenue_candidate_command` and `revenue_candidate_health`. Internal allocation, basis and approval helpers are not executable by application clients. No dedicated public HTTP endpoint, UI or worker was added.

Evaluation accepts only entity, service, binding, unit and request identity. The server derives amount, currency, date, exact policy, approved assessment and evidence. Client amount/date/currency/evidence/hash overrides are rejected.

## Evaluation and ownership

`revenue_candidate_basis` resolves an ACTIVE reporting profile, exact accepted commercial Contract version, immutable specified service, APPROVED binding and approved applicable non-TEST_ONLY policy. Retirement alone does not invalidate a previously approved applicable binding. New bindings still require approved policies under R5A.

Only ACCEPTED attestations for the exact service/binding/unit are selected, in stable ID order. The R5B resolver rechecks current source access, availability, version and hash. Its result must match the accepted attestation and the approved requirement digest. Operational COMPLETED, Contract signature and Payment are never queried as recognition triggers. Fulfillment supplies eligibility, not money.

Principal/Gross uses approved service consideration or approved allocated consideration. Agent/Net requires approved agent fee or explicitly approved allocation. Provider cost and outbound commission are absent from evaluator amount inputs. Organization type and cash route cannot select the financial interpretation.

Incomplete evaluation raises a precise blocking domain error without persisting a financial candidate. Examples include missing fulfillment, missing/closed period, invalid binding, unsupported precision and missing allocation. BLOCKED is reserved in the lifecycle vocabulary; this slice does not manufacture a zero-amount blocked snapshot where there is no authoritative date/amount basis. R5A already rejects bindings with missing allocation decisions.

## Exact calculation and allocation

Strategies are limited to POINT_IN_TIME_ON_APPROVED_EVIDENCE, OVER_TIME_BY_VERIFIED_UNITS and OVER_TIME_BY_APPROVED_MILESTONES. Amount strategies remain ACCEPTED_SERVICE_CONSIDERATION, APPROVED_AGENT_FEE and APPROVED_ALLOCATED_CONSIDERATION. There are no executable formulas, current-price lookups, cash-balance strategies or elapsed-calendar accrual.

`revenue_allocate_units` uses integer minor-unit numerators, exact PostgreSQL `numeric`, `div` and `mod`. Approved schedule `units` supply relative weights. Largest remainders receive residual cents in binding schedule order, with unit key as deterministic tie-breaker. All unit allocations sum exactly to the approved binding amount. Service-level bundle allocation must already be approved; the evaluator never equal-splits services.

For point-in-time/milestone units the entire approved unit must be fulfilled. For partial verified-unit coverage, the snapshot represents cumulative accepted quantity for that semantic unit. Partial minor units are floored; full coverage receives the exact remaining allocation. A later cumulative snapshot replaces, rather than adds to, the prior unposted candidate. One live candidate per semantic unit prevents summing both snapshots.

Tests demonstrate 100.00 across three equal milestones = 33.34 + 33.33 + 33.33; 1:2:3 weights allocate 16.67 to the first milestone; one and two of six verified units produce cumulative 16.66 and 33.33. Fractional quantity and maximum `numeric(14,2)` allocation tests conserve every minor unit without JavaScript floating-point accounting arithmetic.

Amounts persist as `numeric(14,2)` and are returned as decimal strings. Units retain R5A exact quantity semantics. Candidates have one currency. Initial supported two-decimal currencies are USD, CNY, EUR, GBP, HKD, AUD, CAD, NZD, SGD and CHF, additionally constrained by the reporting profile. Unsupported precision/currency fails closed; no rounding into an unsupported currency and no accounting FX conversion occur.

## Business date and accounting period

The server derives business date from the accepted evidence: the latest attestation date in a cumulative unit. It resolves the same-entity accounting period and requires OPEN. Missing or closed periods reject evaluation; closure before submission/approval makes an existing candidate stale. No date override or current-period substitution is exposed.

Cumulative attestations must belong to the same accounting period. A unit spanning multiple periods is explicitly rejected with `revenue_unit_cross_period_unsupported`, so earlier evidence cannot be silently moved forward. Such services must enumerate separate period unit keys in their approved schedule. The integration test verifies this refusal across two configured periods.

## Immutable basis, identity and staleness

`R5C_EVALUATOR_V1` and R5A canonical `revenue_digest` pin workspace/entity, Contract/version, stable service key, specified service, binding/version, policy/version, role/presentation, semantic unit, ordered attestation IDs/digests/source identities, accepted price/Quote references, amount/allocation/agent-fee basis, currency, date and accounting period/revision. No operational payload or contract document is copied.

The table is immutable from creation except lifecycle/review metadata. An UPDATE to amount, currency, date, evidence or digest is rejected even in privileged adversarial SQL. DELETE is rejected; draft purge is deferred.

Database uniqueness enforces one candidate per semantic scope plus digest. A partial unique index permits only one DRAFT/READY_FOR_REVIEW/APPROVED row per workspace/entity/Contract/stable-service/unit. Re-evaluation with another request key returns the same equivalent snapshot. A changed valid basis can create a successor only after the prior live basis is no longer current; the old unposted snapshot becomes STALE and remains retained. Rejected or stale identical snapshots are returned as historical records and are not revived. A new reviewable candidate requires changed approved basis.

No broad operational triggers mutate candidates. `revenue_candidate_health` derives CURRENT/STALE/BLOCKED. EVALUATE resolves current inputs; SUBMIT and APPROVE re-resolve the candidate basis. REVALIDATE allows a designated preparer to persist observed staleness. A stale command returns the STALE candidate rather than accidentally reporting successful approval. Direct generic Approval attempts on stale basis are rejected by the database guard.

Withdrawal, source change/unavailability, affected-unit successor, binding supersession and period closure invalidate processing. Unrelated Contract snapshots and later Product/Quote prices do not. Amendment tests retain Unit A on v1 while a successor's future Unit B uses v2. R5D must revalidate again and coordinate consumption of cumulative units with immutable posted facts.

## Approval, authority, RLS and audit

The existing designation owner adds RECOGNITION_PREPARER and RECOGNITION_REVIEWER. POLICY_OWNER is not implicitly a candidate operator. Assignment/revocation continues through R5A governance. New capabilities are `revenue.recognition.view`, `.manage` and `.review`; no post capability is added. Current administrator capability membership still requires active workspace/entity business designation at the database boundary.

EVALUATE/SUBMIT/REVALIDATE require preparer designation; APPROVE/REJECT require reviewer designation. All commands require AAL2 and recheck authority after obtaining the Revenue mutation lock. The creator cannot review their own candidate. ADMIN/SUPER_ADMIN without designation fail. RLS permits scoped lineage reads for designated preparers/reviewers; application clients cannot directly write candidate rows. Source detail remains behind canonical source permissions.

Submission creates an existing `approval_requests` row of exact type REVENUE_RECOGNITION_CANDIDATE and an `approval_actions` submission. The request pins candidate ID, revision, digest and entity. A Revenue-specific trigger guards both the candidate command and direct generic `decide_approval` entry. Existing foundation approval dispatch is preserved for its original types. The generic decision wrapper acquires the Revenue lock before locking the Approval row for this new type.

Approval changes only candidate review state and writes existing approval/audit/receipt records. It creates no Revenue fact or cash movement. Rejection preserves the basis and reviewer/reference. Audit includes opaque candidate/approval identity, digest, exact amount/currency/date and review actor. Audit failure rolls back state, Approval action and receipt; same-key retry succeeds once the injected failure is removed.

## Concurrency and idempotency

The inherited workspace Revenue advisory lock serializes mutation, including R5A authority/period/binding transitions and R5B withdrawal. Candidate commands recheck designation after that lock. Request receipt validation follows; target candidate/Approval rows and exact foundation/source rows are locked within the transaction. The generic decision path takes the same advisory lock before its Approval row lock. Canonical source shared locks serialize source checks with source mutations.

Unique constraints additionally protect semantic/basis identity. Concurrent same-basis evaluations with different request keys return one ID; concurrent reviewers produce one valid terminal decision. Period close and designation revocation held in another transaction cause waiting review to observe the committed change. Request-key reuse with changed payload conflicts; a lost-response retry returns the same approved result without another Approval action.

## R3 runtime mapping

| Scenario | R5C result and boundary |
|---|---|
| TX-001 own service | PASS: no candidate before fulfillment; Principal candidate 842.60 after explicit accepted evidence |
| TX-002A Principal | PASS: approved gross consideration 842.60; provider AP is not implemented or consulted |
| TX-002B Agent | PASS: approved fee 193.10 despite the same 842.60 cash magnitude; no cost subtraction |
| TX-003 channel collection | PASS: 631.95 net receipt does not replace approved 842.60 consideration |
| TX-004 reseller | PASS: school buyer service uses its accepted 417.25 consideration; school category does not select role |
| TX-005 two-sided recruitment | PASS: inbound service candidate 725.40 remains unchanged after canonical outbound commission accrual 87.30 |
| TX-006 deposit/offset | Cash-only non-trigger PASS using existing trade Payment; custody and offset runtime remain deferred to R5E, not simulated as implemented |
| TX-007 pre-recognition refund | PASS: Payment and full canonical Refund without fulfillment create no candidate or negative amount |
| TX-008 partial service/refund | Original earned-stage candidate PASS; refund-driven correction candidate/fact explicitly deferred to R5D |
| TX-009 over-time | PASS: only verified quantities contribute; cumulative replacement and cross-period refusal tested |
| TX-010 bundle | PASS for approved component amount 201.17 and deterministic schedule allocation; missing service allocation rejected by foundation validation, never guessed |
| TX-011 amendment | PASS: A stays pinned to v1, B uses approved v2; unrelated operational snapshots/current catalog do not reprice |
| TX-012 commercial FX | PASS: accepted CNY 622.17 and Quote v2 provenance remain unchanged after later Quote pricing; reference quote FX is contextual, no rate is rerun |

This matrix covers candidate behavior, not provider AP, custody, financial reporting, real tenant policy correctness or complete correction support.

## Verification

Environment: Node 26.10.0, npm 12.2.0. PostgreSQL **18.4-bookworm**; 18.6-trixie was not cached locally. No 18.6 verification is claimed. Fresh test containers use random names/credentials, tmpfs, loopback-only random ports, no application environment files and `finally` cleanup.

| Check | Result |
|---|---|
| R5C disposable PostgreSQL | PASS — `scripts/test-revenue-candidate-postgres.mjs` |
| R5A disposable PostgreSQL, unchanged | PASS |
| R5B disposable PostgreSQL, unchanged | PASS |
| Finance/commission disposable PostgreSQL | PASS — Payment, Refund, commission and settlement/RLS regression |
| R5C static contracts | PASS — 4 tests |
| R5B / R5A static contracts | PASS — 3 / 3 |
| R4 / R3 / R2.1 / R2 | PASS — 14 / 26 / 14 / 10 |
| R1, unchanged | 11/12; historical 3.29.0 versus current 3.31.0 version assertion fails |
| Historical foundation and decision pack, unchanged | 23/26; two historical 3.25.0 version assertions and one pre-runtime capability assumption fail |
| Typecheck | PASS |
| Lint | PASS; initial unused test-variable warning resolved with evidence-ID assertion; focused final lint clean |
| Build | PASS — local application build, no deployment; existing static route-classification notice |
| Public privacy | PASS — 13 tests, including pending candidate files |
| Migration manifest | PASS — head 117, 122 SQL files |
| Opening 121 SQL bytes | PASS — unchanged, including 115/116 |
| Browser | NOT REQUIRED — no UI/browser surface changed |

The historical foundation test was rerun with the repository's `tsx` loader after an initial loader-resolution failure. The table records the actual assertion results under the correct loader. No historical file was changed to make assertions green.

Integration checks include real canonical Payment/Refund, Enrollment, Contract linking, outbound Commission, Activity evidence, approved price/Quote provenance, largest-remainder and fractional-quantity arithmetic, source withdrawal/change/removal, duplicate evaluation and review, period/revocation races, audit rollback, direct material mutation/deletion denial, AAL1, self-review and generic administrator rejection. Positive test policies are fictional tenant-approved policies through the normal foundation workflow, not activated R3 TEST_ONLY policies. Unchanged R5A verifies TEST_ONLY rejection and composite reference guards.

Private command logs and hash manifests are retained under `work/revenue-r5c/`. No real source clauses, personal identities or application DB resources were used.

## Acceptance answers

| Question | Answer and evidence |
|---|---|
| Only approved service/binding/policy? | YES — `revenue_candidate_basis`, foundation acceptance and exact composite references; retired-policy exception only for existing approved binding |
| Can generic Payment or COMPLETED create a candidate? | NO — canonical cash/refund/completed Enrollment tests remain fulfillment-blocked |
| Can withdrawn/unhealthy evidence support a current candidate? | NO — source and withdrawal tests derive STALE and prevent approval |
| Can current Product Price reprice it? | NO — price, operational snapshot and Quote v3 regression preserve candidate ID and accepted version |
| Can provider cost or outbound Commission automatically reduce it? | NO — evaluator reads neither; canonical commission regression preserves inbound candidate amount |
| Principal and Agent, identical cash, different amounts? | YES — 842.60 gross versus approved 193.10 fee |
| Deterministic, sum-preserving allocation? | YES — exact `div`/`mod`, equal/weighted/fractional/extreme amount tests |
| Multiple equivalent candidates for one earning scope? | NO — semantic/digest uniqueness, live-unit index and concurrent evaluation test |
| Can stale candidate be approved? | NO — governed review and direct generic Approval revalidate and reject/mark stale |
| Does approval create Recognized Revenue? | NO — only candidate/Approval/audit/receipt writes; absent fact/cash tables verified in PostgreSQL |

## Architecture deltas and remaining boundaries

**R4_ARCHITECTURE_DELTA:** R5C implements ORIGINAL candidates only. No weak `original_fact_id` or correction-intent reference is introduced before the R5D immutable fact owner exists.

**R5_PLAN_DELTA:** Incomplete evaluations fail with blocking errors rather than persisting snapshots with invented financial basis. Same rejected basis remains historical and cannot be resubmitted by changing only the request key. Reviewed new basis is required.

**R5_PLAN_DELTA:** Partial evidence within one approved unit is a cumulative unposted snapshot. It is never an additive earning event. Cumulative evidence across accounting periods is unsupported; approved schedules must identify separate period units. R5D must coordinate posted unit consumption, residual amounts and append-only corrections before it permits replacing any basis already represented by a fact.

For amendment relevance, R5C invalidates predecessor processing only when a successor approved binding covers the same unit. An unrelated future unit does not invalidate existing accepted evidence for a different unit. Historical R5B creation rules are unchanged; this does not authorize new predecessor attestations.

Recognition Candidate ≠ Recognized Revenue Fact. Approved Candidate ≠ posted Revenue. Approved Candidate ≠ cash settlement. R5C does not implement corrections or deposit offset. No General Ledger, AP, P&L, accounting FX, forecasting, AI financial decision, dashboard or background posting was added.

R5D must consume only APPROVED, CURRENT candidates and revalidate source health, authority, period, semantic consumption and immutable basis again. Posting, fact identity, append-only correction lineage and posting receipts belong to that separate slice.

## Git boundary and verdict

Staging: EMPTY. Commit: NOT RUN. Push: NOT RUN. Deploy: NOT RUN. Production: NONE.

`REVENUE_R5C_RECOGNITION_CANDIDATE_RUNTIME_COMPLETE`

`REVENUE_R5D_RECOGNIZED_FACT_READY`

R5C Candidate runtime complete
≠ Recognized Revenue posted

Recognized Revenue runtime complete
≠ tenant accounting policy validated

Tenant policy validated
≠ every transaction automatically recognized
