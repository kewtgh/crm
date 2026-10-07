# v3.28 Phase 3 — Student Lifecycle & Organization Account Workspace

Verdict: `V328_PHASE3_STUDENT_ACCOUNT_EXPERIENCE_COMPLETE`.

## Baseline and preservation

| Item | Opening / final state |
|---|---|
| Branch | `main` |
| HEAD | `b74984e764214caf0383c2e7ca3425d0da536280`, unchanged |
| Formal version | `3.27.0`, unchanged |
| Verification runtime | Node `26.10.0`, npm `12.2.0` |
| Latest migration | `202610070113_student_family_experience.sql` |
| Migration 113 SHA256 | `d507d8b3d7f4ce6c03e93c267f2cdc78559e55de1ff12aa43f2b112414d5d131` |
| Opening worktree | 60 candidate files, including legitimate Phase 0/1/2 work and six Revenue specifications; staging empty |
| Phase 1/2 preservation | All opening candidates retained. Nine shared/route consumers intentionally evolved; the other 51 opening files remain byte-identical. Executive and Student Support management implementations remain byte-identical. |
| Migration boundary | All 118 opening SQL files byte-identical; no migration 114 |
| Git actions | No staging, commit, push, history rewrite or deployment; Production none |

Opening status, diff, raw candidate copies, migration fingerprints and Revenue fingerprints are retained under ignored `work/v328-phase3/`. No historical patch was applied.

## Student directory and workspace

`/students` is the visible Student root. The directory uses the shared RecordHeader, FilterBar and locale-aware RecordIdentity. It retains canonical search, status, server pagination and duplicate/identity boundaries. The current Student query does **not** support an Academic Year filter; year remains visible on each record. No client-only year filter or new API filter was introduced.

`/students?focus=<student>` renders a full Record Workspace with one primary identity and four same-record DetailTabs: **档案 / 家庭 / 学生旅程 / 学业**. There is no Family lifecycle route strip above these tabs. Profile is readable without entering an editor; editing remains an AccessibleDrawer with unsaved-change protection.

Student identity remains the selected Contact `personId`. The directory and header render the current-locale identity first and the alternate language second. Equal normalized identities render once. Grade, academic year and the existing Student status remain explicit facts.

Focus query changes and browser Back/Forward synchronize the selected record. Server presentation keys isolate distinct focus records when the same route receives new server props. A local refresh does not add duplicate focus-history entries. Safe return links accept only the Student/Household routes and reuse the existing safe-relative-return policy.

The Family panel reads canonical Household members, shows their stored relationship and primary-contact flags, and separately retains the actual Student guardian records and their explicit flags. `PARENT` is not relabeled Father/Mother; membership does not imply guardianship or signing authority. The full Household is opened through `/households?tab=families&focus=<household>&returnTo=…`, rather than embedded inside Student.

Academic retains the existing records, class, grade/year, guardian/editor controls and progression entry. The annual September 1 workspace-timezone scheduler and manual corrections were not changed.

## Journey source mapping

| Visible section | Canonical source | Mutation / destination |
|---|---|---|
| 项目参与 | Existing StudentEnrollmentsSection; `/api/enrollments?studentId=…` | Existing EnrollmentEditor and `/enrollments?focus=…`; formal Enrollment lifecycle unchanged |
| 升学申请 | `/api/applications?studentId=…` | `/applications?focus=…` and the existing filtered Application workspace/editor |
| 学生支持 | `/api/student-success?studentId=…` | `/student-success?focus=…`; existing case/goal/risk/intervention/outcome owners |
| Student education context | Existing scoped EducationBusinessWorkspace, `subject=STUDENT`, pathways | Existing education-business editor and contextual deep link |
| 家庭活动参与 | Existing education-business participation records, `subject=HOUSEHOLD` | Existing Household participation owner; explicitly labeled as Household facts, not proof that every child participated |

Enrollment, Application and Support load independently. A related-module failure retains Student identity and separately valid sections, with a bounded retry. No universal Student lifecycle object, automatic transition, new mutation or identity inference was added. Summary Application/Support lists are bounded to ten records with links to the owning workspace; Enrollment retains its existing pagination.

## Household workspace

Visible entry: `/households?tab=families`; focused Household: the same URL with `focus`. Bare `/households` and `/households?tab=students` retain their existing Student behavior. Existing route branch semantics were preserved.

Household has one shared RecordHeader and lightweight **Overview / Members / Students / Education Needs / Activity** sections. Overview presents existing family context, income separately from education needs/budget, and narrative fields. Members retain explicit stored roles and canonical member operations. Student rows link to Student Workspace and read the existing Student detail API for grade/year; only the currently displayed related rows load that context. No Student Workspace or Enrollment editor is embedded inside Household.

