# v3.25 Phase 3 — Relationship Import & Batch Reliability

Verdict: **V325_PHASE3_RELATIONSHIP_BATCH_RELIABILITY_COMPLETE**.
Date: 2026-10-06. Version remains **3.24.1**; this is a Phase 3 candidate, not v3.25 release promotion.

## Baseline and Git boundary

| Item | Recorded result |
|---|---|
| Branch | main |
| Starting / Final HEAD | eee07f1866a314129f2ae1923ab45d87ac93ec6f / unchanged |
| Version | 3.24.1 / unchanged |
| Runtime | Node 26.10.0 / npm 12.2.0 |
| Opening worktree | 29 Phase 1–2 candidate files; staging EMPTY |
| Phase 2 baseline | `work/v325-phase3-baseline/`: full patch, 29 hash-verified raw snapshots, manifest/source/migration fingerprints and opening status |
| Final worktree | 42 combined candidate files; 21 Phase 3 changed/added files; staging EMPTY |
| Commit / Push / Deploy | NOT RUN / NOT RUN / NOT RUN |
| Production | NONE |

No saved patch was reapplied. Complete candidate and independent Phase 3 delta are reverse-checked
without modifying the worktree. Evidence is Git ignored under `work/v325-phase3/`; logs are also
retained at `work/v325-phase3-*.log`.

## Schema / reuse decision

**112 required: YES.** Existing batches/rows cannot represent set-local aliases/DAGs, and the two
existing Household Member/Student Guardian mutations lacked optimistic revisions and payload receipts.
112 adds minimal orchestration metadata, relation revision/receipt composition, protected source-aware
Set RPCs and subject-index/cleanup/export support. It reuses the existing batch engine, formal domain
mutations, selected-reference tokens and worker cycle. It introduces no CRM fields, permanent external
IDs, second queue, original file archive or new production dependencies.

| Migration | SHA256 / evidence |
|---|---|
| 106–110 | All opening raw bytes unchanged; manifest includes every historical file |
| 111 | `eae3bdc2d76929e872841e4625e0b12e3906d6793d087b7ea49264d087a50813` — unchanged |
| 112 | `57217b3c7f08856c0aafd1b9756f574fca44215830e501afd626260f3c66829d` |

All **116 opening historical migration files** retain their exact raw bytes. `.gitattributes` pins
112 bytes across platforms. Formal `npm run db:migrations:verify` discovers and verifies 112.

## Relationship resources and owning mutations

| Resource | Canonical owner / identity | Implemented boundary |
|---|---|---|
| Organization–Contact Association | `assign_contact_organization`; Contact organization_id | Standalone-to-explicit-Organization CREATE; Contact updated_at advances, revision/receipt, guarded reversal to NULL; non-null reassignment rejected |
| Household Member | `save_household_member` composed by `save_customer_relation`; Household + Contact | CREATE/UPDATE/SKIP; one membership regardless of role; formal primary-contact behavior, relation and sibling revision guards |
| Student Guardian | `save_student_guardian` composed by `save_customer_relation`; Student + guardian Contact | CREATE/UPDATE/SKIP; MOTHER/FATHER/GUARDIAN/RELATIVE/OTHER; explicit legalAuthority, no inference from member role |
| Organization Contact Intelligence | `save_organization_contact_intelligence`; current Organization + Contact | Current membership, existing revision/key protection, formal scores/narratives; no fanout |
| Organization Contact Relationship | `save_organization_contact_relationship`; Organization + endpoints + type | Same current Organization, no self edges; directed direction preserved, symmetric endpoints canonicalized; existing cycle validation retained |

Each resource has independent SET_V1 XLSX/CSV blank/example templates, Guide/Enums and machine Metadata.
Entity SET_V1 adds optional typed alias without changing standalone v2/legacy headers. Relationship
UPDATE blanks preserve current values; no relationship clear/delete/MERGE operation. Active relation
lookup never selects arbitrary retired history. Duplicate CREATE requires review, not overwrite;
repair to explicit UPDATE/SKIP is supported, without mass identity merge.

## Alias / Import Set / revision / retry / rollback

Aliases are unique to Set + type + key; typed syntax and explicit selected references only. No
cross-set escape, name/email/phone fallback or child auto-creation. A successful CREATE or selected
existing UPDATE/SKIP can resolve an alias; resolved identity is immutable until evidence erasure.
References retain actor/workspace/resource binding, 24h expiry/hash-at-rest and current authorization.

