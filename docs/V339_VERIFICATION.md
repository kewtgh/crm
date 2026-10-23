# Verification for v3.39

Date: 2026-10-23. Node 24.22.0 LTS, Playwright Core 1.64.0, Chromium revision 1248
(browser 156.0.8078.4). Baseline: v3.38.0 at `e7a1592`.

## Behavioral and database checks

Targeted application/adapter/route/migration-history regressions: 24 passed, zero failed or skipped.
Coverage includes version/receipt validation, supported relations and attendee consent, timezone
conversion, exact request preservation, full daily agenda, export expiry/query predicates and
preservation of API validation errors.

The bounded disposable PostgreSQL test passed on the already-installed `postgres:18.4-bookworm` image.
A fresh temporary container used loopback-only ports, temporary storage and random test credentials,
without dotenv or application database URLs. The complete migration chain was setup for targeted
appointment tests, not a full database regression campaign. Verified invariants:

- Exact action replay preserves result, event version, completion timestamp and delivery count.
- Changed payload reuse, stale versions and terminal-state modifications are rejected.
- Current ownership, tenant and membership boundaries apply, including suspended-actor replay.
- Legacy staff mutation functions and direct appointment UPDATE are denied.
- Two simultaneous actions from one version produce one accepted transition.
- Delivery insertion failure rolls back appointment state, action audit and receipt together.

The test container was removed in `finally`; its private cleanup record is retained. No delivery
worker or provider was invoked. All pre-existing migration files remain unchanged; migration 136 is
the only added SQL migration.

## Build and browser checks

Typecheck and changed-file ESLint passed. Production build passed; a screenshot-driven mobile CSS
correction required one subsequent build and a repeat of the affected browser phase. Build-tool
warnings concern dynamic imports, code grouping and route classification, without compilation failure.

Chromium component phase: 11 page/state checks passed. Chinese/English at 1440px and 375px cover full
13-record daily agenda pagination, expired/available downloads, create/action response loss, unchanged
retry bytes after locale switching, locked uncertain input/closing, supported relations, late read
invalidation, visible read recovery, export page correction, latest-query wins and filtered-empty state.
Screenshots were reviewed. Container-bound assertions cover mobile legend and action-button visibility.

Public phase: login, password recovery and password reset at desktop/mobile; six checks passed.
Both phases created zero identities. Browser evidence contains executable/revision, source fingerprint,
build hash, migration head, timestamps and screenshots under ignored
`work/browser-qa-chromium-1248/phases/calendar-exports/` and `phases/01-public/`.

## Publication and limits

Public privacy/artifact tests: 14 passed. Release metadata/UX tests: three passed; `release:check`
confirms version 3.39.0 across canonical files. Together with the targeted regressions, 41 automated
tests passed. Whitespace/diff checks passed. The task-owned QA server was stopped and its PID file
cleared; the disposable PostgreSQL container was removed.

Component fixtures use actual components/production CSS with fictional API responses. Database tests
establish the tested appointment invariants on a fresh schema, without claiming production provider
delivery, an authenticated live browser/database integration, or every migration upgrade topology.
No production deployment, full database suite or complete ten-phase browser matrix was run.
