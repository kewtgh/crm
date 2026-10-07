# v3.28 Phase 0 — UX Architecture & Redesign Contract

状态：`V328_UX_ARCHITECTURE_READY`。这是下一轮实施的设计契约，不表示 v3.28 已发布，也不批准新的领域能力。

配套实施计划：[UX_IMPLEMENTATION_PLAN_V328.md](UX_IMPLEMENTATION_PLAN_V328.md)。本阶段只新增两份 Markdown 文档。

## 1. 基线、证据与适用边界

| 项目 | 实际基线 |
|---|---|
| Branch / HEAD | `main` / `b74984e764214caf0383c2e7ca3425d0da536280` |
| 正式版本 | `3.27.0`，Phase 0 保持不变 |
| 最新迁移 | `202610070113_student_family_experience.sql` |
| 最新迁移 SHA256 | `d507d8b3d7f4ce6c03e93c267f2cdc78559e55de1ff12aa43f2b112414d5d131` |
| Runtime | Node `26.10.0` / npm `12.2.0` |
| 开始工作区 | tracked clean；staging empty；六个既有 Revenue specification candidates 未提交 |
| Screenshot baseline | manifest HEAD 与当前 HEAD 相同；无需恢复历史提交 |

审阅了私有截图清单及全部八组截图，共 90 张：1920 宽 76 张、1440 宽 5 张、375 宽 9 张；87 张中文、3 张英文，5 张 full-page。证据编号 `UX-SHOT-NNN` 对应清单中的 number。图像哈希与清单相符。截图使用实际 React 组件、AppShell 和 production CSS，在本地 QA 装配中使用独立虚构的 mocked business APIs；它们证明呈现结果，不证明 authenticated SSR、真实数据库权限或 mutation 行为。本阶段没有追加截图活动。

有界代码检查覆盖 AppShell、workspace/detail tabs、搜索筛选、table/modal、五个重点工作区、对应 route guards、creation/activity validators、management metric/trend contracts、翻译字典和 CSS 入口。没有开展全仓业务或安全审计。

私有图像及精确检查证据留在 Git-ignored `work/`，本文不嵌入图像。公共示例只使用 Student A、Parent A、Example Education Organization 等独立虚构身份。六个 Revenue 候选文件不修改、不删除、不 stage；`V326_REVENUE_POLICY_INPUT_REQUIRED` 继续有效。

## 2. 当前 UX 模型

### 2.1 Global IA 与局部导航

`components/app-shell.tsx` 当前以工作台、客户关系、运营协作、管理后台为主要分组；运营协作再分客服、销售、合同财务、数据治理、报告及智能建议。个人设置在账户区域。部分分组包含许多实现路由，业务位置取决于 active-route 映射。

`getActiveNavigationHref` 将 `/students`、`/enrollments`、`/applications`、`/student-success`、`/progression`、`/workflow-templates` 全部归到 `/households`。`familyWorkspaceTabs` 没有独立 Students 和 Enrollments 项，却有流程模板配置。结果是学生交付、申请、支持与配置都像家庭档案的附属功能。

`WorkspaceTabs` 是路由链接，使用 `aria-current`；`DetailTabs` 是同页 panel tabs，支持方向键、Home/End 和 roving focus。二者共用接近的外观。Student drawer 内还能嵌入完整 Household 局部 tabs，形成重复导航层（UX-SHOT-028）。Organization 页面、quick summary 和 CustomerOperationsPanel 重复身份标题（UX-SHOT-011–016）。

### 2.2 页面与操作模式

Directory 主要是 table + SearchFilterBar + quick summary；Lead Pool 是卡片集合但仍以全量过滤及治理操作为中心；Executive Overview 和支持分析把多个完整指标模块依次铺开。Contract 是目录选择后在下方展开关联内容；Product catalog 与 bundles/exchange rates 在一个工作区，整体尚可。

Record detail 混用独立页面、长 drawer 和嵌套 drawer。`AccessibleDrawer` / `ConfirmDialog` 已有 modal registry、top-modal focus/inert、Escape、focus restoration 与未保存修改保护。技术能力保留；长记录默认 drawer 和嵌套完整工作区是需要调整的产品使用方式。

### 2.3 Responsive 与视觉基础

AppShell 支持折叠 sidebar，CSS 各阶段文件有多个局部 media queries。SearchFilterBar 主要负责 flex/wrap，不知道“主要/高级”筛选语义；mobile 因而把 desktop controls 全部堆在结果前。Directory table 采用 scroll/min-width；部分标题和 drawer 把长双语名称以同等级斜杠拼接。

基础 body 已是 14px，并非整个系统都是 12px；但 table、按钮和许多功能文字仍使用 12px。已有正文 `76ch` 限宽是合理基础，不是需要撤销的全局约束。主要问题是区域优先级、重复容器、mobile disclosure 和各组件在宽屏中的分配，不应归因于一个并不存在的统一 1200px 限宽。

保留品牌颜色、sidebar 身份、Lucide、status colors、按钮含义、drawer/dialog、table conventions。目标是 **Dense but calm**；不做视觉换肤、营销式留白、巨大字级、装饰动画或 glassmorphism。

## 3. 问题、优先级与证据

P0 表示阻止安全实施的边界破坏；P1 表示日常定位或首屏决策障碍；P2 表示效率与一致性问题；P3 表示低优先级整理。没有从截图确认新的 P0 业务事故。

