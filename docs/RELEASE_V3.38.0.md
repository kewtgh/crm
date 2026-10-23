# Release v3.38.0

Date: 2026-10-23.

## Daily work and reliability

The action center keeps confirmed work available when an independent source fails. Missing sources
are named without exposing diagnostics. Incomplete data and failed refreshes cannot display a clear
workload claim; a successful refresh restores the normal state. Counts remain overlapping category
signals, with the snapshot time visible.

Category and priority filters now use validated URL parameters, preserve unrelated context and support
browser history. Filtered-empty views offer a reset, and mobile category controls wrap to keep every
label visible. Chinese and English messages cover all new states.

Pending approval counts use the same regular RLS read boundary as approval lists. Non-administrators
can reach their requests and assigned reviews through personal approvals; administrators retain their
administrative destination. The dashboard labels unavailable approval counts and provides a recovery
link instead of presenting zero. Approval decision permissions are unchanged.

Dashboard contract and notification entries follow destination capabilities. Task titles open their
records, and today/overdue links open the matching personal queue. Related-record searches explicitly
exclude archived opportunities, contracts, quotes, families and leads before limiting results,
reinforcing existing RLS protection.

## Compatibility and verification

No migration, dependency update, automatic record mutation or financial policy change is included.
Node remains pinned to 24.22.0 LTS and Chromium to revision 1248. The new behavioral tests join the
regular test and contract commands; focused commands are `npm run test:action-review` and
`QA_PHASE=action-review npm run qa:chromium-1248` (set the environment using your shell).

See the [audit](FIRST_PRINCIPLES_AUDIT_V338.md), [completed plan](FIRST_PRINCIPLES_PLAN_V338.md)
and [verification results](V338_VERIFICATION.md).
