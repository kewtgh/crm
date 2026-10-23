# First principles audit for v3.38

Date: 2026-10-23. Baseline: v3.37.7, `44b2ff8`; clean opening worktree.

## Principles and coverage

A CRM must preserve facts, show only permitted actions, distinguish unknown information from zero,
and help a person reach the next business action. Reads should fail independently when their business
sources are independent. Archived records must remain historical evidence without becoming new links.

The review traced dashboard and action-center aggregates, task completion and queues, personal
approvals and their current restrictive RLS, notifications, navigation capabilities, relation lookups,
shared request error/cancellation handling, and release/privacy controls. Existing financial commands,
receipt recovery, deployment schema guards and reporting timezone contracts were reviewed as boundaries;
this is not exhaustive certification of all business commands or live production infrastructure.

## Findings and decisions

| ID | Priority | Evidence and consequence | Implementation |
| --- | --- | --- | --- |
| A1 | High | `loadActionCenter` uses one `Promise.all` for dashboard, privacy and readiness. A failure in an independent source removes all known actionable work. | Settle independent sources separately; return explicit unavailable-source identifiers and only confirmed counts. Keep authentication/RLS at existing boundaries. |
| A2 | High | The action center can show green “No urgent items” and a clear empty state when growth is unavailable. Failed refreshes leave old data without a clear completeness state. | Distinguish complete, partial and failed-refresh snapshots; keep known work visible, label confirmed counts, and never assert clear while a source is unknown. |
| A3 | High | Approval signals are gated on `admin.access`, although migration 135 exposes personal requests and assigned team reviews to non-administrators. The legacy security-definer dashboard count has a different scope from the approval list. | Count pending approval rows through the regular RLS gateway. Use `/approvals` for non-administrators and `/admin/approvals` for administrators. Reuse the same count on the dashboard. |
| A4 | Medium | Dashboard risk/renewal links are rendered without `contracts.view`; notification attention links without `messages.view`. Task titles are not links to their task records. | Align these entries with route permissions, add direct task-detail links and matching today/overdue queue links. |
| A5 | Medium | Action-center category selection exists only in local state and offers no urgency focus. Empty filtered areas use the same wording as globally clear work. Mobile category scrolling can hide labels. | Add validated category and priority URL filters, history restoration, visible signal counts, wrapping category controls and explicit reset for filtered-empty results. |
| A6 | Medium | `searchRelatedRecords` omits `archived_at=is.null` for opportunities, contracts, quotes, households and leads, while current restrictive RLS already hides archived rows. This is a query-contract consistency gap, not evidence of an access bypass. | Add explicit active-row predicates before limits as defense in depth, preserving historical storage and RLS. |

## Architecture and business assessment

The shared gateway, transaction-local database identity, restrictive RLS, capability checks, trusted
mutation origins, immutable finance facts and request receipts provide useful domain boundaries.
The concrete mismatch is between source availability, aggregate scope and reachable actions. Fixing
that mismatch requires small shared read helpers and presentation contracts, not a new service or schema.
No accounting, consent, recognition, commission or approval decision policy changes are justified here.

Large JSX components, accumulated stylesheet layers and migration functions modified through textual
replacement increase future change cost. A repository-wide rewrite would need its own compatibility
inventory; this release confines cleanup to the action center being changed and tests the affected
contracts. The existing task queue remains a bounded snapshot rather than a global work ledger.

## Selected new capabilities

All selected additions are included in the execution plan: shareable category/urgency work views,
independent-source recovery with honest completeness, approval reminders for personal/assigned work,
and direct homepage navigation into task context. They use existing business facts and permissions.
Automatic outreach, AI scoring and automatic financial posting are excluded from the implementation
recommendation because they require new consent, outcome-quality or accounting policy decisions.

Technical references: [promise settlement semantics](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise.allsettled)
and [React effect cleanup](https://react.dev/reference/react/useEffect).
The application-specific conclusions above come from repository code, not from those references.