| ID / 优先级 | 具体问题 | 证据 | 设计处理 |
|---|---|---|---|
| UX-001 / P1 | 学生生命周期全部高亮到家庭，Students/Enrollments 缺少一等 workspace 入口 | AppShell、WorkspaceTabs；UX-SHOT-025–046 | 独立学生服务空间；保留 URL 和原领域 |
| UX-002 / P1 | Executive 首屏先占用大筛选区，attention 在六个展开模块之后 | ExecutiveOverviewPage；UX-SHOT-072–075；full-page 高 7231px | Attention → period changes → KPIs → domain summaries |
| UX-003 / P1 | mobile 机构和线索结果被完整 desktop 筛选表单推到首屏之外 | SearchFilterBar/CSS；UX-SHOT-009、049 | search + 两个主筛选上限 + Filters sheet |
| UX-004 / P1 | Organization 多次身份标题，概览/商业/教育业务选择分裂 | Customer360Page/CustomerOperationsPanel；UX-SHOT-011–017、081 | 一个 Account Workspace、一份 RecordHeader |
| UX-005 / P1 | Student/Household 完整局部导航互相嵌套，长双语标题占据 task surface | StudentsWorkspace；UX-SHOT-028、031、090 | Student workspace + family context summary；跨记录链接 |
| UX-006 / P2 | Lead card claim/follow-up 与 release/reassign/history 同等权重 | LeadPoolWorkspace；UX-SHOT-047–052 | state-aware next action；治理放 More |
| UX-007 / P2 | Dashboard Launchpad、指标、Today Focus 等竞争首屏 | UX-SHOT-001–006 | My Today 优先，Launchpad secondary |
| UX-008 / P2 | Student Support Analytics 多种口径指标等权平铺 | StudentSuccessAnalytics；UX-SHOT-044 | Health/Risk/Goals/Interventions/Outcomes/Trend 分组 summary + drilldown |
| UX-009 / P2 | Contract 选中行与下方关联内容之间上下文弱 | UX-SHOT-055–061 | 强 selected row + compact selected context + local sections |
| UX-010 / P2 | 普通活动记录强制双语 summary 与 next step | activities route schema | 单语言内部记录为目标；必须先有领域输入契约调整，不能只隐藏字段 |
| UX-011 / P2 | 翻译 fallback 可直接返回 key，存在真实漏键路径 | I18nProvider；PipelinePage `common.notSet` | 本地化安全 fallback；词条完整性 gate |
| UX-012 / P3 | CSS 层叠与局部断点分散，功能文字层级不一致 | 八份 CSS、DataTable | 逐消费者迁移，不启动全 CSS rewrite |
| UX-013 / P3 | Imports 问题状态按钮窄列换行、technical codes 层级过高 | UX-SHOT-085 | closure 阶段局部改进；保留诊断 code 的可访问详情 |

P0 实施阻断条件：权限因导航扩大、重造 canonical mutation、把 accepted-save/failed-refresh 显示为保存失败、混淆财务/身份事实、公开私有截图。任何一个发生即停止相关 phase，不靠视觉验收放行。

正面参考：Opportunity Pipeline 的阶段、横向扫描和下一步（UX-SHOT-053）；Action Center 的分类、紧凑条目、优先级和 mobile 行为（UX-SHOT-077–079）。Products（062–068）和 Contracts 保留主体，不能因为资源概念不同而默认拆分。

## 4. Target Global IA

### 4.1 最终可见空间

```text
工作
  工作台 · 行动中心 · 我的任务 · 日历 · 待审批
  通信工作区（次级）
客户关系
  学校与机构 · 联系人
学生服务
  学生 · 家庭 · 项目参与 · 升学申请 · 学生支持 · 学年与升级
商业合作
  线索 · 商机 · 产品 · 合同 · 财务 · 渠道协议与返佣
  拓展活动（次级）
经营分析
  经营总览
  渠道分析 · 团队绩效 · 报告中心（次级）
运营治理
  导入 · 数据质量 · 重复记录审查 · 流程模板
  隐私请求 · 现有建议/自动化（次级，按各自权限）
管理
  现有 workspace / users / security / operations / recycle 管理
账户与帮助（utility，不增加业务 tab 层）
```

学生是独立业务概念；家庭是学生相关的关系与需求上下文。Contacts 的 canonical 目录也包含家长、学生或独立联系人，因此总入口使用“联系人”，关联机构的视图使用“机构联系人”；不以改名伪造组织关联。

“渠道协议与返佣”是现有 `/commissions` 的业务入口，不新建 Channel identity 或 Revenue backend。Workflow Templates 是业务配置，不属于每日学生处理步骤。Education Business 是次级跨记录工作台，相关能力优先出现在账户/家庭/学生的上下文内。

### 4.2 导航入口契约

`AUTH/RLS` 表示 authenticated access 加 owning repository 的 actor/visibility 检查；不表示所有角色能看所有记录。下表是可见性约束，不能替代服务器 route、RPC、RLS 或 row-level action gates。没有对应 capability 的现有页面不凭空发明 permission；管理类 entry 还保留实际角色约束。

