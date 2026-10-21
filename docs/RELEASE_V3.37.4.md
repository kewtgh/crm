# v3.37.4 — Legacy identity history and staff removal

## Defect and scope

The previous release covered reporting-qualification history but not historical
identity synchronization. A fictional never-signed-in administrator changed to
Sales Director through the previous protocol remained blocked with
`BUSINESS_REFERENCES_EXIST`: its completed synchronization row and
`IDENTITY_CHANGE_PREPARED`/`IDENTITY_CHANGE_SYNCED` audit events were treated as
business dependencies. This was reproduced against migration 132 before the fix.
Fresh accounts changed only through the current direct role RPC did not exercise
that path. This reproduction does not establish any production account's cause.

## Change

Forward migration `202610210133_staff_legacy_identity_removal.sql` treats completed
or rolled-back identity changes, and failed changes with completed repairs, as
administrative history. Removal retains their account UUID in a disabled,
de-identified identity, clears personal snapshot fields, and preserves role/status
history. Existing reporting-history retention also remains supported.

Pending changes and pending, processing, failed or exhausted repairs return
`IDENTITY_REPAIR_REQUIRED`. Completed retained operations cannot be requeued or
updated after removal. The eligibility and removal transaction locks history rows
and rechecks all dependencies. MFA, suspension, workspace boundaries, administrator
protection, exact receipt replay and transaction rollback remain enforced.

Actual customer ownership, team responsibilities, financial contributions,
approved reporting scopes and unknown references still block deletion. Never
signing in does not bypass those checks. The dialog now identifies the blocking
category, without exposing record contents or internal database names.

## Verification and deployment

Targeted disposable-PostgreSQL regression covers legacy synced and rolled-back
changes, completed repair of a failed change, all unresolved repair states,
anonymous retention, replay rejection, reporting history, actual ownership,
financial dependencies, transaction rollback and concurrency.

Node.js 24.22.0 verification passed: the bounded lifecycle PostgreSQL scenario,
29 targeted unit tests, typecheck, zero-warning changed-file lint, one production
build and 14 public repository privacy/artifact checks. Chromium revision 1248
passed 13 staff-management page/viewport checks with browser 156.0.8078.4.
The local QA server was stopped and the disposable containers were removed.

Apply migration 133 and deploy the application together. Updating only the web
image does not change the database eligibility function. Check the production
migration ledger for both migrations 132 and 133 when investigating a deployment
that still returns the generic older blocker. Private verification evidence stays
under ignored `work/`; no production account was deleted during local tests.
