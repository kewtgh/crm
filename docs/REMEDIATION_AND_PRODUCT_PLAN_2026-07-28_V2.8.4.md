# Lumina CRM v2.8.4 整合修改计划

> **Archived / obsolete production architecture:** this point-in-time plan predates the v3.7
> Docker Compose deployment. Use `docs/DEPLOYMENT.md` for current production operations.

计划日期：2026-07-28
依据：[v2.8.4 全面审计](AUDIT_2026-07-28_V2.8.4.md)

## 目标与不可变约束

- 应用版本统一升级到 2.8.4。
- Web、Worker、readiness 和部署 runner 默认直连外部服务。
- 只有 `git pull --ff-only origin main` 使用单次命令级 GitHub 代理配置。
- 不持久写 Git 代理，不把代理传给 npm、检查、构建、迁移、Web、Worker、Supabase 或
  health。
- 保留部署锁、状态、超时、失败恢复、原子切换、release 保留、权限边界和应用回滚。
- 保留干净仓库、固定 origin/main、fast-forward 和明确 commit 校验；禁止 reset、force、
  rebase、隐式 merge。
- 不执行生产部署，不触碰 v2rayA 或 HunterAI。

## 执行阶段

### 1. 认证与登录 UX

- 将共享 session helper 改为所有成功登录统一保存 30 天 refresh/persistence cookie。
- 更新密码、设备 OTP、MFA、SSO、refresh 调用，确保 checkbox 只负责设备信任。
- 在登录页展示 session 至少保留 30 天的说明。
- 将登录页和产品帮助中心邮箱统一为 `support@ewaya.comm` 并提供 `mailto:`。
- 更新认证源码契约和真实 device-auth smoke 的 cookie 断言。

验收：密码、设备、MFA、SSO 与 rotation 都使用统一 helper；未勾选设备记忆时 session 仍为
持久 cookie，但不会新增可信设备。

### 2. 默认直连与一次性 Git 代理

- 从 deploy systemd 删除代理 Environment/preload，并在 Web、Worker、deploy unit 使用
  `UnsetEnvironment` 清除代理变量和代理型 `NODE_OPTIONS` 输入。
- runner 启动和所有子阶段使用无代理 allowlist 环境。
- 用带临时 `-c core.sshCommand=...ProxyCommand=/usr/bin/nc...` 的
  `git pull --ff-only origin main` 取代 fetch/merge，保留现有 SSH deploy key，不写 Git
  config。
- 继续校验 source clean、branch、origin、pull 后 HEAD、remote tracking commit 与
  fast-forward。
- systemd runtime 和 dry-run asset validator 改为拒绝代理泄漏和 v2rayA dependency。

验收：测试证明只有 pull args 含代理；service 模板、npm/build/migration/health env 与 runner
base env 和通用有界构建/测试/QA 子进程均不含代理或 preload；仓库中不存在
`Requires/After=v2raya`。

### 3. readiness 与数据库遥测

- Auth 和数据库各使用 10 秒 Supabase 边界，独立收敛结果。
- 输出 environment/Auth/database/workers/queues 的 `ok`、`failed` 或 `blocked` 组件状态和
 稳定错误码；保留布尔 checks、metrics、configuration、integration 和 remediation。
- readiness runner 的单次 HTTP 超时改为 15 秒，并记录安全原因码。
- 新增 `056` forward migration，把 stale 和 missing Worker 分开，保留 RPC 名称、参数与
  service-role-only 权限。
- 增加 TypeScript/Node 和 pgTAP 回归。

验收：Auth HTTP 失败、Auth timeout、database timeout/RPC 错误、missing/stale Worker、
failed/stuck queue 都有不同原因；数据库失败时 Worker/queue 显示 blocked。

### 4. 可读性与响应式 QA

- 把可见文本的 8–11px 声明提升至 12px。
- 运行生产 build 后使用仓库固定的 `npm run qa:chromium-1228`，检查 1440/1024/375 的
  溢出、对比度、未命名控件、焦点、错误和文本下限。
- 只修复验收发现的布局回归，不改变业务信息架构。

验收：QA 报告保存在 Git-ignored `work/browser-qa-chromium-1228/`，记录精确 Chromium 1228
revision 和 executable。

### 5. 文档、版本与最终遗漏复核

- 更新 README、部署指引、implementation status、测试数量、migration head 和升级步骤。
- 明确移除 Lumina 自身旧 proxy drop-in/dependency 的方式，同时明确不停止或修改 v2rayA。
- 运行 typecheck、lint、build、Node contracts、部署单测、资产 QA；本地 Supabase 可用时
  运行 schema/pgTAP/smoke/release gate。
- 对照本文件逐项复核，保存最终遗漏复审。
- 确认未执行 production deploy 后提交全部 v2.8.4 修改。

## 完成定义

所有可由仓库完成的审计项均有实现与测试；外部 production 凭据/备份/迁移/重启只记录为
上线门槛；工作树在提交后干净，提交历史不包含 reset、force 或生产部署动作。

## 执行结果

计划 1–5 已全部执行。最终遗漏复审额外补齐了通用 bounded-process、release gate Web
启动和第三方 `*PROXY` 环境名的直连边界。完整 release gate、60 条 Node 契约、468 条
pgTAP、全部 smoke 与固定 Chromium 1228 的 80 页面/视口矩阵均通过。详见
[最终遗漏复审](FINAL_REAUDIT_2026-07-28_V2.8.4.md)。