| 用户标签 | Route | 可见 capability / guard | 主要受众 | 理由 |
|---|---|---|---|---|
| 工作台 | `/dashboard` | AUTH；各模块继续 capability-aware | 一线、管理 | 个人上下文和今日工作 |
| 行动中心 | `/action-center` | AUTH；signals 各自授权 | 一线、管理 | 跨领域可行动事项 |
| 我的任务 | `/tasks` | `tasks.view` | 操作人员 | 正式 Task，不另建任务引擎 |
| 日历 | `/calendar` | `calendar.view` | 操作人员 | 已有日程 |
| 待审批 | `/approvals` | `approvals.decide` | 审批者 | 将决策入口置于工作 |
| 通信 | `/messages` | `messages.view`；子视图另行授权 | 客服、顾问 | 沟通次级入口 |
| 学校与机构 | `/schools` | AUTH/RLS | 业务人员 | 账户关系目录 |
| 联系人 | `/people` | AUTH/RLS | 业务人员 | Person identity 及关联上下文 |
| 学生 | `/students` | `education.view` | 顾问、交付 | 一等学生身份入口 |
| 家庭 | `/households?tab=families` | `education.view` | 顾问、交付 | 使用明确现有 query，避免改写 bare route 语义 |
| 项目参与 | `/enrollments` | `education.view` | 交付、运营 | Enrollment lifecycle 队列 |
| 升学申请 | `/applications` | `education.view` | 升学顾问 | Application lifecycle |
| 学生支持 | `/student-success` | `education.view` | 支持人员、管理 | Cases/outcomes/analytics 的业务空间 |
| 学年与升级 | `/progression` | `progression.manage` | 授权教务 | 学年 progression，不等同 Enrollment |
| 线索 | `/leads` | `leads.view` | 销售 | 优先待处理线索 |
| 商机 | `/opportunities` | `opportunities.view` | 销售 | 保留阶段 Pipeline |
| 产品 | `/products` | AUTH/RLS；写入仍由 catalog/FX 权限控制 | 销售、运营 | 产品、批次和报价上下文 |
| 合同 | `/contracts` | `contracts.view` | 商务、财务 | 合同生命周期 |
| 财务 | `/finance` | `finance.view` | 财务 | canonical receivable/payment/refund |
| 渠道协议与返佣 | `/commissions` | `finance.view`；相关操作独立授权 | 渠道、财务 | 已有协议、规则、accrual、settlement |
| 拓展活动 | `/growth` | `leads.view` | 拓展人员 | 次级活动工作台 |
| 经营总览 | `/reports/executive` | `education.view`；金融/commission 各自限制 | 管理 | 跨域异常与决策 |
| 渠道分析 | `/reports/channels` | `education.view`；金额各自限制 | 渠道管理 | 已有渠道 read model |
| 团队绩效 | `/sales/performance` | AUTH/RLS；正式受限 read model | 销售管理 | 已有贡献和绩效 |
| 报告中心 | `/reports` | AUTH；报告目的地各自授权 | 管理、运营 | 次级报告发现 |
| 导入 | `/imports` | `imports.view` | 数据运营 | 已有 import/set engine |
| 数据质量 | `/data-quality` | `dataQuality.manage` | 数据治理 | 数据信号与修复 |
| 重复记录审查 | `/duplicates` | `duplicates.manage` | 数据治理 | 正式 review workflow |
| 流程模板 | `/workflow-templates` | `education.view`；管理 action 维持正式权限 | 业务配置人员 | 离开日常 Family tabs |
| 隐私请求 | `/privacy-requests` | 可见入口 `privacyRequests.manage`；服务器原规则 | 隐私处理人员 | 次级治理；个人请求保留账户入口 |
| 教育业务工作台 | `/education-business` | `education.view` | 跨记录运营人员 | SECONDARY；contextual quick actions 优先 |
| 现有智能建议 | `/ai` | `ai.review` | 已授权审核者 | 保留现有能力，不增加 inference fact |
| 现有自动化 | `/automation` | `automation.manage` | 配置人员 | 次级配置，不与 AI 权限互相替代 |
| 管理 | `/admin` | 现有 ADMIN/SUPER_ADMIN role gate + capabilities | 管理员 | 保留细粒度管理 |
| 账户与帮助 | `/settings/profile`, `/help` | AUTH；敏感设置仍有现有验证 | 当前用户 | utility |

分组只表示位置，不授予权限。无权 entry 省略；可见记录的只读页保留内容并解释只读，不铺满 disabled buttons。Sidebar 高亮使用真实目的地的空间，而非伪装成家庭页。Directory→Record 的返回链接保留 search/filter/sort/page/scroll；不同空间的 drilldown 明示目的地与当前 scope。

### 4.3 Route mapping 与深链接兼容

PRIMARY = 空间主要入口；SECONDARY = 次级工作区；CONTEXTUAL = 从拥有上下文的记录进入；DEEP_LINK = 保留 URL 不占常驻导航。表中的目标分组是呈现变化，所有 URL 先保留。

| Existing route / query | Future visible location | Status |
|---|---|---|
| `/dashboard` | 工作 / 工作台 | PRIMARY |
| `/action-center` | 工作 / 行动中心 | PRIMARY |
| `/tasks` | 工作 / 我的任务 | PRIMARY |
| `/tasks/[id]` | Task detail，返回原队列 | CONTEXTUAL |
| `/calendar` | 工作 / 日历 | PRIMARY |
| `/approvals` | 工作 / 待审批 | PRIMARY |
| `/messages` | 工作 / 通信 | SECONDARY |
| `/messages` bulk/templates/portal query views | 通信内现有授权目的地 | SECONDARY |
| `/notifications` | 全局通知 utility / 通信 | SECONDARY |
| `/guardian-portal` | 通信 / 家长门户管理 | SECONDARY |
| `/schools` | 客户关系 / 学校与机构 | PRIMARY |
| `/schools/[id]` | Account Workspace | CONTEXTUAL |
| `/people` | 客户关系 / 联系人 | PRIMARY |
| `/people/[id]` | Contact Workspace | CONTEXTUAL |
| `/students`，含 focus | 学生服务 / 学生与 Student Workspace | PRIMARY |
| `/households?tab=families`，含 focus | 学生服务 / 家庭与 Household Workspace | PRIMARY |
| `/households` bare / `?tab=students` | 保持当前学生视图；显示正确学生位置 | DEEP_LINK |
| `/households?focus=...` | 保持当前家庭解析；链接必须显式带 families tab | CONTEXTUAL |
| `/enrollments`，含 focus | 学生服务 / 项目参与 | PRIMARY |
| `/applications`，含 focus | 学生服务 / 升学申请 | PRIMARY |
| `/student-success` cases/analytics/outcomes/focus | 学生服务 / 学生支持 | PRIMARY |
| `/progression` | 学生服务 / 学年与升级 | PRIMARY |
| `/workflow-templates` | 运营治理 / 流程模板 | PRIMARY |
| `/education-business` | 跨记录教育业务工作台 | SECONDARY |
| `/education-business` Organization/Household/Student scope | 对应 record 的上下文 action | CONTEXTUAL |
| `/leads` | 商业合作 / 线索 | PRIMARY |
| `/growth` | 商业合作 / 拓展活动 | SECONDARY |
| `/opportunities` | 商业合作 / 商机 | PRIMARY |
| `/products`；当前 product/cohort/bundle/FX states | 商业合作 / 产品，保留现有局部结构 | PRIMARY |
| `/contracts`，含 selected/focus states | 商业合作 / 合同 | PRIMARY |
| `/finance` | 商业合作 / 财务 | PRIMARY |
| `/commissions` | 商业合作 / 渠道协议与返佣 | PRIMARY |
| `/sales/performance` | 经营分析 / 团队绩效 | SECONDARY |
| `/sales/allocation` | 团队绩效 / 授权贡献分配 | CONTEXTUAL |
| `/reports/executive` | 经营分析 / 经营总览 | PRIMARY |
| `/reports/executive/attention` | 总览 / 管理异常 drilldown | CONTEXTUAL |
| `/reports/channels` | 经营分析 / 渠道分析 | SECONDARY |
| `/reports` | 经营分析 / 报告中心 | SECONDARY |
| `/reports/marketing` | 报告中心 / 现有营销报告导出 | SECONDARY |
| `/analytics/consumption` | 报告中心 / 使用与消费分析 | SECONDARY |
| `/reports/exports` | 报告中心 / 已审批导出 | SECONDARY |
| `/imports`，含现有 Import Set state | 运营治理 / 导入 | PRIMARY |
| `/data-quality` | 运营治理 / 数据质量 | PRIMARY |
| `/duplicates` | 运营治理 / 重复记录审查 | PRIMARY |
| `/privacy-requests` | 运营治理 / 隐私请求 | SECONDARY |
| `/ai` | 运营治理 / 现有建议审核 | SECONDARY |
| `/automation` | 运营治理 / 现有自动化配置 | SECONDARY |
| `/admin` | 管理 / 总览 | PRIMARY |
| `/admin/approvals` | 管理 / 现有审批管理 | SECONDARY |
| `/admin/operations` | 管理 / 运行管理 | SECONDARY |
| `/admin/workspace` | 管理 / 工作区设置 | SECONDARY |
| `/admin/users` | 管理 / 用户 | SECONDARY |
| `/admin/recycle-bin` | 管理 / 回收站，保留 SUPER_ADMIN 限制 | SECONDARY |
| `/admin/security` | 管理 / 安全 | SECONDARY |
| `/settings/profile` | 账户 / 资料 | SECONDARY |
| `/settings/account` | 账户 / 账户信息 | SECONDARY |
| `/settings/security` | 账户 / 安全 | SECONDARY |
| `/settings/notifications` | 账户 / 通知偏好 | SECONDARY |
| `/settings/privacy` | 账户 / 个人隐私 | SECONDARY |
| `/help` | utility / 帮助 | SECONDARY |

