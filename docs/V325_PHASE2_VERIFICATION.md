# v3.25 Phase 2 — Categorized Templates & Strict Preflight

Verdict: **V325_PHASE2_TEMPLATES_PREFLIGHT_COMPLETE**.

## Baseline and isolation

| Item | Actual value |
|---|---|
| Branch | main |
| Starting / final HEAD | eee07f1866a314129f2ae1923ab45d87ac93ec6f |
| Starting / final version | 3.24.1 |
| Runtime | Node 26.10.0; npm 12.2.0 |
| Worktree | . |
| Opening candidate | Four untracked Phase 1 files; no tracked modifications; empty staging |
| Phase 1 isolation | work/v325-phase2-baseline/: complete patch, manifests, raw snapshots, migration fingerprints |
| Final candidate | 29 combined files; 27 Phase 2 changed files; fingerprints: work/v325-phase2/candidate-manifest.json |
| Commit / push / deploy | NOT RUN |
| Production access | NONE |

No saved patch was applied. Phase 2 changes have an independent reverse-check against the preserved
Phase 1 baseline. Phase 1 verification remains a historical record, not a description of current v2
availability. [Architecture](IMPORT_OPERATIONS_ARCHITECTURE.md#phase-2-activated-runtime-contract).

## Template contract

| Resource | Business fields | Total v2 columns | XLSX | CSV | Guide / Enums / Version |
|---|---:|---:|---|---|---|
| Organization | 35 | 37 | Blank + Example | Blank + Example | PASS |
| Household | 20 | 22 | Blank + Example | Blank + Example | PASS |
| Contact | 19 | 21 | Blank + Example | Blank + Example | PASS |

Protocol columns are operation and targetReference. XLSX has Data/Guide/Enums/hidden Metadata.
CSV resource/version are explicit upload selections. Templates use exact registry keys, optional
sensitive columns and canonical enum codes. Filename and Excel dropdowns are not server authority.
Legacy templates keep their original headers and remain separately selectable; no auto-converted
mapping profile. V2 profile UPDATE requires an existing profile; otherwise it returns a blocking typed
error. This constraint is visible in Guide. CREATE with profile fields is supported.

## Runtime parity, preflight and references

| Resource | Owning mutation | Blank UPDATE | Revision / Rollback |
|---|---|---|---|
| Organization | save_customer_record + update_school_customer_profile; save_education_business | NO_CHANGE | PASS core/profile |
| Household | save_customer_record + update_household_profile; save_education_business | NO_CHANGE | PASS core/profile/exact decimals |
| Contact | create_customer_contact / update_contact_profile; save_contact_communication | Merge authorized current full input | PASS core/WeChat |
| Student legacy compatibility | save_customer_record / update_student_profile | NO_CHANGE | PASS; identity remains Contact |
| Cohort / Enrollment | Existing canonical lifecycle RPCs | Existing CREATE/SKIP contract | Direct PostgreSQL regression PASS |

New legacy four-resource submissions use canonical adapters; pre-existing historical legacy batches
remain unchanged. V2 does not execute independent legacy business SQL. Core/profile/WeChat atomicity
is tested, including a failing sub-operation. Shared preflight uses rolled-back domain mutation
subtransactions: zero canonical rows, audit, receipts or Enrollment history survive.

UPDATE uses an authorized selected target token and preflight revision. Blank/omitted/null mean
NO_CHANGE. `__CLEAR__` is nullable-allowlist-only; owning domain null/empty representation applies.
No ordinary MERGE, name-based first-match target, Contact Organization UPDATE reassignment, or
Student duplicate identity storage. Manual duplicate CREATE NEW/SKIP and explicit-target repair are
distinct from formal identity merge. Exact decimal strings survive into PostgreSQL numeric, including
100000000.01. Income is not education budget. There is no float money round-trip or FX.

Selected-reference tokens are actor/workspace/type bound, hashed at rest and expire after 24 hours.
Hidden/foreign/missing/expired are the same INVALID_REFERENCE. Staff selection rejects inactive
accounts/memberships. Search is manual candidate selection; email/phone/name are not identity keys.

Unknown/missing schema columns block preflight. Error locations retain physical sheet/row/column/field.
Mapping profiles have version and optimistic revision. Execution rechecks access, references, target
revision, duplicates and owning-domain validation. Per-row subtransactions yield explicit partial
failure. Successful rows are not repeated. Accepted request retry returns one batch; changed payload
conflicts. Repair creates a fresh revision-bound preflight. Guarded rollback blocks intervening changes
and dependencies, and stores only actual changed field snapshots.

## Schema and privacy

Migration required: **YES — 111**, `202610060111_strict_import_protocol.sql`.

SHA256: `eae3bdc2d76929e872841e4625e0b12e3906d6793d087b7ea49264d087a50813`.

Necessary scope: batch/template/execution metadata, mapping/review/target concurrency, private expiring
reference tokens, canonical row transaction composition and bounded evidence retention. An observed
Contact mutation parameter ambiguity is fixed forward. No absent CRM business field is added.
All **115 historical migration files**, including 106–110, match opening raw-byte fingerprints.

V2 batch evidence is actor/workspace private, hidden on loss of target access, retained for 30 days,
then cleared by a bounded existing-worker task. Audit excludes row dumps, notes and income. Existing
legacy batches are not destructively purged. Full subject-specific evidence cleanup and relationship
orchestration remain explicit Phase 3 gates; bounded retention is not a claim of complete legacy
privacy remediation.

## Verification

| Gate | Result | Evidence / boundary |
|---|---|---|
| Opening baseline / Phase 1 isolation | PASS | work/v325-phase2-baseline/ |
| Registry/template/header/Guide parity | PASS | Real CSV/XLSX unit round-trips |
| Unit and targeted Node regression | PASS | 78 tests; imports, contract, customers, profiles, Cohort, Enrollment |
| Organization / Household / Contact execution | PASS | scripts/test-import-v2-postgres.mjs |
| Student legacy identity / blank compatibility | PASS | Same disposable PostgreSQL scenario |
| Zero-business-write preflight | PASS | Canonical/audit/receipt/history counts unchanged |
| Clear / exact decimal / paired ranges | PASS | Unit + PostgreSQL |
| Core/profile/WeChat row atomicity | PASS | Invalid range and communication rollback |
| Duplicate / selected references / hidden safety | PASS | Multiple matches, hidden/foreign/missing, eight search resource schemas |
| Owner active/assignable | PASS | Inactive account and membership rejected |
| Revision / concurrent UPDATE | PASS | Two actual PostgreSQL connections: one succeeds, one fails stale |
| Accepted retry / payload reuse | PASS | One batch identity; altered payload rejected |
| Mapping revision / access | PASS | RPC stale rejection; direct v2 table UPDATE denied |
| Guarded rollback | PASS | Organization, Household, Contact; stale/dependency guards |
| Private evidence / 30-day cleanup / audit minimization | PASS | RLS, worker physical purge and audit content checks |
| Direct Education Business PostgreSQL regression | PASS | Typed profiles, privacy cleanup, retained financial history |
| Direct Enrollment PostgreSQL regression | PASS | Lifecycle/history, concurrent revisions, privacy purge, PRIMARY/ASSIST |
| Historical migrations / frozen 106–110 | PASS | 115 opening raw-byte fingerprints |
| Migration verification | PASS | npm run db:migrations:verify |
| Typecheck | PASS | npm run typecheck |
| Scoped lint | PASS | All candidate JS/TS/test/QA files |
| Production build | PASS | work/v325-phase2-build.log |
| Affected Chromium | PASS | Four language/viewport cases; Chromium 1243 |
| QA server stopped | PASS | Formal server stop/status: running=false |
| Production runtime packaging | PASS | Runtime closure: 46 modules; existing XLSX dependencies |
| Deployment dry-run | PASS | No deploy or Production connection |
| Release metadata remains 3.24.1 | PASS | npm run release:check |
| Documentation links / complete and independent delta reverse-check | PASS | work/v325-phase2/verification.json |
| Whitespace / empty staging | PASS | git diff --check; no staged files |
| Complete browser matrix / whole-repo audit | NOT RUN | Outside this bounded task |

PostgreSQL tests used **postgres:18.4-bookworm**, not deployment's 18.6 image. Each scenario is disposable
and bounded; no Production DB was accessed. Browser evidence:
`work/browser-qa-chromium-1243/v325-phase2/phases/import-v2/report.json` with four PNGs.
Browser: pinned **ms-playwright/chromium-1243**, actual version **153.0.8010.12**, Playwright **1.63.0**,
`%LOCALAPPDATA%/ms-playwright/chromium-1243/chrome-win64/chrome.exe`.

Browser boundary: actual Imports components and production CSS on the final production build;
mocked business APIs. Real downloaded XLSX/CSV files are re-uploaded and parsed in the browser.
RLS, canonical mutation, references, revisions, atomicity, receipts, rollback and retention are verified
separately by PostgreSQL integration. The full authenticated browser-to-database path is not claimed.

Build ran again only after observed mobile QA wording/UPDATE target display fixes affected runtime.
The later reference/Staff SQL fixes were revalidated in PostgreSQL; they did not change the web bundle.
Initial sandbox EPERM on a typecheck subprocess was resolved by the approved local-tool execution;
the final formal command passed.

## Explicit non-scope

No relationship batch, household/guardian batch, cross-file Import Set, dependency orchestration,
mass merge, new general rollback engine, automatic identity resolution, AI mapping, absent domain
fields, Revenue, Targets or Forecast. No version promotion, commit, push, deploy or Production access.
Phase 3 must close subject cleanup and relationship reliability gates before activating those paths.
