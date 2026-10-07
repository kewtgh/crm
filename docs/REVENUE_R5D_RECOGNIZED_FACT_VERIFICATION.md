# Revenue R5D — Recognized facts and corrections

## Baseline and scope

The implementation starts from the **working tree**, not from the checkpoint commit. Opening branch: `main`; HEAD: `cd19e48c19343536a9ad5f97e3c7bd89228f63f8`; formal version: **3.31.0**; migration head: **117**, **122 SQL files**. R5A–R5C were uncommitted. Opening status, tracked diff, index, 42 existing phase-artifact fingerprints and all SQL SHA256 values are retained privately in ignored `work/revenue-r5d/opening.json`.

R5D adds migration `202610080118_revenue_facts.sql`, repository operations, a disposable PostgreSQL suite and five static contracts. The only shared TypeScript change adds `revenue.recognition.post`, including its AAL2 classification. It does not add UI, workers, cash applications, deposit offset, AP, GL, tax, accounting FX, attribution or analytics.

## Canonical ownership and migration

The one new relation is `recognized_revenue_facts`. Existing Contract/version, specified service, policy, binding, attestation, candidate, Payment, Refund, Commission, Approval, Audit and mutation receipt owners remain authoritative.

Migration 118 extends the existing candidate with `candidate_kind`, original/prior fact references, correction intent/reason and a server-derived revised-entitlement snapshot. Existing candidate rows deterministically default to `ORIGINAL`: R5C could create no other kind. There is **no guessed financial backfill** and migration application creates no recognized facts.

Policy versions gain a constrained `correction_rule`. Its default is `BLOCKED`. A policy owner can configure `REVISED_ENTITLEMENT`, an explicit prior-period permission and a reference **only in their draft**, with revision, audit and receipt. Submission freezes the content and existing approval binds the complete version. Approved historical policies cannot silently acquire correction rights.

All opening SQL, including 115–117, and historical Revenue documents/tests remain byte-identical. Final verification: **head 118, 123 SQL files**. All 122 opening SQL hashes match; 41 of the 42 opening candidate paths match exactly, with only the authorized additive `lib/capabilities.ts` extension differing. Version remains **3.31.0**.

## Runtime operations

| RPC | Purpose |
|---|---|
| `revenue_set_correction_rule` | Configure a draft policy's bounded correction behavior before approval |
| `revenue_evaluate_correction` | Derive a correction candidate from an original fact and an independently approved revised cumulative entitlement |
| `revenue_post_candidate` | Post exactly one current approved candidate under a designated independent poster |
| `revenue_recognized_lineage` | Read root, immutable history and exact same-currency current total |

`lib/revenue-fact-repository.ts` follows the existing database gateway. Posting accepts candidate ID, expected revision, posting reference and request key; it accepts no amount, currency, policy or date override. Correction inputs are references and intent, never a caller-supplied signed amount. Candidate submit/approve/reject continues through the existing R5C command and canonical Approval infrastructure.

## Posting and authority

Posting checks active workspace membership, the current Revenue workspace, entity-specific `POSTING_AUTHORITY`, administrator capability eligibility and AAL2. Role membership alone is insufficient. The preparer, reviewer and poster must be **three distinct actors**. An existing reviewer may receive a posting designation, but still cannot post a candidate they reviewed.

Within one transaction, posting checks request identity, locks the candidate and approval basis, validates exact approval ID/digest/revision/entity/reviewer, rejects TEST_ONLY, and reruns R5C basis resolution. This rechecks the ACTIVE profile, accepted commercial Contract/version, approved applicable binding, policy, accepted/current attestations, operational source health, amount provenance, business date and OPEN accounting period. Retired policies remain usable only under the existing approved-binding rules; no current Product policy is read.

Fact insertion, canonical audit and receipt are atomic. The fact includes the exact candidate/version/service/binding/policy/unit, amount/currency, business date/period, poster, approval/posting references and source digest. A deferred constraint trigger requires the matching posting receipt and audit before commit. Workers/system callers have no execution grant. No approval function inserts a fact.

The added capability follows the existing role taxonomy; the database independently enforces its ADMIN/SUPER_ADMIN eligibility plus designated business authority. It does not introduce a role-only approval bypass or an external posting endpoint.

