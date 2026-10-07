# Revenue R5G — Integrated closure

## Baseline and preservation

Opening: `main`, HEAD `cd19e48c19343536a9ad5f97e3c7bd89228f63f8`, formal version **3.31.0**, migration **120**, **125 SQL files**. The uncommitted working tree is implementation truth. Opening Git state, tracked diff, tracked/untracked inventory and raw SHA256 fingerprints are retained under ignored `work/revenue-r5g/`. No reset, restore, stash, staging, commit, push, deployment or Production access occurred.

R5G adds verification entries and release documentation. Historical phase reports, phase tests and migrations 115–120 are preserved. There is no R5G migration, accounting-semantic change or new financial owner. The browser dispatcher gains an explicit current-schema compatibility entry while the original R5F browser suite remains unchanged.

## Canonical architecture and migration chain

| Migration | Canonical responsibility |
|---|---|
| 115 | Entity-scoped reporting profile, authority, periods; versioned policy; accepted Contract service; binding |
| 116 | Fulfillment attestation, explicit source resolution and governed verification |
| 117 | Immutable deterministic recognition candidate basis and review |
| 118 | Immutable recognized fact, independent posting and append-only corrections |
| 119 | Payment purpose extension, cash application/release and Finance interlocks |
| 120 | Bounded designated read projections; no persistent owner |

Reporting Configuration is one semantic area implemented by profile/authority/period relations. The other seven Revenue semantic areas are Policy Version, Specified Service, Service Binding, Fulfillment Attestation, Recognition Candidate, Recognized Revenue Fact and Cash Application. There are ten Revenue-related relations, not ten independent economic domains.

Contract/Version, Product/Price, Quote/Version, Receivable, Payment, Refund, Enrollment/Cohort, Channel Commission, Approval/Action, Audit, Mutation Receipt and commercial FX snapshots retain ownership. No duplicate cash, Contract, pricing, Commission, GL or AP owner exists.

## Current-schema verification entry

`npm run test:revenue:current:postgres` runs `scripts/test-revenue-current-postgres.mjs`. Each child creates a fresh disposable database. This entry runs the legacy-data upgrade, unchanged Foundation/Fulfillment suites, explicit Candidate compatibility, correction/read integration, real API integration, cash/read integration and Finance/Commission regression. Financial assertions in historical suites are preserved; only explicitly superseded owner-absence assertions change in private generated compatibility entries. `npm run test:revenue:current` verifies final ownership, security surface, compatibility preservation and current release metadata.

Actual PostgreSQL image: **postgres:18.4-bookworm**. 18.6 was not locally available and was not claimed as tested. Containers use random names/credentials, tmpfs, loopback random ports and finally-cleanup. No application environment file or application database is used by these suites. Raw logs and generated harnesses remain private.

## Existing-data upgrade

The upgrade suite applies the original SQL through 114, then creates fictional Product, Contract/Version, Payment, Refund, Enrollment and Commission data through the existing Finance/Commission fixture. It snapshots all legacy columns and applies 115–120 with the real migrator.

All legacy columns remain equal. Existing Payments gain only compatible `TRADE_RECEIPT` purpose/default scope fields. Accepted commercial-version provenance is not guessed. Reporting profiles, authorities, policies, services, bindings, attestations, candidates, facts and applications remain empty. The existing tenant read returns `NO_CONFIGURATION`. Migration is not activation or back-recognition.

## Synthetic tenant and API boundary

The current integration exercises an ACTIVE profile, explicit periods, approved policy, explicitly accepted commercial Contract version, specified service, reviewed binding and fulfillment requirements, independently verified attestation, candidate preparation, independent review and third-person posting. A valid no-Payment service posts its exact amount/currency/date/period with immutable lineage.

The API harness serves the **actual `app/api/revenue/route.ts` handlers over a loopback HTTP server**, uses the actual session store/capability checks/database gateway and `crm_app` database credentials. Only the framework's request-local `next/headers` adapter is supplied by the harness. No financial repository, authentication decision or DB result is mocked. It performs Evaluate → Submit → Approve → Post, checks the approval has not created a fact, rejects AAL1 and reviewer-as-poster, retries with the same identity, and verifies exactly one fact of 842.60.

This is real HTTP API/database integration, **not a full Next/Vinext browser-to-database E2E**. Browser verification separately uses actual production components/CSS and independently fictional API responses. Neither result is presented as the other.

## R3 current-runtime closure matrix

Statuses apply to supported generic Revenue Foundation patterns, not tenant accounting correctness or excluded domains. The current-schema scripts execute these cases again; this matrix does not rely only on prior reports.

