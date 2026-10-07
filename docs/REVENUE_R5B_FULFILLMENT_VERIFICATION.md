# Revenue R5B — Fulfillment evidence and attestation verification

## Baseline and preservation

Implementation baseline: branch `main`, HEAD `cd19e48c19343536a9ad5f97e3c7bd89228f63f8`, formal version **3.31.0**, migration **115**, **120 SQL files**. The uncommitted R5A worktree, not HEAD alone, was the implementation source.

Opening evidence is retained privately in `work/revenue-r5b/opening.json`: status, diff, staging, 32 candidate fingerprints and all 120 migration fingerprints. The 26 pre-R5A Revenue candidates remain untracked, unstaged and byte-identical. Migration 115 and all earlier SQL remain byte-identical. R5A repository, integration test, static test and verification report remain unchanged. The only extended opening source file is `lib/capabilities.ts` (three fulfillment capabilities).

R5B adds migration `202610070116_revenue_fulfillment.sql`; final logical head is **116**, with **121 SQL files**. Version remains **3.31.0**.

## Canonical ownership and runtime surface

Exactly one new relation, `revenue_fulfillment_attestations`, owns the Revenue-specific interpretation of operational evidence. It contains no monetary amount or currency. Activity and Enrollment remain operational owners; Contract, Payment, Refund, Commission and existing Revenue foundation owners are reused.

Repository entry points are in `lib/revenue-fulfillment-repository.ts`, using the existing database gateway:

| RPC | Purpose |
|---|---|
| `revenue_set_fulfillment_requirements` | Set explicit source/unit requirements on a maker-owned DRAFT binding, with revision and receipt |
| `revenue_attestation_command` | CREATE, SUBMIT, ACCEPT, REJECT, WITHDRAW |
| `revenue_attestation_health` | Derive CURRENT, SOURCE_CHANGED or SOURCE_UNAVAILABLE without altering evidence history |

No UI, dedicated public HTTP route, worker, recognition calculation, candidate, recognized fact, correction or cash application is introduced.

## Binding semantics and architecture delta

**R4_ARCHITECTURE_DELTA:** R5A's validated unit schedule identifies units and ceilings, but its policy reference alone does not enumerate qualifying source semantics. R5B extends the existing binding with `fulfillment_requirements`; it does not create another policy owner. Each requirement pins a schedule key, permitted source domain, explicit source IDs, evidence type, condition and business-date basis. Validation rejects unknown keys and malformed requirements. Setting requirements is audited and idempotent; submission freezes them under the existing binding approval digest.

Existing approved bindings with empty requirements remain historically intact and **cannot** support an attestation. A successor approved binding must explicitly establish evidence requirements. No completion status is backfilled into fulfillment.

Initial evidence types are SERVICE_DELIVERY, DELIVERABLE, COVERAGE and MILESTONE. Their names do not select recognition behavior. Every submission and acceptance rechecks the exact approved binding, applicable non-TEST_ONLY policy, ACTIVE reporting profile, source, unit and date.

## Supported source resolvers

| Source | Access and relationship | Snapshot identity | Business date |
|---|---|---|---|
| CRM_ACTIVITY | Existing accessible, non-archived activity; same workspace and Contract organization; explicit approved source ID | Canonical server hash of the source row; version is NULL because this source has no canonical revision | `occurred_at` interpreted in the reporting profile's business timezone |
| STUDENT_ENROLLMENT | Existing accessible, non-archived enrollment; active canonical Contract enrollment link; matching Cohort where specified; explicit approved source ID | Enrollment revision plus hash of the source and active link identity/revision | `completed_at` interpreted in the reporting profile's business timezone |

The resolver uses two fixed SQL branches, never caller-selected table names or dynamic SQL. Other domains, including document extraction, are unsupported and rejected. No contract-document workflow changed, so document regression is not applicable to this slice.

Sources are resolved by the server at creation, submission and acceptance. A COMPLETED Enrollment without an approved requirement is rejected. Even a permitted COMPLETED source needs a linked Contract, exact source authorization, unit, date, independent verifier and current designation. Completion never automatically creates or accepts an attestation.