## Identity, immutability and retention

Database uniqueness enforces:

- At most one fact per candidate.
- One ORIGINAL per `(workspace, reporting entity, Contract, stable service key, recognition unit)`.
- One posted correction per root and correction intent, independently of request key.

Changing candidate, evidence, binding, date or request key cannot manufacture another ORIGINAL. Composite foreign keys retain workspace/entity/service/version and same-currency correction-root scope. No cascading removal of operational data deletes fact history.

An unconditional trigger rejects every fact UPDATE and DELETE, including privileged SQL with normal triggers enabled. Application/system/worker INSERT/UPDATE/DELETE grants are revoked. A privileged direct INSERT lacking the atomic posting receipt/audit is also rejected. Database superusers capable of disabling integrity mechanisms remain an infrastructure trust boundary; no application role has that privilege.

Reads require Revenue designation and workspace scope. They return minimal opaque lineage, not private source bodies. Source detail access remains governed by the canonical domain. Policy retirement, user authority revocation or operational source removal cannot rewrite facts. Accounting history has no recoverable-delete route or mutable STALE/VOID state.

## Corrections and cumulative units

Correction evaluation requires an existing ORIGINAL root and a **CURRENT, APPROVED revised ORIGINAL candidate** for the same Contract/stable service/unit/currency. That candidate expresses the revised cumulative entitlement using approved policy, binding and current evidence. Root and revised policies must both permit corrections. Evaluation snapshots the ordered fact chain, prior fact, revised candidate/revision/digest, policy rules, date/period, optional verified Refund reference and reason. No raw source payload is copied.

The exact calculation is:

```text
delta = approved revised cumulative entitlement - sum(root and posted corrections)
```

Amounts are PostgreSQL `numeric(14,2)` and API decimal strings. There is no floating-point accounting calculation or implicit FX. The current balance is derived, never a mutable balance owner.

REVERSAL must be negative and cannot reduce the lineage below zero. ADJUSTMENT may increase or decrease only to the approved target. Full reversal requires an approved zero target. A paid Refund is validated through its canonical Payment/Contract/currency; its cash amount is contextual and does not determine the correction amount. Refund before any original fact cannot create a reversal.

REPLACEMENT uses **one signed net replacement fact**. For current 100 and approved replacement 80, it appends -20 with the target 80 and prior 100 retained in the approved candidate snapshot. This is the bounded equivalent of reversing 100 and replacing 80, preserves one candidate → one fact, and cannot leave a half replacement. Audit/receipt failures roll back the entire transaction.

For partial verified units, R5C candidates are cumulative. R5D uses **Option B**: first posting is ORIGINAL; later growth requires a separately prepared/reviewed ADJUSTMENT candidate. The verified sequence is `16.66 + 16.67 + 66.67 = 100.00`. Attempting to post the later cumulative 33.33 as another ORIGINAL fails. The final minor-unit remainder remains exact.

Concurrent correction candidates pin the prior consumption chain. After one posts, the other is stale and cannot post its old delta. Same intent/same payload returns the existing candidate; changed payload under that intent conflicts. Posted candidate health may subsequently become stale as consumption/evidence changes; the **fact** remains immutable. A successful posting retry returns the original fact without repeating the mutation.

## Periods and concurrency

Business date and accounting period always come from the approved candidate, never from the poster. An original cannot move silently from a CLOSED period. A prior-period correction requires both approved policy versions to explicitly permit it and a new approved candidate with a genuine evidence-derived business date in an OPEN period. The new fact preserves original business date, root and `prior_period_flag`; the original period is untouched. Date overrides and period reopening are not added.

The inherited workspace Revenue advisory transaction lock is acquired before receipt and domain-row locks. Commands recheck designation after waiting. Posting then locks candidate, policy/approval, basis sources and period; correction evaluation locks the root/revised candidate and resolves consumption under that same workspace lock. This conservatively serializes Revenue mutations, compatible with authority changes, period close, attestation review and candidate approval. Operational source rows are locked during resolution. Database uniqueness remains a second defense.