Education Needs uses the existing Household-scoped education-business editor. Activity uses the existing Household follow-up owner without another identity header or navigation strip. The contextual return link opens the originating Student. Household member and guardian authorization remain separate.

## Organization Account Workspace

`/schools/[id]` remains the canonical Organization URL. One RecordHeader replaces repeated page/quick-summary/customer-operation identity headers. It shows locale identity, core status, owner and recorded next step; the context rail includes the actual latest interaction date. Missing recorded context is labeled **未记录**. Completeness is a secondary data-quality disclosure. Authorized privacy requests remain reachable through a secondary disclosure and the existing governance destination.

Local navigation is exactly six sections:

| Section | Behavior / canonical reuse |
|---|---|
| 概览 | Bounded active-opportunity summary, recent Contract links, core metadata and a current-context rail; no full commercial/profile/history dump |
| 联系人 | Existing Contact records, follow-up context, explicit Organization-prefilled ModulePage creation, CrmRecordEditor editing and Contact deep links |
| 商机 | Existing Organization commercial read model for stage, exact formatted amount, currency and recorded next action; existing PipelinePage create task with explicit Organization context |
| 合同与产品 | Existing OrganizationContractEditor draft create/edit, Contract links and ProductCatalogAction; no new Organization–Product relationship |
| 渠道与活动 | Existing OrganizationCommercialPanel/profile, explicit contact intelligence and relationships, education events/referrals; agreement/performance detail disclosed on demand |
| 动态 | Existing relationship plan, follow-ups and the source-labeled Customer360 timeline; formal activity editor retained |

The commercial endpoint already exposes Organization-scoped Opportunity facts. It is reused instead of reconstructing amounts from the minimized customer snapshot or adding a backend. CNY/USD amounts remain separate; no total, conversion, Revenue or commission deduction is calculated. Owner names are shown when supplied; where the minimized read model lacks a friendly Opportunity owner name, the original Opportunity workspace is the destination. The Organization owner is never substituted for an Opportunity owner.

`/education-business` remains a secondary cross-record workspace, including existing Organization and Student subject links. Embedded consumers use the same component/editor but omit their resource navigation and top-level identity heading. They do not create new domain ownership.

## Canonical reuse and progressive creation

| Task | Visible minimum | Enrichment / preservation |
|---|---|---|
| Organization create | At least one language name, city, Organization type, duplicate check | Short name, curriculum, categories, affiliation, parent, website, counts and narratives are in a closed enrichment disclosure. Existing canonical defaults and payload fields remain intact. |
| Contact create | At least one language name, email or phone, Contact type, explicit Organization association in Account context, duplicate check | Title, owner, communication, preference, source, role, tags, follow-up and notes are deferred behind the disclosure; existing defaults remain intact. |
| Student create | Existing Contact person, grade, academic year; Household optional | Student number, birth date, class, learning style, interests and narratives are enrichment. No second Student name input/model. |

Organization/Contact continue through `/api/crm/<resource>` check/create and the existing full-record editor. Student/Household, guardian and academic operations continue through `/api/education`; related data continue through their existing endpoints and permission gates. Contract draft updates retain `expectedUpdatedAt`; Student/Household updates retain their canonical revision timestamp; relationship follow-ups retain request keys/receipts. No API, repository, RPC, RLS, worker or scheduler changed, and no duplicate backend was introduced.

Student full-input updates start from the authorized snapshot and preserve omitted enriched fields, arrays, dates, status and revision. Explicit clears remain explicit. Contact and Organization updates retain their existing full-input editors. Compact creation does not submit absent optional fields as destructive update defaults.

Accepted Student/Household edits close the editor and retain the same record/local section. Failed refresh is reported as **已保存；最新显示暂未刷新**, with a refresh action rather than a repeated save invitation. Guardian/member/academic refreshes retain the local section and do not add duplicate history entries. Revision conflict retains the editor and the existing review/reload contract; it does not overwrite or automatically retry.

Read-only Account actions are omitted using the canonical subject `canManage` and existing capabilities. All six current staff roles have `education.manage`; this phase did not fabricate a Student-only read-only role or alter that authorization model. Existing Student capability branches remain intact. The record-specific read-only browser case uses SALES_SUPPORT and a canonical read-only Organization snapshot.

**Internal Activity bilingual relaxation: DEFERRED.** The Customer360 activity API/editor still requires `summaryZh`, `summaryEn`, `nextStepZh`, `nextStepEn`. Existing CustomerOperations follow-up records remain their distinct domain; they do not replace that activity contract.

## Shared primitives, responsive and accessibility evidence