Authentication、legal 及 invite/外部门户 URL 保留原认证/邀请边界，不并入内部 CRM 全局导航。没有 Phase 0 redirect。若后续统一 bare `/households` 到 `/students`，必须单独迁移 query 语义并测试 focus ID 的类型，不能将 Student ID 当 Household ID；现有带 `tab=families` 的链接永久可用。焦点记录转为 workspace 时仍接受原 focus 深链接，不要求立即新增 record route。

## 5. 页面 archetypes

所有 archetype 遵循一项 dominant primary action；次级操作用普通按钮/链接；管理操作用 More；destructive action 分离并确认。

| Archetype | 目的与必需区域 | Action hierarchy | Desktop | Mobile | Load / empty / error |
|---|---|---|---|---|---|
| Command Center | My Today、Attention、Business Snapshot、Quick Navigation | 当前最重要任务；quick launch 次级 | 今日与关注并列；summary 下置 | 今日→关注→snapshot→quick launch | 分区 skeleton；无任务说明原因及任务入口；模块失败独立 retry |
| Queue | priority、owner、age、state、next action | 每行一个下一步；治理 More | 紧凑 rows/cards；可见关键状态 | search/primary filter + sheet；行动直接可见 | ready/blocked/review 区分；filtered-empty 提供 reset；保留成功加载区 |
| Directory | identity、essential filters、sort、records、pagination | create（若有权限）；记录打开次级 | full-width table 与 priority columns | 紧凑 record rows/卡片，advanced sheet | 初载骨架；零记录与无匹配分开；retry 不清空 filter |
| Record Workspace | 一个 identity header、critical context、next action、local nav、related facts、activity | 上下文下一步；edit 次级 | main + attention/context rail | compact header + 主要上下文；local nav 可滚动 | identity 与模块可分加载；相关域失败不抹掉主记录；无关项有 contextual create |
| Lifecycle Workspace | state、blocker、next required action、linked subjects、history/evidence | 允许的 lifecycle transition；metadata edit 次级 | record context persistent + main workflow | 先state/blocker/action，history 后置 | pending 不冒充成功；已接受 mutation 的 refresh failure 独立提示；无关联事实不可推断 |
| Management Dashboard | Attention、Changes、KPIs、domain summaries、drilldown | investigate / decision destination；scope 次级 | 横向指标与异常 summary，按域按需展开 | exception→key change→KPIs→domain summaries | restricted/zero/unavailable 分开；每域失败独立；时间范围与口径一直可识别 |
| Operations / Configuration | task status、scope、step/progress、review/result、safe diagnostics | 当前可执行步骤；管理配置次级 | 工作步骤 + compact reference/context | 当前步骤优先，高级控件 sheet | uploaded≠imported；partial failure 显式；错误 code 在详情可复制，不作为主文案 |

WorkspaceNav 负责跨路由工作空间；Record Local Navigation 负责当前记录内内容；Global sidebar 负责稳定产品空间。正常页面最多两个可见业务导航层，包括 sidebar。Record 页不再同时展示 family/report workspace tab strip 和 record tabs。局部筛选或 section disclosure 不是第三层导航；不能把第三层 tabs 改名后保留。

## 6. Responsive、视觉与 interaction contract

| Tier | 可用宽度 | 结构 |
|---|---|---|
| EXPANSIVE | 1600px+；1920×1080 主验收 | 使用完整工作宽度；main/context rail、多列 summary、大表格；form 自身受读写宽度限制 |
| STANDARD DESKTOP | 1024–1599px；1440×900 | 同样的任务顺序；次要 rail 可折叠，减少列；不能依赖 1920 才能找到 action |
| COMPACT / TABLET | 680–1023px | sidebar 收起；secondary panels 按需展开；table priority columns；双列能读才保留 |
| MOBILE | <680px；375×812 | progressive disclosure、短身份头、full-screen task、filters sheet；结果优先 |

这些是目标 behavior tiers，不要求一次重写所有旧断点。沿用现有 680px mobile 约定；新增 shared primitives 用 1024/1600 统一行为；旧组件 900/1100 等局部规则在迁移消费者时删除或说明。测试 width 指 viewport，grid 根据扣除 sidebar 后的可用宽度决定是否并列。

### 6.1 Width、filter 与身份

