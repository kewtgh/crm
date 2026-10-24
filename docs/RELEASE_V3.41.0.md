# Release v3.41.0

Date: 2026-10-25.

## Task completion and recovery

Quick completion now requires the version displayed with each task. Forward migration 138 advances
task revisions on every update, including existing generic edits and worker changes. One command
checks current access and all selected versions before completing a task or batch, and records the
action audit and exact-request receipt atomically. A stale, archived or unavailable selection changes
nothing. Replaying an accepted request returns its original result without another completion audit.
The legacy staff bulk-completion RPC is revoked; generic record editing retains its existing contract.

The dashboard and queue preserve uncertain requests for explicit retry. The queue freezes an uncertain
bulk selection and reason, blocks actions against failed/loading reads and refreshes capacity with the
workload after acceptance. A failed display refresh offers read recovery without another completion.
Queue search, priority and page are shareable URL parameters independent of the full directory's
filters. The queue remains a snapshot of up to 100 visible open tasks.

Apply migration 138 before running this version. Older clients missing revisions/request identity
must reload before quick completion. Historical migrations and task business facts are preserved.

## Notifications

Mark-read controls in the notification page and top popover follow `messages.manage`. Read-only
roles retain navigation to their notifications. Pre-write reads are cancelled, change events received
during a write are serialized, and a failed display refresh is distinguished from a failed or
unconfirmed write. Existing API authorization and notification ownership policies remain in force.

## Validation

Use `npm run test:task-completion` and `npm run test:task-completion:postgres` for the task contracts
and disposable database invariants. The latter uses a preinstalled PostgreSQL 18 image with
`--pull=never`; `TASK_TEST_POSTGRES_IMAGE` can select another installed supported image.
Affected Chromium phases are `task-completion` and `notification-integrity` through `QA_PHASE`
and `npm run qa:chromium-1248`. The runner retains its exact Chromium revision 1248 requirement.

See [audit](FIRST_PRINCIPLES_AUDIT_V341.md), [plan](FIRST_PRINCIPLES_PLAN_V341.md)
and [verification](V341_VERIFICATION.md). Publication and production deployment require a separate task.
