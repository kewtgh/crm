# Verification for v3.38

Date: 2026-10-23. Runtime: Node 24.22.0 LTS; Playwright Core 1.64.0; pinned Chromium revision 1248.

## Completed checks

- Targeted behavioral regressions: 34 passed, zero failed or skipped across v3.38, v3.37,
  workflow usability, frontline experience and personal governance.
- Public repository/privacy artifact tests: 14 passed. Release metadata/UX checks: three passed;
  `npm run release:check` confirms canonical version 3.38.0. Total automated tests: 51 passed.
- Typecheck and ESLint for changed source, tests and QA scripts passed.
- Production build passed. Build-tool diagnostics concern dynamic imports, chunk grouping and
  route classification; they did not block compilation. A mobile control-wrap correction justified
  one subsequent build, using the existing build timeout.
- Chromium component phase: 16 checks passed with browser 156.0.8078.4, including Chinese/English,
  1440px/375px, URL filters/history/reset, incomplete and filtered-empty states, stale refresh recovery,
  capability-aligned dashboard destinations, task context and unknown approval counts.
- Chromium public phase: login, password recovery and password reset at desktop/mobile; six checks
  passed. The component and public phases created no identities and made no business writes.
- The task-owned production QA server was stopped; its status confirms no remaining server PID.

## Evidence and boundaries

Private reports retain the exact executable, browser revision/version, source fingerprint, build hash,
migration head and timestamps under `work/browser-qa-chromium-1248/phases/action-review/` and
`work/browser-qa-chromium-1248/phases/01-public/`. Screenshots were visually reviewed; wrapping controls
were added after that review found mobile labels could scroll out of view. The regression now checks
every category button against its container, not just document overflow.

Component fixtures exercise actual components and production CSS using fictional API responses.
Adapter tests verify approval queries and failure semantics, but do not prove live database RLS.
The existing restrictive approval policy was inspected; it is unchanged. No live authenticated
database suite, full browser matrix, production deployment or infrastructure recovery test was run.
Those are optional follow-up checks, not evidence supplied by this release.
