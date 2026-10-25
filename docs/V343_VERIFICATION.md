# Verification for v3.43.0

Baseline: v3.42.0 at `5d190b1`. Local implementation and validation of the adopted communication
audit scope. Raw diagnostics and screenshots remain in ignored `work/`.

## Contract and database evidence

The communication regression set passed 58 tests. Coverage includes validated URL filters,
exact failure timestamps, response contracts, actual API capability/origin checks, atomic command
dispatch, legacy asynchronous worker semantics, batch email and authentication email boundaries.
The CI application command passed all 456 main tests and all 8 CAPTCHA tests, including the
communication regression set; these are overlapping totals. The accepted production build was
reused for the CI test portion rather than rebuilt. Historical source assertions in v3.20,
v3.30 and v3.8.2 tests now follow the shared workspace/command ownership while preserving their
queue, duplicate-prevention and provider-isolation requirements. Typecheck passed on Node
24.22.1 LTS with npm 12.2.1.

The dedicated PostgreSQL script passed the fresh migration chain through migration 140, complete
filtered pagination, request replay and conflicts, later-failure rejection, uncertain-outcome
redelivery denial, current role/contact/workspace boundaries, closed/consent rules, concurrent
same-request serialization, atomic receipt-failure rollback and minimized receipt payloads.
It used the installed `postgres:18.4-bookworm` image with `--pull=never`, a random isolated loopback
port, random credentials and tmpfs storage. The temporary container was removed. No existing
database, volume, recipient or external provider was used.

## Production build and browser evidence

The production build passed. A screenshot review found a half-width inbox search field; the
filter layout was corrected and rebuilt because production CSS changed. The accepted build hash is
`ab33fd25226a62cb5e13982c3a130c775680869915cd73f9d8a95a4ca84d81a8`.

The targeted `communications-recovery` phase passed all 10 page/viewport checks with zero errors
and zero warnings. It used Chromium revision 1248, browser 156.0.8078.4 and Playwright Core 1.64.1.
The generated report retains the exact executable path and build/source evidence at
`work/browser-qa-chromium-1248/v343/phases/communications-recovery/report.json`.
The final v3.20 test assertion alignment followed that browser run and changed no production source.

Coverage includes Chinese/English at 1440, 375 and 320 pixels; history/filter/context preservation;
off-page deep links; real out-of-range correction; per-conversation drafts and leave confirmation;
failed/late detail reads; immediate duplicate prevention; exact message/creation/redelivery retry;
locale changes during uncertainty; accepted operations with failed reads; closed conversations;
both view-only roles; and initial-read recovery. Screenshots were visually reviewed, including
the final English narrow layout. API responses were fictional; database behavior was independently
validated by the disposable PostgreSQL check.

## Release checks

Root application, email Worker and planning dependency audits each reported zero vulnerabilities
with the existing moderate threshold. The lockfile changes only the application release number.
Release metadata is aligned at v3.43.0. Raw test/build logs remain in `work/v343/`.

Final repository lint passed. All 14 staged public-repository/privacy artifact checks passed,
and the diff passed whitespace checks. The local QA service was stopped after browser acceptance.
Only reviewed source, fictional fixtures and minimized repository-relative documentation are
included in the local release commit; raw evidence remains ignored.

## Acceptance boundary

Local verification does not constitute production migration, real provider delivery, deployment
or remote Actions acceptance. The full multi-phase browser matrix and unrelated database suites
are outside this release's targeted checks.
