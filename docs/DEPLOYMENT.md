# Lumina Education CRM v2.0.0 部署指引

## 1. 前置条件

- Node.js 22.13+。
- 独立的 Supabase 项目（Auth、Postgres、Storage）。
- HTTPS 正式域名、密钥管理、备份、告警与 worker 调度平台。
- 正式 Turnstile、SMTP/邮件投递、Webhook 与已启用集成的供应商凭据。

先备份数据库并在隔离暂存项目演练迁移和向前修复。不得复用其他项目的 Supabase、用户、密钥或回调地址。本地 CRM 使用 `http://localhost:3200`，本地 Supabase 使用 56321–56324；`/api/health` 必须返回 `version=2.0.0`。

本地 Supabase 的默认开发密钥、Mailpit 与 Studio 只允许在单机或受信开发网络使用，禁止暴露到公网、共享测试环境或生产。

## 2. 环境变量

以 [.env.example](../.env.example) 为唯一字段清单。应用必需值：

```dotenv
APP_URL=https://crm.example.com
NEXT_PUBLIC_TURNSTILE_SITE_KEY=production-site-key
TURNSTILE_SECRET_KEY=production-server-secret
TURNSTILE_EXPECTED_HOSTNAME=crm.example.com
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=public-anon-key
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
CRM_WORKSPACE_ID=workspace-uuid
LOGIN_THROTTLE_HASH_SECRET=independent-random-secret-at-least-32-bytes
```

邮件、Webhook 与同步 worker 按启用能力配置 `EMAIL_DELIVERY_*`、`WEBHOOK_<PROVIDER>_SECRET`、`WEBHOOK_PROCESSOR_*` 和 `INTEGRATION_SYNC_PROCESSOR_*`。`AI_PROVIDER_*` 是可选状态标记；当前版本的建议由本地规则引擎生成，不会调用外部 AI 或发送 CRM 数据。

`NEXT_PUBLIC_*` 只能保存公开值。Turnstile secret、service role、限流 HMAC、邮件/集成 token 绝不能进入浏览器、提交、构建日志或客户端 bundle。初始化后立即删除 `ADMIN_PASSWORD`。

## 3. 数据库与身份

1. 保持公开 signup 关闭，但允许管理员创建的员工使用 email/password 登录。
2. 配置正式 `APP_URL`、密码重置回调、SMTP 和邮件模板。
3. 配置精确 Turnstile hostname。
4. 超级管理员、管理员、销售总监和销售经理执行敏感能力前必须达到 TOTP AAL2。
5. 确认 `crm-avatars`、`crm-exports` 为 private。
6. 按原顺序应用 `202607160001` 至 `202607190040` 的全部迁移：

```bash
npx supabase db push --linked
npx supabase db lint --linked --level warning
npx supabase test db --linked
```

`038` 统一增长型列表分页；`039` 增加任务委派/SLA、CRM 编辑与历史、共享视图、持久密码恢复限流、危险操作幂等边界、数据质量复核及 CRM 导出审批；`040` 增加学生/家庭/监护/学术记录、学籍升级、Lead、隐私请求、导入映射与逐行修复、精确财务聚合和可审计建议。不得遗漏、重排或重新开放底层 merge/rollback/accept RPC。

首次初始化时运行 `npm run auth:bootstrap-admin`，确认 `SUPER_ADMIN` membership、`must_change_password=true` 与 username，随后删除临时密码。首次登录必须完成改密和 TOTP。

## 4. 构建与验收

```bash
npm ci
npm run release:gate
```

门禁包括 typecheck、lint、production build、23 条 Node 契约、222 条 pgTAP、schema lint、依赖审计、业务/HTTP/export smoke、生产静态资源与 MIME 检查，以及指定 `ms-playwright/chromium-1228` 的 23 组 UI/权限/无障碍检查。smoke 会写入并清理隔离数据，只能对专用本地/暂存 workspace 执行。

## 5. Worker 与外部集成

统一执行六类 worker：

```bash
npm run workers:process
```

生产调度器按业务 SLA 周期执行该命令。六类处理器分别负责提醒、通知 outbox、日历投递、生成文件、Webhook inbox 和集成同步。任一失败会记录失败心跳并让命令失败；不得手工修改数据库伪造健康。

导出文件位于私有桶，下载使用短期签名 URL，文件按过期策略清理。Webhook 必须使用供应商独立 HMAC secret、稳定事件 ID、完整 canonical envelope、5 分钟重放窗口和原子幂等摄取。

## 6. 健康、监控与备份

- `GET /api/health`：liveness，返回 200 与版本。
- `GET /api/health?mode=ready`：检查 Auth、数据库、环境、队列 SLA 和六个 worker；不健康时返回 503。
- 告警覆盖 5xx、限流、RLS 拒绝、审批执行失败、身份补偿失败、失败/卡死任务、最老积压、心跳过期、邮件/Webhook 失败和存储容量。
- 启用 PITR 或每日备份；定期在隔离项目恢复并验证 Auth、RLS、合同、付款、提醒、审计与私有文件。

## 7. 上线验收

- 公开注册拒绝；错误认证保持 JSON/表单内错误与 request ID。
- Turnstile、首次改密、TOTP/AAL2、角色、团队和 workspace 边界生效。
- 学校、联系人、任务编辑/归档/历史/并发冲突和导出审批完整。
- 报价、合同、付款、退款、导入 dry run/执行/幂等回滚、去重预览/幂等合并可追溯。
- 数据质量只能在源字段修复并重检后正常关闭；忽略必须记录理由。
- 运维中心显示真实积压、集成配置和六个新鲜 worker；readiness 为 200。
- 学生、家庭、学籍升级、Lead 转化、隐私请求、10,000 行导入和私有 CSV/XLSX/PDF 输出闭环。
- 以 1440、1024、375px 验证中英文、键盘、焦点、菜单、抽屉、表单错误、对比度和横向溢出。
- CSP 包含每请求 nonce 与 `strict-dynamic`，生产脚本策略不含 `unsafe-inline`。

## 8. Sites 发布

1. 复用 `.openai/hosting.json` 的既有项目。
2. 在 Sites 运行时保存正式环境变量与 secrets，不复制本地测试值。
3. 推送通过门禁的精确提交，再以同一 commit 保存 version。
4. 只部署已保存 version；先使用 private 访问级别。
5. 部署完成后检查状态、liveness、readiness 和核心 smoke。

## 9. 回滚

1. 停止新写入流量和 worker。
2. 将应用回滚到上一已验证 Sites version。
3. 数据库优先使用向前修复迁移；仅在恢复演练确认后执行备份恢复。
4. 不删除审批、审计、合同版本、付款、通知或 Webhook 历史来“回滚界面”。
5. 恢复后重跑 release gate、readiness、权限、业务和浏览器矩阵。

## 10. GitHub Actions

生产 worker 工作流使用 Node.js 24 与 `actions/checkout@v6`、`actions/setup-node@v6`，
且不再调用产生 Node.js 20 强制运行警告的 artifact 步骤。仓库发布门禁不下载浏览器；
浏览器门禁使用已预置的 `ms-playwright/chromium-1228`，若 runner 不具备该精确运行时
应明确失败。