Source payloads are used transiently for hashing, not copied into Revenue rows or responses. Source detail permission remains with the operational owner. The Revenue view exposes minimal opaque lineage, not documents or contact details.

## State, digest and retention

The lifecycle is `DRAFT → IN_REVIEW → ACCEPTED | REJECTED`, and `ACCEPTED → WITHDRAWN`. Material basis is immutable from creation, which is stricter than freezing at submission. Replacement creates a new independently reviewed row referencing a REJECTED or WITHDRAWN predecessor for the same service/unit. No delete API or generic recoverable deletion is provided.

The server uses R5A `revenue_digest` normalization to hash service, binding/policy, source identity/version/hash, approved requirement/unit, business date, coverage and exact verified units. Caller hashes and raw source payloads are rejected. Source changes before review prevent acceptance. A later source change derives SOURCE_CHANGED or SOURCE_UNAVAILABLE without rewriting accepted history or automatically withdrawing it.

Opaque IDs/hashes remain after operational archival/deletion. Operational source FKs intentionally do not cascade into attestation history. Composite FKs preserve workspace/entity/service/binding and predecessor scope. Reviewed and withdrawn history cannot be deleted; material updates fail even through privileged direct SQL. Later candidate/fact owners must reference this retained history and recheck source health and withdrawal state.

## Unit, coverage and date validation

- Unit keys must already exist in the approved binding schedule. Attestations never invent units or milestone weights.
- Point-in-time and milestone units are single-use and must match the scheduled exact unit quantity.
- Verified-unit coverage requires ordered dates within the schedule, no accepted overlap and no cumulative excess. Units use `numeric(18,6)` and decimal strings at the RPC response boundary.
- Duplicate checks span Contract plus stable service key and recognition unit, across binding versions and service amendments. Changing evidence ID, date or binding does not reset an earned unit.
- An approved successor service prevents new evidence against its predecessor. Existing history remains bound to the original version.
- Business date must match the explicit source date rule, accepted Contract date scope and an existing entity accounting period. A CLOSED period does not prevent historical evidence collection; this is not permission to post into that period.

Withdrawn evidence releases fulfillment capacity in this slice but does not erase its identity. R5C/R5D must additionally reconcile any already consumed units and corrections before subsequent recognition; no Revenue is generated here.

## Authority, approval and RLS

The existing designated-authority model gains EVIDENCE_VERIFIER. Its assignment approval/revocation reuses R5A approval infrastructure. POLICY_OWNER creates/submits evidence; EVIDENCE_VERIFIER accepts, rejects or withdraws it. Generic ADMIN or SUPER_ADMIN membership is insufficient. The current capability model permits Revenue capabilities to administrators, but every database command also requires active workspace/entity designation and AAL2. Authority is rechecked after acquiring the mutation lock.

Added capability vocabulary: `revenue.fulfillment.view`, `revenue.fulfillment.manage`, `revenue.fulfillment.verify`. RLS restricts reads to the current workspace and designated owner/verifier. Direct application/system/worker table writes and internal helper execution are revoked. Approved source detail still requires canonical source access.

Attestation review is a dedicated transition of this owner, not a second general approval engine. It records independent attestor/verifier, exact immutable basis, expected revision, review reference, timestamp, canonical audit and mutation receipt. Acceptance/rejection prohibits self-verification. Rejection can close stale evidence without requiring the stale source to qualify. Withdrawal requires a designated verifier and reason/reference.

Inherited R5A delta: explicit Revenue workspace context must match canonical current workspace selection, otherwise access fails closed. R5B does not change legacy global workspace selection.

## Transactions, locking and retry

All material actions audit within the mutation transaction; audit failure rolls back state and receipt. Same request key/payload returns the accepted result; changed payload conflicts. Lost-response retry does not duplicate mutation or audit.

