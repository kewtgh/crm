# Verification for v3.42

Date: 2026-10-25. Baseline: v3.41.0 at `f364822`. Verification uses Node 24.22.1 LTS,
the retained npm 12.2.1 entrypoint, Playwright Core 1.64.1 and Chromium revision 1248.

## Automated and database checks

Recovery contracts, personal governance/navigation, mutation outcomes, migration history,
request security, timezone/drawer compatibility and UX foundation passed 38 tests. Public
privacy/artifact and release metadata/UX checks passed another 17. Total: 55 distinct automated
tests, zero failures or skips. Overlapping earlier contract runs are not counted again. Fresh
nonincremental typecheck and changed-file ESLint passed, including the final component changes.

The disposable database check applied the entire migration chain through 139 using the already
installed `postgres:18.4-bookworm` image with `--pull=never`, random credentials, temporary storage
and a loopback-only port. It never reads dotenv or application database URLs. The fixture creates
105 archived tasks of one kind plus additional recent, foreign, product and business records.
It verifies reachability beyond the previous per-kind limit, exact filtered totals, the 44-kind
global query, personal/workspace isolation, administrator MFA, shared cleanup metadata and
preservation of established product/business restoration behavior.

Lifecycle checks passed for precise archive tokens, refusal to restore a newer deletion from an
old selection, timezone-independent exact receipt replay, changed-request conflicts and legacy
staff RPC denial. Concurrent different requests produce one accepted restoration; simultaneous
identical requests return the same result. Receipt failure rolls restoration and its confirmation
audit back. Ownership changes and suspended membership deny even an accepted receipt replay.
The test-owned container is removed in `finally`.

The fixture initially assumed a caller-set workspace could switch the effective workspace and
expected a dedicated MFA error. Existing helpers derive scope from active membership and reject
low-assurance administrators earlier. Assertions now check an actual foreign-workspace record
and the established rejection layer. No authorization policy was broadened for the tests.

This validates a disposable PostgreSQL 18.4 instance, not a PostgreSQL 18.6 image or production
upgrade. Existing product, lead-pool and personal-governance fixtures now call the guarded recovery
entrypoint; their complete original database suites were not rerun. The focused database fixture
directly exercises the affected core/product/business recovery and permission contracts.

## Production build and Chromium acceptance

The production build passed. Subsequent builds followed actual UI corrections: mobile vertical
Flex interaction created excessive card height, and a previous operation's success notification
could persist into an uncertain confirmation. Mobile recovery cards now use a content-sized grid;
starting another selection clears the previous success notification and restored-record link.
Build notices concern existing code grouping/dynamic imports and static route classification.

The final `recycle-recovery` phase passed 10 page/viewport checks with browser 156.0.8078.4,
zero errors, zero warnings and zero browser-created identities. Coverage includes Chinese/English
at 1440, 375 and 320 pixels; server paging; shareable search/kind/cleanup views; multiword typing;
browser history; external parameter preservation; honest retention copy; current-read action
gating; cancelled late reads; immediate duplicate prevention; locked uncertain confirmation;
exact retry across languages; accepted restoration with failed display refresh; changed deletion
rejection; known detail links; true last-page correction; workspace scope; and initial-load recovery.

Screenshot review includes narrow-screen viewports and the uncertain mobile confirmation. The
fixture asserts bounded card height and no horizontal overflow or hidden filter controls. Recovery
eligibility dates and archive timestamps in the fictional records are consistent. Final evidence:

- Build hash: `1443331621cb82c1a5f738b84d6380c17e52b71ac572ea60ae1fb599dc326d15`.
- Source fingerprint: `bc4c917f1472ce0cd6bbda33c06f00c915499c7a390ba0e212de71923cda837b`.
- Report and screenshots: ignored `work/browser-qa-chromium-1248/phases/recycle-recovery/`.
- Private build/database evidence and review crops remain under ignored `work/`.

The fixture uses actual components and production CSS with fictional API responses. Database
invariants are checked independently; this is not authenticated browser-to-database end-to-end,
external delivery or production validation. No full database suite or complete browser matrix
was run. Private reports and screenshots are not published as CI artifacts.

## Release boundary

Migration 139 must precede deployment; cached kind/ID-only restore clients must reload. Generic
edits, existing restore semantics, task revisions and cleanup workers retain their contracts.
No persistent application identity, external communication, financial posting or purge was created.
Disposable identities were removed with the test database. The task-owned QA server is stopped
and its PID file is cleared; production build output and private evidence are retained. The release
is committed locally, without a push or production deployment.

## CI follow-up for dashboard completion ownership

[CI run 40125482485](https://github.com/kewtgh/crm/actions/runs/40125482485), job `120965871907`,
failed Build and test for `b9dca6f`: the build succeeded and 444 of 445 main tests passed. Typecheck,
privacy, lint and the database job passed. Deployment/Worker/dependency-audit steps were skipped.
The failing frontline test still required `pendingTaskIds` and an inline PATCH in the dashboard,
although task completion transport and duplicate prevention now belong to `useTaskCompletion`.

The assertion now follows the dashboard's shared completion wiring and pending/uncertain action
gating. Layout and accepted-row removal checks remain. The existing Chromium dashboard case also
checks two synchronous clicks produce one request, uncertainty disables competing tasks and explicit
retry preserves the accepted request bytes. Production code and CI gates are unchanged.

The focused pre-fix file reproduced the same one failure among ten tests. After correction, 24
targeted tests passed. Reusing the validated v3.42.0 build, the original CI main and CAPTCHA commands
passed 445 and eight tests respectively, with no failures or skips. They use the npm execution-path
environment required by the root-redirect server fixture. Changed-file lint passed. The targeted
Chromium 1248 task phase passed eight checks with no errors/warnings and no browser-created identity.
Logs and minimized remote failure metadata remain under ignored `work/ci-frontline-assertion/`;
browser evidence is isolated under `work/browser-qa-chromium-1248/ci-frontline-assertion/`.
The task-owned QA server was stopped. No new production build, push or remote rerun was performed;
the corrected commit still requires a new remote CI run after publication.
