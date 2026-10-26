# Verification for v3.46

This is the original scoped feature report, not production-candidate sign-off. The complete
historical contract suite was not run in that pass. See [the production-build correction](V346_PRODUCTION_BUILD_FIX.md)
and [the mandatory candidate checklist](RELEASE_CANDIDATE_CHECKLIST.md) for the later full-gate evidence.

Date: 2026-10-26. Baseline v3.45.0 at `6708104ec6c31f1ead127f46057f8a0a625dff71`. Node 24.22.1 LTS. Evidence is scoped to the adopted personal-settings plan; no production or existing database is used.

## Implementation evidence

Initial contract and actual API-handler adapter tests passed: 11 tests, no failures. Covered compact/preserved quiet intervals, partial/equal/invalid inputs, security channels, read schemas, revocation/account outcomes, timezone date boundaries/DST, bilingual placeholders and authenticated API branches. Delivery and authentication helpers are explicitly substituted; no email is sent and no real session/device is revoked.

First implementation lint identified synchronous state updates in mount effects and unused extraction imports. Mount reads now start as cancellable asynchronous tasks, with cleanup and initial loading guards, matching existing repository read-lifecycle patterns. The corrected source lint passed without errors or warnings.

## Final acceptance

| Check | Result | Evidence and boundary |
| --- | --- | --- |
| Targeted application regressions | PASS: 53 / 0 failed / 0 skipped | About 2.02 seconds. New settings contracts and actual settings/session/MFA API + CRM server-layout adapter execution, request security, authentication email boundary, previous discovery/calendar changes, shared inputs and release metadata. |
| Typecheck | PASS | Pinned Node 24.22.1, native TypeScript noEmit, bounded to 55 seconds. |
| Changed-file ESLint | PASS | 23 source/test/QA files; no ESLint errors or warnings. |
| Public privacy | PASS: 14 / 0 failed | Candidate files, fictional identities, documentation paths, private evidence exclusion and minimized public CI artifact policy. |
| Dependency audits | PASS: 0 vulnerabilities | Root, email Worker and planning package; 15-second network timeout with no retry. No dependency resolution changes or threshold reduction. |
| Release metadata | PASS | Package, lockfile, APP_VERSION, README and status agree on 3.46.0; Node/runtime pins remain unchanged. |
| Production build | PASS | Required bounded build; repeated once after the server-layout availability correction. Final log is ignored work/v346/build-final.log. Existing Vinext static route-classification warnings remain informational. |
| Chromium personal settings | PASS: 13 page/viewports / 0 errors | Final build, 7.27 seconds. Chinese/English at 1440/375 px for account/quiet settings, immediate duplicate guards and frozen fields, preserved custom intervals, partial/unknown revocation, failed-refresh recovery, stale response rejection, independent MFA/device access and shared-context availability protection. |
| Chromium discovery/calendar regression | PASS: 9 page/viewports / 0 errors | Final build, 10.89 seconds. Existing scoped search, focused records, bilingual/mobile layouts and compact scheduling inputs remain verified after the shared preferences change. |

The final regression command was:

```text
node scripts/run-bounded.mjs --label v346-final-regressions --timeout-seconds 55 --idle-seconds 40 -- node --import tsx --test --test-isolation=none --test-concurrency=1 tests/first-principles-v346.test.mjs tests/first-principles-v345.test.mjs tests/first-principles-v339.test.mjs tests/request-security.test.mjs tests/auth-email-delivery.test.mjs tests/v310-behavior.test.mjs tests/structured-inputs.test.mjs tests/release-metadata.test.mjs
```

Both browser phases use npm run qa:chromium-1248 with QA_PHASE set individually to personal-settings and global-discovery, and QA_OUTPUT_DIR set to ignored work/browser-qa-chromium-1248/v346/. Each phase has a 55-second hard limit. All 22 final page/viewport checks use revision 1248 Headless Shell, version 156.0.8078.4. Exact executable/revision evidence and screenshots remain private. Desktop account and mobile quiet-hours/device/fallback screenshots were visually reviewed; checked pages have no document horizontal overflow.

## Verification corrections and failure history

- The first browser assertion inspected a fieldset without waiting for its committed state. The corrected script waits for the actual disabled state and verifies the submitted input controls. The immediate guard still proves two simultaneous submit events produce one request. Failed reports remain private; no safety condition was removed.
- Server-chain review after the initial component pass found the outer layout dependency on loadUserSettings. A client-only independence test did not establish end-to-end shell reachability. The layout now catches failed/invalid preference reads, exposes a labeled unavailable context and preserves authentication/MFA redirects. Actual layout adapter tests cover failure and malformed preferences; the final browser phase verifies conversion is blocked until a validated settings read restores the context. No production evidence is inferred.
- Email copy previously promised notices to old and new addresses although the existing issuer targets the new address. The description now matches the actual verification flow; no new mailing action was introduced.
- One required rebuild followed that production-source correction. The final phases use that build; earlier component passes are not counted again.

## Limits and cleanup

The API and layout tests execute actual exported handlers with named authentication, storage and delivery adapters. Browser fixtures execute actual components and final production CSS against independently fictional intercepted APIs. These establish application behavior under controlled outcomes; they do not prove actual PostgreSQL revocation transactions, mail delivery or production compatibility. The existing two revocation helpers remain separate operations, and partial results do not claim atomicity.

Real database/authentication/mail-provider integration, remote GitHub CI, Ubuntu host validation, other browsers, the full historical regression matrix and production smoke testing are NOT_RUN for this release. No migration or SQL function changes are made, and this scope does not start a complete database campaign. No real token, session, trusted device, customer record or existing volume is changed. No email is sent. The task-owned local QA server is stopped after verification; no persistent service is added.

All P1-P6 findings and S1-S8 implementation items are complete within these explicit boundaries. Audit, completed plan and release notes contain reviewed public conclusions; raw diagnostics and failed attempts remain under ignored work/. V2 remains paused, V1 is untouched, the earlier unrelated untracked V2 audit is preserved, and this application release is committed locally without push or deployment.