- CRM canvas 不设全局 1200px max-width。Tables、Pipeline、Finance、Management 使用有效宽度；叙述内容约 70–76ch，编辑 field/group 有合理宽度，不扩展到整个 1600px。
- Directory/Queue mobile：search → 最多两个主要筛选（该域选择）→ `筛选 · N`；advanced filters 在 drawer/sheet。主要筛选可并列或 compact chip，不能每项都强制整行。当前 active filters 摘要及 clear 可见；N 是活跃条件数，不能重复算 primary filter；draft sheet apply/cancel 不改变结果直到提交。
- Organization primary filters 为 status/owner；commercial tier、potential、key-contact 等在 advanced。Lead primary 为 pool/mine scope 与 stage；owner/age/source/commercial qualification 为 advanced。权限决定可见 scope。Student primary 为 academic year/status；家庭成员检索及其他条件按实际查询能力提供。
- 在有至少一个匹配记录、无 initial error 的默认 375 状态，第一条记录起始应在首屏出现。极端系统告警或必须先选 scope 才能查询属于有理由例外，不用于放弃普通目录验收。
- Identity 主行使用当前 locale 名称，另一语言为低权重 secondary text；缺一语言使用已存在的规范化名称，无 AI 翻译，不修改 canonical 身份。重复相同规范化名称只显示一次；长名称正常换行，不能挤走 primary action。

### 6.2 Typography、surface、tables

| Role | Target |
|---|---|
| Page title | 24–30px；mobile 可取较小端 |
| Section title | 16–20px |
| Functional body / table primary / buttons | 13–14px 目标最低层级 |
| Metadata / eyebrow | 12px；不能承担主要操作指令 |

Surface 0 是 canvas；1 是 primary workspace；2 是平面 section/divider 或低强调操作卡；3 是需要关注/交互的 detail/exception。不是四层 card 嵌套。独立可行动对象才用 card；字段组用 definition list/row/divider。Status color 含义保留且有文本，不只靠颜色。

Desktop 保留真正 table 及排序语义；mobile 每域指定 priority-column view、compact record row 或 card。Column disclosure 显示遗漏字段，不能把全部数据缩成小字。必要横向滚动只留在明确表格容器，不造成页面整体 overflow。

### 6.3 Drawers、loading 与错误

Create/edit/短详情可用 drawer；需要多域、多 tabs、长 history 的记录进入 workspace page。Mobile drawer 是 full-screen task，compact sticky title/back/close、visible primary action，form 底部不被 sticky footer 遮挡。Nested drawer 是例外；mobile 优先替换 task surface 并可返回未丢失的上一步 draft。保留现有 focus registry、confirmation 与 Escape pending 策略。

Initial load 用区域 skeleton；background refresh 保留数据并标示刷新；mutation pending 禁止重复提交；partial module unavailable 保留其他域。Filter scope 变化时不能把旧数据冒充新 scope，可以保留标明旧 scope 的数据直到新结果到达，或用现有隔离 skeleton。

Accepted mutation + failed refresh 提示“已保存，最新显示暂未加载；刷新”，保留 receipt/record identity；不显示“保存失败”，不重提 create。真正失败保持 draft 并提供 safe retry。STALE_TARGET 不静默覆盖；明确重新读取与复核。Empty 说明“无记录”或“筛选无匹配”，给合适 create/reset。Error 给人类解释、下一步和 safe request reference，不打印 SQL、stack、filesystem、hidden identity。

## 7. 核心工作流程与领域 ownership

| User task | 用户可见连续结构 | 正式 owner / 边界 |
|---|---|---|
| 从账户跟进到商机 | Account next action → activity/task → existing opportunity create/editor | Organization、Activity/Task、Opportunity 各自 mutation；不是新 account backend |
| 合同与产品 | Account context → Contract draft，选择既有 Product/Cohort → 回到 account summary | Product≠Cohort；Contract≠Enrollment；既有 Contract editor 和 revision/approval |
| 学生服务 | Student identity → family context → enrollment/application/support link → lifecycle workspace | Student 由 Contact identity；Household relation、guardian authorization、Enrollment、Application、Support 各自所有权 |
| 交付状态 | Enrollment state/blocker → 正式 allowed transition → history | 不从 Cohort date 或 Support outcome 自动推进 Enrollment |
| 经营调查 | exception → canonical scope drilldown → record/queue | 只消费已有 management read model；不在浏览器重算领域事实 |
| 数据运营 | Import progress → review/repair/execute → guarded rollback | 复用原 import engine；set 不是跨文件 ACID |

Organization/Contact 继续 `createCrmRecord` / `updateCrmRecord` 的 canonical adapters；Student 继续 `createStudent` / `updateStudent`；education profile/context action 继续 `save_education_business`；Cohort/Enrollment 继续 `save_product_cohort` / `save_student_enrollment`。Finance、Contract、Task、relation 原 API、revision、maker-checker、request keys/receipts、RLS 全部保留。UI context prefill 只是候选显式选择，服务器重新授权，不能按名称猜 identity。

### 7.1 Progressive enrichment

| Create | Minimum viable input（当前实际约束） | 后续 enrichment |
|---|---|---|
| Organization | 至少一语言名称、city；organization type/classification 明确可见，已有合法默认 affiliation | website/address、curriculum、规模、结构叙述、商业 profile；parent 使用授权引用 |
| Contact | 至少一语言名称 + email 或 phone；需要时明确 Organization association/contact type | title、communication level、tags、decision role、acquisition、notes、follow-up |
| Student | 授权选择既有 Contact personId、grade、academicYear；按正式规则可选 household | birth date、strengths、interests、expectations、support needs、learning style |

名称实际由 `bilingualSchema` 至少一语言校验与规范化，不能要求用户手动填两份相同 identity。Contact minimum 不以只填 WeChat 绕过目前 email/phone 条件；Student 不在 students 表制造第二份名字。Duplicate check 保留。最小 create 应能在一个短 task 中完成，不强制无必要的 wizard。

Enrichment 是同一记录的后续正式 edit，不是另一套 store。Full-input wrapper 的 update 必须保留未编辑值，不能因 progressive form 少字段就让 defaults 重置数据；使用现有 authorized snapshot/revision 合成完整 input。

普通内部 Activity 的目标是只要求一个有效语言的 summary 和 next step，另一语言可选；对外必须双语的 artifact 仍按业务要求。目前 API 四个字段都 min(2)，Phase 0 不变更。未来只有在明确迁移 API/domain validator、显示 fallback、旧记录兼容和回归之后才能放宽；没有预算时保留现状并说明必填，不填虚假翻译或复制文本假装第二语言。

## 8. Top 5 redesign contracts

### 8.1 Executive Overview — 最高优先级

