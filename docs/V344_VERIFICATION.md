# Verification for v3.44.0

Baseline: v3.43.0 at `f12cbba`. Local acceptance of adopted approval findings A1–A6. Raw logs,
screenshots and diagnostics remain in ignored `work/`.

## Contract and database acceptance

The targeted approval/authorization/action-discovery regression set passed 28 tests, including
catalog and URL contracts, malformed-response refusal, exact decision preconditions, actual HTTP
role/MFA/origin/CSRF boundaries, result minimization and existing administrator workflow regressions.
Typecheck passed on Node 24.22.1 LTS and npm 12.2.1.

The CI application test commands passed all 469 main tests and all 8 CAPTCHA tests with no skips
or failures. The targeted 28-test set is included in the main total, not an additional total.
The accepted production build was reused for the test portion without a redundant rebuild.

The dedicated disposable PostgreSQL check passed the fresh migration chain through migration 141;
RLS-scoped pages, statuses, pending counts and execution history; timezone-independent snapshot
tokens; changed-content refusal even without an updated timestamp; current team assignment and
independence; concurrent decisions and exact replay; receipt/audit/job rollback; and accepted
decisions with failed business execution. All five existing revenue types retain specialized review.

Custody tests exercise review authority, independence and permission loss before receipt replay.
The minimal custody fixture lives in an outer transaction that is rolled back, with deferred cash
declaration constraints enabled throughout. These tests do not assert cash receipt posting,
allocation or settlement acceptance. Existing financial routines are delegated without rewriting
their business rules.

The check used the installed `postgres:18.4-bookworm` image with `--pull=never`, random credentials,
a new loopback port and tmpfs storage. Its temporary container was removed. No existing database,
volume, financial record or external recipient was used.

## Build and browser acceptance

The production build passed. Desktop metadata was tightened to two columns after screenshot
review; the accepted rebuild contains that CSS change. Its SHA-256 is
`a222d9c7796bba23d6c90022f8e469af1a03a72e21dfbe33da4cf62a6abfd80e`.

The targeted `approval-review` Chromium phase passed all 10 page/viewport checks with zero errors
and warnings. Runtime: Chromium revision 1248, browser 156.0.8078.4 and Playwright Core 1.64.1.
The report retains the exact executable and source/build evidence at
`work/browser-qa-chromium-1248/v344/phases/approval-review/report.json`.
Its source fingerprint is `c5c7c8cef5cbd74bbbdb4a5a28cc353dbe5e68b5d83ca96acd7427ed6e8091fb`.

Coverage includes Chinese/English at 1440, 375 and 320 pixels; URL scope/status/execution views,
history, exact search text and unrelated context; actual last-page correction; failed/late read
gates; immediate duplicate prevention; frozen mobile confirmation and original-request recovery
across locale changes; permission-denied confirmation retaining uncertainty; required rejection
notes; accepted decisions with failed execution or refresh; stale snapshot rejection; expiry and
withdrawn history; specialized revenue routing; live deadline changes; personal read-only roles;
and recoverable initial failure. Desktop metadata and mobile uncertainty screenshots were visually
reviewed. APIs in this phase were fictional; database guarantees were tested independently.

## Release checks

Full repository lint and typecheck passed. Root, email Worker and planning dependency audits each
reported zero vulnerabilities with the existing moderate threshold. Dependencies and runtime pins
are unchanged; the lockfile changes only the application release number. Release metadata is
aligned at v3.44.0. The QA server was stopped after acceptance.

All 14 staged public-repository privacy/public-artifact checks passed, and the staged diff passed
whitespace checks. Only reviewed source, fictional fixtures and minimized documentation enter the
local release commit. Private raw evidence remains ignored.

## Release boundary

Local checks do not constitute a production migration, deployment or remote Actions acceptance.
The full browser matrix and unrelated database suites are outside this targeted verification.
