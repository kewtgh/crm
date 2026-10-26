# Repository agent instructions

## Node runtime

- Use the Node.js 24 LTS version pinned in `.nvmrc` for development and verification.
  Keep package engines, Docker images and CI aligned with that LTS version.

## Production candidate verification

- Targeted feature QA is not production-candidate acceptance. Before committing or handing off a
  production candidate, run the complete `npm run test:contracts:raw` without removing tests.
- Run `npm run release:verify` in development Docker, or obtain a successful CI Docker verification
  for the same candidate. This uses the production Dockerfile's `verification` target, including
  build, typecheck, lint, full contracts and deployment contracts in their actual order.
- Record the tested source, results and any pre-existing conditional skips. Do not substitute a
  previous SHA's CI result. Documentation-only candidates skipped by automatic CI require manual
  workflow dispatch or local verification. A failed/NOT_RUN gate cannot be reported as passed.
- See [the production candidate checklist](docs/RELEASE_CANDIDATE_CHECKLIST.md). This verification
  does not authorize a production deployment or replay of an archived request.

## Public repository privacy gate

- Conversation content and local operational files are not automatically Git-safe.
- No future CRM change may introduce real company identity, real customer/counterparty
  information, Production secrets, private infrastructure data or real transaction evidence
  into the public repository.
- Use independently fictional fixtures, reserved example addresses, neutral reference filenames,
  and repository-relative documentation paths. Keep private audit/QA evidence under ignored `work/`.
- Never publish original private contracts, source exports, raw operational logs or unreviewed
  screenshots. Public CI artifacts require a reviewed, minimized publication format.
- Do not store private values in public denial lists or reproduce them in error messages.
- Credential rotation and public history rewrites require separate explicit authorization;
  deleting a value from current files does not remove historical exposure.

## Keep audits and verification strictly time-bounded

- Do not turn a scoped implementation task into a repository-wide audit, release audit, or full
  regression campaign unless the user explicitly asks for one.
- Work in short, visible steps. Run one bounded check at a time and report its result before starting
  the next category of work.
- Prefer the smallest relevant verification set: targeted tests, typecheck, lint, and only the
  browser phase directly affected by the change.
- Do not run the complete ten-phase Chromium matrix, the complete database suite, or repeated full
  builds for a scoped change without explicit user approval.
- Any single optional audit or QA command expected to take more than 60 seconds requires advance
  user approval. A normal required build may use its existing repository timeout, but must not be
  repeated unless source affecting the build changed.
- Once the requested behavior and its targeted regression tests pass, stop expanding the audit.
  Summarize remaining optional checks instead of executing them.
- If a tool call is interrupted or ambiguous, first inspect whether it already completed. Do not
  immediately rerun or broaden it.
- On Windows, never start the persistent QA server with `Start-Process npm.cmd`: descendant
  processes can retain the tool's output handles and make a successful start look hung. Use
  `npm run qa:server:start`, `npm run qa:server:status`, and `npm run qa:server:stop`; these use a
  detached direct Node entrypoint, file-backed logs, and a PID file.

## Browser QA is available locally

- This development environment has the pinned revision 1248 Headless Shell runtime installed.
  The shared resolver accepts `ms-playwright/chromium-1248` or `ms-playwright/chromium_headless_shell-1248`,
  with an explicit `PLAYWRIGHT_CHROMIUM_1248_PATH` override; both builds must use revision 1248.
- For this repository's browser, responsive, accessibility, authentication, and release QA, use
  `npm run qa:chromium-1248` and the existing `scripts/browser-qa-chromium-1248.cjs` workflow.
- The absence of an in-app Browser session is **not** a blocker and must not be reported as proof
  that browser QA is unavailable.
- Do not download or install another browser and do not silently substitute a different Chromium
  revision. Keep the exact Chromium revision and executable evidence in the generated report.
- Start the validated production build on the repository's configured local URL before QA, and
  retain the report under the existing Git-ignored `work/browser-qa-chromium-1248/` evidence path.
- If a higher-priority runtime policy prevents executing the pinned browser, state that exact policy
  conflict; do not claim that no browser is installed or available in the development environment.
