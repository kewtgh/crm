# Verification for v3.45

Baseline v3.44.0 at `5cee02d`. Node 24.22.1 LTS. Evidence is scoped to discovery, target navigation and schedule creation/controls. Production and existing local databases/volumes are not used for testing.

## Completed during implementation

- Initial targeted application regressions: 35 PASS / 0 FAIL, covering global query/result contracts, capability isolation, independent source failures, fair interleaving, target API focus, JSON/SQL-array transport distinctions, compact parsing and adjacent calendar/structured inputs.
- Real PostgreSQL verification passed on the cached `postgres:18.4-bookworm` image using a new random-name, loopback-only, tmpfs container and random credentials. The current migration chain was set up for targeted tests, not a full database regression campaign. No dotenv or application database URL was read.
- Reproduced the original transport failure: a JavaScript empty array passed natively to a JSONB parameter becomes an object. Actual appointment creation previously failed. The shared metadata-aware transport now creates empty-attendee and invited appointments, preserves SQL-array reminders, and replays the exact original creation without duplicating attendees/deliveries.
- Consent denial, version conflict, terminal-state/owner/tenant boundaries, concurrent actions, transaction rollback on delivery insertion failure, and suspended-actor recovery remain verified. No worker/provider was started and no email was sent. The disposable container was removed in finally.
- Typecheck and the first changed-file ESLint pass succeeded. Release metadata is aligned to v3.45.0.

## Final acceptance

| Check | Result | Scope and evidence |
| --- | --- | --- |
| Targeted application tests | PASS: 81 / 0 failed / 0 skipped | New v3.45 tests plus v3.38/v3.39/v3.43/v3.44, structured inputs, products, request security, interaction reliability, finance analytics and release metadata; 55-second bounded command completed in about 4 seconds. Includes actual bundled API handler execution with explicit authentication/repository adapters. |
| Disposable PostgreSQL calendar actions | PASS | Approximately 7.37 seconds; transport reproduction, real creation with empty/nonempty attendees, exact replay, consent, concurrency and existing action safeguards. Evidence remains in ignored work/calendar-actions-postgres/. |
| Typecheck | PASS | Pinned Node 24.22.1; node node_modules/@typescript/native/bin/tsc --noEmit, bounded to 55 seconds. |
| Changed-file ESLint | PASS | 34 source/test/QA files; no ESLint errors or warnings. |
| Public privacy | PASS: 14 / 0 failed | Fictional fixtures, candidate files, documentation paths, artifact publication and operational-file exclusions. |
| Dependency audits | PASS: 0 vulnerabilities | Root application, email Worker and planning package audits; no dependency or lockfile resolution changes were necessary. Private reports remain in ignored work/v345/. |
| Release/host metadata | PASS | Application, package/lockfile and documentation agree on 3.45.0. Existing host-control-plane contract remains unchanged. |
| Production build | PASS | Required bounded build completed. Rebuilt once after the source-level DateInput reset correction; final log is ignored work/v345/build-final.log. |
| Chromium 1248 global discovery | PASS: 9 page/viewports, 0 errors | Final build; 12.41 seconds; Chinese/English desktop/mobile, partial/all-source failures, explicit retry, page-only mode, scope/role, late-response rejection, IME, compact inputs, controlled native-picker bridge, form reset, schedule submission and focused targets. |
| Chromium 1248 shared forms | PASS: 3 page/viewports, 0 errors | Final build; 7.37 seconds; desktop/tablet/mobile, required fields, import repair, native date selection, money, installments, nested confirmation and focus restoration. |
| Chromium 1248 calendar/exports | PASS: 11 page/viewports, 0 errors | Final build; 7.90 seconds; bilingual agenda/export layouts, exact creation/action recovery and export recovery. |

The final targeted test command was:

```text
node scripts/run-bounded.mjs --label v345-targeted-regressions --timeout-seconds 55 --idle-seconds 40 -- node --import tsx --test --test-isolation=none --test-concurrency=1 tests/first-principles-v345.test.mjs tests/first-principles-v339.test.mjs tests/first-principles-v338.test.mjs tests/structured-inputs.test.mjs tests/product-mutations.test.mjs tests/first-principles-v344.test.mjs tests/first-principles-v343.test.mjs tests/request-security.test.mjs tests/interaction-reliability.test.mjs tests/analytics-finance.test.mjs tests/release-metadata.test.mjs
```

Browser phases use npm run qa:chromium-1248 with QA_PHASE set individually to global-discovery, forms and calendar-exports, and QA_OUTPUT_DIR set to ignored work/browser-qa-chromium-1248/v345/. Each phase has a 55-second limit. All 23 final page/viewport checks use revision 1248 Headless Shell, browser version 156.0.8078.4; the exact executable and revision remain in the private reports. Desktop and mobile screenshots were visually reviewed for the scheduling controls and search layout. No screenshots or raw environment paths are published.

## Failures resolved during verification

- The new browser fixture initially switched roles before React committed the replacement shell; it now waits for the committed role before typing.
- Its initial generic contract-document response omitted the real workspace templates/options fields and caused the fixture to exit before the contract refresh. The fixture now supplies the actual response shape and waits for the refresh response rather than a guessed delay.
- The existing shared-forms script searched only the top level of the build's static directory. It now resolves the actual nested production CSS, with selector assertions updated to the new shared control.
- Final review added uncontrolled DateInput reset handling and a browser regression proving default restoration while parent-controlled values retain their owner's state. Native min/max/step validation and canonical FormData remain verified.
- Existing analytics rendering emits React warnings about SVG title children in the targeted Node tests. All relevant tests pass; this release does not claim to resolve unrelated chart markup warnings. Vinext's existing static route-classification/build warnings remain informational.

## Evidence boundaries

Browser fixtures use independently fictional data and simulated API outcomes, with the real shared components and final production CSS. They do not replace the separately reported real PostgreSQL tests. The ephemeral PostgreSQL fixture contains only generated fictional records; no existing local database, business volume or production credential is used. QA only starts/stops a task-owned local web server, which is stopped after verification.

Remote GitHub CI, Ubuntu target-host compatibility, other browsers, the full historical regression matrix and production smoke testing are NOT_RUN for this application release. No push or production deployment was requested for v3.45.0. No V1 deployment protocol, V2 implementation, production infrastructure, business migration, customer communication or automatic recovery replay is changed. The existing unrelated untracked V2 audit is preserved outside this commit.

All adopted S1-S7 changes are implemented and locally verified within these limits. Raw diagnostics, failed attempts, browser reports/screenshots and disposable database evidence remain under ignored work/. The audit, completed implementation plan and release notes are the reviewed public evidence.