Import Set contains the existing batches, max **20 files / 2000 rows / 1000 per file**. Preflight
computes a dependency DAG and blocks cycles/missing parents without business writes. Execution/rollback
attempt at most 100 rows per call (UI defaults 50). Files do not form one ACID transaction. Each row
commits coherently or fails in its subtransaction; APPLIED rows are excluded on resume.

Failed parents leave explained BLOCKED_DEPENDENCY rows; revision-protected repair runs fresh preflight
and unlocks children. Progress reports actual failed/review/blocked counts. Set and row revisions
prevent stale repair/execution. Both Household Member and Guardian two-session competition produce
one successful update and one STALE_TARGET. Accepted payload-bound relation retries produce one mutation;
same key with changed payload fails. UPDATE without observed identity/revision is rejected.

Rollback reverses dependency order, relations first, and preserves subsequently modified/used facts.
It checks receipt, current revision, related primary changes and canonical dependents. Partial rollback
is explicit, with ROLLBACK_BLOCKED rows. Association rollback advances Contact updated_at; an earlier
Contact CREATE may consequently be conservatively blocked instead of overriding intervening mutations.
It is not atomic undo. Direct row writes and legacy/standalone RPC bypasses are denied.

## Privacy / retention / worker

New v2 and Set evidence remains private and expires after 30 days. Contact/Household/Student physical
cleanup scrubs indexed raw/normalized data, error/duplicate/reference evidence, rollback snapshots and
relation receipts; related Set evidence is invalidated as a whole, including aliases/dependencies.
Existing canonical privacy rules govern the business relations. No cleanup mutates Finance/Commission
ledgers or Enrollment history. Historical pre-CANONICAL_V2 evidence is not destructively purged and
its older retention gap remains documented.

Audit contains safe IDs/action/revision metadata, not income, notes, background or narratives. The
wrapper stores a minimal accepted receipt instead of retaining an extra nested narrative receipt.
Lease-scoped verified privacy export emits only subject-specific import lineage, with no other-party
row values. Existing generated-job worker includes that lineage; existing reminder-worker purge
also clears expired Set evidence. No original source archive or error-file export service is added.

## Verification gates

| Gate | Result | Scope / evidence |
|---|---|---|
| Opening / isolated Phase 2 baseline | PASS | 29 snapshots and original migration fingerprints; no patch reapply |
| Independent templates / guide / enum / metadata parity | PASS | 9 real XLSX/CSV schemas, 17 Phase 3 tests |
| Typed aliases, conflicts, type, missing, cycle checks | PASS | Unit + real PostgreSQL |
| Multi-file golden path / all five relation owners | PASS | Real disposable PostgreSQL |
| No surviving preflight canonical/audit/receipt writes | PASS | Actual before/after fact/audit/receipt snapshots |
| Role identity / primary semantics / explicit legal authority | PASS | Membership UPDATE same pair; Guardian false stays false |
| Direction / symmetry / self / current Organization validation | PASS | INFLUENCES directional pair; reversed PEER duplicate; wrong Organization rejected |
| Association / unsupported reassignment / guarded NULL reversal | PASS | Real canonical mutation and rollback; updated_at advancement |
| Revision / two-session concurrency / receipt / payload reuse | PASS | Member + Guardian genuine parallel sessions; accepted retry and changed payload negative |
| Dependency failure / repair / Set resume | PASS | Failed parent blocks child; repair unlocks; APPLIED rows not recreated |
| Guarded reverse rollback / subsequent edit / partial rollback | PASS | Safe rows reverse, edited rows remain with ROLLBACK_BLOCKED |
| Hidden / foreign / cross-workspace / direct-write denial | PASS | RLS and protected RPCs; no hidden identity or count output |
| Contact / Household / Student subject evidence cleanup | PASS | Actual physical deletion and scrubbed evidence, revoked Set access |
| Privacy export lease / subject-safe lineage | PASS | Valid matching lease only, no row narrative or another party's values |
| Evidence TTL / audit minimization / worker access | PASS | Actual worker purge; audit content scans |
| Finance / legal / Commission retention | PASS | New cleanup count invariance; Education Business non-empty retained financial history regression |
| Existing v2 / legacy Student compatibility regression | PASS | Final-chain real PostgreSQL, blank/clear/precision/retry/rollback/WeChat |
| Cohort / Enrollment boundary regression | PASS | Targeted canonical lifecycle/reference/history tests; paths unchanged |
| Targeted unit / resource regressions | PASS | 57 tests, `work/v325-phase3-tests.log` |
| PostgreSQL Phase 3 / v2 / Education Business | PASS | `postgres:18.4-bookworm`; three bounded local disposable runs |
| Exact deployment PostgreSQL 18.6-trixie | NOT RUN | Image absent locally; initial targeted startup failed before tests; supported 18.4 override passed |
| Historical migration raw bytes / 111 frozen / 112 checksum | PASS | 116 original fingerprints; `work/v325-phase3/migration-fingerprints.json` |
| Formal migration verification | PASS | `work/v325-phase3-migrations.log` |
| Typecheck | PASS | `work/v325-phase3-typecheck.log` |
| All Phase 3 scoped JS/TS/test/QA lint | PASS | Compared with raw Phase 2 baseline; final changed QA scripts additionally checked |
| Production build | PASS | Version 3.24.1; repeated once after observed mobile CSS defect, `work/v325-phase3-build.log` |
| Chromium 1243 affected UI | PASS | Four zh-CN/en × 1440/375 views; executable/version below |
| QA server stopped | PASS | Formal stop/status: running=false, pid=null |
| Worker runtime packaging / migration discovery / deployment dry-run | PASS | 46-module runtime closure, final migration chain, local read-only deployment checks |
| Architecture / links / complete and Phase 3 reverse-check | PASS | Final reconciliation evidence, no patch application |
| Whitespace / unchanged version / empty staging | PASS | Final `git diff --check` and metadata assertions |
| Commit / push / deploy / Production / full audit | NOT RUN | Outside this Phase's authorization/scope |

