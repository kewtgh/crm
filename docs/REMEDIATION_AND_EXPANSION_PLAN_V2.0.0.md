# Lumina Education CRM v2.0.0 完整改造与扩展计划

- 计划日期：2026-07-19
- 审计输入：`AUDIT_2026-07-19_CHROMIUM_1228.md`
- 产品基线：恢复 `planning-source/education-intelligent-crm-planning-v1` 的教育 CRM 核心范围
- 状态：`[ ]` 未开始，`[~]` 进行中，`[x]` 完成，`[!]` 需要生产环境所有者

## 完成定义

“完成”要求源码、数据库迁移、RLS/权限、双语 UI、错误/空/加载状态、自动化、
Chromium 1228 桌面与移动 QA、运维文档同步完成。没有真实生产凭据时，仓库功能必须
fail closed 并显示明确待配置状态，不得以本地测试值伪装生产完成。

## Phase 0：证据与发布阻断

- [x] P0-01 保存真实 Chromium 审计并废止旧的“无缺陷”结论。
- [x] P0-02 保存本完整计划和可追踪验收标准。
- [x] P0-03 拆分保存视图的共享 schema 与服务端仓库，消除浏览器中的服务端依赖。
- [x] P0-04 修复/规避 Vinext Windows 静态资源路径缺陷。
- [x] P0-05 release gate 解析 HTML 并验证全部本地 CSS/JS 的 200、MIME 和非 HTML 响应。
- [x] P0-06 增加 `ms-playwright/chromium-1228` 隔离 UI audit，验证水合、console/page error、
  1440/1024/375、中文/英文、键盘、权限和横向溢出。
- [x] P0-07 readiness 输出托管环境、六 worker、队列与可选集成的可执行修复说明。
- [!] P0-08 在 Sites 配置真实生产环境变量、迁移和 worker 调度，readiness 达到 200。

## Phase 1：权限、安全、错误和数据正确性

- [x] SEC-01 建立客户端安全的 capability 矩阵，统一导航、按钮、页面和服务端 API 能力。
- [x] SEC-02 将 SUPER_ADMIN、ADMIN、SALES_DIRECTOR、SALES_MANAGER 敏感操作与 MFA/AAL2
  引导、API 和数据库策略对齐。
- [x] SEC-03 为禁止能力提供可本地化的权限解释，不依赖失败后猜测。
- [x] ERR-01 建立统一 API 错误呈现器，保留字段、错误码、冲突、MFA 和 request ID。
- [x] VALID-01 所有动态 UUID 路由使用统一解析并返回 400/404，而不是上游 500。
- [x] DATA-01 新增数据库端产品/收入精确聚合，消除 1000 行截断和币种遗漏。
- [x] DATA-02 财务 UI 按币种显示，基础币种折算必须引用持久汇率快照。
- [x] OPS-01 提供受保护的 worker 周期入口或平台计划触发器，并保持幂等租约与心跳。

## Phase 2：UI/UX、可访问性和性能

- [x] UI-01 Turnstile 提供加载、超时、失败、重试和无障碍 live 状态。
- [x] UI-02 修复移动财务摘要裁切，窄屏使用 2×2/单列，不隐藏关键值。
- [x] UI-03 修复登录标题中文断行和安全验证空白布局。
- [x] A11Y-01 正文字号不低于 12px，关键说明不低于可读阈值；移除 8–10px 功能文字。
- [x] A11Y-02 所有普通文字达到 4.5:1，大字达到 3:1；状态不能仅依靠颜色。
- [x] A11Y-03 触控目标优先达到 44×44，最低满足 WCAG 2.2 24×24 例外规则。
- [x] A11Y-04 使用 Chromium 检查标题层级、名称/标签、焦点、菜单、抽屉和键盘路径。
- [x] PERF-01 客户端只加载当前语言字典，切换时按需加载另一语言。
- [x] PERF-02 清理失效 locale 文案，并将 v2、窄屏和 WCAG 收口规则拆至 `app/v200.css`。

## Phase 3：隐私、导入和导出闭环

- [x] PRIV-01 新增数据主体请求表、状态机、身份复核、截止日期和审计。
- [x] PRIV-02 账户隐私页支持访问、导出、更正、限制处理和删除请求。
- [x] PRIV-03 管理员具备最小权限处理队列；导出/删除继续走审批与异步任务。
- [x] IMP-01 CSV 上限提升至 10,000 行，预检结果进入持久、分块和可恢复批次。
- [x] IMP-02 支持 XLSX、模板下载、字段映射保存和逐行错误修复。
- [x] EXP-01 generated jobs 支持 CSV、XLSX 和 PDF，文件保存在 private storage。
- [x] EXP-02 报告页按能力提供学校、学生、家庭、销售和财务输出。

