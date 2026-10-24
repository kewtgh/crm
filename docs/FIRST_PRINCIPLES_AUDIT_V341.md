# First principles audit for v3.41

Date: 2026-10-25. Baseline: v3.40.0 at `0131cc7`, clean worktree.

## Business principles and coverage

A CRM should preserve the facts a user acted on, confirm accepted commands after a lost response,
and distinguish a current workload from an unavailable or outdated snapshot. A saved work context
should reproduce the same filters. Visible actions should follow the same permissions as their APIs.

The review traced capabilities and transaction-local database identity, the dashboard and task queue,
generic record editing, action-center links, notification reads and writes, saved views, recent
calendar/quality command contracts, financial read boundaries and release/privacy controls. Existing
RLS, finance facts, consent and approval rules remain domain boundaries. This is a code-path audit,
not a certification of every module or of a running production system.

## Findings and adopted changes

| ID | Priority | Evidence and consequence | Change |
| --- | --- | --- | --- |
| T1 | High | `completeDashboardTask` checks affected rows but not the version displayed. `bulk_complete_crm_tasks` is already atomic, but also lacks observed versions. A task edited by another operator can be completed from obsolete context. | Add task revisions advanced by all updates, return them with queue/dashboard reads, and require each observed revision for quick completion. Preserve generic editor timestamp checks. |
| T2 | High | Both completion APIs lack request receipts. A lost response leaves an accepted completion indistinguishable from failure; a new retry encounters DONE and cannot recover its result. | One atomic command owns version checks, current edit authorization, audit and durable receipt. Preserve the exact payload in the client, allow explicit original-request retry and block competing work while uncertain. |
| T3 | High | `TaskWorkspacePanel` keeps completion and selection enabled after failed or ongoing reads. After success it removes rows but retains old capacity totals until a later refresh, with no accepted-write/failed-refresh distinction. | Gate mutations on current confirmed data, invalidate reads before writes, refresh capacity and queue together, and offer display-only recovery after an accepted write. Freeze the bulk selection and reason while its result is unknown. |
| T4 | Medium | The `queue` filter is shareable, but queue search and pagination are local state. There is no priority focus despite priority data already being present. | Add independently named URL search, priority and page parameters; preserve directory parameters, support browser history, reset paging on filter changes and expose bilingual priority controls. Keep the 100-row snapshot boundary explicit. |
| N1 | Medium | `NotificationCenterPage` and the shell popover render mark-read actions for OPERATIONS_MANAGER and CUSTOMER_SUCCESS_SPECIALIST, whose capabilities include `messages.view` but not `messages.manage`. The API correctly rejects those writes. | Gate both interfaces and the hook with the existing manage capability. Do not expand server permissions. |
| N2 | High | Notification loads can finish after mark-read begins, and cross-instance change events may start reads during a write. Old results can restore an already-read notification. Post-write read failure uses the same error channel as write failure. | Cancel and invalidate pre-write reads, serialize change-event refreshes during writes, gate stale-data actions and distinguish accepted writes from failed display refreshes. |

## Architecture assessment

The shared gateway, transaction-local identities, scoped ownership checks and receipt table already
support the required guarantees. Reuse them through a small task command contract and completion
hook. Use deterministic row-lock ordering for multi-task changes, retain all-or-nothing behavior and
recheck edit access before returning a receipt. Keep the existing generic record editor and worker
task changes compatible; task revisions must advance for those paths too.

The prior action-center source isolation, calendar action receipts, quality governance, schema-guarded
deployment and saved directory views address earlier findings. No new defect in accounting or consent
policy was established by these reviewed paths. Large components and cumulative CSS remain maintenance
costs; extract the state being changed here rather than attempt a repository-wide framework rewrite.

## Included features and business limits

All six findings are included in this release. New capabilities are version-aware completion,
explicit confirmation of an uncertain single/bulk completion, shareable queue search/priority/page
views, and recovery that refreshes accepted work without submitting it again. They require no external
service, new accounting rule or customer contact. Automatic outreach, predictive scoring and automatic
financial posting are not adopted recommendations because this review supplies no consent, outcome
calibration or accounting policy for them.

Concurrency follows [PostgreSQL row-lock guidance](https://www.postgresql.org/docs/current/explicit-locking.html).
Read cleanup follows [React effect guidance](https://react.dev/reference/react/useEffect), and visible
result/recovery messages follow [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
The findings above are derived from repository code.
