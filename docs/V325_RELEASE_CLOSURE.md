# v3.25 — Operational Readiness & Release Closure

Verdict: **V325_RELEASE_READY — COMMIT READY** at validation closure. The user subsequently authorized
commit after completion; the final commit identity and clean status are recorded in the Git-ignored
`work/v325-release/verification.json` and `commit-receipt.json`. No push, deployment or Production access.

## Baseline and release isolation

| Item | Actual result |
|---|---|
| Branch | main |
| Starting HEAD / validation HEAD | eee07f1866a314129f2ae1923ab45d87ac93ec6f |
| Starting / final version | 3.24.1 → 3.25.0 |
| Runtime | Node 26.10.0; npm 12.2.0 |
| Worktree | <workspace> |
| Opening candidate | 42 Phase 1–3 files; staging EMPTY |
| Complete release candidate | 50 files; 15 Phase 4 changed/added files |
| Opening baseline | work/v325-release/opening-snapshots/; candidate and all 117 migration raw fingerprints |
| Candidate evidence | Complete patch, Phase 4 delta, closure-only patch, raw snapshots, manifests and verification.json |
| Git authorization | Explicit supplement: commit after all required work completes |
| Push / deploy / Production | NOT RUN / NOT RUN / NONE |

No saved patch was applied. All three reverse-checks use `git apply --reverse --check` without
modifying files. Staging remains empty during validation; the exact reconciled candidate is staged
only for the authorized commit. Historical Phase 1–3 reports retain their original metadata.

## Frozen migrations

| Migration | SHA256 |
|---|---|
| 111 | eae3bdc2d76929e872841e4625e0b12e3906d6793d087b7ea49264d087a50813 |
| 112 | 57217b3c7f08856c0aafd1b9756f574fca44215830e501afd626260f3c66829d |

All **117 opening migration files** preserve exact raw bytes, including 106–110. Formal migration
verification discovers 111 and 112. No 113, destructive migration or new CRM field is required.

## Release content and closure fixes

The existing Imports workspace now provides typed field coverage, separate Organization/Household/
Contact v2 XLSX/CSV templates, Guide/Enums/version metadata, strict zero-write preflight and owning
canonical execution. Selected references remain authorized, actor/workspace/type bound and expiring;
duplicates never select the first match. Blank preserves values, clear is nullable-allowlist-only,
money stays exact, and revision/receipts protect execution and guarded rollback.

Five independent relation resources use canonical association/member/guardian/intelligence/contact-
relationship owners. SET_V1 typed aliases and bounded DAG orchestration reuse batches, expose blocked
dependencies and partial failures, and support revision-protected repair/resume and guarded reverse
rollback. They add no permanent identity or global transaction. New evidence is private for 30 days,
with Contact/Household/Student subject erasure and subject-safe leased export lineage.

One observed release defect was fixed: nullable reference fields lost their `__CLEAR__` instructions
in v2/SET_V1 Guide text. Both Guide paths now preserve clear plus reference semantics. No business
mapping, mutation or schema behavior changed. The first staging check also found trailing blank lines
in two previously untracked QA files; they were removed before commit, then staged whitespace and
all three patch checks were rerun. Release-only tests add blank artifact/Guide/Enum parity,
downloaded-XLSX-to-canonical golden execution, complete Contact field preservation, ambiguous duplicate
and token storage/expiry/type checks, and browser metadata mismatch negatives. These suites are wired
into the existing CI test commands. No production capability or dependency was added in closure.

## Required release gates

