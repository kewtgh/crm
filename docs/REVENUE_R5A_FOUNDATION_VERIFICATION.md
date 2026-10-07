# Revenue R5A — Foundation runtime verification

## Baseline and boundary

Opening: `main`, HEAD `cd19e48c19343536a9ad5f97e3c7bd89228f63f8`, version **3.31.0**, logical migration **114**, **119 SQL files**. Tracked worktree and staging were empty; 26 historical/R1/R2/R2.1/R3/R4 Revenue candidates were untracked. Opening status, diff, index and SHA256 manifests are retained privately under ignored `work/revenue-r5a/`.

R5A adds one bounded migration, `db/migrations/202610070115_revenue_foundation.sql`: logical head **115**, **120 SQL files**. All 119 opening SQL files and 26 protected Revenue files remain byte-identical. No guessed data backfill, version promotion, release note, posting, fulfillment, candidate, correction, cash application, UI, worker or analytics is introduced.

## Canonical owners

Exactly six relations are added:

| Relation | Purpose |
|---|---|
| revenue_reporting_profiles | Durable reporting entity distinct from workspace; framework, timezone reference, currencies, precision, cutoff/correction/retention references, maker/checker, activation |
| revenue_authority_assignments | Effective, revocable named business authority, independent of generic administrator role; designation approval/reference |
| revenue_accounting_periods | Explicit OPEN/CLOSED date ranges, no overlap, close reference/actor/time and revision |
| revenue_policy_versions | Constrained strategies, version identity, test-only boundary and immutable review content |
| contract_specified_services | Exact accepted Contract version, service key/amendment predecessor, accepted amount/quantity/currency and provenance digest |
| revenue_service_bindings | Versioned service-policy association, per-service principal/agent assessment, allocation/refund variance and semantic unit schedule |

Existing Contract/Version and Quote/Version own accepted transaction provenance. `contracts.source_quote_version_id` is captured during accepted-quote conversion, then copied naturally into existing Contract snapshots. Commercial acceptance fields are added to the existing Contract Version owner; no latest-version inference or duplicate version table is used. Accepted versions cannot be changed or purged. Composite references prevent deletion of referenced Quote versions and scope mismatches.

Product Price remains mutable according to its existing catalog contract; accepted values are copied as exact snapshots and never reread for historical pricing. Payment, Refund, Receivable, Enrollment, Cohort, Commission, Approval, Audit, receipt and FX owners remain authoritative. No money owner is duplicated.

## Runtime surface

The server repository is `lib/revenue-foundation-repository.ts`, using the existing `databaseJson` RPC gateway. No new public HTTP route or browser surface is added.

| RPC | Contract |
|---|---|
| provision_revenue_profile | Controlled provisioning only; executable by migrator, not app/system/worker. Explicit external business-authority reference; distinct initial owner and approver; workspace membership, timezone/currency validation, audit and retry receipt |
| revenue_foundation_command | Whitelisted foundation commands with entity, target, expected revision, data and request key |
| decide_revenue_approval | Exact approval revision and reference, named authority/AAL2, immutable basis and same-request retry |

Foundation commands: `PROFILE_SUBMIT`, `PROFILE_RETIRE`, `POLICY_CREATE`, `POLICY_SUBMIT`, `POLICY_RETIRE`, `CONTRACT_ACCEPT`, `SERVICE_CREATE`, `BINDING_CREATE`, `BINDING_SUBMIT`, `AUTHORITY_ASSIGN`, `AUTHORITY_REVOKE`, `PERIOD_CREATE`, `PERIOD_CLOSE`.

Draft content is deliberately immutable in this slice; revised policy/binding content is a new version. No arbitrary JSON patch command exists. Binding approval supersedes the previously approved binding without changing its content, including when an intervening successor was rejected. Period reopening is deferred: CLOSED is terminal in R5A and no generic period update is exposed.

## Approval, capabilities and RLS

Six dot-style capabilities are added: `revenue.policy.view/manage/approve`, `revenue.binding.manage`, `revenue.configuration.view/manage`. Existing ADMIN/SUPER_ADMIN role mapping supplies these generic capabilities; database authority checks additionally require an active designation in the current entity and active workspace membership. Role membership alone is insufficient. POSTING_AUTHORITY can be recorded as an authority concept but grants no posting operation.

Initial designation is an audited provisioning operation outside application-administrator permissions. Subsequent assignments use existing Approval requests/actions with exact target/revision/digest, require a separate designated checker, and cannot self-assign via approval. Revocation requires another designated approver, a reference, revision, AAL2, audit and receipt; it takes effect immediately.

