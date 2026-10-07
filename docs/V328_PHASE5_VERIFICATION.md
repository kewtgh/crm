# v3.28 Phase 5 — Cross-product UX Closure

Verdict: **V328_PHASE5_UX_CLOSURE_COMPLETE**. Candidate verification report. Formal version remains **3.27.0**. This document is not release approval.

## Baseline and preservation

| Item | Opening boundary |
|---|---|
| Branch | `main` |
| HEAD | `b74984e764214caf0383c2e7ca3425d0da536280` |
| Formal version | `3.27.0`; package, lock, APP_VERSION and release metadata are not promoted |
| Latest migration | `202610070113_student_family_experience.sql` |
| Migration count | 118 opening SQL files |
| Opening worktree | 92 unstaged/untracked candidates, including Phase 0–4 and six Revenue specifications |
| Opening staging | EMPTY |
| Verification runtime | Node `26.10.0`, npm `12.2.0` |

The working tree is the baseline, including all legitimate prior-phase work. Opening status, diff statistics and SHA256 for every candidate and migration are retained under ignored `work/v328-phase5/`. No reset, restore, clean, history rewrite, old-patch reapplication or staging operation occurred.

All 92 opening candidates are retained: 82 byte-identical and ten intentionally evolved shared files. Those ten are the UI stylesheet, two locale aggregators, test registration, two Chromium dispatchers and four existing component QA helpers. Final worktree: 105 unstaged/untracked candidate files. Existing navigation, management, Student/Household/Account, Lead and Dashboard runtime consumers are byte-identical to the opening state. The QA helpers add opt-in core-only coverage; their existing full affected-phase scenarios remain available.

No API, repository, RPC, mutation, RLS, worker, permission taxonomy, business field or canonical state changed. The import field-label helper changes presentation fallback only, not schema, parsing, validation or import interpretation.

## Contracts selected context

The existing KPI, lifecycle, searchable table, pagination, renewal context and canonical actions remain. Selection has a distinct background and inset marker, a checked radio, and a selected-row link to the related content. Hover or keyboard focus alone does not constitute selection.

The compact selected-context section contains one heading, the existing Contract identifier, locale-aware buyer identity, status, period and value with an explicit currency code. The minimized current Contract list contract does not supply a contract number; the actual identifier is shown without inventing a number or extending the backend. When selection is outside the current result page, the context explicitly says so; absent facts are not reconstructed or presented as current.

Same-record **项目参与记录 / 合同文档** sections use DetailTabs, including arrows, Home/End, roving focus and tab/panel semantics. Selection persists when switching sections. Both canonical children remain mounted and the inactive section is hidden, preserving editor and uncertain-request state. The existing commercial lock also disables section switching while the Enrollment mutation requires it. There is no new Contract workspace backend or lifecycle.

Existing `initialSelectedId` focus input, query, filtering, paging, approval/export/signing gates and AAL2/maker-checker owners remain. ContractEnrollmentSection and ContractDocumentsSection are unchanged: their respective relation/document APIs, expected revisions, receipts, request keys, retries and permissions remain authoritative.

At 1440 the selected row's link reaches the corresponding compact context; keyboard activation and the actual context bounding box are checked. 1920 uses the full workspace. 375 wraps identifiers and long bilingual identity, retains reachable actions and usable local sections without document overflow. This is a bounded refinement, not a new mobile Contract product.

## Products

Product rows now use shared RecordIdentity: current locale first, alternate name secondary. Long independently fictional identities wrap. Mobile's four KPI cards use two compact columns, preventing them from consuming most of the initial page. New identity text uses 13px functional text.

**Products / Bundles / Exchange Rates are NOT split.** Prices, effective dates, currencies, purchasers, lifecycle actions and canonical Product/Price/Bundle/FX ownership remain. No financial aggregation or reinterpretation was added. Opportunity Pipeline remains the positive reference; its runtime is unchanged.

## Imports and Data Quality

Import problem rows now order human explanation, the next repair/review instruction and field label before technical diagnostics. Repair retains its existing drawer/schema and has a non-wrapping usable control. Known resource types use business labels; the Chinese Import Sets entry is **联合导入任务**. Unknown field labels have a human-safe fallback rather than echoing an internal key.