回答顺序是 attention、what changed、key KPIs、domain investigation、drilldown。1920 的 first viewport 应同时可见实质异常、关键变化和 KPI，而不是完整筛选表单。Compact scope 包含 period、Product/Cohort 与 More；只有 server contract 支持的 scope 才开放，显示“哪些模块不受此筛选影响”。

```text
┌ Sidebar ┬ Executive Overview                         [Refresh] ┐
│ Analysis│ Period ▾  Product ▾  Cohort ▾  [More filters]         │
│         │ As-of · workspace timezone · scope limitations       │
│         ├──────────────────────────────┬───────────────────────┤
│         │ Attention / management       │ Period changes        │
│         │ reason · impact · investigate│ eligible PERIOD facts │
│         ├──────────────────────────────┴───────────────────────┤
│         │ Key KPI strip · snapshot/date/currency labels         │
│         ├──────────────────────┬───────────────────────────────┤
│         │ Commercial summary   │ Delivery summary              │
│         │ Finance summary      │ Channel summary               │
│         │ Admissions summary   │ Student Support summary       │
│         │ [Inspect domain]     │ [Inspect domain]              │
│         └──────────────────────┴───────────────────────────────┘
```

1440 保持顺序，attention/changes 可缩列，domain detail 默认闭合；mobile 是 compact scope → attention → period changes → key KPIs → domain summaries → quality/details。更多筛选是 sheet。

Attention 引用已有 management attention reasons/route，不创建第二任务引擎。Action Center 是执行者自己的跨域事项；Executive Attention 是管理视角异常、影响与调查决定。可指向同一 canonical record，但不得把重叠 signal count 合计成独立“待办总数”。

默认 KPI 选择现有 open opportunities、active enrollments、support risks，以及分币种财务事实；每项注明 SNAPSHOT 或 PERIOD。Changes 使用 `management-trend-contract` / 已有 trends read model：只为可比较的 PERIOD 指标显示 previous/absolute/percent。没有 historical-as-of 的 SNAPSHOT 不伪造变化；零 previous 的 percentage 按 canonical null 说明；不可比较显示解释，不显示 0%。金融权限、commission money restriction、shared Contract count-once/unallocated 和不同币种分列不变。

六个 domain 默认 summary + disclosure/drilldown；drilldown 使用现有正式匹配能力，若无精确 scoped destination 就明确“打开工作区”，不能标成匹配记录。Unavailable、restricted、真实零值三者不同。Student Support Analytics 使用同 archetype：Health/Risk→Goals→Interventions→Outcomes→Trend；原分母、period/snapshot/cohort scopes 不合并。

### 8.2 Student / Family Lifecycle

```text
┌ Global: Student Lifecycle ┬ Students                            ┐
│ Students                  │ Search   Year ▾ Status ▾ [Filters N]│
│ Families                  │ Student / grade / parent / next step│
│ Enrollments               │ Student A →                         │
│ Applications              ├─────────────────────────────────────┤
│ Student Support           │ Student workspace (focus URL)       │
│ Academic Progression      │ Primary identity                    │
│                           │ grade · year · owner · next action  │
│                           │ Profile | Family | Journey | Academic│
│                           ├─────────────────────┬───────────────┤
│                           │ current panel       │ attention     │
│                           │ linked enrollment  │ explicit next │
│                           │ application/support│ required step │
└───────────────────────────┴─────────────────────┴───────────────┘
```

Student is visible in global navigation; record local navigation replaces the directory workspace strip. Family panel renders contextual member rows with explicit relationship, short profile summary and links, not a complete embedded Household tab system. Parent/Student search result badges use stored relationship facts; membership role GUARDIAN alone does not imply legal authority, and PARENT without a specific father/mother fact must not be guessed as either.

Journey groups participation, Enrollment, Applications and Support as linked facts with their own status and actions. It does not merge their lifecycle or create a fake universal student state. A Household Workspace shows household identity, actual members, needs and contextual children, retaining each child's separate participation records. A long focused Student/Household record uses a page; a short edit uses the existing drawer.

Mobile: Student identity → current grade/year/next action → single local nav → current panel → related summary. Family member edit opens one short task; Back restores Student panel, draft/filter context. Enrollment/Application/Support details prioritize current state/blocker/allowed action before history. Academic progression keeps the current annual rule and manual correction; Phase 0 proposes no scheduler change.

### 8.3 Organization Account Workspace

```text
┌ Account: Example Education Organization                 [Edit] ┐
│ alternate-language identity (secondary)                        │
│ Owner · relationship/commercial status · last interaction       │
│ Next action                                         [Follow up]│
├────────────────────────────────────────────────────────────────┤
│ Overview | People | Opportunities | Contracts & Products        │
│ Channels & Outreach | Activity                                 │
├─────────────────────────────────────┬──────────────────────────┤
│ Business context / current panel    │ Attention / key contacts │
│ Open opportunity / active contract  │ Next step / data quality │
│ Contextual existing editor action   │ Links with destination   │
└─────────────────────────────────────┴──────────────────────────┘
```

One primary RecordHeader; no repeated account title in quick summary or operational panel. Owner, current commercial relationship, explicit next action, last interaction, open opportunities, active contracts and key-contact coverage are actionable context. Completeness remains a secondary data-quality signal with explanation, not primary account business status. Missing fields display “未记录”，not a fabricated next action.

People uses existing Contact create/edit and formally authorized association; Opportunities uses current editor; Contracts & Products uses existing Contract/Product editors with explicit selected account, not a second backend. Channels & Outreach brings current education profile, events/referrals and commercial relationship views into context; each fact retains canonical permission/ownership. Privacy/history administrative access remains available via appropriate More/Activity sections, not removed to achieve six tabs.

Desktop main/context rail uses width without stretching prose; 1440 can collapse rail; mobile one locale identity, summary before tabs, current panel first, attention disclosure. Choosing an action returns to the same account/panel with accepted-save status even if refresh fails.

### 8.4 Lead Pool → Work Queue

```text
┌ Lead queue                         [Create lead, if permitted] ┐
│ Pool / Mine / All ▾  Stage ▾  Search                 [Filters N]│
├────────────────────────────────────────────────────────────────┤
│ Lead / organization                        stage · age          │
│ Owner · latest activity · qualification signal                  │
│ Next action text                         [Primary action] [⋯]   │
│ More: release / reassign / visibility / assignment history       │
└────────────────────────────────────────────────────────────────┘

Mobile:
┌ Search ─────────────────────────────────┐
│ Scope ▾  Stage ▾             [Filters N]│
│ Lead identity · stage                   │
│ Owner · age · next action               │
│ [Primary action]                    [⋯]│
└─────────────────────────────────────────┘
```