Actual lock order is the inherited workspace Revenue advisory lock, receipt validation, target binding/attestation row where relevant, then canonical Contract, operational source and enrollment link shared locks. The workspace lock serializes unit totals and overlap checks across attestations, bindings and amendments. Source shared locks serialize final validation against operational writes. R5A authority changes use the same Revenue lock. This coarse lock favors correctness for the initial manual workflow; finer locking is deferred until justified by measured contention.

## Verification

Tests use independently fictional fixtures. Disposable runners never load application environment files or accept a configured application DB URL. Each starts a randomly named, loopback-only, tmpfs PostgreSQL container and removes it in `finally`.

PostgreSQL **18.4-bookworm** was used. The requested 18.6 image was not cached locally; this is the documented R5A fallback, not a claim of 18.6 verification. Runtime: Node **26.10.0**, npm **12.2.0**.

| Gate | Result / evidence |
|---|---|
| R5B fresh PostgreSQL integration | PASS — `scripts/test-revenue-fulfillment-postgres.mjs` |
| Existing R5A PostgreSQL suite, unchanged | PASS — policy/binding immutability, TEST_ONLY rejection, accepted price/Quote pinning, operational snapshots, amendments, authority, periods, RLS |
| Existing finance/commission PostgreSQL regression | PASS — canonical Payment, Refund, shared earning protection, settlement race, currency and permissions |
| R5A/R5B static contracts | PASS — 6 tests; Node same-process test mode |
| Typecheck | PASS |
| Lint | PASS |
| Production build | PASS — local build only; existing static route-classification notice retained |
| Public privacy | PASS — 13 tests, including candidate files |
| Migration manifest | PASS — head 116, 121 SQL files |
| Opening 120 SQL bytes | PASS — unchanged, including 115 |
| Protected 26 Revenue candidates | PASS — unchanged and unstaged |
| Browser | NOT REQUIRED — no UI changes |

R5B integration exercises lifecycle and independent verification; ADMIN/SUPER_ADMIN and AAL1 denial; explicit COMPLETED-rule rejection; unknown unit/domain, unrelated source and binding/service rejection; source hash/revision changes; canonical archival; withdrawal/replacement; direct-write denial and retention triggers; lost-response retry and changed-payload conflict; exact coverage ceilings and overlap races; two-reviewer and withdraw/accept races; a canonical Enrollment update racing review; audit rollback; amendment unit continuity; milestone duplicate rejection; workspace/entity denial and immediate authority revocation.

Some tests intentionally use privileged synthetic fixture setup or adversarial direct SQL. Operational Enrollment creation/update, Contract linking, Activity creation and archival also exercise canonical RPCs. No Production, real tenant accounting evidence or real financial conclusion is claimed.

Private logs, opening/final hashes and command evidence are under `work/revenue-r5b/`, excluded from Git. Historical Revenue documents/tests are not repaired or rewritten by this slice.

## Limitations and next slice

Only Activity and Enrollment resolvers are supported. Exact approved source ID allowlists are intentionally conservative: adding a new source requires a new approved binding basis. Other operational domains and document evidence require separate resolver implementations and tests. Draft editing/cleanup, automated evidence discovery and UI are deferred. No source status or AI output may authorize fulfillment independently.

R5C can consume approved services/bindings and accepted attestations, but must revalidate source health, withdrawal, scope and durable candidate basis. It must not equate accepted evidence with money.

## Git boundary and verdict

Staging: EMPTY. Commit: NOT RUN. Push: NOT RUN. Deploy: NOT RUN. Production: NONE.

`REVENUE_R5B_FULFILLMENT_RUNTIME_COMPLETE`

`REVENUE_R5C_RECOGNITION_CANDIDATE_READY`

R5B Fulfillment runtime complete ≠ Recognition Candidate runtime complete.

Recognition Candidate complete ≠ Revenue posted.

Revenue posted ≠ tenant accounting policy independently validated.

Fulfillment Attestation accepted ≠ Recognition Candidate created or Revenue recognized. Evidence withdrawn ≠ Revenue automatically reversed.
