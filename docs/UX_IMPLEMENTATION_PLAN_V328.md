# v3.28 — UX Implementation Plan

状态：**PLAN ONLY**。依赖 [UX_ARCHITECTURE_V328.md](UX_ARCHITECTURE_V328.md) 的冻结设计；当前版本仍为 `3.27.0`。本计划不批准现在实施、发布或修改领域政策。

## 1. 交付原则与次序

先解决信息架构、任务层级与上下文，再做 progressive disclosure、响应式和视觉修整。保留现有 brand、canonical APIs、permissions、revision、maker-checker、receipts、RLS 和 URL。每个 phase 可以拆成数个小 PR/commit，随时保持应用可部署，不用一个巨型 UI rewrite。

经营总览是最高页面优先级，因此在 shared primitives 后提前到 Phase 2；学生/账户在 Phase 3，线索/工作台在 Phase 4。这比把 Executive 放到最后更直接回应当前证据，同时先提供其依赖的 filter、metric、attention primitives。Operations、Products、Contracts 主体不抢占前期重构。

| Phase | Scope | Dependency | Deployable result |
|---|---|---|---|
| 1 | Shared UX primitives + Global IA + confirmed terminology fixes | architecture/route inventory | 正确导航与新组件可被逐页采用；原领域页面继续可用 |
| 2 | Executive Overview + Student Support Analytics | compact filters、MetricStrip、AttentionPanel | 管理页面异常/变化优先；原正式 read models 不变 |
| 3 | Student Lifecycle + Organization Account Workspace | RecordHeader、WorkspaceNav、ResponsiveDetailLayout、mobile task | 学生入口独立、账户上下文集中；mutation 不复制 |
| 4 | Lead Work Queue + Dashboard refinement | FilterDrawer、QueueItem、MoreActions、attention summary | 一线下一步清晰；launchpad 降为 quick launch |
| 5 | Cross-product responsive / terminology / accessibility closure | 已迁移重点消费者 | Contracts bounded context、lower-priority surface 修整、CSS 回收及 release closure |

Phase 0 不改版本。后续实施期间继续正式版本策略；只有所有对应 release gates 完成并得到发布授权，才 promotion 到 `3.28.0`。本计划本身没有 migration requirement。

## 2. Shared dependency map

| Dependency | Existing source | Implementation rule |
|---|---|---|
| global route/capability mapping | AppShell、route guards、permissions | 一个 visible-entry contract；服务器和 RLS 仍权威；role restrictions 不简化 |
| workspace vs record navigation | WorkspaceTabs、DetailTabs | route links/aria-current 与 panel tabs/keyboard 分开；正常最多两层 |
| search/filter | SearchFilterBar、existing query state/saved views | primary/advanced presentation；保留 query、sort、pagination、授权 scope |
| overlays | AccessibleDrawer、ConfirmDialog、modal registry | 新 mobile layout 使用原 focus/unsaved guard；不再造 modal engine |
| identities/table | DataTable、bilingual names、status labels | 当前 locale primary，alternate secondary；没有业务数据迁移 |
| account/student context | existing record and education/commercial APIs | composition of authorized results；返回原 context；不建立 duplicate repository |
| management | metric/trend contracts、overview/trends/attention APIs | mode/currency/scope 保留；仅已有 eligible PERIOD comparison |
| translations | zh-CN/en dictionaries、I18nProvider | human fallback + producer enum/key contract tests；不靠 broad literal regex 判定拼接 key |
| styles | globals/v200/v220/quality/operations/v270/ui-system/workflow-experience | named primitive rules→migrate consumer→remove obsolete overrides；不批量重新排序 CSS |
| regression evidence | pinned Chromium 1243、existing synthetic QA fixtures | actual components/production CSS；修正 fixture-only status/signal，再作为断言 |

最小新组件集合：RecordHeader、WorkspaceNav、FilterBar/FilterDrawer、QueueItem/MoreActions、MetricStrip、AttentionPanel、ResponsiveDetailLayout、MobileTaskHeader、SectionHeader。已有功能足够时演进现有组件；没有首个消费者的组件不提前建设。

## 3. Phase 1 — Shared primitives + Global Navigation

### Work packets

