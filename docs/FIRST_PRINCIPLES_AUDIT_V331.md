# First-principles application audit — v3.31

## Baseline and method

Opening branch `main`, HEAD `798bd42253819499b74aa6a9d5a05e0f042f5db1`, version `3.30.0`.
Tracked worktree and index were clean. Ten historical/R1 Revenue candidates are excluded and
fingerprinted privately. There are 119 historical SQL files, logical migration head 114.

The audit asks whether a user can identify the record, understand authoritative facts, act with
permission, recover from failure, and return to the same context. It reviews code and prior plans,
then tests concrete findings. It is not a claim of exhaustive security certification or Production
inspection. Private evidence belongs under ignored `work/first-principles/`.

## Confirmed findings

| ID | Priority | Evidence at opening | Consequence | Treatment |
|---|---|---|---|---|
| R01 | High | `api-client.ts` returns status 0 on transport loss; deletion, Lead, activation, commercial and commission clients test only `< 500` | An ambiguous accepted write may lose its original retry identity | Shared failure classification; preserve exact request; synchronous duplicate-submit protection |
| R02 | High | Lead/commercial/activation catches include `onSaved` or follow-up reads | A refresh error may be described as an uncertain write after acceptance | Separate write outcome from refresh outcome; terminal accepted state; refresh-only recovery |
| R03 | Medium | RecordDeleteAction displays conflict but offers another deletion using the stale snapshot | Repeated conflicts; unclear next step | Explicit reload/review, fresh canonical snapshot, separate confirmation; no automatic overwrite |
| R04 | Medium | DataTable stores Organization/Contact filters in local state; usePagedResource serializes only basic query fields | Reload/Back loses advanced scope; copied URLs cannot reproduce the visible list | One URL/query owner for supported filters; preserve unrelated query keys |
| R05 | Medium | usePagedResource accepts late reads without an explicit post-await cancellation check; list error leaves rows visible under changed scope | Old results can appear to answer the new query | Scope-bound response visibility, cancellation check, required list-envelope validation |
| R06 | Medium | DataTable uses the same no-record message for empty and filtered results; restoring defaults leaves advanced filters active | Misleading emptiness and incomplete reset | Distinct filtered no-match guidance; full applied reset; saved-view scope stays explicit |
| R07 | Medium | SearchableSelect intercepts Home/End from its editable search input | Keyboard users cannot move the caret normally | Preserve input editing keys; retain Arrow selection and Escape focus restoration |
| R08 | Medium | EnrollmentRelation does not provide pending state and keeps old suggestions on failed search | Stale options appear current; empty/loading/error are unclear | Pending and failure presentation; clear stale options; retain selected identity |
| R09 | Medium | ActionDisclosure only closes on button activation; no focus-leaving close | Link-based menus can remain open after keyboard traversal | Close on link activation/focus exit; preserve native disclosure and modal focus |
| R11 | Medium | Browser keyboard test found Contact saved-view action hidden by legacy mobile `.quick-summary > button` rules | Mobile users cannot reach view management/default reset | Compact three-column metrics with reachable 40px view action; scoped semantic CSS |
| R10 | Medium | `workspace-redesign.test.mjs` absent from both regular test lists | A locally tested workspace regression can escape CI | Include current workspace and new reliability contracts in both entry points |

## Architecture and business review

| Area | Assessment and boundary |
|---|---|
| Navigation and workspaces | Query-aware Student/Family identity and six Account sections are implemented. Composition preserves canonical Enrollment/Application/Support owners. No second lifecycle is needed. |
| Management | PERIOD comparisons and SNAPSHOT facts have separate contracts; currencies and restricted/unavailable/zero remain distinct. Existing focused regressions are retained. |
| Permissions and deletion | Deletion route requires existing capability, trusted mutation and AAL2; canonical RPC handles revisions and receipts. Forty-four cleanup kinds exist. Financial history needs domain reversal/cancellation, not universal destructive deletion. Client recovery is the confirmed gap. |
| Identity and privacy | Student updates begin with authorized snapshots; Household membership is not guardian authority. Existing safe translation/enum/missing-value helpers remain appropriate. No new sensitive fields should be collected for this work. |
| Query ownership | Server filtering and pagination remain authoritative. URL state should describe supported query parameters, never filter an incomplete client page. Saved-view v1 does not store advanced scope; do not silently claim otherwise. |
| UI/UX | Recent workspace composition should be preserved. Highest value now is predictable recovery, visible loading and no-match states, and keyboard correctness across shared consumers. |
| Maintainability | Several large compressed TSX files mix fetching, forms and layout. Extracting every domain now would increase regression scope. A shared mutation outcome helper is justified by five real consumers; broader decomposition requires a separate bounded migration. |
| Verification | Static source assertions alone cannot prove request-key retention or keyboard behavior. Add real component browser failure injection and behavioral helper tests. Browser fixtures do not prove RLS. |

## Integrated feature recommendations

This release implements safe recovery actions (reload/review and refresh-only retry), durable advanced
directory links, clearer filtered-empty states and explicit relation-search loading. These enhance
existing workflows without new data models or permissions.

The following are conditional roadmap inputs, not approved implementation items: Student-scoped
Contract/Payment composition needs a canonical relationship and permission contract; Revenue needs
approved contract-specific policy and actual transaction evidence; configurable automatic reminders
need owner, deduplication and escalation rules; bulk destructive actions need a per-resource preview,
partial-failure and recovery design. None can be safely inferred from a UI request. Existing task,
notification and financial owners should be reused if those prerequisites are approved.

Previous v3.26–3.30 plans are checked against current consumers and targeted regression coverage.
Their historical completion reports remain historical. This audit records new reproducible gaps
without claiming those earlier browser fixtures proved all network-failure paths.
