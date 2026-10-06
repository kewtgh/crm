# v3.25 Phase 1 — Import Capability & Field Contract

Verdict: **V325_PHASE1_IMPORT_CAPABILITY_CONTRACT_COMPLETE**.

This verdict covers the field/capability/relationship specification and executable contract tests.
Expanded imports and legacy runtime parity fixes are **not implemented**. Phase 2–3 activation gates
are explicitly recorded in [Import Operations Architecture](IMPORT_OPERATIONS_ARCHITECTURE.md).

## Baseline

| Item | Actual value |
|---|---|
| Branch | main |
| Starting / final HEAD | eee07f1866a314129f2ae1923ab45d87ac93ec6f |
| Starting / final version | 3.24.1 |
| Runtime | Node 26.10.0; npm 12.2.0 |
| Worktree | . |
| Opening state | CLEAN; empty staging; zero candidates |
| Final candidate | Four new files: architecture, this verification, typed registry, tests |
| Commit / push / deploy | NOT RUN |
| Production access | NONE |

Task's quoted `1c18e16` checkpoint precedes actual `eee07f1`, the completed v3.24.1 Actions fix.
No historical patch was applied. Evidence: `work/v325-phase1/` (Git ignored).

## Capability and Coverage

| Resource | Current import columns | Existing canonical core/display fields reviewed | Independent profile fields | No core field / extension required |
|---|---:|---:|---:|---:|
| Organization | 14 | 19 | 17 | 8 |
| Household | 11 | 13 | 8 | 3 |
| Contact | 5 | 19 | 0 | 4 |
| Student | 15 | 16, including 2 Contact-derived names | 0 | 0 |
| Cohort | 15 | 15 | 0 | 0 |
| Enrollment | 11 | 11 | 0 | 0 |

133 classified rows overall; this includes read-only/derived/extension rows and is **not** a claim that
133 columns should be in a new template. Contact intelligence and contact-to-contact relationship
attributes are separately documented in the relation contract. Sensitive optional fields remain optional.

Contact's missing import coverage includes contact type/status, communication level, notes, preferred
method/language, acquisition source, decision role, tags, follow-up time, owner, record status, optional
Organization association and separately managed WeChat. Organization core lacks import shortName,
organizationType/address/status coverage; commercial/education profile has its own canonical table.
Household status/owner and education needs are distinct from its current 11 fields.

## Contract Decisions

CREATE / UPDATE / SKIP are distinct; ordinary imports do not promise identity MERGE. CREATE never
overwrites a duplicate; UPDATE requires selected authorized target and revision. Blank is NO_CHANGE;
explicit clear is deferred. Required groups and decimal/currency/date rules are recorded per field.
Names, email and phone are candidate evidence, not universal identity. Future user-facing references
are authorized selected tokens or typed batch-local aliases; current legacy UUID headers stay compatible.

Organization–Contact is optional single association; Household member and guardian relations are
separate. Household member uniqueness is pair, not role. Contact-to-contact Organization relations
have directed/symmetric role-specific identities. No inferred guardian/signatory permission.

Preflight persists no canonical facts. Execution revalidates current authority/revisions/references.
Four legacy resources have independent SQL and inconsistent blank/retry/duplicate semantics; these
are recorded as IMPORT_DOMAIN_PARITY_GAP and later activation gates. Cohort/Enrollment already use
domain RPC validation/mutations; preserve status history. No new import framework or migration 111.

## Verification