ResponsiveDetailLayout and SectionHeader now have real Student, Household and Account consumers. They only place supplied content/context. Phase 1 RecordHeader/RecordIdentity, FilterBar, DetailTabs and AccessibleDrawer are reused. No second modal, filter or mutation engine was added; new styles are semantic rules in the existing UI stylesheet, without a reskin or stylesheet-order rewrite.

1920 uses main/context columns; 1440 retains the same information order with a narrower context rail; 375 places compact locale identity, actions, local navigation and current content before secondary context. Record tabs scroll locally without page overflow. Long bilingual identities wrap and retain usable actions. Functional controls retain usable sizes and focus styling.

Measured normal 375 synthetic fixtures:

| DOM region | Top position | Result |
|---|---:|---|
| Student local navigation | Approximately 282px | PASS, inside 812px viewport |
| Student current panel | Approximately 370px | PASS, inside first viewport |
| Organization Overview content | Approximately 492px | PASS, inside first viewport |

Browser assertions verify one primary H1/RecordHeader, one Student local tablist, six Account tabs, no nested Family workspace navigation, no document overflow, canonical journey links, separate money currencies, advanced filter isolation, focus restoration, Escape, and DetailTabs Home/End/roving focus. Shared existing focus trapping, skip link, ARIA labels/tab panels, touch behavior and reduced-motion machinery remain intact. Phase 1 mobile first-record and saved-view/history behavior remain passing.

## Verification matrix

| Gate | Result |
|---|---|
| Phase 1 navigation/capability/deep-link/filter regression | PASS |
| Phase 2 management semantics and responsive regression | PASS |
| Student visible root and focus workspace | PASS |
| Student local navigation; no nested Family navigation | PASS |
| Journey canonical links and domain boundaries | PASS |
| Household member/guardian semantics and Student links | PASS |
| Organization single identity and six-section workspace | PASS |
| Contextual Contact create/edit and explicit association | PASS |
| Contextual Contract draft create/edit | PASS |
| Minimum Organization/Contact/Student creation | PASS |
| Duplicate checks and canonical defaults | PASS |
| Untouched Student values and existing full-input editors | PASS |
| Read-only Account action omission; existing Student authorization preserved | PASS |
| Accepted save / failed refresh distinction | PASS |
| Revision conflict and no automatic overwrite | PASS |
| Related-module partial failure | PASS |
| Long locale identities; 1920 / 1440 / 375 | PASS |
| Accessibility, navigation and guarded drawers | PASS |
| Translation and safe fallback regression | PASS |
| Public privacy regression | PASS |
| Migration verification and all historical raw bytes | PASS |
| Typecheck | PASS |
| Lint | PASS |
| Production build | PASS |
| Whitespace and empty staging | PASS |
| QA server stopped | PASS |
| PostgreSQL mutation campaign | NOT REQUIRED — data layer unchanged; NOT RUN |
| Authenticated browser-to-real-DB E2E | NOT RUN |
| Full ten-phase Chromium / release audit | NOT RUN — bounded affected phases only |

Targeted contracts: **155 passed**, comprising 119 Student/Account/domain/Phase 1/2 contracts and 36 existing affected UI/workflow/Student Support operation contracts. Ten new record-workspace contracts cover tab structure, preserved values/clears, return URLs, ownership, contextual reuse, minimum creation, locale coverage, server focus isolation and related context/currency.

Pinned browser: **ms-playwright/chromium-1243**, browser version **153.0.8010.12**. Four affected phases passed: Student/Household **31**, Account **18**, UX foundation **23**, Management experience **25**; **97 page/viewport checks** in total. Each phase uses its existing bounded runner. Raw reports preserve the exact local executable privately.

**Browser boundary:** actual React components, production CSS and synthetic mocked APIs/navigation transport. This is component/browser evidence; it does not claim authenticated real-DB mutation, revision, receipts or RLS integration evidence. Those canonical owners were unchanged and their affected contract regressions passed. Screenshots, network/body fixtures and logs remain ignored under `work/browser-qa-chromium-1243/` and `work/v328-phase3/`; none are published as CI artifacts.

## Revenue and release boundary

Revenue remains `V326_REVENUE_POLICY_INPUT_REQUIRED` — **DEFERRED / UNTOUCHED**. All six opening Revenue candidates retain their exact SHA256, remain untracked and unstaged; detailed opening/final fingerprints are only in ignored evidence. They were not modified, deleted or approved.

No migration, Revenue implementation, automatic identity matching, activity bilingual API relaxation, new business field, new permission taxonomy, business lifecycle transition, or release promotion occurred. Formal version remains `3.27.0`. Lead/Dashboard/Contract/Product redesigns remain for their authorized later phases.

Final Git boundary: staging **EMPTY**; commit **NOT RUN**; push **NOT RUN**; deploy **NOT RUN**; Production **NONE**. All Phase 0/1/2/3 work remains an uncommitted candidate for review.