Technical codes, row, field/column, safe sheet identifier and preflight revision remain reachable through native keyboard-accessible details. Duplicate decisions, upload, mapping, preflight, batch review, repair, execute, rollback and Import Set orchestration are unchanged. An Import Set is not a cross-file ACID transaction.

Data Quality rules now check dictionary membership explicitly. The former `translation !== key` test was incompatible with Phase 1's safe fallback and could hide known business explanations behind Unavailable. Issue explanation, canonical severity, affected record and repair direction precede the rule/reference disclosure.

SafeDiagnostics renders only explicitly supplied identifiers in a constrained format. Arbitrary `lastError` and arbitrary quality details are not rendered. Object payloads, path/URL text, SQL/stack-like prose and sentinel strings are excluded. Synthetic injected raw diagnostics are absent in rendered regions. Full diagnostic bodies remain outside public UI and screenshots; no raw server-error propagation is introduced. Known codes remain diagnostic identifiers, not business status or severity.

## Terminology and fallback closure

| Confirmed defect / review | Result |
|---|---|
| Quality fallback compared output to a key | Fixed with explicit known-label membership and the existing mapped business label |
| Chinese Import Sets literal | Fixed: 联合导入任务; English retains Import sets |
| Enrollment title/related Contract label differed from frozen terminology | Fixed: 项目参与记录 / 关联项目参与记录 |
| Import batch resource enum at business hierarchy | Known values use existing business labels; unknown type is neutral |
| Import v2 field fallback echoed unknown token | Fixed: 未识别字段 / Unrecognized field |
| Raw import error and arbitrary quality detail rendering | Replaced with human explanation plus allowlisted technical disclosure |
| Action Center producer coverage | Actual producer title/detail keys exist in both dictionaries; no fabricated quality signal |
| Organization AT_RISK screenshot fixture | Prior fixture correction remains; canonical RISK enum unchanged |

Phase 1 safe translation/enum/missing helpers remain: unknown status is neutral, optional missing is Not recorded, explicit unset is Not set, required invalid responses remain unavailable/error, and zero remains zero. Dynamic translation prefixes are not treated as missing complete keys. Render tests operate on actual functional regions rather than universal HTML `null` substring scans.

Application/升学申请, Student Support/学生支持, Support Case/支持个案, Workflow Template/流程模板 and Pipeline/商机看板 retain existing business terminology. Channel agreement, commission eligibility, accrual ledger and settlement remain distinct. Technical terms such as CSV/XLSX, UPDATE, `__CLEAR__`, diagnostic codes, revision and Guide are intentionally retained where they explain the strict import contract; they are not invented business states.

Financial labels continue to distinguish Contracted, Receivable, Confirmed payment/Collected, Outstanding, Overdue, Refunded and Commission. Existing historical internal field names are unchanged; no collected payment, contract amount, receivable or commission is renamed Revenue, income, profit or ROI. Existing unrelated sales target/weighted-opportunity forecast terminology is not a new Phase 5 metric or forecast engine.

## Final shared primitive inventory

| Primitive | Status | Current consumers / boundary |
|---|---|---|
| NavigationDestination | KEEP | AppShell sidebar and page commands; query-aware path/query identity and existing guards |
| WorkspaceNav | KEEP | WorkspaceTabs route consumers and governance QA; Link/nav/aria-current |
| WorkspaceTabs | COMPATIBILITY ALIAS | Legacy communication, finance, sales, governance and assistance wrappers; alias to WorkspaceNav |
| DetailTabs | KEEP | Student, Household, Account, Support and selected Contract; genuine same-record panels |
| RecordHeader | KEEP | Organization Directory, Student/Household and Account workspaces |
| RecordIdentity | EVOLVE — additional consumers | Existing directories/Lead plus Product and Contract buyer rows/context; presentation only |
| FilterBar / FilterDrawer | KEEP | Organization Directory, Student/Household, management scope, Lead; drawer is composition using AccessibleDrawer |
| SearchFilterBar | DEFERRED MIGRATION | Existing Contact table, Imports relationship controls and FilterBar's lower-level composition; no second query engine |
| MetricStrip | KEEP | Executive and Student Support summaries; supplied facts, currency and mode only |
| AttentionPanel | KEEP | Executive and Dashboard; supplied canonical signals only |
| ResponsiveDetailLayout | KEEP | Student/Household/Account main/context composition |
| SectionHeader | KEEP | Record context and Dashboard sections |
| QueueItem | KEEP | Lead Work Queue; owning component supplies actions and authority |
| MoreActions | KEEP | Lead, wrapping existing ActionDisclosure/menu machinery |
| AccessibleDrawer | KEEP | Existing creates/edits, filters, diagnostic repair; modal registry/guard/focus engine |
| ConfirmDialog | KEEP | Existing deletion/confirmation/unsaved guards |
| SafeDiagnostics | KEEP — implemented | Imports and Data Quality; native details, no fetching or business interpretation |
| MobileTaskHeader | DEFERRED | No separate unused component created; existing record/drawer headers serve current consumers |

