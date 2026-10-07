# v3.28 Phase 4 — Lead Work Queue & Dashboard Refinement

Verdict: **V328_PHASE4_FRONTLINE_EXPERIENCE_COMPLETE**. Formal version remains **3.27.0**; all work is an uncommitted candidate.

## Baseline and preservation

| Item | Opening / final boundary |
|---|---|
| Branch | `main` |
| HEAD | `b74984e764214caf0383c2e7ca3425d0da536280`, unchanged |
| Formal version | `3.27.0`; package, lock and APP_VERSION unchanged |
| Latest migration | `202610070113_student_family_experience.sql`; no 114 |
| Migration 113 SHA256 | `d507d8b3d7f4ce6c03e93c267f2cdc78559e55de1ff12aa43f2b112414d5d131` |
| Opening worktree | 79 unstaged/untracked candidate files, including Phase 0–3 and six Revenue specifications |
| Candidate preservation | All 79 retained; 72 byte-identical; seven shared files intentionally evolved |
| Migration preservation | All 118 opening SQL files byte-identical |
| Verification runtime | Node `26.10.0`, npm `12.2.0`, through the existing local runtime bootstrap |
| Opening PATH runtime | Node `24.21.0`, npm `12.0.2`; not used for verification |
| Staging | EMPTY |
| Commit / push / deploy / Production | NOT RUN / NOT RUN / NOT RUN / NONE |

The actual working tree, rather than HEAD alone, is the baseline. Opening status, candidate and migration fingerprints, final boundary evidence and raw QA remain ignored under `work/v328-phase4/` and the existing browser evidence directory. No reset, restore, clean, history rewrite, old-patch reapplication or staging operation occurred.

The seven evolved opening candidates are the shared UI stylesheet, FilterBar, both locale dictionaries, test-script registration and the two Chromium phase runners. Phase 0 documents, Phase 1 navigation, Phase 2 management consumers and Phase 3 record workspaces remain byte-identical. No API, repository, RPC, permission, RLS, worker or database behavior changed.

## Lead Work Queue

`/leads` uses the Queue archetype. Search, queue scope (Pool / Mine / All) and Lead status are primary. City, school type, commercial tier, explicit key-contact condition, minimum partnership potential, minimum age and sort are advanced. These are existing server-supported conditions. Owner/source filtering and saved-view persistence are deferred because there is no corresponding current Lead query/storage contract.

The initial scope remains All, matching the existing route loader. Scope changes reuse the existing query and authorization. Search has explicit submission; status/scope changes issue one owning query. Report drill filters and Organization context remain attached. Paging, page size and deterministic server sorting are preserved.

FilterBar reuses SearchFilterBar and AccessibleDrawer; it does not query data itself:

- Open copies applied values to a draft; draft edits issue no request.
- Apply commits once; Cancel/Escape discard and restore trigger focus.
- Reset draft changes only the seven advanced conditions, preserving search and status.
- Clear applied filters clears search/status/advanced conditions, preserving the selected queue scope.
- `Filters · N` counts only applied advanced conditions, including a non-default sort; search, scope and status are excluded.

QueueItem displays current-locale identity, lower-priority alternate identity, status, owner, elapsed age/creation date, latest recorded activity and recorded next action. Missing next action is **未记录 / Not recorded**, without generated advice. Qualification details use a native disclosure. Potential remains a signal and never changes sorting unless the existing sort is explicitly selected.

Known source codes use existing labels; freeform source text is retained without fuzzy inference. Unknown status is neutral and human-readable. No additional Lead status or assignment model was introduced.

### Action contract

| State / context | Primary action | Secondary | More | Permission source |
|---|---|---|---|---|
| Eligible unowned public SCHOOL in Pool | Claim | Existing account link | Existing permitted edit, assignment/visibility, history | `leads.manage` + `availablePoolLead`; manager and supplied `can_assign` for governance |
| Editable NEW / QUALIFYING Lead | Qualify / follow up | Existing account/Household link | Release where allowed, assignment/visibility, history | `leads.manage` + supplied `can_edit`; existing ownership/visibility conditions |
| Editable QUALIFIED Lead | Create opportunity | Existing account/Household link | Qualify/edit plus permitted governance/history | Existing `leads.manage` + `can_edit`; same canonical conversion API |
| DISQUALIFIED Lead | No dominant follow-up mutation | Existing context link | Edit if originally permitted; permitted assignment/visibility/history | Existing edit and manager gates; correction is retained without presenting an active queue task |
| CONVERTED Lead | Open existing account/Household when linked | No duplicate primary link | Existing permitted governance/history | Existing readable context; no invented Opportunity ID |
| Read-only or no allowed next action | Human-readable no-action context | Existing readable account/Household link | History; any governance requires its original gates | Capability and supplied record authority; no disabled mutation button |

The pool action is explicitly restricted to available public SCHOOL records, null owner and an active Lead status. All existing permitted edits remain reachable, including when Claim takes visual priority. No ownership, qualification or conversion is implied by selecting an action.

