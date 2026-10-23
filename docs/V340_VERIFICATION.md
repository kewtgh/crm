# Verification for v3.40

Date: 2026-10-23. Baseline: v3.39.0 at `5156aeb`. Verification uses Node 24.22.1 LTS,
npm 12.2.1, Playwright Core 1.64.1 and Chromium revision 1248 (156.0.8078.4).
The local LTS archive was checked against the official SHA256 manifest. The active verification
runtime is retained under ignored `work/v340/runtime/`; this does not replace the global Node install.

## Automated checks

- Quality contracts/repositories, dependency security, existing UX contracts and migration history:
  26 passed, no failures or skips.
- Runtime/version/BuildKit targeted regressions: 10 passed.
- Email worker tests: 124 passed.
- ALTCHA lifecycle and HTTP regressions after the dependency upgrade: 8 passed.
- Planning reference: Prisma schema validation passed using a fictional URL, without database access.
- Fresh nonincremental TypeScript check and changed-file ESLint passed.
- npm audits for application, worker and planning reference each report zero vulnerabilities.

The bounded disposable PostgreSQL check passed with the installed `postgres:18.4-bookworm` image,
loopback-only port, temporary storage and randomized credentials. It never reads dotenv or an
application database URL. A fresh migration chain is setup solely for quality command tests:
active/history lifecycle, verified source correction, scan reopening, exact receipt replay,
stale finding/rule revisions, changed-payload conflict, tenant/role/suspension boundaries,
legacy/direct write denial, simultaneous stale commands and receipt-failure atomic rollback.
The temporary container is removed in `finally`. This is not a PostgreSQL 18.6 image verification
or a full database regression campaign. Migration 137 is the only added SQL migration.

## Build and browser checks

Production build passed. Subsequent builds followed actual screenshot/interaction corrections:
mobile notification hit testing, an explicit empty-trend explanation and preservation of spaces
while typing multiword search. Search normalization occurs at the server query boundary. Build-tool notices concern
dynamic imports, code grouping and route classification; compilation succeeds.

The final build passed eight quality component/state checks: Chinese/English at 1440px and 375px,
URL/history/filter paging, retained history, assignment scope, source links, optional-source failure,
read failure/action gating, continuous multiword search, lost-response exact retry across locales, immediate duplicate prevention,
accepted-save/refresh-only recovery, revision-bound rule changes and actual last-page correction.
Screenshots were inspected; container-bound checks reject horizontal overflow and hidden filters.
The controlled checkbox check waits for the server-confirmed state, and final-page assertions wait
for the actual corrected view rather than a transient pre-render loading state.

The same final build passed six public desktop/mobile checks for login, password recovery and reset.
Both phases created zero identities. Reports retain exact executable/revision, build hash, source
fingerprint and migration head under ignored `work/browser-qa-chromium-1248/phases/quality-triage/`
and `phases/01-public/`. Reports are not merged with older or unrun browser phases.

## Cleanup and publication

The saved exact cleanup set removed 29 paths / 2,870 files: 1,657,254,738 logical file bytes
(about 1.66 GB). Targets were npm content caches, verified runtime download ZIPs, old BuildKit
download layers/tar/partial chunks, final accepted build output and local compiler/build caches.
Paths were required to remain inside this repository, be Git-ignored and contain no reparse points.
BuildKit manifest/verification metadata and old runtime installations were retained.
9,587 retained evidence/configuration files passed before/after SHA256 checks. Reports, screenshots,
backups, source exports and the active Node/npm runtime remain. Observed host free-space increase
was 1,669,566,464 bytes; concurrent system activity means this is distinct from the exact file sum.

Only unused cache in the existing CRM-specific BuildKit builder was pruned: Docker reports 6.096 GB
reclaimed logically. The builder was temporarily started for inspection/pruning and restored to
its prior stopped state. All 102 volume names, all pre-existing container identities and their
running/stopped states remained unchanged; the existing CRM database remains stopped. No image,
database container, volume or unrelated resource was deleted. This is not Windows Docker VHDX
compaction or a claim of equivalent host-space reclamation. Before/after inventories and deletion
records are private under ignored `work/v340/cleanup/`.

The subsequent search correction required one final build and repeat of the two affected browser
phases. Its regenerated 780 build/cache files (16,824,965 bytes) were removed again after QA;
this follow-up deletion is recorded separately rather than inflating the main reclaim measurement.
Both final browser reports remain intact and the QA PID file is absent.

The task-owned QA server was stopped and its PID file cleared. Public privacy/artifact tests:
14 passed. Release metadata/UX tests: three passed. Together with the other listed automated
checks, 185 tests passed, without counting browser scenarios or database invariants as unit tests.
Final release metadata and whitespace checks passed. The release is committed locally; no push
or deployment was performed. Rebuild before starting the application because accepted build
output was deliberately removed during cleanup.

## Limits

Component fixtures use actual components and production CSS with fictional API responses. Database
invariants are checked independently on a disposable schema. No authenticated live browser/database
integration, external delivery provider, production deployment, full database suite or complete
ten-phase Chromium matrix is claimed. ESLint 10 still encounters upstream Next-plugin peer metadata
warnings at install time; the existing compatibility wrappers pass actual lint without policy changes.