No dead abstraction is introduced. Route navigation is not converted to ARIA tabs. A compatibility alias is retained until its actual consumers migrate; lower-priority pages are not all rewritten for cleanup.

## CSS ownership and closure

All eight existing stylesheets retain their original import order.

| File | Disposition |
|---|---|
| `app/globals.css` | Retained: tokens, shell, tables, forms, mobile and reduced-motion foundation |
| `app/v200.css` | Retained: existing domain/detail/editor consumers |
| `app/v220.css` | Retained: existing workspace/domain layouts |
| `app/v220-quality.css` | Retained: quality severity, rule and operational layout consumers |
| `app/v220-operations.css` | Retained: unaffected operational/admin consumers |
| `app/v270.css` | Retained: existing task, save/context and product behavior presentation |
| `app/ui-system.css` | Only CSS file changed: selected context, diagnostics, repair controls, Product identity and mobile KPI rules |
| `app/workflow-experience.css` | Retained: launchpad/filter/commercial/account consumers and existing responsive/focus rules |

**Rules removed: none.** Consumer inventory includes literal usage, existing aliases and dynamically supplied classes. No rule group was proven both unused and free of a compatibility/dynamic consumer within this bounded closure. Therefore there is no unsupported deletion, stylesheet reorder or claim of full consolidation. New rules have named real consumers; domain CSS stays with its current owners rather than being copied wholesale into the shared file.

Search inventory and CSS fingerprints remain private. Future removal must identify the obsolete selector, its former consumer, replacement and affected browser evidence. An old version in a filename is not evidence that its rules are unused.

## Responsive, accessibility and state evidence

Core coverage preserves full enterprise width at 1920, task capability/context at 1440 and progressive disclosure at 375. All sampled pages reject document-level horizontal overflow. Long Organization, Student, Lead, Product and Contract-buyer identities retain their locale hierarchy. Executive comparison direction remains neutral; color does not declare every increase good.

Keyboard checks cover the mobile sidebar and current destination, global search, Organization filter trap/Escape/restoration, record opening and browser return, Student/Household/Account local tabs, Lead More and filter drawer, Contract local sections, Executive scope, Action Center category selection, native diagnostic disclosures and Import repair dismissal. Existing skip link, form labels/error association, pending controls, unsaved confirmation and reduced-motion rules are retained. Core QA explicitly exercises reduced-motion preference; existing focus-visible outlines are not removed.

Initial load, background refresh, mutation pending and partial unavailability remain separate. Phase 1–4 accepted-save/failed-refresh, stale conflict, uncertain retry and capability contracts pass; their owning runtime consumers are unchanged. Permission visibility remains separate from server authorization and AAL2. Contract read-only actions are omitted under their original authority, not shown as a disabled mutation toolbar.

## Verification matrix