| Scenario | Status | Current proof |
|---|---|---|
| TX-001 | FULL_RUNTIME_PASS | Accepted own service and evidence → independent review/post; no Payment required |
| TX-002A | FULL_RUNTIME_PASS | PRINCIPAL/GROSS posts 842.60 from entitled consideration |
| TX-002B | FULL_RUNTIME_PASS | AGENT/NET posts approved 193.10 fee at the same customer-cash magnitude; no cost subtraction |
| TX-003 | FULL_RUNTIME_PASS | Channel-pattern approved gross consideration remains 842.60; remittance is not amount authority |
| TX-004 | FULL_RUNTIME_PASS | Reseller Contract consideration 271.30 governs; Organization type is not a policy decision |
| TX-005 | FULL_RUNTIME_PASS | Inbound service 409.20 posts independently; current Commission/Finance suite preserves outbound accrual/settlement |
| TX-006 | FULL_RUNTIME_PASS | Supported custody 100 → separate earned fact 100 → actual Receivable application 100; Revenue stays 100; release/refund/split tests |
| TX-007 | FULL_RUNTIME_PASS | Payment/refund without qualifying fulfillment cannot evaluate or create a fictitious reversal/root |
| TX-008 | FULL_RUNTIME_PASS | Original 100 retained; revised entitlement 70 produces −30; refund amount does not dictate correction |
| TX-009 | FULL_RUNTIME_PASS | 16.66 ORIGINAL +16.67 ADJUSTMENT +66.67 ADJUSTMENT =100.00; competing correction and retry do not duplicate |
| TX-010 | FULL_RUNTIME_PASS | Missing approved allocation blocked; explicit allocated component 219.35; exact minor-unit allocation conservation |
| TX-011 | FULL_RUNTIME_PASS | Historical unit A fact pins v1; genuinely future unit B uses accepted v2; catalog changes cannot rewrite history |
| TX-012 | FULL_RUNTIME_PASS | Accepted CNY 622.17 and Quote v2 commercial FX provenance survive later Quote v3; no accounting FX |

Provider-payable accounting, intercompany/cross-currency netting and unsupported custody targets remain out of scope. FULL refers to the specified supported pattern, not those adjacent domains.

## Governance, capabilities and RLS

Current Revenue roles require active workspace membership, ADMIN/SUPER_ADMIN capability eligibility **and** active entity-specific designation. Neither generic administrator role is a financial designation. Ordinary operational members cannot use Revenue mutations. Authority revocation is enforced at the DB boundary.

| Authority | Intended operations |
|---|---|
| POLICY_OWNER | Draft policy/binding, approved requirement configuration, accepted service onboarding, period creation; request assignment |
| POLICY_APPROVER | Independent foundation decisions, period close, controlled retirement/revocation |
| EVIDENCE_VERIFIER | Independent accept/reject/withdraw evidence |
| RECOGNITION_PREPARER | Evaluate, submit, revalidate, prepare correction |
| RECOGNITION_REVIEWER | Independent candidate approve/reject |
| POSTING_AUTHORITY | Post approved/current original or correction; different from preparer and reviewer |
| CASH_APPLICATION_MANAGER | Custody declaration/application/release and governed custody Finance operations |

Capability mapping: `revenue.policy.view/manage/approve`, `revenue.binding.manage`, `revenue.configuration.view/manage`, `revenue.fulfillment.view/manage/verify`, `revenue.recognition.view/manage/review/post`, `finance.cashApplication.manage`. All Revenue API mutations explicitly require AAL2. DB commands independently enforce designation, scope, AAL2, state/revision and immutable basis. Read capability does not authorize mutation or full source-document access. Policy approval, recognition review, posting and cash management are distinct functions, even if a tenant explicitly assigns multiple designations to one user; transaction-specific separation still rejects self-review and non-independent posting.

Current tests cover ordinary/super-admin denial, AAL1, self-review, missing/revoked designation, wrong entity/workspace, incompatible binding/service/evidence and stale revisions. The integrated suite checks INSERT/UPDATE/DELETE privileges are absent for app/system/worker on all seven protected policy/service/binding/evidence/candidate/fact/application relations. Existing adversarial tests attempt direct immutable updates/deletes and posting bypass.

Migration 120 security-definer functions have fixed search paths and explicit grants/revokes. Helpers are not callable by system/worker/app except the intended bounded entry points; entity designation and canonical Contract visibility restrict projection. Cash details additionally require cash authority. Source detail remains subject to its canonical resolver/permissions. The new test checks actual function catalog settings/grants, not merely SQL text.