| Gate | Result | Evidence / boundary |
|---|---|---|
| Opening baseline | PASS | 42-file immutable opening snapshot; empty staging |
| Migration verification | PASS | migrations.log; 117 files through 112 |
| Historical migration bytes | PASS | Opening/final migration-fingerprints.json |
| 111 frozen | PASS | Exact SHA above |
| 112 frozen | PASS | Exact SHA above |
| No 113 unless justified | PASS | No new migration |
| Runtime | PASS | Node 26.10.0/npm 12.2.0; dependencies.log |
| Field Contract | PASS | Phase 1 tests and canonical catalog parity |
| Template / registry parity | PASS | Protocol + release-template tests |
| XLSX / CSV | PASS | Blank/example artifacts, Data/Guide/Enums/Metadata |
| Legacy compatibility | PASS | New legacy canonical submissions; historical contract retained |
| Strict resource schema | PASS | Entity/SET_V1 tests |
| Unknown column rejection | PASS | Unit and real component upload |
| Template version | PASS | Wrong resource/SET_V1 XLSX rejected regardless of filename |
| Canonical adapters | PASS | v2/Set PostgreSQL golden execution |
| Preflight zero mutation | PASS | Before/after facts, audit, receipts and status history |
| Execution revalidation | PASS | Access/reference/revision/duplicate checks |
| Blank NO_CHANGE | PASS | Entity and relation golden UPDATE |
| Explicit clear | PASS | Allowlist, forbidden fields and corrected Guide |
| Exact decimals | PASS | 100000000.01 and budget values preserved |
| Reference token | PASS | Actor/workspace/type, hash-at-rest, 24h expiry and reauthorization |
| Hidden-safe lookup | PASS | Hidden/missing/foreign/expired safe errors; no hidden count |
| Duplicate review | PASS | Name/email/phone candidates require explicit review |
| No first-match | PASS | Ambiguous Organization fixture applies zero rows |
| Entity retry / receipt | PASS | Accepted identity reused; changed payload rejected |
| Revision / concurrency | PASS | Stale target and two-session entity race |
| Row atomicity | PASS | Core/profile/WeChat failing sub-operation rolls back |
| Guarded rollback | PASS | Entity UPDATE/CREATE guards preserve later edits |
| Relationship templates | PASS | Five independent CSV/XLSX schemas |
| All five relation owners | PASS | Real canonical relation golden paths |
| Typed aliases | PASS | Successful/selected target binding only |
| Alias scope / immutability | PASS | Typed Set-local identity, conflict/cross-set rejects |
| Import Set DAG | PASS | Real dependency ordering; 20 files/2000 rows/1000 per file |
| Cycle detection | PASS | DEPENDENCY_CYCLE |
| Blocked dependency | PASS | Failed parent never creates child/falls back to name |
| Repair unlock | PASS | Fresh revision/preflight unlocks repaired parent dependencies |
| Resume | PASS | APPLIED rows not recreated |
| Partial failure | PASS | Explicit failed/review/blocked progress |
| Relation concurrency | PASS | Household Member and Guardian two-session races |
| Relation receipt | PASS | Retry identity/payload protection |
| Reverse rollback | PASS | Relations precede entity attempts |
| Partial rollback | PASS | ROLLBACK_BLOCKED preserves subsequent mutations |
| No automatic identity match | PASS | Explicit reference/alias only |
| No silent Organization reassignment | PASS | NULL assignment only; non-null blocked |
| No guardian authority inference | PASS | Explicit false stays false; role/identity separate |
| 30-day evidence | PASS | Private bounded TTL and real worker purge |
| Contact cleanup | PASS | Physical erasure scrubs related rows and invalidates Set |
| Household cleanup | PASS | Income/background evidence erased |
| Student cleanup | PASS | Student/guardian/alias evidence erased |
| Subject-safe export | PASS | Matching verified privacy job lease; lineage only |
| Audit minimization | PASS | Sensitive narrative/money sentinels absent |
| Finance retention | PASS | Import cleanup count guards + non-empty Family financial-history regression |
| Commission retention | PASS | Import cleanup guards + immutable ledger/settlement/privacy regression |
| Enrollment history retention | PASS | Real lifecycle/concurrency/privacy/history regression |
| Integrated entity golden path | PASS | Organization/Contact XLSX → parse → canonical; Set association/intelligence/relation |
| Integrated household/guardian golden path | PASS | Household XLSX + Set Contact/Student/member/guardian chain |
| No AI / OCR | PASS | Scoped import runtime scan; no provider/parser dependency added |
| Deployment compatibility | PASS | Formal dry-run, runtime closure, production bundle packaging |
| Typecheck | PASS | Final 3.25.0 typecheck.log |
| Scoped lint | PASS | 36 changed JS/TS/test/QA files; metadata-negative QA lint after change |
| Production build | PASS | One final 3.25.0 build; no subsequent build-affecting change |
| Affected Chromium | PASS | Two phases × zh-CN/en × 1440/375 = 8 views |
| QA server stopped | PASS | running=false, pid=null |
| Architecture | PASS | Activated runtime separated from historical gaps |
| Release Notes | PASS | RELEASE_V3.25.0.md |
| Implementation Status | PASS | 3.25 current; historical sections retained |
| Version 3.25.0 | PASS | package/lock/APP_VERSION/README/status aligned |
| Complete reverse-check | PASS | v325-complete.patch |
| Phase 4 reverse-check | PASS | phase4-delta.patch against opening snapshots |
| Closure-only reverse-check | PASS | Metadata/docs/test/QA delta; excludes Guide runtime fix |
| Whitespace | PASS | git diff --check plus all candidate text checks |