Primary action is selected from already permitted actions and current state: eligible unowned pool lead → Claim; owned active lead → Follow up; qualified lead with permission → Create opportunity; converted lead → existing opportunity/account link. If no next action is authorized, render read-only context instead. State/ownership must be current; presentation priority cannot make forbidden Claim or reassignment available.

Release/reassign/visibility/history are lower-frequency More entries with original gates and confirmations. Filters split primary scope/stage/search from advanced owner/age/source/qualification. Long names have locale hierarchy, qualification is a signal rather than a wall of equal dl fields. Preserve current expectedRevision/requestKey, uncertain retry and payload-bound receipt contracts.

### 8.5 Dashboard — refinement

```text
┌ Dashboard                 [Daily | Management] remembered      ┐
│ My Today / next tasks                 │ Attention               │
│ business action + current context     │ categorized signals     │
├───────────────────────────────────────┴────────────────────────┤
│ Business Snapshot · existing capability-aware facts             │
├────────────────────────────────────────────────────────────────┤
│ Quick Navigation / existing Workflow Launchpad (secondary)      │
│ Operations Snapshot / additional context                        │
└────────────────────────────────────────────────────────────────┘
```

Keep existing elements, palette and density. My Today is personal task context; Action Center is the canonical cross-domain exception queue; Dashboard shows a bounded summary with link rather than another full queue. Launchpad is secondary quick launch, not an equal competing task engine. Management mode provides a compact management summary and Executive link, not a copy of the entire Executive report.

Daily and Management remain equally legitimate; show one at a time. Remember explicit user choice in an account-scoped browser preference; absent preference use existing permitted role/capability-aware default. Do not add profile schema solely for this choice. Neither role nor remembered choice grants extra access. Mobile puts current focus/attention above navigation tiles. Retain globally available search and existing saved views.

## 9. Shared components 与 CSS 策略

| Existing | Decision | Contract |
|---|---|---|
| AppShell | Evolve | stable spaces、capability visibility、accurate active location；retain auth/settings/global search |
| WorkspaceTabs | Evolve into WorkspaceNav | route links + aria-current；used only when global destination cannot directly express subspace |
| DetailTabs | Keep/evolve | genuine same-record panels；keyboard/ARIA preserved；not route tabs |
| SearchFilterBar | Evolve | explicit primary/advanced grouping + active state；no duplicate query engine |
| AccessibleDrawer / ConfirmDialog | Keep | reuse modal registry/focus/unsaved guard；mobile task layout added on top |
| DataTable | Evolve | full-width desktop、locale identity、priority columns/mobile record view；preserve sorting/select/pagination |
| StatusBadge / ProgressBar | Keep | canonical label mapping、safe unknown fallback；accessible status/values |
| adhoc page heading / quick summary | Merge presentation into shared headers | single identity, business context priority；quality secondary |
| adhoc Surface nesting | Evolve/retire redundant wrappers | 0–3 hierarchy；section/divider preferred |

| Candidate | Required responsibility | Avoid |
|---|---|---|
| RecordHeader | identity, business context, primary action, locale hierarchy | fetching/mutating another domain |
| WorkspaceNav | route destination/current/return semantics | duplicating DetailTabs role=tab |
| FilterBar + FilterDrawer | semantic groups, draft/apply/reset, active N | second server filter implementation |
| QueueItem + MoreActions | scan hierarchy + permitted next action | deciding authorization or auto transitions |
| MetricStrip | value, currency, mode, date, safe optional comparison | KPI recomputation or mixed-currency sum |
| AttentionPanel | prioritized reasons + explicit drilldown | new task/signal engine or false unique count |
| ResponsiveDetailLayout | main/context placement across tiers | global narrow max-width |
| MobileTaskHeader | compact title/back/pending/primary action | replacing modal focus/guard machinery |
| SectionHeader | title, scope/help, secondary actions | every section as a new card |

These are presentation primitives, not new canonical stores or services. Implement only primitives with an identified consumer; re-use current ActionDisclosure/menu behavior where appropriate rather than inventing another popover implementation.

| CSS file | Current responsibility / consolidation disposition |
|---|---|
| `app/globals.css` | tokens、shell、base tables/forms；keep foundation, extract migrated layout rules gradually |
| `app/v200.css` | historical product/detail extensions；remove only obsolete migrated selectors |
| `app/v220.css` | historical workspace/domain refinements；retain unaffected domains |
| `app/v220-quality.css` | quality workspace；lower-priority migration |
| `app/v220-operations.css` | operations/admin；preserve capability/state styling |
| `app/v270.css` | latest product behavior/presentation fixes；carry forward save/context semantics |
| `app/ui-system.css` | common headings/tabs/forms/detail styles；consolidation home for shared semantic rules |
| `app/workflow-experience.css` | launchpad/filter/commercial/account workflow layouts；migrate per redesigned consumer |

`app/layout.tsx` currently imports those files in that order. Freeze unaffected cascade behavior; add named shared primitives, migrate one consumer, then remove its superseded overrides. Do not add an ever-growing override file as the only strategy; do not require full CSS consolidation before the first UX phase. A stylesheet reordering needs affected-browser evidence, not cosmetic cleanup.

## 10. Terminology 与 fallback defect inventory

### 10.1 UI language policy

| Concept | zh-CN preferred | English | Meaning boundary |
|---|---|---|---|
| Enrollment | 项目参与 / 项目参与记录 | Enrollment | 与学年学籍、Application 分开 |
| Application | 升学申请；通用 context 可用申请 | Application | 不是 Admission milestone |
| Case | 支持个案 | Support case | 不显示未解释的 Case token |
| Playbook / Workflow Template | 流程模板（按实际对象） | Workflow template | 不暗示新自动执行引擎 |
| Import Set | 联合导入任务 | Import set | 有界依赖编排，不是全文件事务 |
| Pipeline | 商机看板 | Opportunity pipeline | 现有阶段模型 |
| Student Success | 学生支持 | Student support | Support completion 不推导 enrollment/revenue |

