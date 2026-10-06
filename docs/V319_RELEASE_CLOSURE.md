# v3.19 release closure

The closure reconciles the 90 uncommitted Phase 1–4 files against their final manifests.
Starting branch: `main`; starting HEAD: `5d340c99aeaf36a565ef1fcb383a8f16f6fedd7e`;
starting version: `3.18.2`. Current release metadata is `3.19.0`.

No features were added during closure. The changes are current version/release documentation,
AI fact-boundary clarification, browser-fixture compatibility and bilingual viewport evidence,
and byte-preserving Git attributes for the four new migrations. Historical migrations remain
unchanged. The original phase patches were inspected, never reapplied.

## Frozen migrations

| Migration | SHA-256 |
| --- | --- |
| 091 Product Cohorts | `d4eade39b3f5154872e7e1806a40d9a4f7a4a9b76938dd99180d364d826b3929` |
| 092 Student Enrollments | `30fb6a2ecf0af912095001d768e839996b87d7f0f46c483569ec836811211206` |
| 093 Commercial Cohort Links | `dbdee8ed7ffa2efadc2c680dd999764615f92ebb0d4baa7e2d3a3ae6834a9f69` |
| 094 Operational Readiness | `20b932898ec17f685f58611f5a026025d3edd3a2ee727f17781871ea5fcda520` |

Git preserves their raw bytes without checkout newline conversion. Apply them in order using
the existing migration runner. No down migration or historical checksum rewrite is supplied.
The full candidate whitespace check reports **FAIL** for five pre-existing trailing spaces in
094 (lines 519, 524, 529, 534 and 539). All other candidate files pass. This cosmetic issue is
retained because the migration is frozen; it does not change SQL behavior or the defined
release gates. The raw check output is preserved in the local verification evidence.

## Bounded verification

Actual runtime is the repository's existing portable Node **26.10.0**, with npm **12.2.0**.
Only the process PATH selects this runtime; no system runtime settings or engines were changed.
`npm ci --no-audit --no-fund` passed without lockfile/dependency changes. Existing ESLint plugin
peer warnings and the tsconfck deprecation remain; scoped lint passes without suppressions.

| Gate | Result |
| --- | --- |
| Worktree reconciliation / historical migrations / frozen 091–094 | PASS |
| Declared Node/npm and dependency installation | PASS |
| v3.19 targeted tests | PASS — 72 tests |
| Cohort PostgreSQL | PASS — constraints, workspace/role/AAL2, revision, audit, retry |
| Enrollment PostgreSQL | PASS — identity, lifecycle, concurrency, attribution, history, privacy |
| Commercial PostgreSQL | PASS — bidirectional integrity, dual scope, link history, Quote conversion |
| Operational PostgreSQL | PASS — live Finance, visibility, imports, quality, automation, snapshots |
| Existing Education/family Finance PostgreSQL | PASS — both buyer models and retained financial history |
| No duplicate shared-contract totals / CNY and USD isolation | PASS |
| Typecheck / scoped lint / production build | PASS |
| Affected Chromium 1243 / architecture / release metadata | PASS |

PostgreSQL uses the installed `postgres:18.4-bookworm` image in fresh disposable containers,
with localhost-only ports and automatic cleanup. No existing application/production DB is used.
Browser checks use Chromium **1243**, executable
`%LOCALAPPDATA%/ms-playwright/chromium-1243/chrome-win64/chrome.exe`.
The four affected phases are `product-cohorts`, `enrollments`, `commercial-links` and
`operational-readiness`. Component fixtures do not replace the real PostgreSQL security tests.
Complete repository regression, unrelated browser phases, production migration and deployment
are intentionally **NOT RUN**.

## Recovery and evidence

`work/v319-release/` holds the opening raw snapshots, reconciled baseline, final candidate
manifest, combined Phase 1–4 checkpoint patch, closure-only patch and verification report.
The manifests list exactly the candidate files. `work/browser-qa-chromium-1243/v319-release-final/`
holds affected-browser evidence. These local artifacts remain ignored and must not be staged.

Before a commit, the closure-only patch can be reverse-checked and reversed to restore the
opening Phase 1–4 source state, provided no later edits intervene. The combined checkpoint patch
can restore all four phases onto the recorded starting HEAD after an apply check; do not reapply
it to this already modified checkout. Preserve the raw snapshots for exact restoration.

The prepared commit message is `feat: add cohort and enrollment operating foundation`.
Prepare one feature checkpoint from the explicit final manifest. A subsequent source rollback
should use a normal revert, never a history rewrite. Database recovery remains forward-only and
must separately account for retained Enrollment and financial data; reverting source does not
remove applied migrations or authorize production changes. No automatic commit, push or deploy
is performed without the corresponding explicit instruction.