### Browser boundary and observed fixes

Actual ImportsPage/ImportSetsPage, existing providers and **production CSS**, with mocked business APIs.
Five relationship XLSX/CSV template downloads, entity/relation file addition, alias/DAG visibility,
dependency blocking/repair, explicit legal authority, progress and partial rollback are exercised.
Real RLS, mutation, concurrency, receipts, DAG, rollback, TTL, parser/templates and privacy are covered
separately by unit/PostgreSQL tests; mocked browser outcomes are not database evidence.

Pinned executable: `<workspace>`.
Observed version **153.0.8010.12**; no alternative browser installed/substituted.
Successful evidence: `work/browser-qa-chromium-1243/v325-phase3/phases/import-sets/report.json`
and four screenshots. Mobile table min-width overflow was observed, fixed and revalidated on all four
views. Earlier QA locator failures selected a hidden option or over-strict wrapped label, then were
corrected. PostgreSQL exposed SQL alias collisions in rollback/cleanup and missing Contact timestamp
advancement; fixes were rerun through the real scenario. No failed gate was waived.

## Acceptance / Phase 4 entry

All 20 requested Phase 3 acceptance answers hold: relationships have separate templates; aliases are
not business IDs and never cross Sets; no name/email/phone matching or parent fallback; member role
does not alter identity; guardian roles never infer legal authority; association never silently
reassigns; directed/symmetric rules preserve canonical identity; all relations use owning mutations
with revision/receipt guards; Set is not cross-file ACID; partial failure is visible; resume skips
APPLIED rows; guarded rollback preserves later edits; new v2 subject cleanup exists and leaves finance/
commission facts intact; no AI identity matching.

The Phase 1 RETRY_REVISION_GAP is closed for activated entity/relation paths, PRIVACY_RETENTION_GAP is
closed for new v2/Set evidence, and standalone association + member/guardian RELATION_MUTATION_GAP is
closed within this scope. Historical legacy retention and arbitrary reassignment remain explicitly
outside activation. Phase 4 can assess operational release closure; this document does not promote
the version or authorize deployment.

## Explicit non-scope

Mass identity merge; automatic name/email/phone identity resolution; arbitrary relationships or
Organization reassignment; relationship delete import; cross-file global ACID; unlimited orchestration;
permanent external IDs; absent CRM fields; original file archive; AI/OCR; Revenue; Targets; Forecast.
