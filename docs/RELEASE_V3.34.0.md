# v3.34.0 — Workspace Density, Workflow Builder & Contact Access

Organization activity, Leads, Contact operations and Student Outcomes now use compact layouts
with clearer actions and neutral surfaces. Channel Agreements open with a summary and separate
rules, documents, settlement and version history. Revenue configuration and empty states explain
prerequisites without a large empty workspace or an unauthorized initialization action.

Admissions templates support an ordered step navigator, a single selected editor, keyboard
reordering and advanced task-title overrides. The two editable presets and blank drafts remain
available; existing active/used template immutability is preserved.

Contact access is separate from communication consent. Owners and explicitly shared users can
access records; managers can read through the actual reporting chain within one active department.
Titles alone grant no access. Administrators can read employee-owned Contacts; Super Admins have
full Contact access within their workspace. Management read access does not independently grant
edit permission. Communication grants and withdrawals retain decision history, and queued outbound
communication requires both Contact access and appropriate consent.

Family creation can atomically add multiple independent parents or guardians. Occupation, employer
and title belong to each person. Household membership remains separate from guardian authorization.
Legacy household occupation values are preserved for review rather than assigned to guessed people.

Administrators can change ordinary employee roles. Only Super Admins can grant administrator roles
or change administrator accounts. Role changes require elevated authentication, current authority,
audit and request receipts; existing sessions are revoked. The last active Super Admin is protected.
Role changes do not appoint managers or Revenue business authorities.

Accepted writes followed by failed refreshes recover through reads only. Uncertain requests keep
their original payload and identity while the editor remains open.

## Upgrade and boundaries

Apply migration **124** with this application version through the normal deployment process.
The final inventory is **129 SQL files**; prior migrations are unchanged. Existing manager links and
active canonical team memberships are required for hierarchy access. Missing links fail closed;
there is no title-based or guessed hierarchy backfill. Initial Revenue provisioning stays controlled.

No Revenue or Commission accounting semantics change. This release does not add a General Ledger,
provider AP, accounting FX, automatic posting or a new financial owner. Communication preference
history is not legal certification. Verification used fictional disposable data and local browser fixtures.
No Production access, deployment, push or commit was performed for this task.

See [verification](V334_VERIFICATION.md) for test boundaries and operational limitations.

## Build cache retention supplement

The user additionally requested 24-hour automated build-cache retention. The environment example,
post-deployment cleanup fallback, storage-maintenance fallback and checked-in BuildKit GC policy
now agree on `LUMINA_BUILDKIT_CACHE_RETENTION_HOURS=24` and
`LUMINA_BUILDKIT_CACHE_MAX_AGE=24h`. Existing scoped automatic cleanup remains enabled;
no actual Docker cleanup, deployment or remote environment change is performed by this task.
