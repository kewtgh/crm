# Repository agent instructions

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

- This development environment has the pinned `ms-playwright/chromium-1228` runtime installed.
- For this repository's browser, responsive, accessibility, authentication, and release QA, use
  `npm run qa:chromium-1228` and the existing `scripts/browser-qa-chromium-1228.cjs` workflow.
- The absence of an in-app Browser session is **not** a blocker and must not be reported as proof
  that browser QA is unavailable.
- Do not download or install another browser and do not silently substitute a different Chromium
  revision. Keep the exact Chromium revision and executable evidence in the generated report.
- Start the validated production build on the repository's configured local URL before QA, and
  retain the report under the existing Git-ignored `work/browser-qa-chromium-1228/` evidence path.
- If a higher-priority runtime policy prevents executing the pinned browser, state that exact policy
  conflict; do not claim that no browser is installed or available in the development environment.