## Phase 4：学生、家庭、学籍和 Lead

- [x] EDU-01 新增 households、household_members、students、student_guardian_relationships。
- [x] EDU-02 学生身份复用 Person，学术记录独立保存课程体系、学校、年级和有效期。
- [x] EDU-03 新增学生、家庭列表/详情/编辑/归档/时间线和权限感知搜索。
- [x] EDU-04 新增学籍升级批次、预览、人工确认、幂等键、毕业/Alumni 分支和审计。
- [x] LEAD-01 新增 Lead 来源、资格、负责人、学校/家庭主体和转化状态。
- [x] LEAD-02 提供 Lead 列表、资格判定、去重和转化为 Opportunity 的事务 RPC。
- [x] LEAD-03 学校与家庭使用独立默认 Pipeline，并保留转化证据。

## Phase 5：可审计智能建议

- [x] AI-01 新增建议运行、输入快照摘要、证据、规则/Prompt 版本、模型和状态表。
- [x] AI-02 默认规则引擎只使用用户有权查看的数据，生成可解释建议和置信度。
- [x] AI-03 用户可接受、编辑或拒绝；决定生成任务/活动前必须人工确认并审计。
- [x] AI-04 外部 AI 仅在显式 feature flag、供应商凭据和数据处理授权齐备时启用；
  未配置时绝不发送 CRM 数据。
- [x] AI-05 提供建议工作台、证据查看、过期状态和权限过滤。

## Phase 6：测试、文档和发布

- [x] TEST-01 为新表、RLS、capability、转化、升级、隐私和 AI 决策补充 pgTAP。
- [x] TEST-02 为解析器、错误呈现、权限和静态资源检查补充 Node 行为测试。
- [x] TEST-03 Chromium 1228 隔离审计成为 release gate 的明确步骤和产物。
- [x] TEST-04 全量 typecheck、lint、build、Node、pgTAP、schema lint、smoke、npm audit 通过。
- [x] DOC-01 更新 README、部署、环境字段、worker、迁移、回滚和产品范围。
- [x] DOC-02 旧审计和旧实现状态标记为 superseded，不再声称浏览器未执行。
- [x] REVIEW-01 对照本计划逐项检查遗漏、永久 disabled、错误吞没、原始技术码和无权限按钮。
- [x] REVIEW-02 重新执行经理 AAL2/支持角色与 1440/1024/375 中英文浏览器矩阵。
- [!] RELEASE-01 将正式 Supabase 迁移应用到隔离/生产项目并备份验证。
- [!] RELEASE-02 推送精确通过状态，保存 Sites version，并在生产依赖齐备后私有部署。

## 必须保持的架构约束

1. 认证用户、客户 Person、学生和家庭成员是不同概念；客户不得成为员工 Auth 用户。
2. AI 不是事实源；证据、版本和人工决定必须可追溯。
3. 多币种不能静默相加；没有汇率快照不得伪造基础币种金额。
4. 删除、合并、转化、升年级、导出和 AI 采纳必须幂等并记录审计。
5. UI capability 只改善体验；服务端 API、RPC 和 RLS 永远是最终授权边界。
6. 生产凭据只能进入 Sites/runtime secrets，不得进入源码、日志、截图或部署包。

## 最终遗漏审查

- 对照每个 `[ ]` 项查找代码、迁移、测试、文档和浏览器证据。
- 检查所有新增页面的 loading、empty、error、forbidden 和 mobile 状态。
- 检查所有 growing list 的服务端分页和精确 count。
- 检查所有跨对象写入的 workspace、角色、所有权、并发和幂等。
- 检查所有用户可见技术码、UUID、英文占位、低对比度和小字号。
- 检查生产 HTML 引用的每个静态资源，并验证客户端水合后无 console/page error。

## 执行结果（2026-07-19）

- 从空数据库应用至迁移 `202607190040`，schema lint 为 0 条告警，pgTAP 为 222/222。
- TypeScript、ESLint、production build、23 条 Node 契约、依赖审计与全部业务/HTTP smoke 通过。
- `work/browser-qa-chromium-1228/report.json` 记录 23 组真实页面/视口检查，精确使用
  `C:\Users\Horolf\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe`，
  Chromium `149.0.7827.55`；两个隔离 QA 身份均已删除。
- 最终遗漏复审补齐了学籍批次与 AI 建议的精确服务端分页、低权限工作台链接、
  选择器占位文字对比度、旧工作流 request ID 错误反馈和样式层拆分。
- 仓库内可执行项已完成。P0-08、RELEASE-01 和 RELEASE-02 仍依赖真实生产 secrets、
  独立 Supabase 迁移、worker 调度、备份与 Sites 生产环境，必须由环境所有者完成。