Real multi-membership test: explicit Revenue workspace mismatching `current_workspace_id()` returns null and read/mutation fails closed. Global legacy workspace selection is unchanged; this remains an operational limitation.

## Command/read inventory

No generic financial CRUD is exposed. Internal evaluator/digest/guard helpers are not public financial operations.

| Entry / operation | Classification | Guard / purpose |
|---|---|---|
| `provision_revenue_profile` | CONTROLLED_PROVISIONING | Migrator-only bootstrap, externally reviewed business-authority reference, distinct owner/checker |
| `revenue_foundation_command`: POLICY_CREATE, BINDING_CREATE | DRAFT_MUTATION | Designated owner, exact versions; successors instead of historical edits |
| Foundation: CONTRACT_ACCEPT, SERVICE_CREATE, PERIOD_CREATE, AUTHORITY_ASSIGN | CONTROLLED_PROVISIONING | Authenticated designated owner; explicit scope/provenance; assignment needs separate approval |
| Foundation: PROFILE_SUBMIT, POLICY_SUBMIT, BINDING_SUBMIT | APPROVAL | Freeze exact revision/basis and create canonical approval request |
| Foundation: POLICY_RETIRE, PROFILE_RETIRE, AUTHORITY_REVOKE, PERIOD_CLOSE | APPROVAL | Existing designated owner/approver command-specific checks; no arbitrary reopen |
| `decide_revenue_approval` | APPROVAL | Exact request/revision, maker/checker, AAL2 |
| `revenue_set_fulfillment_requirements`, `revenue_set_correction_rule` | DRAFT_MUTATION | Constrained draft configuration; no executable DSL |
| `revenue_attestation_command`: CREATE, SUBMIT | DRAFT_MUTATION / APPROVAL | Explicit qualifying source/unit, immutable submitted basis |
| Attestation: ACCEPT, REJECT, WITHDRAW | APPROVAL | Verifier, AAL2, source revalidation and retained history |
| `revenue_candidate_command`: EVALUATE, REVALIDATE | DRAFT_MUTATION | Deterministic server amount/basis; stale observed through governed command |
| Candidate: SUBMIT, APPROVE, REJECT | APPROVAL | Independent reviewer; no fact side effect |
| `revenue_evaluate_correction` | DRAFT_MUTATION | Existing root + approved revised entitlement; no arbitrary signed amount |
| `revenue_post_candidate` | FINANCIAL_POSTING | Independent designated poster, APPROVED/CURRENT, OPEN period, uniqueness and exact basis |
| `cash_application_command`: DECLARE_CUSTODY, APPLY, REVERSE | CASH_MUTATION | Cash manager, AAL2, canonical Payment/target, exact ceilings |
| `record_payment`, `request_refund`, `complete_refund`, `decide_approval` | CASH_MUTATION / APPROVAL | Existing Finance owners; custody reservation/application interlocks and Revenue-specific approval dispatch |
| `revenue_workspace_read`, `revenue_source_options` | READ | Bounded, minimal, designated entity/Contract/source scope |
| `revenue_candidate_health`, `revenue_attestation_health`, `revenue_recognized_lineage` | READ | Authoritative health/lineage; no mutation |
| `cash_source_status`, `cash_target_status`, `cash_contract_settled`, `cash_contract_access` | READ | Finance scope, source/target balances and access predicates |
| `revenue_workspace_id`, `revenue_has_authority` | READ | Context/authority predicates, not grants of business authority |

## Concurrency, retry and retention

Current suites re-run concurrent candidate evaluation/review, same-candidate double posting, semantic-unit uniqueness, correction/root serialization, period-close/posting, authority-revoke/posting and withdrawal/posting races. Cash suites exercise apply/apply, apply/refund-reservation and apply/direct-settlement races. Database locks/unique identities, not UI guards, enforce ceilings and one ORIGINAL per unit. Larger cumulative evidence requires an approved ADJUSTMENT against the original.

Receipts reject changed payload under the same key; accepted retries return the same outcome. Logical candidate basis, posted candidate identity and application/correction intent provide economic idempotency beyond request keys. Representative audit-failure injection rolls back candidate approval, original/correction posting and cash mutation. Immutable history cannot be edited/deleted; changes append new reviewed lineage. PII removal does not cascade-delete retained facts; read models retain opaque IDs/hashes rather than full private source bodies.

## Financial number origin