Tests cover concurrent same-candidate posting, competing corrections, close-before-post, revocation-before-post and both withdrawal-before-post/post-before-withdrawal outcomes. Accepted writes with lost responses and alternate request keys return the same fact. No UI guard is relied upon.

## Architecture clarifications

- **R5C_INTEGRATION_DELTA — cumulative consumption:** first ORIGINAL plus subsequent approved ADJUSTMENT preserves one original earning identity. The R5C evaluator itself remains unchanged; its command's original-candidate replacement scan now excludes correction candidates.
- **R4_ARCHITECTURE_DELTA — explicit correction rule:** existing policies had descriptive references but no executable constrained correction choice. The draft-only approved rule defaults to BLOCKED; prior-period treatment is never inferred.
- **R5_PLAN_DELTA — replacement:** a single net REPLACEMENT fact with exact approved target/prior snapshots avoids a two-fact candidate exception and half-replacement risk.
- The inherited explicit Revenue workspace must still match canonical current workspace; this slice does not redesign workspace selection.
- Refund currency is owned by canonical Payment, not duplicated onto Refund or newly persisted as another cash owner.

## R3 scenario-to-runtime mapping

| Scenario | R5D result and scope |
|---|---|
| TX-001 | Earned own-service ORIGINAL posts without Payment |
| TX-002A | PRINCIPAL/GROSS posts accepted consideration; provider cost is not read or deducted |
| TX-002B | AGENT/NET posts approved fee 193.10, independently of customer cash 842.60 |
| TX-003 | Channel collection retains approved gross basis; net remittance is not a calculation input |
| TX-004 | Reseller uses company-buyer Contract amount; Organization type does not set role |
| TX-005 | Inbound service posts independently; outbound Commission owner and behavior remain unchanged |
| TX-006 | Separately earned service may post; deposit custody/application/offset remain **unimplemented, R5E** |
| TX-007 | Payment/refund without fulfillment produces no candidate/fact or fictitious reversal |
| TX-008 | Original plus independently approved revised entitlement produces append-only correction; Refund amount is contextual |
| TX-009 | First cumulative ORIGINAL plus reviewed delta ADJUSTMENT; exact final remainder |
| TX-010 | Only approved allocated candidate basis posts; no automatic bundle split |
| TX-011 | Historical version's fact remains; genuinely new amended unit can post under the new version |
| TX-012 | Accepted CNY 622.17 and Quote v2 provenance persist despite Quote v3; no FX recalculation |

The R5D suite verifies the posted amounts and independence contracts; unchanged R5C tests supply broader allocation, generic completion and candidate-stage source scenarios. These fictional scenarios prove runtime mechanics, not actual tenant accounting conclusions.

## Verification

Disposable PostgreSQL uses the locally available **postgres:18.4-bookworm**. Local image inspection found no 18.6 image; no 18.6 verification is claimed. The runner uses a random container/name/password, tmpfs, loopback-only random port, no application environment file and finally cleanup.

| Check | Result |
|---|---|
| R5D PostgreSQL | PASS: migration, posting, authority/AAL2/independence, source health, TEST_ONLY defense, RLS, direct SQL immutability, receipts, correction bounds/replay/race, replacement rollback, cumulative conservation, period/revocation/withdrawal races, Quote/catalog/amendment pinning |
| Unchanged R5A PostgreSQL | PASS |
| Unchanged R5B PostgreSQL | PASS |
| Unchanged R5C PostgreSQL | **Historical boundary failure** at `scripts/test-revenue-candidate-postgres.mjs:246`: expects `recognized_revenue_facts` absent. Earlier amount, source health, approval, concurrency and immutability checks pass. Its later checks are not claimed executed; R5D separately covers scope/period/revocation. |
| Finance/commission PostgreSQL | PASS: payments, paid refunds, commission settlements, currency, race/RLS/retention |
| R5D static contracts | 5/5 PASS |
| R5C / R5B / R5A static | 4/4, 3/3, 3/3 PASS |
| R4 / R3 / R2.1 / R2 | 14/14, 26/26, 14/14, 10/10 PASS |
| R1 | 11/12; unchanged 3.29.0 versus 3.31.0 assertion fails |
| Historical foundation/decision pack | 23/26; two 3.25.0 version assertions and prior “no Revenue write capability” assertion fail unchanged |
| Public privacy | 13/13 PASS |
| Typecheck | PASS |
| Lint | Full run: zero errors, one unused test variable warning; variable removed and affected-file lint rerun: zero errors/warnings |
| Build | PASS, version 3.31.0; existing vinext static route-classification notice only |
| Migration verification / opening byte comparison / diff check | PASS: head 118, 123 SQL; original 122 SQL unchanged; protected phase artifacts unchanged; staging empty |
| Browser | NOT REQUIRED: no browser-facing UI changed |