1. 将 architecture 的 visible-entry table 实现为能力感知导航，新增学生服务/经营分析/运营治理空间；把 `/students` 设为独立入口。保留原 auth/settings/global search 和 administration role restrictions。
2. Family 可见入口显式使用 `/households?tab=families`；bare `/households` 仍保持现有学生语义。准确定位 `/enrollments`、`/applications`、`/student-success`、`/progression`；Workflow Templates 离开 Family daily tabs。
3. 明确 route WorkspaceNav 和 record DetailTabs；先保留未迁移页面样式。提供 locale-aware header/identity、semantic filters、mobile task layout；一个简单 Directory 作为首个 filter 消费者。
4. 修复真实缺失 `common.notSet`；定义 translation fallback、安全 enum/missing-value presentation。修正 QA fixture 的 Organization `AT_RISK` 与不存在的 ActionCenter quality producer；不能用添加虚构领域 enum/signal 修 fixture。
5. 建立后续 consumer 可用的 MetricStrip/AttentionPanel，沿用已有 menu/modal/focus 基础。

### Acceptance

- 可见 entry 的 capability 与现有目的地相符；无权 entry 不出现，restricted management 不冒充 zero。
- 所有保留 URL/query 正常打开；Student、Family focus 的 ID 不混淆；browser Back 保留目录 state。
- shared FilterDrawer 支持 draft/apply/reset、active N、keyboard/Escape、mobile first-result 条件。
- bilingual name 只改变 presentation；没有新 identity 字段或 mutations。

验证：navigation/terminology/filter focused contracts；修改 TS 后 typecheck 和 scoped lint；AppShell/实际 runtime build 按 repository policy；browser 1920/1440/375 shell、Org directory、student destination、一个 readonly role。不得以纯 mocked browser 证明 RLS。

## 4. Phase 2 — Executive + Support Analytics

### Work packets

1. Executive compact period/Product/Cohort/More scope；先显示 Attention、period changes、key KPI strip，再六域 summary。明确当前 as-of、workspace timezone 及不受 scope 影响的模块。
2. 调用已有 overview/trends/attention paths；eligible PERIOD 的 previous/absolute/percent comparison 直接消费 canonical contract。SNAPSHOT 无 historical-as-of 时不显示变化；percent null、restricted、unavailable 有明确文字。
3. 六域 detail 默认按需展开，drilldown 保持 scope 和实际目的地能力；保留 finance/commission permissions、currency、shared Contract unallocated 语义。
4. Student Support Analytics 用 Health/Risk/Goals/Interventions/Outcomes/Trend summary，已有 counts、denominators、cohort/period scopes 不变。Cases/Outcomes 仍可直接打开。
5. `/reports/executive/attention` 仍是 management exception drilldown；不复制 Action Center 成新的执行 engine。

### Acceptance

- 1920×1080 初始 viewport 同时有实际 attention、可用 period change 和重要 KPI；不是 filter form + 按钮。
- 1440 没有丢失 primary investigation action；375 attention 优先，scope 进入 sheet。
- 每个 domain 能独立呈现 unavailable/restricted；当前 mode/date/currency 可识别。
- 开关 domain details 不修改任何 canonical fact；无新增 trend history、Revenue、forecast 或 client-side business aggregation。

验证：existing management/trend/privacy contract regressions + presentation tests；browser Executive at all three widths、Support analytics 1920/375、permission-limited、zero baseline、partial module error。只有服务读取行为实际改变才增加相应 DB regression；不自动跑全部数据库套件。

## 5. Phase 3 — Student Lifecycle + Organization Account Workspace

### Work packets

1. Student Directory/Workspace 以 Students 为 visible root；默认 current-locale identity。焦点记录沿用现有 URL，可由长 drawer 迁移成 workspace page；提供返回保留筛选的目录链接。
2. Student local nav：Profile/Family/Journey/Academic。Family 用 contextual member rows，显示实际关系；完整 Household Workspace 通过 link 打开，不能在 Student panel 中嵌入第二份 workspace tabs。
3. Journey 提供 Enrollment/Application/Support/participation 各自正式状态和操作链接。Enrollment/Application/Support detail 优先 state/blocker/allowed next step；history 后置。
4. Organization 一份 RecordHeader；Overview/People/Opportunities/Contracts & Products/Channels & Outreach/Activity。保留 privacy/admin access、数据完整度信号，但降低非行动 metadata。
5. Contextual Contact/Contract/Product/profile actions 复用 existing editors；selected parent 显式传入、fresh authorization/revision 检查；save 后回到当前 account panel。
6. Organization/Contact/Student create 最小任务 + enrich profile。Full-input update 合成完整现有 input，不能 reset untouched fields；保持 duplicate check 和 required fields。
7. Education Business 保留 secondary route。把相关 profile/needs/pathway/event/referral/participation/application 的已有 actions 通过 context 调用；不把每个资源一律塞进 RecordHeader 或新 backend。

