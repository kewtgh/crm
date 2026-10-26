# First principles audit for v3.47

Date: 2026-10-26. Baseline v3.46.0 at `93e217bb5f46ab87e073e7cbfe2f691c2e0af2a9`, clean worktree, Node 24.22.1 LTS.

## Principles and coverage

A CRM must preserve the request a person actually submitted and the facts a reviewer saw. A lost
response is not evidence of failure. Acceptance of a command, execution of its business action and
refreshing the display have independent outcomes. A privacy case must retain its existing identity,
second-review and execution controls; this audit does not establish new legal deadlines or policies.

Reviewed recent search/scheduling/settings, approvals, task/recycle/communication recovery, saved
views and action-center boundaries. Traced privacy request creation, RLS, review, execution and the
workspace in depth. The existing privacy functions already enforce identity verification, allowed
transitions, two reviewers for export/deletion and domain execution receipts. Reuse those owners;
do not introduce another execution engine or alter financial/retention rules.

## Findings and adopted scope

| ID | Priority | Code evidence and consequence | Adopted change |
| --- | --- | --- | --- |
| Q1 | High | createPrivacyRequest inserts without request identity; managePrivacyRequest sends no observed snapshot or command receipt. Response loss can duplicate a request; obsolete review context can authorize a later state. | Atomic create/review commands using the existing mutation_receipts table, current access checks before replay, snapshot preconditions and minimized results. Delegate the existing management/execution function. |
| Q2 | High | The review drawer omits the original note, requested changes and contact context, although these facts drive execution. Client transition labels do not distinguish acceptance from asynchronous execution. | Show the actual authorized request, whitelisted correction fields, contact link and observed status/identity. Preserve second-review restrictions and distinguish accepted/queued/completed outcomes. |
| Q3 | High | Pagination reads have no cancellation/error ownership; actions remain available on stale data. Accepted writes followed by a failed reload share the write-failure path. Pending state alone does not immediately prevent duplicate submissions. | One small workspace hook owns reads and commands, freezes exact request bytes while uncertain, invalidates prior reads, provides explicit original-request retry and display-only refresh recovery. No automatic write retry. |
| Q4 | Medium | The server accepts arbitrary status strings; list filters and pagination have no shareable view. Failed initial SSR reads remove the workspace, and shrinking totals can leave an empty nonfinal page. | Validated status/type/mine/overdue/page URL views, RLS-scoped filtering before complete stable pagination, actual last-page correction and independent read retry. Deadlines remain the stored absolute instants. |
| Q5 | High | The legacy read includes raw execution failure_detail, legal_hold and result_summary even though the UI only needs progress. Raw execution status/errors are rendered directly. | A positive read projection exposes only reviewed request context and bounded execution metadata; fixed bilingual status/failure guidance replaces internal diagnostics. No raw execution JSON in the browser or command receipts. |
| Q6 | High | User requests visible completed appointments. Existing completion already persists status/completed_at, but listAppointments always filters SCHEDULED and the UI removes completed events. | Preserve existing history; add a show-completed checkbox and 1 year/6 months/3 months/1 month/1 week display periods. Filter by completion date, show read-only completed markers and a complete paginated history with a jump to its scheduled day. No expiry deletion or CRM task-list integration. |
| Q7 | High | User requests internal-member relations and invitation reminders. Calendar supports organization/contact relations only; generic USER search is deliberately limited by task-assignment authority. Calendar colors encode appointment kind rather than relation/incoming context. | A calendar-only active-member directory and USER relation; atomic in-app invitations plus existing reminder scheduling, recipient-only read access and read-only incoming UI. Preserve exact creation/action replay and external attendee consent. Add relation colors with text labels and invitation links to the scheduled calendar context; do not widen task assignment. |

All Q1-Q7 fixes and their included capabilities are adopted: verifiable submission/review, explicit
uncertain confirmation, complete shareable triage, deadline focus and useful review context. Add two
forward migrations and reuse existing RLS, mutation receipts, tasks and privacy execution functions.
No new database/service, automatic outreach, purge schedule, scoring model or deployment protocol is
introduced. V2 remains paused; V1 and production infrastructure are outside scope.

The review does not certify every historical module or production. Large cumulative files remain
maintenance costs; extract only the privacy domain being changed. Wider customer automation and
legal-policy changes are not proposed without policy/evidence. Recovery is explicit within the open
workspace; sensitive draft payloads are not persisted in browser storage.

The user explicitly clarified that completed records mean calendar appointments and that the period
is a display filter: original history must be retained. Existing appointment completion timestamps
remain authoritative. Completed history is separate from scheduled reminders and cannot be edited,
completed again or requeued by the history controls. Calendar periods use account-local dates and
clamped calendar months, not an invented purge policy.

## Verification requirements

Use fictional fixtures, targeted protocol/API tests, a new disposable loopback-only PostgreSQL
fixture, a bounded bilingual Chromium 1248 phase and the complete production-candidate gates.
Full test:contracts:raw and the real Dockerfile verification target are mandatory before commit.
Separate real database/browser evidence from adapters. Keep raw evidence under ignored work/;
never connect to production, reuse existing database volumes or dispatch real privacy/email jobs.
