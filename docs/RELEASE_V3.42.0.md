# Release v3.42.0

Date: 2026-10-25.

## Complete recovery views

The recycle bin searches all retained records in the actor's authorized scope before stable global
pagination. Exact totals replace the old per-resource 100-record snapshots. Shareable search,
resource-kind, cleanup-state, page and page-size parameters restore through browser history.
Personal scope continues to use existing ownership/manage checks; workspace scope remains restricted
to super administrators with MFA. Initial read failures offer refresh instead of implying an empty bin.

Core-resource cleanup eligibility is displayed consistently in both scopes. Eligibility does not
guarantee a physical deletion time; referenced records may remain retained. A record remains eligible
for restoration while it exists and current authorization permits it. Business resources without an
automatic cleanup date remain explicitly retained. This release changes no purge schedule or worker.

## Exact deletion and outcome recovery

Migration 139 binds restoration to the precise observed archive timestamp and original request key.
An old selection cannot revive a later deletion. Restoration delegates existing domain routines,
and its confirmation audit and receipt commit atomically. An exact accepted replay returns the
original result without restoring again, including after another deletion; current access is checked
before replay. The fingerprint preserves microseconds and is independent of display/session timezone.
Existing domain audit events remain alongside the command confirmation event.

The client locks uncertain confirmations, preserves exact request bytes across language changes and
offers explicit retry. Accepted restoration followed by a failed read offers display-only refresh.
Stale or failed reads cannot enable restoration. Known record-detail routes are linked after success.

Apply migration 139 before this application version. Cached clients must reload; kind/ID-only requests
are rejected. Legacy staff restore entrypoints are revoked. Existing generic edits, task revisions,
student/household status recovery and product lifecycle behavior are preserved.

## Verification entrypoints

Use `npm run test:recycle-recovery` for contracts and personal navigation compatibility, and
`npm run test:recycle-recovery:postgres` for disposable database invariants. The latter uses a
preinstalled PostgreSQL 18 image and `--pull=never`; `RECYCLE_TEST_POSTGRES_IMAGE` selects an installed
supported image. Set `QA_PHASE=recycle-recovery` with your shell and run `npm run qa:chromium-1248`
for the affected component phase. Chromium remains pinned to revision 1248.

See [audit](FIRST_PRINCIPLES_AUDIT_V342.md), [completed plan](FIRST_PRINCIPLES_PLAN_V342.md)
and [verification](V342_VERIFICATION.md). Production deployment is outside this local release task.