中文功能标签使用业务中文，英文保留英文语境；技术 code 仅在可展开诊断中保留。若两个 canonical objects 名称相近，help 解释关系，不能靠同一中文名掩盖差异。

### 10.2 当前缺陷及证据置信度

| ID | Route / component | Current output or risk | Evidence class | Desired rule |
|---|---|---|---|---|
| TERM-001 | `/opportunities` / PipelinePage | 缺 close date 时 `t("common.notSet")`；两份字典缺该 key | CODE_CONFIRMED | 人类可读“未设置 / Not set” |
| TERM-002 | I18nProvider、使用者 | `messages[key] ?? key` 会让遗漏词条显示 translation path | CODE_CONFIRMED fallback mechanism | fallback locale→安全预定义文字；开发测试记录 key，不 echo private values |
| TERM-003 | `/student-success` analytics | `String(row[key])` 对缺字段可能显示 `undefined` | CODE_CONFIRMED sink；UX-SHOT-044 的缺值是 mocked evidence，未证明真实 DB 返回缺字段 | required schema missing→模块 unavailable；optional→未记录；真实零值保留 |
| TERM-004 | Organization list / DataTable | UX-SHOT-009 的 `crm.status.AT_RISK` | FIXTURE_ONLY；Org 实际 status 为 RISK，不能定性为合法生产状态漏译 | fixture 用真实 enum；未知状态安全中性 label，不伪装为 valid/zero |
| TERM-005 | `/action-center` | UX-SHOT-077 的 `actionCenter.item.quality` | FIXTURE_ONLY；当前 repository producer 没有该类型 | 修复未来 synthetic fixture；production keys 以 producer allowlist 检验 |
| TERM-006 | `/leads` / LeadPoolWorkspace | source freeform 值直接显示，已知 code 可能成为业务标签 | CODE_CONFIRMED presentation | 已知来源映射标签；用户文字保留；未知不 fuzzy 推断 |
| TERM-007 | `/imports` problem state | code/location/reason 如 duplicate evidence code 与正文并列 | SCREENSHOT + CODE_CONFIRMED | 人类解释在前，code/location 在详情供诊断 |
| TERM-008 | Executive/analytics labels | Enrollment、Case、AT_RISK 等术语混在中文业务文案 | SCREENSHOT + dictionary review | 统一术语字典和风险状态业务标签，保留正式口径 |

静态 literal 检查不能把 `channel.filter.`、`channel.option.`、`experience.` 的动态拼接前缀当成缺失完整 key。Action Center 实际 producer keys 已有词条；不能以虚构截图类型要求新增真实 signal。

UI 不主动展示 `translation.key.path`、`undefined`、`null`、`[object Object]`。Unknown enum 用“未知状态”及安全 neutral styling；missing optional fact 用“未记录”；invalid required response 用 unavailable/error。安全 fallback 不吞掉校验失败，不把 restricted/null 当零，不修改 canonical enum。任何 schema错误仍可在私有诊断或 safe request reference 下定位。

## 11. Acceptance、accessibility 与状态约束

| Surface | 可观察成功条件 |
|---|---|
| Executive 1920 | first viewport 有 attention、可比较 change 与关键 KPI；scope compact；默认不展开六份完整报告 |
| Student | sidebar 准确定位学生服务；Students 有直接入口；student record 不需要知道家庭导航才能打开 |
| Organization | 一个 primary identity header；业务状态/next action 可识别；各编辑回到当前 account context |
| Directory/Lead mobile | 正常有数据状态 first record 起始可见；advanced filters 不默认铺满首屏 |
| Lead item | 一个 visually dominant permitted next action；治理 More；只读没有 disabled-control graveyard |
| Record local nav | 最多两个可见业务导航层；family context 不嵌套另一完整 record nav |
| Identity stress | 长虚构双语机构/学生/产品名不覆盖 actions；alternate identity 降级；无 page overflow |
| Save | accepted mutation/refresh failure 不诱导重复 create；revision conflict 不覆盖用户更新 |
| Management | restricted/zero/unavailable 可区别；SNAPSHOT 不显示伪趋势；currency 不合计 |

Keyboard、focus-visible、skip link、focus trap/restore、Escape、modal nesting、mobile nav、ARIA current/tab semantics、form labels、reduced motion 均为必需。Touch targets 对 mobile 可操作元素保持适宜触达面积，紧凑视觉不以缩小 hit area 实现。Route nav 使用 links；同页 tabs 使用 tabs；不为视觉一致破坏语义。

没有 UX 数值评分，也不以页面更短作为正确性的唯一标准。验收依据任务可发现、上下文保留、业务事实正确和已指定 viewport 的可观察行为。

## 12. Frozen boundaries 与 deferred

```text
Organization ≠ Opportunity
Product ≠ Cohort
Student ≠ Enrollment
Enrollment ≠ Application
Application ≠ Admission Milestone
Referral ≠ Enrollment
Event Participation ≠ Enrollment
Contract ≠ Enrollment
Contract ≠ Payment
Receivable ≠ Payment
Channel Agreement ≠ Commission Accrual
Enrollment completed ≠ Student Success completed
AI inference ≠ business fact
```

其他约束：Organization≠Contact；Household Member≠Guardian Authorization；名字/邮箱/电话不是 identity match；Product Price/Contracted/Receivable/Collected 不是 Revenue。Context unification 不是 canonical ownership 合并。

Revenue — **DEFERRED / UNTOUCHED**；无 policy approval、ledger、posting、attribution、migration。Global search grouped results/recent records 为后续候选，保留当前能力，不进入首轮优先重构。Products/Bundles/FX 拆分、Contract 全面重建、AI translation、forecast、new business fields、full CSS rewrite 均不批准。Phase 0 没有 runtime、API、worker、DB 或 version change，也没有 commit/push/deploy/Production access。

## 13. Phase 0 verification boundary

执行 public privacy regression、migration verification、whitespace 与两份文档结构/route coverage 检查；核对 Revenue candidates 和全部 migration 的 opening fingerprints，版本/HEAD/staging 保持不变。文档新增不需要 typecheck、build、PostgreSQL 或新 browser QA；这些在各实施阶段按受影响范围执行。私有验证结果保存在 ignored `work/`，不作为 public CI raw artifact。
