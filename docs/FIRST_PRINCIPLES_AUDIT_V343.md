# First principles audit for v3.43

Date: 2026-10-25. Baseline: v3.42.0 at `5d190b1`, clean worktree, Node 24.22.1 LTS.

## Principles and reviewed paths

A communication is an instruction with a recipient, a purpose and one known outcome. A timeout is
not proof that the instruction failed. Acceptance by the application is distinct from delivery by
the provider. Recovery must preserve the original instruction, respect current record visibility,
and never turn a confirmation into a new delivery attempt. A failed read cannot authorize actions
on a stale conversation. A draft belongs to its conversation.

This round traced navigation, approval review, exports, settings, privacy request entrypoints and
the communication inbox through API authorization, contact visibility/consent and asynchronous
delivery. The adopted findings concern communication lifecycle integrity and usability. Existing
task, calendar, quality and recycle commands remain the precedent for receipts and recovery.
Financial posting, approval policy and production infrastructure are outside this implementation.

## Findings and adopted changes

| ID | Priority | Evidence and effect | Change |
| --- | --- | --- | --- |
| C1 | High | `CommunicationsInboxPage` renders creation, inbound, sending and redelivery controls for roles with `messages.view` but no `messages.manage`. The API correctly refuses those writes. | Gate every mutation control and handler with the existing capability. Keep read access and server permissions unchanged. |
| C2 | High | `operate` treats transport loss as ordinary failure. Form edits and `chooseThread` discard the original keys. A user can submit a new copy of a message already accepted. | Retain exact request bytes, freeze competing writes while uncertain, provide explicit original-request confirmation, and warn before leaving unsent or uncertain work. |
| C3 | High | Redelivery accepts only a message ID. It has no durable request result or observed failure token; replay can act on a later failure. The legacy routine also lacks the snapshot's `outcome_may_have_been_accepted=false` safeguard. | Add an atomic command receipt, bind redelivery to the observed update timestamp, reject possibly accepted outcomes, and keep current contact visibility checks before receipt replay. |
| C4 | High | A failed detail read leaves the old thread editable; pre-write detail reads are not invalidated. Accepted writes and failed refreshes share one error channel. | Independent cancellable inbox/detail reads, confirmed-data mutation gates, write-time invalidation and an accepted-write refresh-only state. No automatic mutation retry. |
| C5 | Medium | The composer is reused across threads, so unsent text can appear beside another recipient. Thread selection is not written to the URL and an off-page deep link is replaced by list refresh. | Keep drafts per thread in page memory, clear only the accepted draft, preserve explicit off-page selection and share selected conversation in the URL. Do not persist message text in browser storage. |
| C6 | Medium | Inbox search/page state is local; status, purpose and delivery attention are absent. Pagination visually clamps a page without fetching its replacement. Initial read failure has no local recovery. | Add validated URL views, complete server filters before count/pagination, actual last-page correction, browser history and independent refresh controls. |

## Architecture and adopted features

Use a small shared contract and a communication workspace hook. A forward migration supplies the
filtered read and atomic command envelope around established creation, recording and queueing
functions. Store hashes and bounded outcome metadata in receipts and audit, not message bodies.
The leased worker remains the only provider-delivery owner. Legacy batch producers retain their
interfaces; the web inbox redelivery path uses the guarded command exclusively.

All C1–C6 changes and the associated new features are included: shareable inbox triage by lifecycle,
purpose and delivery attention, exact-request recovery, independently recoverable panes and
conversation-specific drafts. No automated outreach, new paid provider, automatic consent changes,
or predictive scoring is introduced. These would require business policy and outcome evidence.

Read cancellation follows [React effect guidance](https://react.dev/reference/react/useEffect).
Command serialization follows [PostgreSQL locking guidance](https://www.postgresql.org/docs/current/explicit-locking.html).
Recovery feedback follows [W3C status message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
The findings are derived from repository code; these references support the implementation principles.
