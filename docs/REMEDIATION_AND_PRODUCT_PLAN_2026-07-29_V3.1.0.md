# Lumina CRM v3.1.0 修复与产品增强计划

- 日期：2026-07-29
- 输入：`AUDIT_2026-07-29_V3.1.0.md`
- 目标版本：3.1.0
- 状态：已执行完成并复核

## 1. 完成定义

1. 审计中的 P1/P2/P3 仓库内缺口全部关闭，不用文档承诺代替实现。
2. 四项建议增强接入真实 API/UI/部署路径，不使用假数据或永久禁用按钮。
3. 数据写入保持 workspace、角色、AAL2、CSRF/Origin 和 RLS 边界。
4. 新迁移有序、可校验、可在当前数据库向前应用并幂等重跑。
5. 定向测试、类型检查、lint、最终源码对应的生产构建和受影响 Chromium 1228 阶段通过。
6. 复查本计划是否有遗漏，更新版本、状态资料和最终复审后提交。

## 2. 实施工作包

### WP-1：导入真实性、进度和输入上界

- [x] 抽取可测试的导入执行轮次/终态规则。
- [x] 每次使用数据库支持的 100 行批量，按批次实际总量计算安全上界。
- [x] 循环结束后强制检查 `COMPLETED`/`PARTIAL_FAILED`，禁止把 `PROCESSING` 当作完成。
- [x] 展示已应用加失败数量/总量的可访问进度。
- [x] 切换批次时清除旧行，避免新标题配旧数据。
- [x] 对 mapping、行对象、键和值增加与六字段产品模型相称的上界。

### WP-2：对象存储失败补偿

- [x] 头像改用不可覆盖的版本化对象键。
- [x] 把对象写入和资料路径更新放在同一补偿范围。
- [x] 失败只删除新对象；成功更新引用后再尽力删除旧对象。
- [x] 用回归测试锁定“不覆盖旧键”和补偿顺序。

### WP-3：资料更新原子性

- [x] 新增 PostgreSQL RPC，在一个事务中更新 `user_profiles` 与 `user_preferences`。
- [x] RPC 只操作当前应用用户，并保留 workspace/RLS 约束。
- [x] Repository 改用单次 RPC，删除并行双写。
- [x] 更新迁移头契约和数据库验证证据。

### WP-4：健康接口与错误可观察性

- [x] 提取并测试“详细 readiness 仅限 loopback”规则。
- [x] 公网/非本机详细请求返回最小且不泄漏内部状态的拒绝响应。
- [x] 保持 `/api/health` 公网 liveness 与部署本机 readiness 兼容。
- [x] 未捕获 500 异常记录允许名单结构化事件：request ID、路由模板、方法、错误类型和代码。
- [x] 不记录查询串、请求体、cookie、身份或业务字段。

### WP-5：日历时区、容量和重复提交

- [x] 使用用户偏好时区把本地月初/月末转换为 UTC 查询窗口。
- [x] 日历查询使用 exact count，返回 `total` 与 `truncated`。
- [x] UI 在截断时给出明确警告，不静默隐藏。
- [x] 新建预约增加 pending、禁用、`aria-busy` 和错误后的可靠恢复。
- [x] 输入控件补齐与 API 一致的长度限制。

### WP-6：移动导航可访问性和维护性

- [x] 移动侧栏展开时声明 dialog/aria-modal；桌面语义保持 navigation aside。
- [x] 新业务/安全规则放入小型模块，不继续加重已有大组件。
- [x] 不执行与缺陷无关的全量 CSS 或页面重写。

### WP-7：回归与发布

- [x] 新增 v3.1.0 行为契约，并纳入轻量契约测试脚本。
- [x] 运行迁移校验、定向契约、typecheck、lint。
- [x] 在本地 PostgreSQL 应用新迁移并运行相称数据库 smoke。
- [x] 最终应用源码确定后运行对应的生产 build。
- [x] 使用固定 `ms-playwright/chromium-1228` 运行 calendar/imports/settings/admin 受影响阶段。
- [x] 复查全部工作包和历史计划遗漏。
- [x] 更新 README、实现状态、版本文件、package lock 和最终复审。
- [x] 提交完整变更。

### WP-8：一键部署与 v3.1 自托管架构对齐

- [x] 新增只含运行时字段的 `deploy/production.env.example`，不再从混合用途 `.env.example` 复制。
- [x] 共享并强制 `crm_app`、`crm_system`、`crm_worker`、`crm_migrator` 角色约束。
- [x] 禁止 production.env 混入迁移、备份、数据库管理及一次性管理员初始化字段。
- [x] 对 Local 固定持久根与 S3 必需字段/HTTPS endpoint 做 provider 配套预检。
- [x] Web/Worker systemd 只放行持久对象目录，移除 Web 对不可变 release 根的写权限。
- [x] runner 在两种 provider 下均创建并拒绝符号链接形式的对象沙箱目录。
- [x] dry-run 同时校验生产/部署模板、systemd 资产和共享配置策略。

## 3. 验证矩阵

| 风险 | 最小证据 |
| --- | --- |
| 导入假完成 | 纯规则测试 + API/UI 静态契约 + operations Chromium |
| 头像补偿 | 路由源契约 + settings Chromium |
| 资料半成功 | 迁移/RPC 契约 + PostgreSQL migration/smoke |
| readiness 泄漏 | loopback 判断单元测试 + deploy contract |
| 日历时区/截断/双击 | 时区单元测试 + core-a Chromium |
| 错误诊断泄漏 | observability 允许名单契约 |
| 移动导航语义 | 渲染/源码契约 + Chromium 可访问性检查 |
| 一键部署架构漂移 | 19 项 deployment contract + 无副作用 production dry-run |

## 4. 停止条件

请求行为、定向回归、类型、lint、一次构建和受影响浏览器阶段通过后停止扩大审计。完整数据库
套件、重复构建、完整十阶段 Chromium 或生产外部变更不作为本轮默认追加动作；若定向证据暴露
新的同源缺陷，再只扩展到该缺陷直接影响的范围。

## 5. 实施期补充关闭项

1. PostgreSQL 转换链曾删除 `user_profiles` 的旧 SELECT policy，却遗漏重建替代 policy；
   062 迁移恢复“本人或授权管理员可读”，真实用户上下文资料事务及失败回滚均已通过。
2. 数据库 smoke/validate 曾硬编码 65 个迁移；现改为从迁移目录计算预期数量，避免新增迁移
   后工具自身误报。
3. 设置 Chromium 的 MFA 交互仍引用已退休的 `qa-auth.mjs`；现改用无平台依赖的
   `qa-totp.mjs`，并以标准 TOTP 向量锁定。
4. 最终差异审查确认 React `pending` 不能同步拦截同一事件循环的快速双击；日历提交增加
   `useRef` 同步互斥，并保留按钮禁用和 `aria-busy` 作为视觉/可访问状态。
5. 补充部署审计发现生产模板会引入 runner 禁止的高权限字段、Web/Worker 无法写入 Local
   对象根，以及角色/provider 预检过弱；WP-8 已完整关闭，S3 首次切换所需的 systemd
   沙箱目录也在最终复核中补齐。
