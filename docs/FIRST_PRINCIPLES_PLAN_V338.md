# Implementation plan for v3.38

Source: [audit](FIRST_PRINCIPLES_AUDIT_V338.md). All six findings and selected features are in scope.
Authorization covers implementation, versioning and local commit. Production deployment is separate.

| Step | Change and acceptance | Status |
| --- | --- | --- |
| 1 | Save audit and plan before implementation. | Complete |
| 2 | A3: shared RLS pending-approval count with strict count validation; integrate dashboard and action-center route selection. Count failures remain explicit. | Complete |
| 3 | A1–A2: independently settle action sources, preserve confirmed work, identify unavailable sources, and distinguish partial/refresh-failed/empty states. | Complete |
| 4 | A4: capability-aligned dashboard entries and direct task/queue navigation. | Complete |
| 5 | A5: validated URL category/priority filters, history, visible count, reset and bilingual accessible controls. | Complete |
| 6 | A6: archived relation filters before limits, with adapter regressions for every affected type. | Complete |
| 7 | Run bounded targeted behavioral tests, typecheck, changed-file lint, required production build, pinned Chromium public and affected component phases. Inspect responsive Chinese/English views. A screenshot-driven CSS correction required rebuilding and rerunning the affected phases. | Complete |
| 8 | Update canonical metadata to 3.38.0, record verification and limits, run privacy/release checks, review and commit. Stop any task-owned QA server. | Complete in release commit |

## Verification contract

Use fictional records and adapter/component fixtures; do not mutate operational data. Test all roles,
independent failures and recovery, malformed counts, partial-empty behavior, URL round-trip/history,
and missing/archived lookups. Component fixtures do not prove live RLS integration. No database
migration is needed. No full database suite or complete Chromium matrix is planned. Each optional
QA command is bounded to at most 55 seconds; the normal build uses its repository timeout.
Evidence stays in ignored `work/browser-qa-chromium-1248/`; public documents contain minimized results.
