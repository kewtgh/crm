# v3.24.1 — Channel Agreement Name Validation / CI Fix

The Channel agreement editor now uses the shared `BilingualNameHint`: either Chinese or English
name is sufficient, while two blank names prevent submission. This restores the repository's existing
structured-input contract; it does not change agreement or commission business semantics.

Both failed CI runs had the same sole failure in `tests/structured-inputs.test.mjs:84`:

- [v3.24.0 CI](https://github.com/kewtgh/crm/actions/runs/37352198126)
- [v3.23.0 CI](https://github.com/kewtgh/crm/actions/runs/37308455221)

Their production builds, typechecks, lint and PostgreSQL migration/auth/RLS jobs passed. The test
asserted that the bilingual name inputs must include the shared hint/validation component, which
was absent from the Channel agreement editor. The dependency audit steps were skipped after this
failure; local root, email-worker and planning-project audits report zero vulnerabilities.

The affected Chromium QA fixture now mocks the embedded v3.24 generated/uploaded document read APIs.
Previously these reads escaped the mock fixture and returned real unauthenticated 401 responses.
The fixture continues checking errors and additionally tests visible name guidance, rejection of
two blank names and acceptance of a single-language name.

Final local verification on Node 26.10.0 / npm 12.2.0:

| Check | Result |
| --- | --- |
| Original structured-input failure reproduced | PASS |
| Structured-input and Commission targeted tests (17) | PASS |
| Final `npm test`, including the 3.24.1 production build (235 + 8 tests) | PASS |
| Typecheck and two-file scoped lint | PASS |
| Root / email-worker / planning dependency audits | PASS — zero vulnerabilities |
| Chromium 1243 agreement QA, zh-CN/en, 1440/375 (4 viewports + behavior check) | PASS |
| Release metadata / lockfile alignment and whitespace | PASS |
| QA server stopped | PASS |
| Fresh remote Actions run for this patch | NOT RUN — no push or workflow dispatch |

The initial affected browser run failed on the missing fixture mocks; the final rerun after
fixing those mocks has zero errors. The build ran again after the user requested the 3.24.1
version promotion, because version metadata affects the build. No build-affecting source changed
after the final build. Migration 106–110 contents remain unchanged; no new migration was added.

Validation evidence is kept under Git-ignored `work/actions-fix/` and
`work/browser-qa-chromium-1243/actions-fix-agreements-final/`. Browser QA uses actual components,
production CSS and mocked APIs, not authenticated browser-to-real-database E2E.

No migration/schema change, dependency upgrade, contract status change, commission mutation or
workflow gate removal. Real contract templates remain DRAFT. Version metadata is 3.24.1.
The user authorized a checkpoint commit; push, deploy and Production access are not performed.
