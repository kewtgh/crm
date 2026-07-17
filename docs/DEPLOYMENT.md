# Lumina Education CRM v0.7.0 部署指引

## 1. 前置条件

- Node.js 22.13+。
- 独立的 Supabase 项目（Auth、Postgres、Storage）。
- HTTPS 正式域名。
- 私密的服务器/worker 密钥管理。
- 邮件发送 webhook，以及可调度三个 worker 的平台。

先备份数据库并在暂存项目演练迁移和回滚。不要把另一个项目的 Supabase、用户或密钥复用到 CRM。

本地 CRM 固定使用 `http://localhost:3200`，本地 Supabase 使用 56321–56324；不要复用其他项目的 3000 端口或回调地址。验收时必须以 CRM 启动日志打印的地址和 `/api/health` 返回的 `version=0.7.0` 双重确认目标项目。

## 2. 环境变量

```dotenv
APP_URL=https://crm.example.com
NEXT_PUBLIC_TURNSTILE_SITE_KEY=production-site-key
TURNSTILE_SECRET_KEY=production-server-secret
TURNSTILE_EXPECTED_HOSTNAME=crm.example.com
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=public-anon-key
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
EMAIL_DELIVERY_WEBHOOK_URL=https://mailer.example.com/crm-delivery
EMAIL_DELIVERY_WEBHOOK_TOKEN=server-only-token
OUTBOX_BATCH_SIZE=20
EXPORT_BATCH_SIZE=10
```

首次初始化时临时增加：

```dotenv
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=one-time-strong-password
ADMIN_CHINESE_NAME=系统管理员
ADMIN_ENGLISH_NAME=System Administrator
ADMIN_USERNAME=lumina.admin
ADMIN_ROTATE_PASSWORD=false
```

`NEXT_PUBLIC_*` 会进入浏览器包，只能放公开值。`TURNSTILE_SECRET_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY` 必须长期保留在服务器/worker 密钥管理中，绝不能进入浏览器。`ADMIN_PASSWORD` 仅用于一次初始化，成功后必须从本地、CI 和托管环境彻底删除。

## 3. Supabase 配置

1. Auth → Sign Up：关闭公开/匿名 signup；CRM 不提供自助注册、邀请注册或家长注册。
2. Auth → URL Configuration：设置正式 `APP_URL` 和 `/reset-password` 回调。
3. 配置正式 SMTP 和邮件 webhook 的 `staff-account-created` 模板。模板接收中英文姓名、账户名、临时密码、登录地址和 MFA 要求；邮件服务不得记录临时密码正文。
4. 为正式域名创建 Turnstile widget，配置 site key、server secret 和精确 hostname；服务端 Siteverify 是必需步骤。测试密钥不得用于生产。
5. 超级管理员和管理员必须使用 TOTP MFA。邮箱确认可作为通知/恢复渠道，但不能替代 AAL2 第二因素。
6. 确认 Storage 的 `crm-avatars`、`crm-exports` 均为 private。
7. 应用迁移：

```bash
npx supabase db push --linked
```

迁移顺序由文件名保证，当前为 `202607160001` 至 `202607170020`。先在暂存项目运行：

```bash
npx supabase test db --linked supabase/tests/authorization_structure.sql
```

## 4. 创建真实初始管理员

```bash
npm run auth:bootstrap-admin
```

确认 Supabase Auth 中存在用户、`workspace_memberships.role=SUPER_ADMIN`、`must_change_password=true`、`user_profiles.username` 正确。随后删除所有托管环境和 CI 中的 `ADMIN_PASSWORD`。首次登录会被强制修改临时密码，然后强制注册 TOTP MFA；达到 AAL2 前 RLS 不授予管理员 CRM 数据权限。环境变量本身不会创建账号。

## 5. 构建与发布

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

本仓库使用 `vinext build` 并生成 `dist/`。若使用 OpenAI Sites，应在获得明确发布授权后创建/复用私有项目，将返回的 `project_id` 写入 `.openai/hosting.json`，保存上述运行时变量，并部署已经通过测试的同一提交。本次未创建或发布远程 Sites 项目。

## 6. Worker 调度

建议每分钟运行提醒、每分钟运行通知 outbox、每 1–5 分钟运行导出任务：

```bash
npm run reminders:process
npm run outbox:process
npm run exports:process
```

执行器必须单实例或依赖当前 claim 条件防重。对退出码、连续失败、`generated_jobs.status=FAILED`、outbox 失败和提醒重试设置告警。导出文件位于私有桶，签名链接 60 秒有效，文件 24 小时后由 export worker 清理。

## 7. 健康、备份与监控

- `GET /api/health` 必须返回 200、`status=ok` 和当前版本。
- 监控 5xx、登录限流、RLS 403、审批执行失败、慢查询、邮件失败和存储容量。
- 启用 Supabase PITR 或每日备份；定期导出 Auth/数据库配置清单。
- 每季度在隔离项目恢复备份，验证 Auth、RLS、合同、付款、提醒和私有文件权限。

## 8. 上线验收

- 真实员工登录成功；错误密码返回 401，错误位于登录表单。
- 每次登录必须完成 Turnstile；失败时错误位于验证器旁且验证器自动刷新。
- 直接调用 signup 被拒绝；不存在注册页面/API。
- 普通管理员能创建员工但不能创建管理员；只有超级管理员能创建管理员。
- 新账号使用随机临时密码，邮件发送失败时账号回滚；首次登录必须改密。
- 超级管理员和管理员的 AAL1 会话被引导到 MFA，直接读取管理员 API 返回 403 或被 RLS 拒绝。
- 两个不同管理员完成 maker/checker，申请人不能自审。
- 合同签署、业绩分配和导出审批产生正确且唯一的副作用。
- 运行 `exports:process` 后文件可下载，60 秒签名和 24 小时过期有效。
- 中文/英文切换覆盖全站；除人员姓名外不同时显示双语业务字段。
- 使用 `ms-playwright/chromium-1228` 验证桌面、平板、375px、键盘焦点、表单就地错误、双月日历和无横向溢出。

## 9. 回滚

1. 停止 worker 和新写入流量。
2. 将应用回滚到上一已验证提交。
3. 数据库优先使用向前修复迁移；只有在恢复演练确认后才执行备份恢复。
4. 不删除已写入的审批、审计、付款或合同版本以“回滚界面”。
5. 恢复后重新运行健康、权限矩阵和核心 HTTP/Chromium 验收。
