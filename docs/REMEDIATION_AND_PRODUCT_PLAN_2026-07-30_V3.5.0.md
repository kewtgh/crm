# Lumina CRM v3.5.0 修复与产品增强计划

- 日期：2026-07-30
- 输入：`AUDIT_2026-07-30_V3.5.0.md`
- 目标版本：3.5.0
- 状态：已执行并完成最终复查

## 1. 完成定义

1. workspace 有受约束、可审计、仅管理员 AAL2 可修改的业务时区。
2. 应用用户事务与显式 workspace Worker 事务使用同一个 PostgreSQL 本地时区；现有
   `current_date`/`date_trunc`/触发器无需逐函数复制即可统一。
3. 合同剩余天数使用 workspace 业务日，不再依赖 Web 进程本地午夜。
4. 异步写抽屉 pending 时无法通过 Escape、遮罩、关闭或取消退出，并暴露忙碌语义。
5. 任务优先队列不再静默隐藏 12 条以后的项目；旧页面时间遵循个人时区。
6. v3.5 定向契约、迁移校验、类型、lint、部署契约、一次 build 和直接相关 Chromium
   阶段通过。
7. 最终逐项复查本计划，补完遗漏，更新版本/README/实现状态/部署资料并提交。

## 2. 实施工作包

### WP-1：workspace 业务时区数据与事务架构

- [x] 新增 migration 065：`workspaces.business_timezone`、有限时区约束和管理员更新 RPC；
  066 仅补充 Worker 读取业务时区所需的最小权限，067 固定 date-only JSON 文本契约。
- [x] 更新 RPC 写入审计事件，拒绝非管理员、跨 workspace 和不支持时区。
- [x] 用户数据库上下文在 workspace/RLS 设置后同步事务级 `TimeZone`。
- [x] Worker 数据库 helper 支持显式 workspace 事务并在营销导出路径使用。
- [x] 合同剩余天数由 workspace 业务日计算，保持 SQL 摘要与列表一致。

### WP-2：组织设置产品功能

- [x] 新增 workspace 设置 repository、管理员 API 与 `/admin/workspace` 页面。
- [x] API 使用 Origin/CSRF、管理员角色、AAL2 和共享时区 schema。
- [x] 页面提供业务时区选择、当前业务日预览、与个人显示时区差异说明和保存反馈。
- [x] 加入桌面/移动导航、页面 metadata 和完整中英文本。
- [x] 增加默认开启、管理员+AAL2、可审计的 Turnstile 开关；关闭时登录、SSO 和找回密码
  强制使用 ALTCHA，服务端拒绝旧 Turnstile proof。
- [x] CSP 允许 ALTCHA 所需的 `'self' blob:` Worker；Cloudflare One 作为独立身份/访问层，
  不替代 CAPTCHA、限流、MFA 或可信设备。

### WP-3：可靠异步抽屉与时间体验

- [x] `AccessibleDrawer` 新增 pending 关闭保护、禁用遮罩/关闭按钮和 `aria-busy`。
- [x] 合同、日历、沟通、自动化、客户 360、任务、线索、AI、记录创建与导出等直接写
  抽屉传递真实 pending 状态并禁用取消。
- [x] 沟通、自动化、门户和回收站时间使用个人时区格式器。
- [x] 财务分期示例改为不随年份过期的格式说明。

### WP-4：任务优先队列完整性

- [x] 为完整任务表加入稳定锚点。
- [x] 队列超过 12 条时显示“当前显示/总数”并提供跳到完整列表入口。
- [x] 队列摘要和批量选择含义在中英文下清晰一致。

### WP-5：回归、资料与发布

- [x] 新增 v3.5 行为契约并纳入 `test:contracts`。
- [x] 更新 README、实现状态、部署说明、环境/迁移说明和版本常量。
- [x] 运行 migration verify、v3.5 定向契约、typecheck、lint、部署契约和最终 build。
- [x] 使用固定 `ms-playwright/chromium-1228` 复测直接相关 admin/tasks/contracts 页面，
  并执行 Turnstile→ALTCHA→恢复原值交互。
- [x] 对照审计和本计划补漏，保存最终复审，更新版本并提交。

## 3. 验证矩阵

| 风险 | 最小证据 |
| --- | --- |
| SQL 仍受服务器日期影响 | 数据库上下文契约 + migration + 时区边界集成验证 |
| Worker 导出使用错误业务日 | 显式 workspace Worker 事务契约 |
| 越权修改 workspace | API 角色/AAL2/Origin 合同 + RPC 角色校验 |
| 抽屉仍可在 pending 关闭 | 共用组件契约 + 直接调用方契约 + Chromium 键盘/遮罩验证 |
| 任务队列静默截断 | 文案/锚点契约 + tasks Chromium |
| 日期仍绕过个人时区 | 源码契约 + 受影响页面 Chromium |
| Turnstile 关闭后绕过或 ALTCHA 不可用 | 服务端 disabled-proof 合同 + CSP 合同 + Chromium 真实切换/恢复 |
| 综合回归 | migration verify、typecheck、lint、deploy test、一次 build |

## 4. 执行顺序

1. 先完成 migration、数据库上下文和定向契约。
2. 再完成管理员 workspace 设置功能。
3. 然后完成共用抽屉、调用方和日期/任务 UX。
4. 通过定向契约后运行类型和 lint；源码稳定后只运行一次最终 build。
5. 最后运行直接相关 Chromium 阶段，逐项复查计划并更新发布资料。

## 5. 停止条件

所有工作包和定向回归通过后停止扩大检查。除非验证暴露同源缺陷，不重复完整数据库套件、
完整十阶段 Chromium 矩阵或多次 build；外部生产门禁记录为部署前操作，不伪造本地完成。
