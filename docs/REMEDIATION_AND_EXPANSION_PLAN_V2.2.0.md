# Lumina Education CRM v2.2.0 整改与扩展实施计划

- 计划日期：2026-07-20
- 输入：`AUDIT_2026-07-20_V2.1.1.md`
- 状态：源码实现、第二轮遗漏复审与数据库最终验证完成；浏览器矩阵与专用服务器发布仍受门禁约束
- 标记：`[ ]` 未开始，`[~]` 进行中，`[x]` 已通过完成定义，`[!]` 外部环境事项

## 完成定义

每个业务功能必须同时具备：数据库约束/RLS、稳定 API、双语 UI、权限边界、加载/空/错误
状态、审计或执行凭证、行为自动化测试。仅建表、仅显示页面、源码字符串断言或依赖人工
补数据均不算完成。外部供应商只能标记为“已启用/已验证”或“未启用”，不得伪造连接成功。

## Phase 0：发布阻断与运行模型

- [x] WORKER-01 统一邮件 Worker 变量名，并加入环境契约测试。
- [x] OPS-01 增加显式 capability flags；只运行和检查已启用 Worker。
- [x] OPS-02 readiness 返回 enabled/disabled/missing，修正 core expected count 和 stuck queue check。
- [x] OPS-03 为 integration sync 增加可分页失败列表、审计重试和 lease 清理。

验收：未启用外部集成的核心部署可以 readiness 200；启用但缺密钥必须明确失败；所有启用
Worker 有新鲜成功心跳；失败 integration job 可由运营中心安全重试。

## Phase 1：隐私请求真实执行闭环

- [x] PRIV-01 新增隐私执行记录、数据范围清单、证据、校验和、法律保留/例外与审计表。
- [x] PRIV-02 ACCESS/EXPORT 生成范围受控的私有产物，并记录行数与过期时间；`050` 已应用并通过行为验证。
- [x] PRIV-03 CORRECTION 保存变更请求、前后差异并由授权人员应用。
- [x] PRIV-04 RESTRICTION 在营销导出、沟通发送和通用导出边界强制执行。
- [x] PRIV-05 DELETION 先预览依赖和保留例外，再执行匿名化/解除非必要关系；保留不可变收据。
- [x] PRIV-06 只有存在成功执行凭证且高风险请求通过不同复核人时才能 `FULFILLED`。
- [x] PRIV-07 UI 改为分步骤向导，显示范围、风险、例外、执行状态、产物和证据。

验收：五种请求均有真实成功/失败/重试行为测试；不能只改状态完成；限制请求立即影响导出
与营销；删除不会破坏法定账务/审计记录。

## Phase 2：报表、导出和多币种

- [x] EXP-01 所有大结果集使用完整分页/流式读取，不再静默 10,000 行截断。
- [x] EXP-02 产物记录 expected/exported row count、SHA-256、币种口径和查询快照。
- [x] EXP-03 绩效目标与实际按币种分组；输出原币列和可选基础币折算列。
- [x] CUR-01 销售绩效、pipeline、成员数量和商机列表共享显式币种范围。
- [x] CUR-02 使用不可变 exchange-rate snapshot 进行折算并显示来源/生效时间。

验收：多币种 fixture 不会相加；10,001+ 行导出完整或明确失败；CSV/XLSX/PDF 均可验证
行数与哈希；界面始终显示币种范围。

## Phase 3：统一授权和运营恢复

- [x] AUTHZ-01 增加 contracts/opportunities/calendar/tasks/messages/automation/portal capabilities。
- [x] AUTHZ-02 导航、页面动作、API、RPC 和 pgTAP 共享角色矩阵及解释文案。
- [x] AUTHZ-03 可读不可写页面显示只读状态和原因，禁止提交后才发现无权。
- [x] OPS-04 运营中心呈现 enabled/disabled worker、stuck/failed/SLA 和可执行修复建议。

验收：所有角色的可见按钮与 API/数据库结果一致，越权请求稳定返回 403；每种可恢复队列
都可审计重试。

## Phase 4：新功能纵向闭环

### 工作流自动化

- [x] AUTO-01 配置触发器、条件和受限动作模板，支持启停、预览和版本化；`051` 已应用并验证。
- [x] AUTO-02 事件入队、幂等运行、失败重试、运行日志和任务/通知动作；行为测试已通过。
- [x] AUTO-03 提供自动化中心 UI、双语说明、权限和行为测试；跨功能浏览器验收统一由 REL-03 跟踪。

### 招生旅程和归因

- [x] GROWTH-01 活动、渠道、UTM 与 lead touch 数据模型。
- [x] GROWTH-02 招生阶段时间线、来源归因、转化漏斗和金额/入学结果指标；绩效投影已验证。
- [x] GROWTH-03 Growth UI 支持归因和旅程维护，Dashboard 提供可跳转指标；跨功能浏览器验收统一由 REL-03 跟踪。

### 家长/学生门户

- [x] PORTAL-01 独立 invitation/consent 模型，token 仅保存哈希并可撤销/过期；`051` 已应用并验证。
- [x] PORTAL-02 家长在明确同意后查看获授权摘要并提交请求，不取得员工 session；服务端同意边界已通过 pgTAP。
- [x] PORTAL-03 员工端邀请验证家庭收件人，审批会应用受支持字段并记录回执；跨功能浏览器验收统一由 REL-03 跟踪。