Logs and machine results are under `work/v325-release/`. Integrated domain/import tests: **109 PASS**;
protocol/deployment/runtime/dependency tests: **138 PASS**; final release-metadata tests: **2 PASS**.
These counts overlap and are not additive. Template repair reruns are recorded separately. Five
disposable PostgreSQL suites passed: import-v2, import-sets, Enrollment, Commission and Education Business.
Intermediate QA-fixture failures remain in logs: blank CSV needed a filled row, the duplicate fixture
needed a distinct English name, and duplicate execution correctly returned IMPORT_NOT_READY. The final
corrected runs pass. A packaging check was corrected to use stable compiled markers rather than
function names removed by production minification; the actual final bundle contains the required logic.

## Browser and deployment boundaries

Pinned **ms-playwright/chromium-1243**, version **153.0.8010.12**;
executable `<workspace>`.
Reports/screenshots: `work/browser-qa-chromium-1243/v325-release/phases/import-v2/` and `import-sets/`.
Actual ImportsPage/ImportSetsPage, production CSS and actual workbook/parser helpers use mocked
business APIs. Mutation, RLS, revisions, receipts, DAG, concurrency, rollback and privacy have independent
real PostgreSQL evidence. Representative phone screenshots were visually inspected.

Production dry-run/packaging **PASS**. Actual deployment **NOT RUN**; Production **NONE**. Existing
worker/artifact dependencies and migration discovery are verified without installing/pulling anything.
Local integration uses **postgres:18.4-bookworm**. **postgres:18.6-trixie exact-image NOT RUN**: local
image absent; no pull/network access. No exact-image required policy was found in repository instructions.

| Explicit optional boundary | Result |
|---|---|
| Exact PostgreSQL 18.6 image integration | NOT RUN |
| Authenticated browser-to-real-DB E2E | NOT RUN |
| Actual Production deployment | NOT RUN |
| Full repository audit / complete Chromium matrix | NOT RUN |
| Destructive cleanup of historical pre-CANONICAL_V2 evidence | NOT RUN |
| Error-file export service / original-file archive | NOT IMPLEMENTED |

## Deferred / frozen scope

Mass merge, automatic name/email/phone identity resolution, arbitrary reassignment, relationship delete
imports, global ACID/unlimited orchestration, permanent external IDs, new absent CRM fields, original
source-file archive, AI mapping/identity resolution, OCR, Revenue/Attribution, Targets, Forecast and
Management AI remain deferred. Import aliases remain non-business IDs; Household membership and
Guardian relationships never establish legal signing authority. Rollback never overrides later facts.