### Acceptance

- Student 的 current lifecycle location 从 global nav 可辨；Family context 不能推断 legal authority 或未知父母性别关系。
- Organization primary identity 只有一次；open opportunity/active contract/key contacts/next action 可定位。
- Contextual actions 保留权限、receipt、revision、accepted-save/refresh-failure 区别；没有新的 Student/Contract/Product/Finance mutation。
- 375 long-name task header 和 primary save 都可使用；关闭/返回遵守未保存修改保护。
- Product/Cohort、Enrollment/Application、Contract/Enrollment、Household/member/guardian 各自 canonical boundaries 不变。

### Activity bilingual dependency gate

目标普通内部 summary/next step 只要求一个有效语言。当前 API 强制 `summaryZh + summaryEn + nextStepZh + nextStepEn`。此项是独立 bounded work packet：先明确 owning API/domain validator 的单语言规则及历史显示 fallback，再修改 form，保留对外双语 artifact 要求；不得靠 placeholder、复制语言或 AI 翻译通过验证。若后续实施授权不包含该领域契约调整，则此项明确 DEFERRED，其他 workspace 改进仍可交付。

验证：Student/Household/Org/Contact contextual focused regressions；revision与 blank preservation 的已有 contract；browser same Account tabs、Student family/journey、Context create/edit、accepted save/refresh error、stale conflict、1920/1440/375 long names。后端不变时不需重跑全部 financial/education mutations；若 activity contract 修改，单独验证该 RPC/API，不能声称纯视觉改动。

## 6. Phase 4 — Lead Queue + Dashboard

### Work packets

1. Lead primary filters 为 scope/stage/search；advanced owner/age/source/qualification 进 drawer；preserve saved-view/query/server filtering。
2. Card/row 按 identity→stage/owner/age/activity→next action→qualification 排序。从当前允许动作选择一项 dominant primary；release/reassign/visibility/history 进入 More。
3. 保留 viewpool/owned/converted/read-only 的真实条件；revision、requestKey、uncertain retry、receipts 和 payload conflicts 不变。
4. Dashboard 改为 My Today→Attention→Business Snapshot→Quick Navigation/Launchpad→Operations；原品牌和模块复用。
5. Daily/Management 一次显示一个，记忆显式选择；default capability-aware；不要为 preference 新增 schema。Dashboard exception summary 链到 Action Center，management summary 链到 Executive。

### Acceptance

- Lead 每条记录只有一个 visually dominant permitted next action；没有 next action 权限时能读懂只读状态。
- 375 默认有数据时 first lead 起始在首屏；advanced filters 不遮住结果。
- Dashboard first viewport 优先当前工作/attention；launchpad 不再压住 Today Focus。
- Action Center signals 非 unique tasks，Dashboard/Executive 不重复累加重叠事项，不建立新的任务引擎。

验证：lead action hierarchy、capability menu、retry/conflict regressions；Dashboard mode/capability/pref tests；browser Lead widths、claim/owned/converted/read-only、More menu、Dashboard widths和 safe error；不因为 layout 修改重跑所有 mutation suites。

## 7. Phase 5 — Cross-product closure

### Work packets

1. Contracts 强化 selected row、selected-record context、related Enrollments/Documents local navigation；必要 sticky context；保持现有总体结构、draft/approval/document human review。
2. Products 保留 catalog/bundles/FX，做 shared identity/filter/task consumers 的必要调整；不无证据拆分责任空间。Pipeline 和 Action Center 保留正面模式并做回归。
3. Imports/Data Quality 局部 business language、窄按钮和 error code disclosure；不新增 import capability 或变更 strict schema/template identity。
4. 完成 cross-product terminology/fallback、empty/error/loading/read-only、long-name/mobile/a11y 验收；移除已无消费者的 CSS overrides。
5. 汇总 architecture 和实际交付差异；如有 deferred activity policy/secondary low-priority items明确列出。只有实际 release closure 才同步版本 metadata/release notes。

