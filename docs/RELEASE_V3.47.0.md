# v3.47.0 — Privacy review and calendar collaboration

Privacy request creation and review now share atomic command receipts with explicit retry identity,
revision-aware review, minimized responses and complete filtered pagination. Reviews show the
original request, related contact and proposed corrections. Accepted execution remains distinct
from queued/completed work, and refresh failures never prompt duplicate submission.

The dual-month calendar can display completed appointments for one week, one month, three months,
six months or one year. The filter uses completion time and retains historical rows. A paginated,
read-only history list includes appointments outside the current two-month view.

Appointments can reference an active internal member. Existing reminders and in-app notifications
provide invitations and changes without a new service. Recipients have read-only calendar access.
Organization, external contact, internal member and incoming invitations have distinct colors and
text labels. Notification links open the relevant calendar month and day.

Forward migrations 142 and 143 are required; existing receipt/recovery protocols remain in use.
No V1/V2 deployment control code or production infrastructure changes are included.

See [audit](FIRST_PRINCIPLES_AUDIT_V347.md), [plan](FIRST_PRINCIPLES_PLAN_V347.md) and
[verification](V347_VERIFICATION.md). Production operations require a separate authorized release.