MoreActions uses the existing ActionDisclosure engine with native disclosure, menu items, arrow/Home/End navigation, Escape and focus restoration. Release/reassign/visibility/history leave the primary surface. QueueItem and MoreActions never fetch, authorize or mutate records themselves.

**LeadEditor remains text-identical to HEAD after newline normalization.** Request keys, expected revisions, payload-bound uncertain retries, ALREADY_CLAIMED, VERSION_CONFLICT, 403, current owner checks, Product/Cohort/Owner and exact amount/currency inputs are unchanged. Conversion opens the existing editor. The current PoolLead response supplies no linked Opportunity ID, so a converted Lead opens its existing account/Household rather than guessing a destination.

## Dashboard

Daily order: **My Today → operational Attention → Business Snapshot → Quick Navigation → Operations/additional context**. At desktop My Today and Attention share a row. Mobile preserves this order. WorkflowLaunchpad remains a secondary quick launch, with its Daily audience supplied by Dashboard so another Daily/Management switch does not compete with the page mode.

Management mode is a compact supplied snapshot and Executive link. It does not request Management Overview, reconstruct attention/trends or copy the six-domain Executive report. One mode is visible at a time; a pressed-state group exposes the selection.

Explicit preference is best-effort browser storage keyed by the account ID. Invalid or unavailable storage falls back safely. The default is Management for the existing management-oriented roles only when `education.view`, the real Executive visibility authority, is permitted; frontline roles default to Daily. Stored Management never grants access. User changes use their own preference key and cannot inherit another account's selection.

All six current canonical staff roles possess `education.view`; no fictitious management-denied staff role or new permission was introduced. The deny-capability branch is tested directly against the preference contract. Restricted-role navigation remains covered by the Phase 1 regression; read-only Lead uses the real SALES_SUPPORT role and supplied record gates.

### Dashboard fact contract

| Supplied field | Presentation | Boundary |
|---|---|---|
| `todayTasks`, `overdueTasks`, `focusTasks` | My Today counts and existing Task rows | Canonical Task facts; no operational signals converted into Tasks |
| `riskContracts` | One separately labeled operational signal | Not unique tasks or a combined outstanding-work total |
| `pendingAdmissions` | One separately labeled signal when growth is available and visible | Existing admissions/growth snapshot; not Enrollment or inferred Tasks |
| `unreadNotifications` | One separately labeled signal | Notification count; not a task count |
| `pendingApprovals` | Existing approval snapshot where the original admin destination is visible | Existing source/gate; not mixed into Task totals |
| `renewalsDue` | Existing Contract snapshot | Not management interpretation or Revenue |
| `monthRevenueByCurrency` / `monthConfirmed` | Existing confirmed-payment snapshot, explicit currency codes, separately formatted currencies | Historical internal field name retained; no Revenue label, refund reinterpretation, FX or mixed-currency total |
| `activeStudents` | Existing Student snapshot | Not Enrollment status, completion or inferred lifecycle |
| `activeProducts`, `newLeads`, `pendingProgression`, `attributedLeads` | Secondary Operations context under existing capabilities | Existing facts; attribution here retains the existing Lead attribution meaning, not Revenue attribution |

Attention is bounded to three existing, separately named signals. It has an Action Center link and does not fetch the entire queue, sum overlapping counts or claim universal business health when empty. Action Center remains the operational execution queue; Executive remains management interpretation; Dashboard remains personal context and a snapshot.

The Task completion function remains text-identical to HEAD: pending-ID duplicate protection, the existing PATCH, local count correction, removal of completed focus rows and error handling are preserved. No-focus text refers only to Tasks. Optional growth failure leaves Today, attention sources and business snapshots usable; unavailable growth numbers are omitted with the existing warning.

## Shared components and responsive contract

QueueItem and MoreActions have real Lead consumers. FilterBar adds optional explicit search submission; existing consumers keep their original behavior. RecordIdentity, safe enum/translation presentation, AttentionPanel and SectionHeader are reused. WorkflowLaunchpad adds an optional controlled audience without changing its standalone default behavior.

1920 uses full workspace width and a two-column Lead context layout; 1440 retains the same hierarchy. Below 1024 Lead items collapse to a single column. At 375 search and two primary selectors precede the advanced trigger, with the first normal Lead starting in the initial viewport. Long bilingual identities wrap, preserve the permitted action and do not create document overflow. Dashboard's two-column task/attention area becomes ordered single-column content; snapshot cards become compact two-column items.

Original brand, sidebar, Lucide, buttons, statuses and CSS loading order remain. Functional queue controls and task titles use 13–14px; metadata can remain 12px. No global reskin, alternative overlay engine or full CSS rewrite was introduced.

## Verification

Browser evidence uses the repository pinned `ms-playwright/chromium-1243`, browser **153.0.8010.12**, Playwright **1.63.0**, actual React components/AppShell, production CSS and independently fictional mocked APIs. It proves presentation/interactions, not authenticated browser-to-DB, RLS or real mutation integration. Raw screenshots and exact executable evidence remain private/Git ignored; no public artifact upload occurs.