验证：各 affected contract/presentation tests、typecheck、scoped lint、正式 build；一次 final core regression + changed-page samples，不重复 90 张截图。Migration discovery/fingerprints 按 release policy；UX 无 schema需求，不能为导航或页面写新 migration。

## 8. Browser regression strategy

使用 repository pinned Chromium `1243`、现有 QA server start/status/stop workflow、actual components + production CSS、独立虚构 fixtures。QA evidence 留在 ignored `work/`；不上传 raw directory、私有 screenshots、DB logs 或 network traces。每 phase 只跑受影响 browser phase 与下面 selected views，不跑无关全矩阵。

### Core set（最终 closure 一次；各 phase 只取相关子集）

| View | Required width samples | Reason |
|---|---|---|
| Dashboard | 1920、375 | task hierarchy、mobile launch density |
| Organizations | 1920、1440、375 | wide table、compact filter、first record |
| Organization Workspace | 1920、375 | one identity/context actions |
| Students | 1920、375 | visible lifecycle、search/member semantics |
| Student Workspace | 1440、375 | local nav/family context、long-name task |
| Lead Queue | 1920、1440、375 | action hierarchy/filter disclosure |
| Contracts selected | 1440 | selection→detail context continuity |
| Executive | 1920、1440、375 | first viewport decisions、scope、progressive detail |
| Action Center | 1920、375 | preserve positive priority/card behavior |

Primary locale zh-CN；少量 en samples 用于 identity/label expansion，至少 Header/Student/Executive 相关修改处。同一次截图可满足多个 gate；不对每个 phase 重拍未变页面。管理完整 full-page 只在重构/closure 的相关验收使用，以确认按需展开后不存在原先默认长报告。

Phase-specific states：filter sheet apply/cancel/reset；permission-restricted vs zero；load module error；save accepted/refresh failed；revision conflict；short/long/nested task；state-aware primary/More actions；Management eligible change/unsupported snapshot comparison。真实权限、mutation、receipt、RLS 由 existing integration evidence或受影响 targeted DB checks验证，mocked APIs browser 仅证明呈现与交互。

## 9. Accessibility、public privacy 与发布 gate

每 phase 必验 keyboard reachability、focus-visible、Escape/pending guard、focus restore、modal nesting、mobile navigation、route `aria-current`、same-page tabs keyboard/ARIA、labels/errors、reduced motion、touch hit areas。不能为了 compact UI 删除 label 或 focus ring。

只记录 public-safe summary；所有示例独立虚构，email 使用 reserved example.test。未来任何 CRM change 不得将真实公司、客户/对手方、Production secrets、private infrastructure 或真实交易证据带进公共仓库。截图/历史操作证据不能自动进入 Git。

Phase完成标准：requested behavior + relevant targeted regressions通过、无 canonical boundary regression、deep links可用、受影响 widths可操作、无 raw term leaks、QA server stopped。未通过明确报 blocker；不得以 mock截图替代真实业务安全检查，也不得为获得“更多验证”扩大为全仓审计。

Release gate 不批准自动 commit/push/deploy；届时依据用户明确授权。每个阶段附变更范围、测试结果、mock/real boundary 和 deferred 项目；新 shared component 迁移稳定后再移除旧实现。

## 10. Deferred / 非实施清单

- Revenue — **DEFERRED / UNTOUCHED**。六个既有候选保留原 bytes；仍为 `V326_REVENUE_POLICY_INPUT_REQUIRED`；无 approval/ledger/posting/attribution。
- 不新增 canonical business fields、任务引擎、Product/Contract/Student/Finance backend；不改变 annual progression policy。
- 不批准 automatic identity resolution、AI translation/recognition、forecast、P&L、FX revenue consolidation。
- 不要求 Product/Bundles/Exchange Rates 分拆、Contract 全重建、global search 新功能或全 CSS rewrite。
- Phase 0 无 migration、runtime、version promotion、commit、push、deployment 或 Production access。

## 11. Phase 0 文档交付 gate

两份文档覆盖 current evidence、full CRM route mapping、七个 archetypes、四个 responsive tiers、Top 5 wireframes、shared/CSS strategy、terminology confidence、bounded phase/test sequence。验证 public privacy regression、migration verification、route/document integrity、Revenue/migration fingerprint unchanged、`git diff --check` 和新增文档 whitespace。因为只增加 Markdown，typecheck/build/browser/PostgreSQL 在本阶段 NOT REQUIRED。
