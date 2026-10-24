# First principles audit for v3.42

Date: 2026-10-25. Baseline: v3.41.0 at `f364822`, clean worktree, Node 24.22.1 LTS.

## Principles and coverage

Recovery should restore the deletion a user actually reviewed, preserve current access boundaries,
and confirm a previously accepted command after transport loss. Finding an archived record must not
depend on whether it happens to fit an undocumented snapshot. Retention labels must describe the
actual cleanup policy, rather than promise a physical deletion time the system does not guarantee.

This round traced personal and administrative recovery, the fixed business-resource catalog, archive
commands, ownership/MFA checks, generic editing and task revision compatibility, navigation and
recent calendar/quality/task receipt conventions. Approval, privacy, communication and automation
entrypoints were inspected as adjacent workflows; the implemented findings below concern the
recovery lifecycle. This is not certification of unrelated financial execution or live infrastructure.

## Findings and adopted changes

| ID | Priority | Evidence and impact | Implementation |
| --- | --- | --- | --- |
| R1 | High | `listRecycleBin`, `list_deleted_business_records` and `list_personal_recycle_bin` each limit individual resource queries to 100. The page displays the resulting array length without a limit explanation or a way to reach older records. | One authorized server query filters before stable global pagination, returns an exact matching total and removes per-resource truncation. Reuse the existing fixed catalog and personal ownership policy. |
| R2 | High | Restore requests contain only kind/ID. A stale selection can restore a newer deletion of the same record, and accepted restores have no durable request result. Legacy restore functions reject a retry once a record is active. | Bind restoration to the precise observed archive timestamp and a request receipt. Lock and recheck current access before replay, commit restore/audit/receipt atomically, and reject a different deletion without changing it. |
| R3 | Medium | The administrative adapter calculates a 30-day expiry for seven core kinds, while the personal adapter returns no expiry for those same kinds. Labels promise a scheduled permanent deletion and imply failed restoration means expiry, although restoration has no 30-day cutoff and cleanup may retain referenced records. | Share metadata for cleanup eligibility and explicit retention. Explain that eligibility is not a guaranteed deletion time and records remain restorable while present and authorized. Preserve the cleanup policy and historical data. |
| R4 | High | `RecycleBinPage` has no immediate duplicate guard, cancellation or refresh flow. A lost restore response is treated as failure, and the original dialog can be dismissed before the outcome is established. | Preserve exact request bytes, lock an uncertain confirmation, expose explicit original-request retry and separate accepted restore from failed display refresh. Never retry a write automatically. |
| R5 | Medium | There is no search, kind filter, retention focus, shareable view or recovery from an initial list failure. | Add validated URL search/kind/retention/page/page-size, history support, current-read action gating, last-page correction, visible loading/error/empty states and refresh. Provide direct links after recovery where an existing record-detail route is available. |

## Architecture and business decisions

Keep the existing catalog resolver, `personal_recycle_access`, super-administrator workspace scope
and administrator MFA requirements. The new command delegates the established restore routines so
student/household status, product lifecycle and other domain behavior remain compatible. Generic
record changes and workers retain their commands. A receipt does not grant access after membership
or ownership changes. Legacy staff restore entrypoints must no longer bypass the new archive token.

The new read response contains only reviewed labels, identifiers and recovery metadata, not raw
record JSON. Search is a bound substring query and dynamic table identifiers come only from the
fixed database catalog. Global counts and rows use one query snapshot. There is no bulk restore,
automatic dependency revival, new purge schedule, financial posting or customer outreach.

All R1–R5 fixes and selected new capabilities are included in the execution plan: complete paginated
recovery, shareable triage views, honest retention metadata, exact-request confirmation and links to
restored records. They extend the current application without an external service or an invented
business policy. A framework rewrite and automated cleanup expansion are not adopted changes.

Concurrency follows [PostgreSQL row-lock guidance](https://www.postgresql.org/docs/current/explicit-locking.html),
read invalidation follows [React effect cleanup](https://react.dev/reference/react/useEffect), and
recovery messages follow [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
The application findings above come from repository code.