| Gate | Result | Evidence / limit |
|---|---|---|
| Required document / bounded source inspection | PASS | Architecture links actual forms, repository, API and canonical migrations |
| Registry integrity / canonical columns / real mutation owners | PASS | Canonical create/alter DDL for scoped 11 migration groups, repository entrypoints |
| Reverse coverage of core forms and profile schemas | PASS | Organization, Household, Contact, Student and existing profile schema tests |
| CREATE/UPDATE/required groups / blank semantics | PASS | Executable specification; not legacy runtime migration |
| Enum codes / unknown fields / sensitive flags | PASS | Explicit code-only normalization; no implicit display-label aliases |
| Stable references / name ambiguity / hidden-safe results / Owner | PASS | Pure contract unit tests; no claim of new production resolver |
| Decimal preservation | PASS | String/BigInt formatting; legacy Number adapter gap remains explicit |
| Relationship identity / canonical Enrollment lifecycle | PASS | DDL/repository-backed contract assertions |
| Contract helper pure evaluation | PASS | Frozen input/source test; zero runtime endpoint changes |
| Template/parser / customer / education / cohort / enrollment / relationship/privacy regressions | PASS | 85 tests total, including 17 new contract tests; targeted Node suites |
| Migration verification | PASS | `npm run db:migrations:verify`; 115 files, latest 110 |
| Historical migration raw bytes | PASS | All 115 hashes match prior v3.24 release raw fingerprints |
| Frozen 106–110 | PASS | Checksums below; no migration changes |
| Typecheck | PASS | `npm run typecheck` |
| Scoped lint | PASS | New registry and test only |
| Local documentation links / matrix parity | PASS | Final evidence script |
| Version / metadata unchanged | PASS | 3.24.1; no release source changed |
| Candidate reverse-check / whitespace | PASS | Independent new-file patch; `git diff --check` plus candidate patch check |
| PostgreSQL mutation/integration | NOT RUN | Specification-only phase; existing DB execution unchanged; unit privacy checks are not live RLS tests |
| Production build | NOT RUN | Unwired registry/docs/tests; no runtime, API, UI, dependency or build entrypoint change |
| Chromium QA | NOT RUN | No UI changes |
| Deployment dry-run | NOT RUN | No deployment/schema/dependency changes |

Historical raw comparison uses `work/v324-release/migration-fingerprints.json`. Older Git blobs and
some local migrations differ only by pre-existing checkout line endings (`core.autocrlf=true`); this
phase preserves the actual raw bytes and records that distinction rather than rewriting migrations.

| Migration | Frozen SHA256 |
|---|---|
| 106 | 3b58df3169aeb191a601611bf7eb92dc8af863efda409a6265087d5ba13539ac |
| 107 | 21d18fcfd20c10d8d1d49e03d427dd70866502a77fd2392757eb0cf4ef12cd83 |
| 108 | 7385bc29a1d5f8a20249c714ecd802b098bd081a5ff44087fcc88f76de842fc2 |
| 109 | 177aed462485a4f58d3b6e0ede87c1a338cb2051637d367f8cfd7a4397748288 |
| 110 | 4e08159af98970cee8d403100a50568d47ecc14b54b614c80e3e20ca469cd010 |

## Acceptance Answers

Answers refer to the frozen v3.25 contract; gaps in current legacy behavior are stated above.

| # | Answer |
|---|---|
| 1 | NO — separate Organization/Household/Contact resources |
| 2 | NO — Contact coverage is broader than five current columns |
| 3 | NO — association/relationship operations are separately owned |
| 4 | NO — Household is not Contact |
| 5 | NO — member is not automatic legal guardian |
| 6 | NO — names never auto-select a relationship target |
| 7 | NO — planned selected tokens/aliases remove the UUID requirement; legacy headers currently still accept UUIDs |
| 8 | YES — stable verified references are required |
| 9 | NO — blank cannot clear; legacy parity fix remains an activation gate |
| 10 | NO — preflight cannot mutate business facts |
| 11 | YES — planned columns trace canonical storage and owning mutation |
| 12 | NO — unknown columns require error/explicit warning; legacy unmapped-column gap is recorded |
| 13 | NO — import must use owning mutation; legacy independent SQL is recorded for repair |
| 14 | NO — Enrollment lifecycle/history cannot be bypassed |
| 15 | NO — name equality is a candidate, not duplicate fact |
| 16 | NO — reference lookup must be hidden-safe and reauthorized |
| 17 | NO — final XLSX templates are not implemented |

## Explicit Non-Scope

Final XLSX/new CSV versions, actual expanded bulk imports, relationship batch execution, cross-file
staging, new rollback engine, mass merge, AI mapping, automatic identity resolution, OCR, Revenue,
Targets and Forecast. No schema, migration, dependency, deployment or version change; no commit,
push, deploy or Production access in this phase.