| Gate | Result / evidence |
|---|---|
| Phase 1 regression | PASS — navigation, relevant query identity, capability, filter/fallback contracts and core browser |
| Phase 2 regression | PASS — metric/trend/attention/support contracts and core browser |
| Phase 3 regression | PASS — record/journey/minimum-create/preservation/save contracts and core browser |
| Phase 4 regression | PASS — action/permission/retry/preference/task contracts and core browser |
| Contract selected context | PASS — distinct selected state, checked radio, anchor and compact facts |
| Contract deep link | PASS — initial focus selection and record identity retained |
| Contract 1440 | PASS — selected row→context and keyboard local sections |
| Products regression | PASS — locale identity, long-name/mobile density; canonical boundaries unchanged |
| Imports terminology | PASS — human-first instruction, resource labels and reachable technical details |
| Data Quality terminology | PASS — actual business rule label and source-bound diagnostic disclosure |
| Cross-product fallback | PASS — helper/producer/render contracts; sentinel/unknown probes |
| Long bilingual identities | PASS — actual shared consumers; no document overflow |
| Read-only UX | PASS — Contract restricted role and retained prior action gates |
| 1920 core set | PASS |
| 1440 core set | PASS |
| 375 core set | PASS |
| Keyboard navigation | PASS — focused core interactions |
| Drawer / More focus | PASS — trap, Escape and restoration |
| ARIA navigation/tabs | PASS — links/current vs local selected panels |
| Reduced motion | PASS — preference exercised and existing rules preserved |
| Public privacy | PASS — 13 full current tracked/candidate privacy regression tests |
| Migration verification | PASS — manifest verification and all 118 raw-byte fingerprints unchanged; latest 113 |
| Typecheck | PASS — required typecheck on final source |
| Lint | PASS — full lint plus final scoped verification |
| Build | PASS — final production build remains 3.27.0 |
| QA server stopped | PASS — running=false, PID absent |
| Revenue unchanged | PASS — all six byte-identical, untracked, uncommitted and unstaged |
| Staging empty | PASS — no staged paths; HEAD unchanged |

**195 targeted contract tests passed**, including six new closure tests and existing Phase 1–4, Import v2/sets/field and Contract document contracts. No PostgreSQL campaign is required or run: APIs, repositories, RPCs, mutations and RLS are unchanged. This does not claim authenticated real-DB E2E or RLS proof.

Pinned browser: **ms-playwright/chromium-1243**, browser **153.0.8010.12**, Playwright **1.63.0**. Final bounded core/changed-page campaign: **36 page/state/viewport checks**, zero unexpected browser errors and zero warnings. All seven final reports share one production build hash and one source fingerprint. Breakdown: closure 15, Organization foundation 3, Student/Household 6, Account 2, Lead 3, Dashboard 3, management/support 4. Each phase is bounded to 55 seconds; `QA_CORE_ONLY=1` avoids recreating the 90-shot audit. The full ten-phase browser suite is NOT RUN.

Executive 1920 Attention and Changes begin at **285px**, KPIs at **698.42px**. These are actual DOM positions, not a page-height proxy. One full-page Executive capture confirms default collapsed domain detail. Measurements describe independently fictional fixtures, not universal pixel guarantees.

Evidence uses actual React components/AppShell and production CSS with synthetic APIs and navigation transport. It proves presentation/interactions, not authentication/database security or real mutation integration. Expected error injections in prior full affected-phase fixtures retain exact-URL/status handling; the final core campaign injects no HTTP errors, so every unexpected browser error fails. Screenshots and exact executable/build fingerprints remain Git ignored under `work/`; none are embedded in public docs or uploaded as public artifacts.

## Deferred inventory and release boundary

- Internal Activity bilingual relaxation: DEFERRED; the existing four required fields remain.
- Revenue: DEFERRED / UNTOUCHED — `V326_REVENUE_POLICY_INPUT_REQUIRED`; no policy approval, ledger, recognition or attribution.
- Products/Bundles/FX split, full CSS rewrite, new global search capabilities, forecast, new business fields and a new permission/lifecycle/task engine: NOT IMPLEMENTED.
- Unsupported Student Academic Year filtering and Lead owner/source/persistent saved-view filters remain deferred; no client-only substitute.
- Canonical Contract list expansion to include a friendly contract number is not part of this presentation-only closure.

No future CRM change may introduce real company identity, real customer/counterparty information, Production secrets, private infrastructure data or real transaction evidence into the public repository.

Formal version remains **3.27.0**. Staging EMPTY; commit NOT RUN; push NOT RUN; deploy NOT RUN; Production NONE. UX release candidate readiness: **READY**. Verdicts: **V328_PHASE5_UX_CLOSURE_COMPLETE** and **UX_RELEASE_CANDIDATE_READY**. No release promotion or approval is inferred.
