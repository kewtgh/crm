# v3.28 Phase 1 — Shared UX Primitives & Global Navigation

Verdict: **V328_PHASE1_SHARED_UX_NAVIGATION_COMPLETE**. Candidate implementation; formal product version remains **3.27.0**. No release promotion, commit, push or deployment.

## Baseline and scope

| Item | Evidence |
|---|---|
| Branch | `main` |
| Opening / final HEAD | `b74984e764214caf0383c2e7ca3425d0da536280` |
| Version | `3.27.0`, unchanged |
| Runtime | Node `26.10.0`, npm `12.2.0` |
| Latest migration | `202610070113_student_family_experience.sql` |
| Migration 113 SHA256 | `d507d8b3d7f4ce6c03e93c267f2cdc78559e55de1ff12aa43f2b112414d5d131` |
| Opening worktree | No tracked modifications; eight untracked files: two Phase 0 UX documents and six Revenue specification candidates |
| Final worktree | Unstaged presentation, navigation, translations, CSS, QA and contract-test candidates; original specification candidates retained |
| Staging | EMPTY |
| Commit / push / deploy | NOT RUN |
| Production | NONE |

Design authority: [UX architecture](UX_ARCHITECTURE_V328.md) and [implementation plan](UX_IMPLEMENTATION_PLAN_V328.md). The page-redesign phases remain deferred. This phase changes navigation and presentation only: route loaders, APIs, repositories, mutations, RLS and domain models are unchanged.

Private opening evidence, fingerprints and final boundary verification are under ignored `work/v328-phase1/`. No private screenshot is embedded in this document.

## Navigation contract

`lib/navigation-destinations.ts` owns visible destination metadata, pathname matching, relevant query semantics, guards and aliases. AppShell sidebar and page-search commands consume the same capability-filtered metadata. Visibility is not authorization; server routes, owning repositories, action gates and RLS remain authoritative.

| Space | Destinations and existing visibility authority |
|---|---|
| 工作 | 工作台 `/dashboard`, 行动中心 `/action-center`: authenticated access; 我的任务 `/tasks`: `tasks.view`; 日历 `/calendar`: `calendar.view`; 待审批 `/approvals`: `approvals.decide` |
| 客户关系 | 学校与机构 `/schools`, 联系人 `/people`: existing authenticated/row-visibility model |
| 学生服务 | 学生 `/students`, 家庭 `/households?tab=families`, 项目参与 `/enrollments`, 升学申请 `/applications`, 学生支持 `/student-success`: `education.view`; 学年与升级 `/progression`: `progression.manage` |
| 商业合作 | 线索 `/leads`: `leads.view`; 商机 `/opportunities`: `opportunities.view`; 产品 `/products`: existing authenticated model; 合同 `/contracts`: `contracts.view`; 财务 `/finance` and 渠道协议与返佣 `/commissions`: `finance.view` |
| 经营分析 | 经营总览 `/reports/executive`, 渠道分析 `/reports/channels`: `education.view`; 团队绩效 `/sales/performance`: existing authenticated/row-visibility model |
| 运营治理 | 导入 `/imports`: `imports.view`; 数据质量 `/data-quality`: `dataQuality.manage`; 重复记录审查 `/duplicates`: `duplicates.manage`; 流程模板 `/workflow-templates`: `education.view` |
| 管理 | Existing `/admin`, `/admin/approvals`, `/admin/operations`, `/admin/workspace`, `/admin/security`: `admin.access` plus ADMIN/SUPER_ADMIN; `/admin/users`: `users.manage` plus ADMIN/SUPER_ADMIN; `/admin/recycle-bin`: SUPER_ADMIN plus `admin.access` |

Secondary destinations remain under their owning space: communications (`messages.view`), guardian portal (`portal.manage`), outreach (`leads.view`), reports and consumption (existing authenticated model), exports (`exports.request`), education business (`education.view`), privacy requests (`privacyRequests.manage`), AI review (`ai.review`) and automation (`automation.manage`). Account/settings and help remain utilities. No `products.view`, `reports.view` or `management.view` capability was invented. Commission mutation controls and AAL2 challenges are unchanged.

The active group expands automatically; other groups are user controlled. The sidebar keeps its scroll area, collapse mode, dark palette, relationship-health panel and keyboard/mobile behavior. Administration retains its same-tab document navigation boundary.

### Query-aware active identity and old links

