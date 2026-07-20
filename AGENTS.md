# Repository agent instructions

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
