# 3.27 implementation plan — Daily workflow and interaction reliability

1. Fix the shared drawer stack and add opt-in unsaved-change protection (UX-01/02).
2. Add contextual student/cohort enrollment; keep canonical validation and lifecycle; repair
   committed-save/refresh handling and request sequencing (UX-03/04/05).
3. Correct navigation/picker labels; add visible filter reset/count (UX-06/07).
4. Add a capability-aware workflow launchpad and refreshable, accurately described action center
   (UX-08/09). Reuse current data and APIs; do not invent a second task engine.
5. Apply cohesive responsive interaction styling and validate keyboard, mobile, bilingual behavior
   against actual components and production CSS (UX-10).
6. Run targeted tests, typecheck, scoped lint, migration immutability check, public privacy tests,
   production build and affected Chromium 1243 scope. Stop the QA server.
7. Update release metadata to 3.27.0 and commit only this task. No push or deploy.

Acceptance: closing a nested drawer leaves its parent; changed forms offer keep/discard; enrollment controls remain capability-gated; student/cohort context survives submission; refresh failure after
save never triggers a second mutation; latest request wins; reset clears all active directory
filters; action center exposes its age and does not claim deduplicated counts; business shortcuts
respect capabilities. No new migration or Revenue functionality.

Deferred policy-dependent suggestions are documented in PRODUCT_WORKFLOW_AUDIT_V327.md and are
excluded from this executable plan. Verification results and remaining limits are appended below.

Additional confirmed fixes: UX-11 isolates optional growth-summary failure with an explicit
unavailable state; UX-12 removes an unjustified ROI formula and names won opportunity value
accurately. Both are included in this iteration and receive targeted regressions.

Frontline and management workflows have equal priority. The dashboard presents equally prominent
Daily operations and Management & improvement switches. Management links reuse the formal
executive overview, channel reporting and team performance views, with import/data-quality tools.
These links do not grant permissions, create Revenue metrics or infer employee compensation.


## Completion and verification

All twelve executable findings UX-01 through UX-12 are implemented. The equal-priority daily and
management entry decision is included. Policy-dependent suggestions remain explicit future inputs.

| Check | Result | Scope |
|---|---|---|
| Targeted regressions | PASS | 48 tests: workflow usability, enrollments, UI system, customer operations |
| Typecheck | PASS | Final TypeScript source |
| Scoped lint | PASS | Changed source, fixtures and QA helpers |
| Production build | PASS | Final 3.27.0 build, after close-control fix |
| Chromium 1243 usability | PASS | 5 report checks: zh-CN/en, 1440/375 and verification boundary |
| Existing experience browser regression | PASS | 37 page/viewport checks affected by shared UI |
| Public privacy regression | PASS | 8 checks including tracked/candidate files |
| Release metadata | PASS | Checker and 2 metadata tests |
| Migration verification | PASS | Latest 113; no migration diff |
| Whitespace | PASS | git diff --check |
| QA server | STOPPED | Local server stopped after verification |
| Real authenticated browser-to-DB E2E | NOT RUN | No claim of production or complete database verification |
| Complete repository regression / ten-phase browser matrix | NOT RUN | Bounded affected checks only |
| Push / deployment / Production access | NOT RUN | Not part of this task |

Browser evidence uses actual components, production CSS and independently fictional mocked business
APIs. It verifies nested initial mount, focus/scroll restoration, X/overlay/Escape/cancel discard
protection, contextual canonical payloads, accepted-save refresh failure without resubmission,
management/daily entry switching, responsive layout and explicit unavailable read states. Existing
canonical mutation/permission/receipt semantics are retained; no new database behavior is claimed.
Private logs and screenshots remain under ignored work/product-audit and work/browser-qa-chromium-1243.

Baseline main: 7f2058e1b11367e4ad55981f0ca9c477becc6d9e; starting version 3.26.0.
Final version: 3.27.0. Verification runtime: Node 26.10.0 / npm 12.2.0.
Six earlier Revenue specification candidates are excluded from this commit.
