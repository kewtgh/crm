# v3.37 verification

Date: 2026-10-16. Runtime: Node 24.22.0 LTS, npm 12.2.0, Playwright Core 1.64.0,
Chromium revision 1248, browser version 156.0.8078.4. Opening baseline: `523f682` / v3.36.0.

## Results

| Check | Result | Evidence and limits |
| --- | --- | --- |
| A1 completion | PASS | Executable adapter tests require exactly one matching returned row; zero, malformed, wrong or multiple rows fail safely. Active/non-DONE predicates preserve completion timestamps. Existing RLS/CSRF/capability boundaries remain in place. |
| A2 recovery | PASS | Component browser checks cover failed load then successful refresh, conflict preserving a task, and mutation invalidating a held pre-mutation read. An immediate ref guards duplicate write dispatch. |
| A3 queue | PASS | Page 2/3 navigation, local search, page-local selection, bulk completion, personal due-today filtering, explicit snapshot limits and mobile layout. |
| A4 deep links | PASS | Action-center links carry `queue=today` / `queue=overdue`; helper tests and actual component history checks preserve unrelated query context. Date tests cover midnight, timezone differences and DST. Time filters match the user's dashboard reporting timezone. |
| A5 saved views | PASS | V2 strict bounded schemas, local full-filter restore, team API payload/reload/restore, invalid resource-key rejection and v1 independent-filter compatibility. Team views retain existing ownership/access policies. |
| A6 launchers | PASS | All supported roles checked against canonical Students and Performance navigation. |
| Affected Node regression set | PASS | 42 tests across new regression, v3.5/v3.8 behavior, workflow usability, interaction reliability, UX foundation, release metadata and request security. |
| Typecheck | PASS | Final source checked using the repository compiler alias under Node 24 LTS. |
| Changed-file lint | PASS | Zero errors and zero warnings (`--max-warnings=0`). |
| Production build | PASS | One build of final v3.37.0 source, using the repository's bounded build command. |
| Public application browser phase | PASS | Six page/viewport checks: login, forgot password and reset password at 1440px and 375px. Zero errors/warnings. |
| Workflow-quality browser phase | PASS | Six scenario groups: Chinese/desktop and English/mobile queue and saved views, task recovery, shared/legacy views. Includes keyboard focus and overflow assertions. Zero errors/warnings. |
| Public-repository privacy and CI publication | PASS | 14 tests, including candidate-file identity guards and fixed public artifact allowlist. |

Private logs, exact executable evidence and final screenshots remain under ignored
`work/browser-qa-chromium-1248/v337-final/` and `work/v337/`. Final mobile screenshots were visually
reviewed; the previously clipped task summary now wraps and pagination text describes the current page.

The new component phase bundles actual components and production CSS with independently fictional
mocked APIs. It is not authenticated real-database E2E. No migration was introduced; no full database
suite, full ten-phase browser matrix, external-provider test or production deployment was performed.
The audit and regression work do not certify unreviewed financial/security paths.

## Cleanup

The local shared Docker inventory was inspected privately. Only the existing CRM BuildKit builder
was targeted. Pruning was restricted to unused cache older than 24 hours with a 2 GB reserve; Docker
reported 2.41 GB reclaimed. Remaining cache was retained under the age/reservation/shared-cache rules.
The builder was temporarily started for this operation and restored to stopped afterward.

No image, container or volume was deleted; other projects and the retained CRM historical images were
preserved. Approximately 90 MB of obsolete download/npm-cache/development-screenshot files were removed
after verifying their resolved paths remained inside ignored `work/` and had no redirections. The
pinned extracted Node runtime, validated build and final audit/QA evidence remain available. QA server
was stopped. Docker cache reclamation is not a claim that the host's virtual disk file was compacted.

Cleanup ran after final acceptance and before the final release commit so the committed plan can
include its completed outcome. No push or deployment was performed.