| Gate | Result / evidence |
|---|---|
| Phase 1 regression | PASS — navigation/capability/filter/fallback contracts and 23 UX foundation browser checks |
| Phase 2 regression | PASS — management/trend/attention/Student Support contracts; unchanged management consumers |
| Phase 3 regression | PASS — record workspace, minimum create, preservation, customer/education contracts; unchanged record consumers |
| Lead queue hierarchy | PASS — context and next action before qualification detail |
| Lead primary action mapping | PASS — state/ownership/capability contracts; Pool/Mine/Qualified/Converted browser states |
| Governance actions in More | PASS — original gates; keyboard/menu/focus checks |
| Read-only Lead UX | PASS — SALES_SUPPORT and supplied read-only record flags; no fake mutation primary |
| Lead permissions | PASS — six canonical roles and record flags; server authority unchanged |
| Lead filter semantics | PASS — draft/apply/cancel/reset, one advanced apply query, applied badge count |
| 375 first Lead | PASS — actual first-item bounding box starts within 812px |
| Lead uncertain retry | PASS — injected 503 followed by identical payload/requestKey; existing editor retained |
| Conflict / already claimed / forbidden | PASS — safe 409/403 states; editor does not overwrite |
| Conversion currency | PASS — original editor, visible decimal field and separate USD currency payload field |
| Dashboard Daily hierarchy | PASS — Today/Attention/Snapshot before Quick Navigation |
| Dashboard Management hierarchy | PASS — compact snapshot plus Executive link; no Executive request |
| Dashboard mode preference | PASS — account isolation, remembered Daily/Management, audience default, denied-capability contract and browser storage failure |
| Action Center separation | PASS — at most three named supplied signals; no combined task/signal total |
| Executive separation | PASS — link and snapshot only; no copied read model |
| Task mutation unchanged | PASS — exact function comparison and browser PATCH/completed-row removal |
| Partial failure | PASS — optional growth warning leaves core content usable |
| 1920 | PASS — Today/Attention/Snapshot begin in initial viewport; wide queue |
| 1440 | PASS — Lead and both Dashboard modes retain hierarchy without overflow |
| 375 | PASS — first Lead, early Today/Attention, drawer, long identity and modes |
| Accessibility | PASS — labeled controls, pressed-state mode, drawer focus/Escape, More arrows/Home/End/restoration, existing reduced motion retained |
| Translation / fallback | PASS — zh-CN/en, human-safe missing next action, known source labels, Phase 1 unknown/fallback probes |
| Privacy | PASS — 13 public privacy/artifact tests; synthetic fixtures and ignored raw evidence |
| Migration | PASS — manifest verify, latest 113; all 118 opening SQL files unchanged |
| Typecheck | PASS — `npm run typecheck` |
| Lint | PASS — `npm run lint`, followed by scoped lint for final helper/test/QA edits |
| Build | PASS — `npm run build`, final version 3.27.0 |
| Whitespace / staging | PASS — clean diff check; staging empty |
| QA service | PASS — STOPPED, status running=false |
| Revenue boundary | PASS — all six byte-identical, untracked and unstaged |

**135 targeted contracts passed**. Final Chromium checks: Lead **18**, Dashboard **13**, UX foundation **23**; **54 page/state/viewport checks**. Expected injected HTTP failures are identified by exact synthetic URL and status; unexpected errors remain failures. The new required checks cover status/action/permissions, More, filters, long names, absent next action, conversion currency, retry/errors, mode isolation/storage/defaults, empty Tasks, growth failure and both languages.

Measured synthetic Daily Dashboard at 1920: My Today and Attention begin at **329.47px**, Business Snapshot at **621.86px**, all inside 1080px. At 375: My Today begins at **293.31px**, Attention at **527.75px**. These are actual region bounding boxes, not page-height proxies. Lead's normal mobile first item begins at **464.58px**, within 812px. Measurements describe this synthetic state, not a universal page-height promise.

Phase 2/3 browser campaigns were not repeated because their consumers and behavior are unchanged; their relevant contract regressions were rerun. The required shared FilterBar/navigation regression was rerun in pinned Chromium. Full PostgreSQL/release/ten-phase Chromium campaigns and authenticated real-DB E2E were **NOT REQUIRED / NOT RUN**: APIs, repositories, mutations, permissions and RLS are unchanged. No Production service was accessed.

## Deferred and Git boundary

Revenue: **DEFERRED / UNTOUCHED — V326_REVENUE_POLICY_INPUT_REQUIRED**. All six candidates retain opening SHA256, remain untracked/uncommitted/unstaged and have no policy approval. Fingerprints are retained only in ignored evidence.

No migration 114, schema change, new business field, new Lead/task/attention/aggregation engine, Revenue/ROI/profit/P&L/forecast, backend duplication, Activity bilingual relaxation or version promotion. Student/Household/Account/Executive/Support Analytics/Contract/Product/Operations redesigns are outside this phase.

Staging **EMPTY**. Commit **NOT RUN**. Push **NOT RUN**. Deploy **NOT RUN**. Production **NONE**. Formal version **3.27.0**. All Phase 0–4 implementation work remains a candidate for review.