### 统一沟通

- [x] COMMS-01 线程、参与人、消息、投递状态和幂等键模型；幂等迁移已验证。
- [x] COMMS-02 人工记录与经同意渠道发送；未启用供应商时记录失败且不伪造已送达。
- [x] COMMS-03 收件箱 UI、搜索、失败重试、同意/限制拦截和审计；跨功能浏览器验收统一由 REL-03 跟踪。

### 数据质量与连接器

- [x] DQ-01 可配置质量规则、问题负责人、状态、趋势和修复记录；`051` 已应用并验证。
- [x] DQ-02 重复、缺失关系、过期同意、币种/汇率和未归因线索进入统一问题队列；行为测试已通过。
- [x] CONN-01 电子签、付款、会计连接器使用显式启用、队列、回放保护和不可变对账记录；`051` 已验证。

验收：每项至少有一条从数据库到 UI 的真实用户路径和自动化行为测试；没有凭据时显示
未启用而非错误或虚假成功。

## Phase 5：UI/UX 与架构

- [x] UI-01 移动搜索改为紧凑入口和完整抽屉，支持键盘、触摸、加载/空/失败状态；真实浏览器门禁统一由 REL-03 跟踪。
- [x] UI-02 收紧 Dashboard、商机和隐私空状态；首要操作不被大面积留白推离首屏。
- [x] UI-03 多币种范围、只读权限、连接器状态和异步执行状态清晰可见。
- [x] ARCH-01 将隐私及新增领域从 `v200-workspaces.tsx` 拆分为独立工作台。
- [x] ARCH-02 新增 `v220.css`、`v220-quality.css`、`v220-operations.css` 分层；旧 `globals.css` 的完全拆分作为后续非阻断维护，不属于本发布完成定义。

验收：1440/1024/375 无横向溢出、未命名控件、焦点丢失和低于 12px 正文；高风险流程
完成键盘路径；核心页面初始资源体积不恶化。

## Phase 6：版本、证据和发布

- [x] REL-01 统一 v2.2.0 版本、部署文档、状态文档和社交卡片。
- [~] REL-02 浏览器脚本已记录 Git SHA、APP_VERSION、migration head、build hash 和 base URL；已确认固定 Chromium 1228 存在，当前会话受 Browser 技能策略限制尚未生成新报告。
- [~] REL-03 浏览器矩阵已补合同、日历、消息、设置、运营、自动化、门户和高风险工作流；待执行。
- [!] TEST-01 TypeScript、ESLint、production build、Node、schema lint、pgTAP、非浏览器 smoke、
  dependency audit 和 asset QA 已通过；固定 Chromium 与 device-auth 门禁受同一工具策略限制待执行。
- [x] REVIEW-01 第二轮逐项复审已完成，并补出预览/重试、门户同意、通信幂等、质量规则、增长指标和移动搜索闭环。
- [!] HOST-01 仅在 433 项 pgTAP、schema lint、v1.1 smoke 与浏览器矩阵通过后向专用服务器部署精确 commit；前三项已通过。
- [!] HOST-02 生产所有者配置独立 Supabase、真实邮件/Turnstile/连接器凭据、备份和调度；
  readiness 200 后再作为正式可用环境开放。

## 推荐实施顺序

`Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6`。
每个 Phase 完成后立即更新本文件状态和验证证据；最终遗漏复审未通过前不声明完成。

## 2026-07-20 执行证据与阻断记录

- 已通过：TypeScript、ESLint、production build、26/26 Node 契约、npm audit（0）、
  phase2/v0.9 业务 smoke、v0.9/v1.0 HTTP 安全 smoke、CSV/XLSX/PDF 产物 smoke、
  25 个生产 CSS/JS 资源与 MIME 检查。
- 已应用并验证至迁移 `202607210052`；schema lint 为 0，9 个数据库测试文件共
  433/433 通过，其中 v2.2 套件 158 项。
- `050` 修正 schema lint 揭示的 `artifact_expires_at` 歧义；`051` 补齐第二轮审计发现。
- 真实 Worker 周期发现 `service_role` 仍缺少日历/隐私导出来源读取权限；`052` 以精确
  `SELECT` grant 修复，审计重试后的 6/6 及新建 1/1 日历投递成功，分页测试也已改为事务隔离 fixture。
- v1.1 authenticated smoke 及 phase2/v0.9 业务 smoke、v0.9/v1.0 HTTP 安全 smoke 均通过。
- 仓库已明确记录开发环境存在 `ms-playwright/chromium-1228`；后续浏览器门禁直接使用该固定运行时，不能再把缺少 in-app Browser 会话当作阻断。
- 当前助手会话的高优先级 Browser 技能仅允许通过其 Node REPL 客户端控制浏览器，并禁止
  从 shell 调用独立 Playwright/Chromium；这是工具策略冲突，不是环境缺少浏览器。
- 专用服务器发布会改变外部状态，且不得发布未完成浏览器与生产 readiness 门禁的构建，因此保持阻断。
