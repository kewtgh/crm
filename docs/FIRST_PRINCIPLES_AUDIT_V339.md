# First principles audit for v3.39

Date: 2026-10-23. Baseline: v3.38.0, `e7a1592`; clean worktree.

## Product principles and inspected paths

Business state changes need current authority, explicit preconditions and one durable result per
intention. Transport failure does not prove rejection. A view must describe the range and filters
of the data actually shown, make failure visible, and provide a route back to current information.

This round traced calendar creation, completion, cancellation, rescheduling, invitation queues,
related-record search, reporting timezones, export job lists/download eligibility, and data-quality
interactions. Previous action-center fixes remain the baseline. This is a bounded review of those
paths, not a certification of every CRM command or production service.

## Findings and implementation decisions

| ID | Priority | Evidence and consequence | Change |
| --- | --- | --- | --- |
| C1 | High | Legacy `complete_appointment` can overwrite terminal state; `update_appointment_delivery` has no expected-version or receipt guard and increments the event version on every repeat. Repeated delivery updates can enqueue additional invitations. | Add an atomic, authorized, version-checked appointment action with exact-request receipts and audit. Restrict legacy mutation entrypoints; test stale versions, terminal states, replay, ownership, tenants and delivery counts on disposable PostgreSQL. |
| C2 | High | `CalendarPage` resets a creation request key on any edit after an uncertain response. An accepted request can then be submitted again under a new key. Reminder values are translated labels, and reconstituting a retry can change its meaning after a locale switch. | Preserve exact serialized create/action requests until the result is definitive. Lock uncertain input and closing, offer an explicit same-request retry, and use stable reminder values. Keep accepted writes distinct from refresh failures. |
| C3 | High | Calendar reads set `formError`, which is rendered only inside the creation drawer. Reads lack a sequence guard against writes, and successful reloads do not clear old errors. Completion hides only the reminder, leaving the event on the month grid. | Separate visible read errors from form/action errors; add refresh/loading states and invalidate earlier reads before mutations. Reconcile all calendar representations from one event set. |
| C4 | Medium | Selecting a date immediately opens creation. Only two events are shown per cell, while the reminder list hides past dates. Users cannot inspect a full selected-day schedule. The list's two-month scope is implicit. Mobile legends scroll out of view and three action buttons occupy a one-button column. | Add a selected-day agenda with pagination and a separate create action; keep upcoming and selected-day views explicit, show the bounded range and wrap legend/action controls. |
| C5 | Medium | Calendar relation search requests every permitted type and removes only USER, although the create API accepts only ORGANIZATION/CONTACT. | Restrict the query and returned options to supported relation types; retain the selected label when subsequent searches change the option list. |
| E1 | Medium | `ExportsPage` has no explicit refresh or loading state; pagination clamps its displayed page without reloading that page when totals shrink. Old download actions remain active while a different filter is loading. READY can still display after expiry. | Add cancellable refresh with visible loading/recovery, real page correction, query/result consistency and deadline-based download eligibility. Validate status filters and preserve existing server download authorization. |
| E2 | Medium | The export GET route catches pagination `ApiError` and converts it into a generic 500. | Let the existing API wrapper preserve structured validation errors and appropriate status. |

## Architecture and business boundaries

The existing appointment create fingerprint, mutation receipt table, role/RLS predicates, outbox and
timezone conversions are suitable building blocks. A browser-only repair cannot make repeated PATCH
commands atomic. The new action command must lock the record, validate its event version and SCHEDULED
state, write its receipt/audit and queue deliveries in one transaction. Historical migration files
must remain byte-identical; the forward migration introduces no financial policy or automatic outreach.

The broader application still accumulates long components and layered CSS. This release extracts
calendar contracts and presentation helpers where needed, rather than changing unrelated record
workspaces. Data-quality and marketing-export flows would need separate command-specific evidence
before adopting new retry semantics; this review does not claim they share appointment guarantees.

## Selected additions

Implement all changes above, including selected-day schedule inspection, explicit calendar refresh,
exact-request recovery for appointment changes, and an export refresh/status recovery workflow.
External calendar synchronization, recurring events and automatic customer reminders beyond existing
consent-controlled delivery are excluded: they introduce new provider, recurrence and consent rules.
