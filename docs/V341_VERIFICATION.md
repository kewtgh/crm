# Verification for v3.41

Date: 2026-10-25. Baseline: v3.40.0 at `0131cc7`. Verification uses pinned Node 24.22.1 LTS,
the retained npm 12.2.1 entrypoint, Playwright Core 1.64.1 and Chromium revision 1248.

## Automated and database checks

The targeted task, action-center compatibility, mutation-outcome, migration-history and request-security
group passed 39 tests. Public privacy/artifact, release metadata/UX, notification/API cancellation and
existing timezone/drawer/task-scope regressions passed another 33 tests. Total: 72 distinct tests,
zero failures or skips. Earlier overlapping task-only runs are not added again. Fresh nonincremental
typecheck and changed-file ESLint passed; the final pagination correction passed both again.

The bounded PostgreSQL check passed on a disposable container using the already installed
`postgres:18.4-bookworm` image with `--pull=never`, random credentials, temporary storage and a
loopback-only port. It never loads dotenv or application database URLs. A fresh migration chain
through 138 passed, followed by task version advancement, dashboard/queue revision projections,
single/bulk completion, immutable accepted replay, changed-request rejection, stale/archived batch
rollback, owner/tenant scope and legacy RPC denial. Concurrent stale writes, simultaneous exact
requests, opposite batch ordering, receipt/audit rollback and revoked/suspended access on replay
also passed. The container was removed in `finally`. This is not validation of a PostgreSQL 18.6
image or a full database regression suite.

The first database assertion attempted to count audit records as a sales identity; RLS correctly
hid them. The assertion now reads through the disposable container's management connection.
Application authorization was not broadened. Unit/adapter tests reject incomplete or malformed
completion results instead of treating transport success as accepted work.

## Production build and browser checks

The production build passed. A second build followed an actual application correction: when the
requested queue page exceeds the current snapshot, the URL now moves to the displayed valid page.
Build notices concern existing code grouping/dynamic-import and route classification behavior.

The final accepted build is checked with the existing Chromium 1248 workflow using the targeted
`task-completion` and `notification-integrity` phases. Reports and screenshots remain under ignored
`work/browser-qa-chromium-1248/phases/` in their respective phase directories. Exact executable,
browser version, build hash, migration head and source fingerprint remain in each report. They are
not merged with older or unrun browser phases.

The final reports contain eight task/dashboard checks and six notification checks, zero errors,
zero warnings and zero browser-created identities. Both report browser version 156.0.8078.4 and
the same build hash `8fd34f40ff9096a9643a0e1617f43be6704bac3c7bc808e32d148146f7cdf5c1`
and source fingerprint `cd2194ce3cacd4b3c4b325cf097acd91d81b0c8066a463ce19f2cd612b515b87`.

Task checks cover Chinese/English at 1440, 375 and 320 pixels, shareable search/priority/page views,
multiword typing, browser history, directory parameter preservation, out-of-range page correction,
loading/failed-read action gating, immediate duplicate prevention, lost-response single/bulk retries
across languages, locked uncertain drawers and accepted-write refresh-only recovery. The dashboard
uses the same version/receipt contract and confirms an uncertain completion without another action.

Notification checks cover view-only role controls in both page and popover, a pre-write popover
read deliberately returned after the accepted mark, change events while a write is pending,
accepted-mark refresh failure and lost-response display recovery. Chinese/English layouts at
1440, 375 and 320 pixels have no horizontal overflow. Screenshots are visually inspected after
fonts settle and scroll position is reset. Early harness corrections reused the accepted build:
the established Next Image substitute, exact translated button labels and a request-arrival barrier.

## Scope and release boundary

Browser scenarios run actual components and production CSS against independently fictional API
responses. Database invariants are checked separately. This establishes the selected client and
transaction contracts; it is not authenticated browser-to-database end-to-end or production
validation. No persistent application identity, external delivery, financial posting or customer
outreach was created. Disposable identities were removed with their test database.
The complete database suite and ten-phase browser matrix are outside this release's verification.

Migration 138 must precede deployment. Cached clients without task revisions and request identity
must reload. Generic record edits and worker task changes retain their existing commands; all task
updates advance revisions. Private evidence is retained, and the task-owned QA server is stopped
after acceptance. The production build is retained for local use. No push or deployment is performed.
