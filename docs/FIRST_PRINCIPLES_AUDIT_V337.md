# First-principles audit — v3.37

Date: 2026-10-16. Opening baseline: v3.36.0, commit `523f682`. Opening worktree was clean.

## Product principles and audit boundary

A CRM should preserve business facts, show the user's permitted work, make the next action reachable,
and acknowledge a mutation only when its outcome is supported by evidence. Repeated use should reduce
setup, not require reconstructing filters. A late read must not undo a newer user intention.

The review traced identity/capabilities and database context, directory/search and saved views,
dashboard/action-center/task flows, notifications, customer follow-up, navigation, financial read
boundaries and the QA/release workflow. This is an evidence-based review of those cross-cutting paths,
not certification that every financial command, database policy or page is defect-free. No production
connection or original business evidence is used. Private browser evidence stays under ignored `work/`.

## Findings

| ID | Priority | Evidence and practical consequence | Decision |
| --- | --- | --- | --- |
| A1 | High | `completeDashboardTask` in `lib/dashboard-repository.ts` requests `return=minimal`. The gateway returns 204 even when RLS/filters affect zero rows. `PATCH /api/tasks/[id]` then returns success and clients remove the task. Archived/completed rows are not excluded either. | Require one returned task for an active, non-DONE transition. Return a safe conflict on zero rows; retain client state and offer refresh. Preserve existing RLS and task audit triggers. |
| A2 | High | `components/task-workspace.tsx` starts an uncancelled load on mount/refresh. A load begun before completion can restore the completed row. Only a React state boolean guards writes, and successful refresh does not clear a previous error. | Cancel/invalidate earlier reads at mutation start, use an immediate write guard, offer explicit refresh, distinguish failed reads from empty queues. |
| A3 | Medium | The queue uses `visible.slice(0,12)` and a jump to another list. Filtered rows 13–100 cannot be navigated within that queue. The database deliberately caps the snapshot at 100, so summary figures are not global totals. | Add queue pagination, searchable titles/context/owner, and a due-today filter. Keep the 100-row boundary explicit, keep selection page-local, and retain the full-record-list link. |
| A4 | Medium | `lib/action-center-repository.ts` sends both overdue and today task signals to unfiltered `/tasks`. Queue filters exist only in component state. | Carry a validated `queue` URL parameter into the task panel; preserve unrelated directory URL parameters and support history restoration. Today uses the user reporting timezone, matching the dashboard. |
| A5 | Medium | `lib/saved-view-schema.ts` and `DataTable` save only query/status/sort/page-size. Owner, organization and commercial filters remain active independently when applying a view. Existing help documents this limitation but it frustrates reproducibility. | Introduce a bounded version-2 view with resource-specific directory filters. Existing v1 records remain readable with their documented independent-filter behavior; new views restore the complete supported filter set. Server rejects invalid or foreign-resource filter keys. |
| A6 | Medium | `lib/workflow-navigation.ts` sends the Students launcher to `/households` despite canonical `/students`, and gates Performance on `education.view` rather than `performance.view`. | Align launcher destination and capability with canonical navigation. Add all-role regression coverage. |

## Architecture assessment

Existing capability checks, trusted-origin/CSRF validation and transaction-local workspace context are
valuable boundaries. The task fixes should reuse them rather than add a system-level bypass.
`crm_task_workspace` deliberately limits the work snapshot; calling that an exhaustive list would be
incorrect. No schema rewrite is needed for the selected changes: saved-view config already stores JSONB,
and the gateway supports returned update rows. Shared helpers should own versioned view normalization
and task-filter semantics instead of embedding them repeatedly in large components.

Financial fact/recognition and consent/access ownership should remain independent. The reviewed
Revenue reader delegates to existing commands; this audit supplies no evidence justifying an accounting
rewrite or automatic posting. Notifications already use cancellation, page correction and a mutation
guard; reuse that discipline for tasks. Existing receipt-based workflows are preferable to new retry
infrastructure for this bounded release.

## New functions selected for implementation

Complete directory saved views; a searchable, paginated priority queue; reporting-timezone due-today
filtering; direct action-center task views; and explicit queue refresh/recovery. All are included in
the [implementation plan](FIRST_PRINCIPLES_PLAN_V337.md). They require no external service or guessed
business policy. Automatic outreach, predictive scoring and new financial automation were considered
and excluded: the reviewed evidence does not establish consent policy, calibrated outcomes or approval
rules for them. They are not unfinished items in this release.

## Application baseline and references

The existing validated production build passed the Chromium 1248 public phase: login, password recovery
and password reset at 1440px and 375px; six checks, zero errors/warnings, browser 156.0.8078.4.
Authenticated component behavior will be tested separately using independently fictional fixture data;
fixture QA will not be described as real-database end-to-end validation.

The implementation follows [PostgreSQL returned-row semantics](https://www.postgresql.org/docs/current/dml-returning.html),
[React effect cleanup guidance](https://react.dev/reference/react/useEffect), and
[W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
