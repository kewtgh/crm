# Lumina Education CRM v1.1.0 部署指引

## 1. 前置条件

- Node.js 22.13+。
- 独立的 Supabase 项目（Auth、Postgres、Storage）。
- HTTPS 正式域名。
- 服务器/worker 密钥管理、正式 SMTP/邮件投递端点、Webhook 处理端点。
- 可调度六个 worker 并对失败、积压、SLA 超限和心跳过期告警的平台。

先备份数据库并在暂存项目演练迁移和向前修复。不要复用其他项目的 Supabase、用户、密钥或回调地址。

本地 CRM 固定使用 `http://localhost:3200`，本地 Supabase 使用 56321–56324。验收时同时确认启动地址和 `/api/health` 的 `version=1.1.0`。

## 2. 环境变量

以 [.env.example](../.env.example) 为唯一字段清单。至少必须设置：

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

EMAIL_DELIVERY_WEBHOOK_URL=https://mailer.example.com/crm-delivery
EMAIL_DELIVERY_WEBHOOK_TOKEN=server-only-token
WEBHOOK_PROCESSOR_URL=https://integration-worker.example.com/crm-events
WEBHOOK_PROCESSOR_TOKEN=server-only-token
INTEGRATION_SYNC_PROCESSOR_URL=https://integration-worker.example.com/crm-sync
INTEGRATION_SYNC_PROCESSOR_TOKEN=server-only-token
```

每个启用的 provider 必须配置独立的 `WEBHOOK_<PROVIDER>_SECRET`。`NEXT_PUBLIC_*` 只能放公开值；Turnstile secret、service role、限流 HMAC、邮件/Webhook token 绝不能进入浏览器或日志。初始化成功后必须从本地、CI 和托管环境删除 `ADMIN_PASSWORD`。

## 3. Supabase

1. 保持全局公开 signup 关闭，但必须允许已创建员工使用 email/password 登录。仓库本地配置以 `[auth] enable_signup=false` 和 `[auth.email] enable_signup=true` 表达这个边界。
2. 配置正式 `APP_URL`、密码重置回调、SMTP 和邮件模板。
3. 为正式域名配置 Turnstile site key、server secret 和精确 hostname。
4. 超级管理员和管理员必须达到 TOTP AAL2；邮箱验证不能替代第二因素。
5. 确认 `crm-avatars`、`crm-exports` 为 private。
6. 在暂存项目应用全部迁移：

```bash
npx supabase db push --linked
npx supabase db lint --linked --level warning
npx supabase test db --linked
```

当前迁移序列为 `202607160001` 至 `202607180037`。`031`–`036` 关闭租户/身份、租约与可观测性、业务闭环、v1 报价边界、Webhook 原子幂等、Auth 两步建档兼容和旧报价写接口退役；`037` 增加精确 CRM 指标、时区感知仪表盘、付款逾期自动化及 Worker 心跳权限。不得遗漏或重排。

## 4. 初始管理员

仅在首次初始化时提供 `ADMIN_*` 变量，然后运行：

```bash
npm run auth:bootstrap-admin
```

确认 Auth 用户、`SUPER_ADMIN` membership、`must_change_password=true` 和 username 正确，随后立即删除 `ADMIN_PASSWORD`。首次登录必须完成临时密码替换和 TOTP，达到 AAL2 前管理员数据/API 均应拒绝访问。

## 5. 构建与自动化验收

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run smoke:http-v09
npm run smoke:http-v10
npm run smoke:phase2
npm run smoke:v09
npm run smoke:v11
npx supabase db lint --local --level warning
npx supabase test db --local
```

五项 smoke 会写入并自动清理隔离测试数据；只能对专用暂存 workspace 执行。`npm test` 包含 production build。

## 6. Worker 与外部集成

按分钟或业务 SLA 调度：

```bash
npm run reminders:process
npm run outbox:process
npm run calendar-deliveries:process
npm run exports:process
npm run webhooks:process
npm run integrations:process
```

六个 worker 分别记录成功/失败心跳。不得使用手工数据库更新伪造“健康”。邮件、日历、Webhook 和集成同步只有在外部端点确认成功后才能完成；失败任务进入带租约、退避、死信和审计重放的流程。导出文件存储在私有桶，签名链接 60 秒有效，文件 24 小时后清理。

Webhook 请求必须小于等于 1 MiB，携带 provider 对应的 HMAC 签名、稳定事件 ID、事件类型和时间戳。签名覆盖完整 canonical envelope，时间窗口为 5 分钟；重复事件由单事务 RPC 原子确认。浏览器角色不能写入收件箱；只有服务角色可摄取、claim、完成或标记失败。

## 7. 健康、监控与备份

- `GET /api/health`：liveness，进程可响应时返回 200。
- `GET /api/health?mode=ready`：readiness；Auth、数据库、队列或任一预期 worker 不健康时返回 503。
- 对 5xx、登录限流、RLS 拒绝、审批失败、身份补偿失败、队列最老年龄、失败任务、心跳过期、邮件/Webhook 失败和存储容量告警。
- 启用 PITR 或每日备份；每季度在隔离项目恢复并验证 Auth、RLS、合同、付款、提醒、Webhook 和私有文件。

## 8. 上线验收

- 公开 signup 被拒绝，不存在注册页面/API。
- 错误密码返回表单内 401；受保护 API 未登录返回 JSON 401 和 request ID，不返回登录 HTML。
- Turnstile、首次改密、管理员 TOTP/AAL2、角色和团队边界全部生效。
- 停用员工后旧会话不能继续访问；任何身份补偿失败均可见并告警。
- maker/checker、自审限制、旧退款 RPC 缺失和跨 workspace 负向用例通过。
- 报价、合同、收付款/退款、导入 dry run/执行/回滚、去重预览/合并可追溯。
- 客户活动、续约 Playbook、商机阶段守卫、产品包、汇率快照和 Next Best Action 使用真实持久化和审计。
- 五个集成状态与真实供应商一致；只有 provider callback 可确认 `CONNECTED`，未连接时明确显示未连接。
- 运维中心能看到队列、失败、卡死、SLA 超限和六个新鲜 worker 心跳，readiness 返回 200。
- 以 1440、1024、375px 验证中英文、键盘焦点、弹层、表单错误、移动字段标签、无横向溢出和 accessibility。
- CSP 响应包含每请求 nonce 与 `strict-dynamic`，生产脚本策略不包含 `unsafe-inline`。

## 9. Sites 发布条件

若使用 OpenAI Sites：

1. 复用 `.openai/hosting.json` 中的真实 `project_id`，不得另建重复站点。
2. 将生产环境变量和 secrets 保存到站点运行时；不得复制本地测试密钥。
3. 推送已通过上述门禁的精确提交，保存对应 version。
4. 只部署已保存的 version，并在部署后重新检查 readiness 和核心业务 smoke。

生产凭据、worker 调度或浏览器验收不完整时，只保留站点项目/配置，不发布一个已知 degraded 的生产版本。

## 10. 回滚

1. 停止 worker 和新写入流量。
2. 回滚应用到上一已验证 version。
3. 数据库优先用向前修复迁移；只有恢复演练确认后才执行备份恢复。
4. 不删除审批、审计、合同版本、付款、Webhook 收件箱或业务历史来“回滚界面”。
5. 恢复后重跑 readiness、权限矩阵、pgTAP、HTTP、业务和浏览器验收。