| URL | Active destination |
|---|---|
| `/students`, `/students?focus=synthetic` | Student |
| `/households`, `/households?tab=students` | Student |
| `/households?tab=families`, plus `focus`, `page`, `sort` in any order | Family |
| `/enrollments`, `/applications`, `/student-success`, `/progression` | Their own Student Services destination |
| `/workflow-templates` | Operations & Governance |
| `/commissions` | Commercial |
| `/reports/executive`, its attention child route | Management / Executive |
| `/imports`, `/data-quality` | Their own Governance destination |

Matching uses path boundaries and designated query keys; it does not compare concatenated query strings. A restricted child route cannot fall back to an accessible generic parent destination. Existing URLs and the bare Household route's loaders/focus semantics are retained, without redirects. The global navigation intentionally ignores record-focus query parameters when identifying product space.

The Family strip is removed from the seven affected student/configuration route wrappers. It no longer presents another entire lifecycle IA beneath the global sidebar; the actual page components, record tabs and deep links remain intact.

All six canonical staff roles are tested, including SUPER_ADMIN-only recycle-bin and SALES_SUPPORT negative cases. Student, Family, Commission, Executive and Workflow Template page commands are exercised in Chromium; inaccessible import commands are absent for the restricted role.

## Shared presentation primitives

| Primitive | Implementation / consumer |
|---|---|
| NavigationDestination | Sidebar and global page commands; query-aware matching and canonical capability visibility |
| WorkspaceNav | Cross-route `nav` + `Link` + `aria-current`; existing WorkspaceTabs export remains a compatibility alias for unaffected consumers; governance QA consumer verifies semantics |
| RecordHeader / RecordIdentity | Organizations Directory heading and actual organization rows; long bilingual record-header fixture verifies future workspace use |
| FilterBar / FilterDrawer composition | Organizations Directory only; evolves existing SearchFilterBar and uses existing AccessibleDrawer machinery |
| MetricStrip | Minimal supplied-value renderer for the Phase 2 dependency; real component fixture consumer, no Executive migration |
| AttentionPanel | Minimal supplied-item renderer with fixture consumer, no fetch, task creation, counting or signal deduplication |

DetailTabs retains its independent same-record ARIA tabs, arrows, Home/End and roving focus semantics. WorkspaceNav is not a tab widget.

SectionHeader, QueueItem, MoreActions, ResponsiveDetailLayout and MobileTaskHeader are deferred until their actual consumers require them. No unused overlay engine or filtering engine was added.

MetricStrip displays supplied mode, date, value and currency/unit; zero stays zero, invalid values are unavailable, restricted values are hidden, and SNAPSHOT never displays a period comparison. It does not aggregate currency, calculate Revenue or infer comparisons.

Existing stylesheets and their loading order remain. Semantic rules are added to the shared UI system and scoped Organization consumer; no global reskin or new overrides stylesheet. New filter controls use 13–14px functional text.

## Organizations Directory filters and responsive behavior

Desktop: Search, Status, Owner and More Filters share one composition. Advanced conditions are the existing Commercial Tier, Key Contact and Partnership Potential queries. No client-only pseudo filter or new server query was created.

Mobile below 680px: Search, compact Status/Owner and `Filters · N`; advanced fields open a full-width AccessibleDrawer. Organization rows prioritize locale identity, city/curriculum, status and owner. Less frequent metadata is disclosed through More Details. Sorting, direction, server pagination and saved views remain available; empty and error states remain visible.

Draft semantics:

- Opening copies the applied advanced values into a draft.
- Editing or resetting the draft issues no filtering request.
- Apply commits once through the existing query owner and resets pagination.
- Cancel or Escape discards draft edits and restores trigger focus.
- Reset draft clears advanced draft fields while preserving the primary Owner value.
- Clear filters resets applied search, status, owner and advanced conditions; it preserves sorting/page-size behavior.
- Badge `N` counts only applied advanced conditions: tier, key-contact condition and minimum potential. Search, Status and Owner are excluded.

PERSONAL and TEAM saved-view creation are exercised. Existing stored configuration remains `query`, `status`, `sort`, `direction`, `pageSize`; owner/commercial criteria remain independent, with an explicit help label. No stored schema silently changes. Mobile Directory → record → browser Back restores the existing URL sort.

In the normal synthetic 375×812 fixture, the actual first organization row starts at **551.36px**, within the initial viewport. This is a row bounding-box check, not a document-height proxy. At 1920×1080 and 1440×900, desktop tables retain available workspace width. Long synthetic identities do not create document overflow at any tested width.

## Terminology and fallback

