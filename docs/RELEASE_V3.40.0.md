# Release v3.40.0

Date: 2026-10-23.

## Data quality governance

The quality workspace opens with actionable OPEN/ASSIGNED findings. Retained resolved/dismissed
history is explicitly selectable and read-only. Shareable status, severity and assignment filters
apply before pagination; changing a view, returning through browser history and closing the final
row keep the actual request and visible page consistent. Task findings link to their source task.
Rows show status, observation time and retained resolution notes. Empty trends have their own
explanation, and rule administration is collapsed initially to keep triage prominent.

Forward migration 137 adds finding/rule revisions and atomic request receipts. Commands recheck
current authorization, reject stale observations and return the original accepted result on exact
replay. Source verification remains required for resolution. Scan/configuration/assignment/resolution
share a workspace transaction lock; receipt failure rolls the change back. Legacy staff command
entrypoints and direct UPDATE grants are revoked.

Apply migration 137 before running this application version. Cached clients without revision and
request identity must reload. Existing migration files and business source records are unchanged.

Reads are cancelled or invalidated when their context changes. Lost responses retain the original
request for explicit retry and lock conflicting edits. An accepted operation followed by a failed
refresh offers display-only recovery. Optional trend/configuration failure leaves the main queue
available with a clear warning. Mobile success notifications allow interaction with pagination.

## Dependencies and housekeeping

All three manifests/lockfiles receive the current stable dependency refresh. Node is aligned on
24.22.1 LTS and npm on 12.2.1 across application, worker, planning reference, CI and Docker.
Prisma RC and Node Current releases are excluded. Chromium stays on revision 1248; Playwright Core
1.64.1 declares that exact revision. BuildKit/frontend pins and host provisioning guidance are also
updated; host packages and existing infrastructure are not upgraded by this local release.

Project cleanup follows verification and preserves data volumes, reports, screenshots, backups and
the active local runtime. See the measured outcome in [verification](V340_VERIFICATION.md).

See [audit](FIRST_PRINCIPLES_AUDIT_V340.md), [completed plan](FIRST_PRINCIPLES_PLAN_V340.md),
[dependency refresh](DEPENDENCY_REFRESH_V340.md) and [verification](V340_VERIFICATION.md).
This release is committed locally; production deployment is outside this task.