Existing Approval request types are extended only for profile, policy, binding and authority assignment. A BEFORE UPDATE Revenue guard on `approval_requests` also covers the generic `decide_approval` RPC, preventing role-only bypass. The guard checks pending state, expiry, exact basis, entity, designated checker, maker/checker and AAL2 before changing foundation state. Audit failure aborts the transaction. Generic Approval behavior for other domains remains intact.

All six relations have RLS and SELECT-only app grants, scoped to workspace and designated entity authority. Public/app/system/worker direct writes and internal helper execution are revoked. Security-definer functions use fixed search paths. Composite FKs cover entity/policy/service/predecessor, Contract/Quote versions, Product/Cohort, membership and Approval scope. Tests exercise application-role SQL as well as RPCs; privileged direct SQL probes test immutable content and relational integrity.

All exposed foundation mutation paths require AAL2. No UI authorization proxy is involved. Existing gateway error normalization handles safe error codes; there are no added visible labels needing localization.

## Accepted-price and policy contracts

- Money uses `numeric(14,2)`, quantity `numeric(18,6)`. Monetary/quantity inputs are validated decimal strings; floating-point JSON money is rejected. RPC responses expose accepted amount/quantity and agent fee as strings and omit raw nested Contract/Quote snapshots.
- Canonical digest v1 sorts object keys under fixed collation, retains semantic array order and explicit nulls, hashes server-normalized decimal strings using SHA256. Dates are explicit ISO inputs; source snapshots and assessment references are server-bound. Client hashes are not accepted as authoritative.
- Accepted Quote conversion pins the exact version. Later Quote/Product Price updates and operational Contract snapshots cannot rebind the service. New amendments create new rows with stable key/predecessor continuity; old service and binding content remain unchanged.
- Policy uses only the three R4 recognition and three amount strategies. No executable DSL. TEST_ONLY policy cannot be submitted for tenant approval or bound; the approved-state constraint also rejects it.
- PRINCIPAL/GROSS and AGENT/NET consistency is enforced at binding creation/review. Actual Contract version is the refund reference; scenario and fallback references are contextual defaults. Explicit variance requires review reference. Allocated consideration requires an allocation decision and exact amount, bounded by accepted service consideration.
- Unit schedule JSON is bounded and validated for allowed keys, unique semantic unit keys, decimal units, valid dates, strategy cardinality and nonoverlapping coverage. Assessment references are a bounded string array. The server constructs amount-basis JSON; callers cannot submit arbitrary amount-basis formulas. Six relations suffice without another schedule owner in R5A.

## Reliability and retention

Critical commands reuse `mutation_receipts`: same key/payload/actor returns the accepted result, changed payload conflicts. Workspace transaction locks serialize version allocation, review and periods. Mutable state uses revision guards; reviewed content is immutable. Source acceptance and service amendment are explicit operations, not side effects of receiving cash or completing enrollment.

Canonical audit is in the same transaction. Accepted version retention triggers and non-cascading references preserve lineage. No generic recoverable-delete operation is exposed for these foundations. No legal retention duration is invented. Later fulfillment/fact evidence retention remains R5B/R5D scope.

## R4_ARCHITECTURE_DELTA

1. **Workspace context:** inspection and adversarial testing confirmed the existing `current_workspace_id()` implementation selects the first active membership rather than the explicit app workspace setting. R5A's local `revenue_workspace_id()` requires the explicit context to match the existing canonical workspace; otherwise it returns no scope and access fails closed. It does not alter legacy workspace selection globally. A multi-membership session selecting a different workspace is currently rejected, not silently redirected. Future selected-workspace modernization is separate work.
2. **Quote lineage:** explicit acceptance alone could select a later quote version with matching money. The Contract owner now captures source Quote version at conversion. Legacy quote-derived snapshots without this provenance remain blocked from Revenue adoption; no historical version is guessed. A separately reviewed adoption path can be designed later.
3. **Draft lifecycle:** foundation content uses create-next-version rather than mutable draft editing; review/state transitions retain revisions. This is a narrower runtime surface, preserving the R4 immutability contract. Profile corrections after provisioning need controlled replacement/retirement governance; no general profile editor is exposed.
4. **Local database image:** the declared default PostgreSQL 18.6 image was not installed. Verification explicitly used existing `postgres:18.4-bookworm`, not an existing CRM database. All tests used fresh random-name containers, random credentials, tmpfs, loopback-only ports, no application environment and automatic cleanup. PostgreSQL 18.6 verification remains an environment-specific follow-up, not a claimed result.

## PostgreSQL verification

`scripts/test-revenue-foundation-postgres.mjs` applies the full append-only migration chain to a fresh disposable database and verifies:

- Migration application; profile activation and provisioner-only entry; ordinary and super administrator denial without business designation; AAL1 denial; self-approval denial even with both authority roles.
- Policy review/version identity, TEST_ONLY rejection, exact request retry and changed-payload conflict, stale revision rejection, direct table write denial, generic Approval bypass denial.
- Price 100 accepted then catalog price 120: service/binding remain 100; Quote v2 accepted then v3 created: Contract/service remain v2; operational Contract snapshots do not replace accepted commercial versions.
- Contract/service amendment predecessor continuity; wrong Contract/version rejection; old service/policy/binding content unchanged; approved policy v1 remains bound after later versions exist.
- Per-service role/presentation checks, missing variance rejection, malformed schedule rejection, rejected binding successor followed by successful successor approval.
- Named authority assignment approval/revocation; two reviewers race with exactly one successful decision; audit failure rolls back both business state and receipt eligibility.
- Cross-workspace reads return no records; wrong entity commands and composite FK references fail; accepted-version update/delete fails; period overlap fails and close stores actor/time/reference/revision with retry safety.

The unchanged `scripts/test-commission-postgres.mjs` also passed against a separate disposable database with migration 115: canonical trade Payment/Receivable, Refund, Commission accrual/reversal/settlement, concurrency, currency and RLS regressions.

## Verification matrix

| Gate | Result |
|---|---|
| R5A PostgreSQL integration | PASS |
| Existing finance/commission PostgreSQL regression | PASS |
| R5A schema/ownership contracts | PASS — 3/3 |
| R4 architecture | PASS — 14/14 |
| R3 conformance | PASS — 26/26 |
| R2.1 decisions | PASS — 14/14 |
| R2 scenarios | PASS — 10/10 |
| R1 unchanged | 11 PASS / 1 historical version assertion FAIL (3.29.0 versus 3.31.0) |
| Historical unchanged | 23 PASS / 3 FAIL: two old version assertions (3.25.0 versus 3.31.0), one old no-Revenue-capability assumption superseded by authorized R5A |
| Typecheck | PASS |
| Lint | PASS |
| Build | PASS — version remains 3.31.0 |
| Public privacy | PASS — 13/13, including new untracked candidates |
| Migration verification | PASS — head 115, 120 SQL |
| 119 historical SQL / 26 protected Revenue bytes | PASS — SHA256 unchanged; all protected candidates remain untracked/unstaged |
| Browser | NOT REQUIRED — no UI, navigation or public HTTP surface changed |
| Disposable QA resources | PASS — final Docker label query returned no R5A containers; no QA server started |
| Staging / commit / push / deploy / Production | EMPTY / NOT RUN / NOT RUN / NOT RUN / NONE |

A sandbox child-process EPERM initially blocked one historical test file; rerunning with local subprocess access produced the complete results above. Protected tests/documents were not repaired. Logs are private; none of these results certify real tenant accounting policy or production acceptance.

## Acceptance answers

| Question | Answer and evidence |
|---|---|
| Entity separate from workspace? | Yes: independent reporting_entity_id, one ACTIVE profile index; PostgreSQL provisioning and cross-entity FK tests |
| Authority independent of ADMIN/SUPER_ADMIN? | Yes: revenue_has_authority/revenue_require and generic Approval trigger; both generic roles denied in integration |
| Versioned frozen policy? | Yes: policy uniqueness, immutable trigger, next-version command and policy/binding pinning tests |
| TEST_ONLY blocked? | Yes: submission/binding guards plus approved-state constraint; negative PostgreSQL tests |
| Accepted Contract/Quote/price pinned? | Yes: conversion trigger, explicit accepted version and server snapshot/digest; 100→120, Quote v2→v3 and operational snapshot tests |
| Stable service across amendments? | Yes: stable_service_key and scoped predecessor; amendment test retains old service |
| Per-service principal/agent and presentation? | Yes: binding references exact service/policy, consistency validation and incompatible-presentation negative test |
| Contract variance reviewed? | Yes: required variance_review_reference before binding/review; negative integration test |
| No Revenue creation or duplicate finance owner? | Yes: exactly six foundation tables, no recognized/candidate/cash owner; static ownership tests and existing financial regression |

## Final boundary

R5A foundation runtime complete ≠ Revenue recognition implemented.

Revenue recognition implemented ≠ tenant policy approved.

Tenant policy approved ≠ automatic recognition of all transactions.

```text
REVENUE_R5A_FOUNDATION_RUNTIME_COMPLETE
REVENUE_R5B_FULFILLMENT_READY
```
