# Release v3.39.0

Date: 2026-10-23.

## Appointment integrity and recovery

Appointment completion, cancellation and rescheduling now require the current event version and an
exact-request receipt. Forward migration 136 locks the appointment, rechecks current ownership/access,
preserves terminal states and commits the mutation, action audit, receipt and invitation delivery queue
atomically. Replaying an accepted request returns its original result without repeating invitations.
The old staff mutation functions and direct appointment UPDATE grants are no longer available.

Apply the migration before running this version. Cached older clients without event versions/request
identities must reload before changing appointments. Creation keeps its existing fingerprint contract.
No historical migration is rewritten, no appointment is backfilled, and no historical event is changed.

Creation and action dialogs preserve uncertain requests for explicit retry. Editing or dismissing an
uncertain creation request is blocked; changing UI language does not change its payload. Stable reminder
values and organization/contact-only relation choices match the server contract. Accepted writes
invalidate earlier reads and update the shared event set, including completed events on the month grid.

## Calendar and export experience

Selecting a date opens its complete, paginated agenda. Creation remains a separate explicit action.
The two-month/500-record scope, selected-day/upcoming views, visible read errors and refresh controls
make the displayed workload clear. Mobile legends wrap and action buttons have their own row.

Export lists offer refresh and loading/error recovery, reload the correct page when totals shrink,
and prevent stale downloads while filters change or refresh fails. Available/expired queries use the
same deadline distinction as download eligibility. The server download endpoint continues to enforce
authorization and expiry. Invalid pagination/status parameters produce validation errors rather than
a generic server failure. No automatic export approval or new storage access is introduced.

## Verification

Node remains pinned to 24.22.0 LTS and Chromium to revision 1248. Targeted tests are available through
`npm run test:calendar-actions`; disposable database checks use `npm run test:calendar-actions:postgres`.
The database script uses an existing local PostgreSQL 18 image with `--pull=never`; set
`CALENDAR_TEST_POSTGRES_IMAGE` to a locally installed supported image when needed.
The browser phase is `QA_PHASE=calendar-exports npm run qa:chromium-1248` (set using your shell).

See [audit](FIRST_PRINCIPLES_AUDIT_V339.md), [completed plan](FIRST_PRINCIPLES_PLAN_V339.md)
and [verification](V339_VERIFICATION.md). Production deployment is not part of this release task.
