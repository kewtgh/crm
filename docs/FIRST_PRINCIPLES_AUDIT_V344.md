# First principles audit for v3.44

Date: 2026-10-25. Baseline: v3.43.0 at `f12cbba`, clean worktree, Node 24.22.1 LTS.

## Principles and coverage

Approval is a decision about a specific reviewed request, distinct from execution of its business
action. A stale view cannot authorize a changed request, and response loss cannot establish failure.
An expired request remains history but is no longer actionable. Current membership, assignment,
MFA and specialized financial authority remain mandatory during recovery. Lists and totals must
describe the same authorized population.

This round traced personal/administrative approval discovery, decision APIs, database authorization,
terminal administrator decisions, export generation and financial approval guards. Settings,
privacy-request entrypoints and the recently remediated communication/recovery flows supplied
adjacent architecture context. The adopted scope below completes approval review and triage;
it does not replace domain accounting, consent or production deployment policy.

## Findings and adopted changes

| ID | Priority | Evidence and consequence | Implementation |
| --- | --- | --- | --- |
| A1 | High | Approval records model only pending/approved/rejected. The database also retains cancellation and expiry; pending counters include expired requests and the page still offers review. | Represent cancellation and expiry explicitly, gate decisions on the current expiry, and align dashboard/action/admin pending counts with unexpired requests. |
| A2 | High | `listApprovals` maps unrecognized request types to performance summary. Five revenue approval types are absent from the catalog, so professional review context is mislabeled. | Preserve actual request types, add correct bilingual labels and a truthful unknown fallback. Revenue approvals open their existing specialized workspace instead of a generic decision form. |
| A3 | High | Decision requests carry no observed snapshot or receipt. A timeout loses an accepted result; stale requests can be decided after the underlying review context changes. | Atomic snapshot-bound command receipts around existing decisions, with current assignment/MFA checks before replay, exact retries and unchanged business execution rules. Preserve custody lock ordering and authority checks. |
| A4 | High | The page has no immediate write lock, read invalidation or stale-data gate. A pre-write read can overwrite accepted state; editing or switching during response loss changes the intended decision. | Dedicated workspace state, cancellable reads, frozen reviewed context and a locked uncertain confirmation. Never retry a mutation automatically. |
| A5 | High | An accepted decision with `execution_status=FAILED` leaves the old pending review open. A successful decision followed by a failed read shares the same failure channel. | Separate decision acceptance, business execution failure and display-refresh failure. Show durable history and a failed-execution focus; no second approval or automatic business retry. |
| A6 | Medium | Search/type/status/page are local state; page numbers are visually clamped without loading a replacement. Initial failure has no workspace refresh, and reviewers cannot focus their own requests or assigned work. | Validated shareable URL views, mine/reviewable scope, complete server filtering/counting, actual last-page correction, history support and explicit read recovery. |

## Architecture and included features

Use an invoker read projection so existing approval RLS remains authoritative. A forward migration
adds snapshot digests and a command wrapper without adding revision triggers that would conflict
with immutable revenue approval guards. Hash normalized timestamp epochs so recovery is independent
of session timezone. Minimize receipts and confirmation audit data; do not expose request payloads
or raw execution errors in the new read projection.

All A1–A6 fixes and new features are adopted: shareable review/history views, personal and reviewable
focus, execution-failure triage, explicit request confirmation and refresh-only recovery. Existing
revenue decision RPCs retain their domain guards and receipt contracts; the generic HTTP decision
path uses the new snapshot-bound command for ordinary approvals. No new financial posting,
automatic execution retry, customer outreach or paid service is introduced.

Implementation follows [PostgreSQL locking guidance](https://www.postgresql.org/docs/current/explicit-locking.html),
[React effect cleanup](https://react.dev/reference/react/useEffect) and
[W3C status feedback guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
The findings come from repository code.
