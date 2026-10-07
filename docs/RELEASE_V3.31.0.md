# v3.31.0 — Reliable operation recovery and directory context

## Reliable operations

Lead, channel, commercial, commission and recoverable-deletion clients retain the original
request when a response is lost. Explicit retry reuses its payload and receipt identity.
Synchronous guards prevent duplicate submission before a pending render. An accepted mutation
followed by a failed refresh is presented as saved; recovery refreshes the display rather than
repeating the write.

Deletion conflicts offer reload and review before another confirmation. Initial snapshot failures
have a retry path. Existing authorization, AAL2, revisions, retention and server receipts are retained.

## Directory and shared interaction improvements

Organization and Contact directory URLs preserve supported advanced filters alongside search,
status, sorting and pagination. Browser history restores this scope; unrelated context parameters
remain intact. Restoring the default view clears advanced filters. Saved-view version 1 continues
to describe only its supported fields.

Previous-scope rows are not shown as current results during a new query or a failed load. Invalid
required collection/metric data produces an unavailable state. Filtered no-match guidance differs
from an empty directory.

Relation lookups expose loading and failures, discard stale suggestions and preserve the selected
record label. Editable search fields retain native Home/End behavior and IME Enter does not submit
prematurely. More menus close on link activation and keyboard focus exit.

## Verification and boundaries

Regular CI contract lists now include the v3.30 workspace and new reliability tests. Synthetic
Chromium failure injection verifies request identity, conflict recovery, refresh-only actions,
directory history and keyboard behavior. This is not database/RLS or Production evidence.

No API, repository, RPC, permission, schema or migration change is introduced. Migration head stays
114. Revenue analysis and implementation remain outside this release. See the
[audit](FIRST_PRINCIPLES_AUDIT_V331.md), [plan](FIRST_PRINCIPLES_PLAN_V331.md) and
[verification](V331_VERIFICATION.md) for scope, results and policy-dependent roadmap prerequisites.