| UI number | Canonical source |
|---|---|
| Contract Value | Contract |
| Receivable | Receivable Schedule |
| Collected | Canonical Finance settlement projection |
| Custody Cash | Payment + Cash Application declaration/balance |
| Applied Settlement | Cash Application + Receivable |
| Candidate | Recognition Candidate, current live unconsumed basis |
| Recognized Revenue | Sum of all signed immutable recognized facts within currency/scope |
| Refund | Refund |
| Outbound Commission | Commission |

Frontend renders server decimal strings; it does not calculate financial balances. The real read suite proves 1000 Contract /1000 Receivable /700 Collected /400 Revenue separately and custody100/applied60/available40/Revenue80. Correction100−30=70 retains both rows. CNY and USD remain separate. Posted and stale candidates do not inflate actionable earning. Cancelled Contract history remains visible where authorized while cash actionability is separately removed.

## UI, browser and performance

Revenue remains in the existing Commercial/Finance IA with Contract integration. No new global financial application or financial cache exists. The original 18 browser checks remain intact; the new current entry adds cash release confirmation/acceptance for **20 checks**. Desktop1440, tablet820 and mobile390, zh-CN, keyboard Enter/Tab/Shift+Tab/Escape, focus return, labeled dialogs, text status, error/retry and accepted-write/failed-refresh behavior are covered with actual components and production CSS. Chromium is the pinned revision1243, actual version153.0.8010.12.

Approval leaves recognized Revenue unchanged; posting changes it once; cash apply/release changes only settlement; correction appends history. Request identities survive uncertain responses, and accepted writes recover with refresh only. The screenshots/fixture evidence remain private. They are not evidence of tenant accounting correctness.

Bounded performance test creates **105 additional facts through actual governed workflows**, then checks disjoint100-fact pages and25-candidate pages, plus Contract projection. Pre-promotion three-read elapsed time was683ms under the disposable environment; this is a sanity check, not a production benchmark or SLA. No cache was added.

## Controlled operation readiness

Initial rollout is **release-safe as an assisted, controlled operation**, not general administrator self-service. Provisioning uses migrator-only `provision_revenue_profile` with explicit approved entity/framework/timezone/currency/cutoff/correction/retention and authority references. An authenticated POLICY_OWNER submits the profile; a distinct POLICY_APPROVER activates it. Subsequent assignments follow canonical requests/actions.

The existing server repository `commandRevenueFoundation` provides `PERIOD_CREATE` with `period_key`, `start_on`, `end_on`, entity and request identity. It rejects overlaps. Period close uses designated approver/AAL2/revision/reference; reopening is unsupported. The same controlled repository provides explicit `CONTRACT_ACCEPT` and `SERVICE_CREATE` with accepted provenance; operators must not infer latest numeric version. These paths are exercised in the integration fixture before any posting and do not require unrestricted application table writes.

No real tenant policy approval or transaction evidence was supplied. Synthetic approvals are disposable tests, not certification or automatic activation of a real tenant.

## Regression and release gate results

Pre-promotion current-schema PostgreSQL entry: PASS. Standard `test:contracts`:295 +8 PASS. Focused Revenue/Finance/Contract/Product/Enrollment/Auth/readiness contracts:90 PASS. Enrollment and Commercial-link PostgreSQL:PASS, including Quote conversion and retained Contract privacy. Typecheck/lint, privacy13/13, migration verification and browser20 checks passed before promotion. Final post-promotion results are recorded below when complete.

Historical phase-only failures remain separate: unmodified R5C expects recognized facts absent; unmodified R5D expects cash applications absent. Neither assertion is appropriate to current schema120. Earlier version/pre-Revenue capability assertions are retained and reported from actual runs, never silently repaired or counted as current financial behavior failures.

Version metadata is promoted from3.31.0 to3.32.0 only after the pre-promotion gates pass. Canonical package/lock/version/README/status sources are updated; historical phase reports keep3.31.0. [Release notes](RELEASE_V3.32.0.md) describe the user-facing capability and exclusions. No release checkpoint is committed.

Final post-promotion verification:

