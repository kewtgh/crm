# v3.31.0 — Audit implementation verification

## Baseline and delivered scope

Branch `main`; opening HEAD `798bd42253819499b74aa6a9d5a05e0f042f5db1`.
Version `3.30.0` becomes `3.31.0` under explicit user authorization. The opening tracked worktree
and index were clean. Ten untracked Revenue historical/R1 candidates remain separately protected.
Migration count/head: 119 SQL / 114. Runtime: Node 26.10.0, npm 12.2.0.

The [audit](FIRST_PRINCIPLES_AUDIT_V331.md) and [plan](FIRST_PRINCIPLES_PLAN_V331.md) were saved
before implementation. R01–R10 were identified through code/contract review; R11 was reproduced
by mobile browser QA. All eleven concrete implementation findings are closed.

| Finding | Implemented result | Evidence |
|---|---|---|
| R01 | Five mutation consumers distinguish transport ambiguity from confirmed rejection; synchronous submit guards | Classification tests and exact browser request-body comparison for deletion, Lead, commission, activation and commercial |
| R02 | Separate accepted write from failed refresh; accepted editors never offer another save | Outcome tests, deletion refresh-only browser recovery, commission and activation failure injection |
| R03 | Failed deletion snapshot and conflict offer reload/review; next deletion requires confirmation | Browser proves reload is read-only, refreshed revision and new request key after conflict |
| R04 | Supported Organization/Contact filters live with paging in the existing URL owner | Apply/Cancel/Back, URL hydration, resource-switch and default-view browser tests |
| R05 | Canceled responses cannot overwrite current query; old-scope rows hidden; required list/metrics validated | Malformed required-data test, slow/fast search race and same-query route-switch browser tests |
| R06 | Distinct no-match guidance; complete default reset; saved-view v1 scope disclosed | Mobile no-match, invalid-response and saved-view reset checks |
| R07 | Home/End edits the search input; IME Enter is not a premature search/selection | Browser caret assertions, shared keyboard regression |
| R08 | Relation search shows pending/error, removes stale options and retains selected label | Real EnrollmentRelation failure and keyboard fixture |
| R09 | More closes after link activation and keyboard focus exit | Real menu, Escape and focus assertions |
| R10 | Current workspace and reliability tests included in both regular test entrypoints | Script contract and successful standard contract runner |
| R11 | Mobile directory view management remains reachable | Contact saved-view test at 375 and reviewed screenshots |

## Architecture and ownership

`mutation-outcome.ts` classifies client outcomes and separates write/read phases; it is not a new
mutation engine or server receipt store. Existing endpoints, payload schemas, capability/AAL2,
optimistic revisions and domain mutations are unchanged. Financial history is still governed by
its formal cancellation/reversal rules rather than universal deletion.

`usePagedResource` remains the single directory query owner. URL filters are limited to explicit
resource keys; unrelated context keys are retained. Server filtering/paging still decides records.
Saved-view v1 is not extended to falsely imply persistent advanced-filter support. Path changes
schedule a replacement read even if normalized parameters remain identical.

Student, Household, Organization, Enrollment, Application and Support ownership remain separate.
No management calculation, Revenue policy, cross-currency aggregation or inferred guardian authority
is introduced. UI visibility does not replace server authorization.

Only the mobile directory-summary rules are added to `ui-system.css`; stylesheet order, shared
palette and existing workspaces remain intact. The saved-view action has a 40px minimum height
and stays beside a compact three-column metric summary. No full CSS rewrite is claimed.

## Verification

| Gate | Result |
|---|---|
| Focused mutation/filter/UI/domain/permission/management contracts | PASS — 91 tests |
| Standard CI contract entrypoint `test:contracts` | PASS — 295 contracts plus 8 captcha tests |
| Typecheck | PASS |
| Lint | PASS |
| Production build | PASS — final v3.31.0 runtime source |
| Chromium mutation phase | PASS — 10 states |
| Chromium directory/keyboard phase | PASS — 10 states |
| Unexpected browser errors | NONE |
| Public privacy | PASS |
| Migration manifest | PASS |
| Historical raw SQL bytes | PASS — all 119 unchanged, head 114, no 115 |
| Revenue candidates | PASS — all 10 opening hashes unchanged, untracked and excluded |
| Release metadata | PASS |
| Local QA server | STOPPED |

Pinned `ms-playwright/chromium-1243`, browser `153.0.8010.12`. Screenshots and request/error evidence
remain Git-ignored under `work/browser-qa-chromium-1243/v331/`; opening manifests and command logs
remain under ignored `work/first-principles/`. The fixtures use actual React components, production
CSS and independently fictional APIs. Browser mocks do not prove RLS, database transactions or
Production behavior. No full PostgreSQL campaign, full browser release campaign, dependency update
or deployment gate was necessary for this client-only change.

1920/1440/375 directory and deletion-recovery captures pass page-overflow assertions. Visual review
checks readable recovery actions, compact filter alignment and reachable mobile controls. Existing
modal traps and uncertain-result Escape locks remain in force. Intentional network/409/503 failures
are classified by their exact injected scenario, URL and response/failure type; unrelated errors fail.

Browser testing caught and corrected the hidden mobile saved-view action and the missed replacement
read when a reused directory changes path with identical query parameters. Builds were repeated
only after source-affecting corrections. The legacy Lead assertion was updated to verify the retained
request reference rather than require a particular local variable expression.

## Follow-up and Git boundary

Conditional roadmap prerequisites remain documented in the audit: Student-scoped financial linkage,
approved Revenue policy, reminder escalation rules and per-resource bulk-deletion recovery design.
They are not presented as completed features. Broader TSX decomposition is maintenance follow-up,
not an unverified rewrite in this release.

The user authorizes one local commit of the reviewed implementation, tests and release documents.
All Revenue candidates, local configuration, raw screenshots and private evidence are excluded.
Push: NOT RUN. Deploy: NOT RUN. Production: NONE. This task adds no shutdown action or automation.

`V331_AUDIT_REPAIR_COMPLETE`
