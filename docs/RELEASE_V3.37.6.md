# v3.37.6 — Pending staff and personal governance

## Staff removal and reporting

A fictional never-signed-in Sales Director with a historical member UPDATE audit
and no current business links reproduced `BUSINESS_REFERENCES_EXIST` through
migration 133. Previous fixes enumerated account configuration actions; generic
member audit actions remained outside those lists.

Migration 134 treats past audit events as retention evidence, not live business
ownership. Removal retains a disabled, anonymous account/member reference when
necessary and preserves the original business audit event. Current customer
ownership, team references, approved performance allocations, financial
contributions and unknown live UUID dependencies still prevent deletion.

Reporting now requires a completed first sign-in and initial password setup.
Qualification configuration alone does not activate a pending account. The roster,
current and historical reporting predicates and new performance assignments use
this boundary. Historical financial rows are not deleted or rewritten; unscoped
contributions retain their existing report treatment. Existing genuine business
dependencies must be reassigned or resolved before removal, even without login.

## Personal governance

Non-administrators see only My approvals and My recycle bin within Administration.
Administrator routes retain their existing role checks. The personal recycle route
is outside the administrative route tree. Its database functions filter by current
workspace, personal ownership and current edit permission before ordering/limits.
Restore rechecks the same conditions under a row lock; another user's record or
another workspace's record cannot be restored by supplying its UUID. The existing
super-administrator recycle functions retain their stronger authorization.

Approval access is limited by RLS to the requester's own requests and team-lead
reviews actually assigned to them, or administrator access. The same RLS applies
to lists, searches, counts and summaries. Non-sales roles can read their own
requests without receiving approval decision capabilities. The UI hides approval
actions on a request submitted by the current non-administrator; server-side independent
review and MFA checks remain enforced.

Long English audit notices and approval-level badges now wrap within the
approval workspace instead of extending beyond the viewport.

## Verification

Node 24.22.0 verification passed: the bounded disposable-PostgreSQL lifecycle,
reporting and personal-governance regression; 44 related unit tests; typecheck;
zero-warning changed-file lint; production build; and 14 public privacy/artifact
checks. Chromium revision 1248 (156.0.8078.4) passed 9 personal-governance and 13
staff-management page/viewport checks, including Chinese/English, mobile and
non-administrator self-review restrictions. Browser component fixtures use
fictional API responses; database access boundaries are exercised separately.
The temporary QA server and database containers were cleaned up.

Apply both forward migrations 134 and 135 and deploy the application. No
production identity is inspected or removed by local regression tests.