| Gate | Result |
|---|---|
| Current-schema PostgreSQL entry | PASS, all eight entries; real API chain included |
| Upgrade 114 → 120 | PASS, existing economic records preserved and no Revenue backfill |
| Current release metadata/static | 7/7 PASS |
| Standard contract/unit regression | 295/295 + 8/8 PASS on 3.32.0 |
| Targeted integration-point/static regression | 90/90 PASS before promotion; no application logic changed by promotion |
| Enrollment / Commercial links PostgreSQL | PASS; current Finance/Commission also rerun by integrated entry |
| Typecheck | PASS |
| Lint | PASS, zero errors/warnings |
| Production build | PASS; existing vinext static route-classification notice only |
| Final browser | 20/20 PASS, Chromium 1243 /153.0.8010.12, no recorded errors; actual components and fixture API |
| Public privacy | 13/13 PASS |
| Migration verification | PASS, head120 /125 SQL; no additional migration |
| Fingerprints | All 125 opening SQL and all protected phase/runtime artifacts unchanged |
| Git | `git diff --check` PASS, staging empty, original HEAD retained |

Historical results, separately retained:

| Historical entry | Actual result | Superseded assertion |
|---|---|---|
| Foundation contract | 13 PASS /2 FAIL | Formal3.25.0 and absence of Revenue write capability |
| Policy decision pack | 10 PASS /1 FAIL | Recorded3.25.0 versus current3.32.0 |
| R1 | 11 PASS /1 FAIL | Recorded3.29.0 versus current3.32.0 |
| R2, R2.1, R3, R4 | PASS | No maintenance changes |
| Unchanged R5C PostgreSQL | FAIL | `recognized_revenue_facts` expected absent |
| Unchanged R5D PostgreSQL | FAIL | `cash_applications` expected absent |

The new API/browser harness initially required fixture fixes (active account/profile, configured loopback origin, exact response shape, language switch), and its CommonJS adapter required the same scoped lint declaration as the original runner. These were test-only corrections. Final runs above supersede those development attempts; no application accounting/security behavior was loosened.

Final version: **3.32.0**. Migration: **120**. SQL: **125**. The only pre-existing files changed during R5G are the five canonical release metadata sources and the shared browser dispatcher. All other opening files remain byte-identical, including the historical phase artifacts and R5A–F implementation.

```text
REVENUE_R5_INTEGRATED_RUNTIME_COMPLETE
REVENUE_R5_RELEASE_READINESS_PASS
LUMINA_CRM_V3_32_0_RELEASE_READY
```

## Mandatory acceptance answers

| Question | Answer / evidence |
|---|---|
| Current R5A–F internally integrated? | YES — current-schema entry plus real API chain |
| Payment alone creates Revenue? | NO — no-fulfillment Payment/refund cases |
| Generic COMPLETED creates Revenue? | NO — binding-specific accepted evidence required |
| Candidate approval creates Revenue? | NO — API query before posting has no fact |
| Posting without independent poster? | NO — three-actor DB/API rejection |
| ADMIN/SUPER_ADMIN bypass designation? | NO — adversarial authority suites |
| AAL1 critical mutations? | NO — DB guards and API MFA_REQUIRED |
| Same earning unit posted twice? | NO — one ORIGINAL plus root-linked approved deltas; concurrency tests |
| Posted fact changed/deleted? | NO — immutable trigger and denied direct writes |
| Refund directly mutates Revenue? | NO — independent correction evaluation/review/post |
| Append-only correction? | YES — original100 remains100; linked signed facts derive current total |
| Custody over-application? | NO — locked source ceilings |
| Refund/application double use? | NO — reservation/application races |
| Cash Application creates Revenue? | NO — facts unchanged throughout apply/release/refund |
| Product/Quote reprice history? | NO — exact accepted Contract/Quote and decimal provenance |
| Silent currency combination? | NO — server currency groups, row currency, no accounting FX |
| Migration gives existing tenant Revenue facts? | NO — upgrade fixture verifies zero new economic facts |
| Activation without policy/authority? | NO — no configuration/default activation; TEST_ONLY rejected |
| UI financial concepts separate? | YES — real read separation and browser assertions |
| Background auto-post worker dependency? | NO — manual purpose-specific command only; worker writes denied |
| General Ledger? | NO — out of scope |

Remaining limits: manual posting; CRM_ACTIVITY/STUDENT_ENROLLMENT evidence resolvers only; controlled initial provisioning/onboarding/period creation; bounded operational reads; no AP, GL, tax, accounting FX, attribution, automatic historical recognition; legacy workspace mismatch fails closed. No accounting model was reopened and no R5G runtime semantic delta was introduced.

Git boundary: staging **EMPTY**; commit/push/deploy **NOT RUN**; Production **NONE**.

```text
R5 integrated release readiness
≠ Production deployment

Lumina Revenue Foundation
≠ General Ledger

Lumina Revenue runtime
≠ tenant accounting policy certification

Tenant policy approval
≠ automatic recognition of every transaction
```
