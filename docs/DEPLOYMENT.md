# Lumina CRM 部署指引（v0.2.0）

## 部署边界

v0.2.0 可以部署为受限的 UI/认证验收环境，但**不应作为真实客户数据的生产 CRM**。业务表、工作区 RLS、持久化设置、MFA 管理和服务端分页完成前，不要导入学生、家庭或学校真实资料。

## 1. 发布前准备

- Node.js 22.13 或更高版本。
- 独立的 Supabase 项目；不要复用其他生产系统的数据库。
- Cloudflare Turnstile 正式站点和密钥。
- 最终 HTTPS 域名，例如 `https://crm.example.com`。
- Supabase Auth 已配置发信服务，Site URL 与允许的 Redirect URL 包含 `https://crm.example.com/reset-password`。

复制 `.env.example` 作为环境变量清单。托管环境长期保留的变量只有：

```text
CRM_DEMO_MODE=false
APP_URL=https://crm.example.com
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>
TURNSTILE_SECRET_KEY=<secret key>
TURNSTILE_EXPECTED_HOSTNAME=crm.example.com
```

`NEXT_PUBLIC_*` 会进入浏览器包，只能放公开值。`TURNSTILE_SECRET_KEY` 必须是服务端密钥。不要在生产环境启用演示模式或使用 Turnstile 测试密钥。

## 2. 创建真实管理员账号

`.env` 变量不会自动创建 Supabase Auth 用户。请在可信的本地终端或一次性 CI 任务中临时提供以下变量：

```text
SUPABASE_SERVICE_ROLE_KEY
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_CHINESE_NAME
ADMIN_ENGLISH_NAME
ADMIN_ROTATE_PASSWORD=false
```

然后运行：

```bash
npm run auth:bootstrap-admin
```

在 Supabase Auth 控制台确认该用户已存在，且 `app_metadata.role=ADMIN`、`app_metadata.account_status=ACTIVE`。首次登录后立即修改密码，并从本地文件、CI 变量和托管 secrets 中删除 `ADMIN_PASSWORD` 与 `SUPABASE_SERVICE_ROLE_KEY`。应用正常运行不需要 service-role key。

## 3. 质量门禁

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

所有命令必须通过。随后使用指定的 Playwright Chromium 1228 验证：

- 登录错误显示在登录表单内。
- 家长注册错误和 Turnstile 失败显示在注册表单内，验证器自动刷新。
- 未批准的家长账号无法进入 `/dashboard`。
- 非管理员不能访问 `/admin/**`。
- 密码重置链接只在表单内显示结果，URL 不包含错误原因。
- 375px 手机视口无 Turnstile、协议或表单横向溢出。

## 4. 使用 Sites 发布

项目包含 `.openai/hosting.json`，应通过 Sites 保存和发布已通过构建的同一份源码。首次发布时创建站点并把生成的 `project_id` 写回该文件；后续复用同一站点。运行时变量通过 Sites 的环境/secret 管理设置，不要提交 `.env.local`。

优先发布为私有验收环境。只有在远程 Supabase、正式 Turnstile、管理员初始化和上述质量门禁都完成后，才考虑公开域名。当前仓库没有有效 `project_id`，因此不能把本地 Supabase 地址打包后直接发布。

## 5. 发布后检查

1. 打开 `/login`，确认页面不显示演示账号。
2. 使用真实管理员登录并检查 `/dashboard`、`/admin/guardians`、`/settings/security`。
3. 使用无管理员角色账号请求 `/admin`，应被重定向到 `/dashboard`。
4. 等待或缩短 JWT 有效期，确认 refresh token 能恢复会话。
5. 触发密码重置邮件，确认链接回到正式域名 `/reset-password`。
6. 检查 Supabase Auth 日志、Turnstile 验证率和托管平台错误日志。

## 6. 回滚与密钥事件

- 发布失败时回滚到上一个已验证的 Sites 版本，不要在生产环境现场修改构建产物。
- 若 anon key 泄漏，按 Supabase 项目策略轮换并重新构建；若 service-role key 泄漏，立即轮换、审计管理员操作并撤销所有相关 CI secrets。
- 若怀疑账号泄漏，禁用用户、撤销会话、检查 `app_metadata` 与 Auth 日志，再恢复访问。

## 正式上线前的硬阻断项

必须先完成 `ARCHITECTURE_UI_REVIEW.md` 中的 P0 项：应用数据库和迁移、workspace RLS、服务端分页、真实设置/MFA、权限矩阵以及 Chromium 1228 浏览器回归。未完成时仅可用于内部 UI/认证验收。