Raw logs and final manifests remain ignored under `work/revenue-r5d/`. Historical tests and reports were not rewritten to manufacture a green result.

## Acceptance answers

Implementation evidence is migration 118 (`revenue_post_candidate`, `revenue_correction_basis`, `revenue_candidate_current`, immutable/receipt triggers and semantic indexes). Executable evidence is `scripts/test-revenue-fact-postgres.mjs`; static scope and adapter contracts are in `tests/revenue-fact-runtime.test.mjs`.

| Question | Answer and evidence |
|---|---|
| Only APPROVED + CURRENT candidate posts? | YES — posting state/approval check and fresh basis resolution; stale-source/withdrawal/period tests |
| Candidate approval itself creates Revenue? | NO — pre-post fact count is zero; only explicit post function inserts |
| Payment/generic COMPLETED creates a fact? | NO — no approved candidate fails; cash/refund-without-evidence fails; unchanged R5B/C completion contracts |
| Two ORIGINAL facts for a semantic unit? | NO — partial unique index and cumulative second-original rejection |
| Same candidate posted twice? | NO — unique candidate, same-key/alternate-key/concurrent-post tests |
| Product/Quote/catalog rewrites fact? | NO — pinned snapshots and actual later catalog/Quote mutation tests |
| Posted fact UPDATE/DELETE? | NO — unconditional trigger, privileged SQL assertions |
| Refund directly mutates Revenue? | NO — explicit correction evaluation/review/post; full cash refund yields only the approved -30 delta |
| Corrections append immutable lineage? | YES — root/prior references, unchanged original amount, reversal/adjustment/replacement tests |
| Reversal exceeds remaining amount? | NO — nonnegative approved target, server-derived difference; arbitrary -80 input rejected and no second reversal after zero |
| Positive adjustment exceeds approved target? | NO — caller amount rejected; exact target-minus-balance and posting equality checks |
| Cumulative candidates double-count? | NO — second ORIGINAL blocked; 16.66 + 16.67 + 66.67 conserves 100.00 |
| Close/revocation races safely? | YES — shared lock, post-wait authority check, fresh period check and held-transaction races |
| Outbound Commission automatically reduces fact? | NO — evaluator/poster never reads it as a deduction; finance/commission regression remains intact |
| Deposit/cash offset implemented? | NO — no cash-application owner or commands |

## Limitations and Git boundary

Corrections require an approved revised entitlement candidate with current qualifying evidence. No arbitrary amount/date adjustment, automatic refund accounting, automatic source-withdrawal correction, calendar accrual or automatic posting is provided. Prior-period corrections without explicit approved rules are blocked. R5E custody/offset is still outstanding. Three distinct governed actors are required for each posting.

Recognized Revenue Fact ≠ cash receipt. Recognized Revenue Fact ≠ General Ledger journal. Recognized Revenue Fact ≠ tax result. Recognized Revenue Fact ≠ Revenue Attribution. R5D does not implement deposit/cash offset.

Staging: EMPTY. Commit: NOT RUN. Push: NOT RUN. Deploy: NOT RUN. Production: NONE. No version promotion, shutdown or earlier-task release action is part of this slice.

R5D-specific runtime and contract gates pass. The unchanged historical/R5C stage-boundary failures above are explicitly retained and are not reported as passing suites.

```text
REVENUE_R5D_RECOGNIZED_FACT_RUNTIME_COMPLETE
REVENUE_R5E_CASH_APPLICATION_READY
```

```text
R5D Recognized Revenue runtime complete
≠ Cash application runtime complete

Revenue Fact complete
≠ General Ledger implemented

Revenue runtime complete
≠ tenant accounting policy independently validated
```