- Added `common.notSet`: 未设置 / Not set.
- Missing optional values: 未记录 / Not recorded; explicit not configured: 未设置 / Not set; restricted, unavailable and numeric zero remain distinct.
- Unknown enum labels use 未知状态 / Unknown status and neutral styling in the affected Organization consumer.
- Missing translation keys use 暂不可用 / Unavailable, with a development-only diagnostic and focused contract tests. Production UI does not echo the key.
- Safe presentation does not catch invalid required responses or replace load errors with optional-missing labels; the existing loading/error path remains.
- Locale identity trims input, selects the current locale first, and suppresses duplicate normalized alternate values. No identity inference or data migration occurs.
- The ignored screenshot-capture fixture sources were corrected from Organization `AT_RISK` to canonical `RISK`, and from a fabricated ActionCenter quality producer to an existing privacy producer. Historical screenshots remain private evidence; no production enum or signal was invented to accommodate them.

## Verification

| Gate | Result | Evidence |
|---|---|---|
| Navigation IA | PASS | Seven spaces; shared canonical destination metadata |
| Query-aware Family/Student active state | PASS | Relevant-query contract matrix and actual components |
| Capability visibility | PASS | All six roles; restricted browser case |
| Deep links | PASS | Active-destination matrix; original route loaders retained |
| Global search page commands | PASS | Five required permitted commands; negative inaccessible import command |
| WorkspaceNav semantics | PASS | Link/aria-current; no tab role |
| Organization FilterBar | PASS | Existing primary/advanced queries; no draft requests |
| 375 FilterDrawer | PASS | Apply/cancel/reset/Escape/focus restoration and keyboard wrap |
| 375 first-record visibility | PASS | First row top 551.36px < 812px |
| Identity hierarchy | PASS | Long bilingual identity at three widths; normalization contracts |
| Translation fallback | PASS | Synthetic missing key; human-safe Chinese/English labels |
| Unknown/missing presentation | PASS | Unknown enum, missing, restricted and zero |
| Privacy | PASS | `npm run test:public-privacy`, 13 tests |
| Migration verify | PASS | `npm run db:migrations:verify`; all 118 opening SQL files byte-identical; no 114 |
| Targeted contracts | PASS | 31 tests across ux-foundation, ui-system, workflow-usability and rendered-html |
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Build | PASS | `npm run build`, version 3.27.0 |
| Browser 1920 | PASS | 9 captures/checks at 1920×1080 |
| Browser 1440 | PASS | 7 captures/checks at 1440×900 |
| Browser 375 | PASS | 7 captures/checks at 375×812 |
| QA service | PASS | STOPPED |
| Whitespace | PASS | `git diff --check` |
| Revenue boundary | PASS | Six opening candidates byte-identical, untracked and unstaged |
| PostgreSQL mutation suite | NOT REQUIRED / NOT RUN | No API/repository/mutation/RLS changes |
| Full Chromium matrix | NOT RUN | Only the affected UX foundation phase |

Targeted contracts are registered in the existing raw test/contract scripts. Browser invocation uses `npm run qa:chromium-1243` with `QA_PHASE=ux-foundation`; the phase has a 55-second limit and is excluded from combined full-release acceptance.

## Browser and privacy boundary

Pinned runtime: **ms-playwright/chromium-1243**, browser **153.0.8010.12**, Playwright **1.63.0**. Final run: 23 captures/checks, zero browser errors and zero warnings. The private report retains exact executable/build/source evidence; this public document does not publish an operator path.

Evidence uses actual AppShell, Organizations Directory, Student/Family components, shared primitives and production CSS. Business APIs and Next routing transport are synthetic QA mocks. The local built health endpoint confirms version; no production service is accessed and no database identity is created. This is presentation/behavior evidence, not authentication, RLS or PostgreSQL mutation evidence.

Reports and screenshots remain ignored under `work/browser-qa-chromium-1243/v328-phase1/`. No screenshots, raw logs or original audit pack are staged or published.

## Deferred and Git boundary

Executive, Student/Account workspaces, Lead Queue, Dashboard, Support Analytics, Contracts and Products redesigns are deferred. Activity bilingual validation is unchanged. No new business fields, permissions, mutations, migration, financial semantics or task engine.

Revenue: **DEFERRED / UNTOUCHED — V326_REVENUE_POLICY_INPUT_REQUIRED**. All six specification candidates retain their opening SHA256 and remain uncommitted/unstaged. The two Phase 0 UX documents are retained without changing frozen product decisions.

Commit: **NOT RUN**. Push: **NOT RUN**. Deploy: **NOT RUN**. Production: **NONE**. Version: **3.27.0**. Await review before the next implementation phase.
