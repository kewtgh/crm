# Lumina CRM 部署指引（v0.3.0）

## 部署边界

v0.3.0 可以部署为受限的 UI/认证验收环境，但**不应作为真实客户数据的生产 CRM**。业务表、工作区 RLS、持久化设置、日程通知、销售目标版本、MFA 管理和服务端分页完成前，不要导入学生、家庭或学校真实资料。

## 1. 发布前准备

- Node.js 22.13 或更高版本。
- 独立的 Supabase 项目；不要复用其他生产系统的数据库。
- Cloudflare Turnstile 正式站点和密钥。
- 最终 HTTPS 域名，例如 `https://crm.example.com`。
- Supabase Auth 已配置发信服务，Site URL 与允许的 Redirect URL 包含 `https://crm.example.com/reset-password`。
- 已按顺序应用 `supabase/migrations/`，包括独立账户名唯一约束和 `username_available` 查重函数。

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
ADMIN_USERNAME
ADMIN_ROTATE_PASSWORD=false
```

然后运行：

```bash
npm run auth:bootstrap-admin
```

在 Supabase Auth 控制台确认该用户已存在，且 `app_metadata.role=ADMIN`、`app_metadata.account_status=ACTIVE`，`user_profiles.username` 唯一且不等于姓名。首次登录后立即修改密码，并从本地文件、CI 变量和托管 secrets 中删除 `ADMIN_PASSWORD` 与 `SUPABASE_SERVICE_ROLE_KEY`。应用正常运行不需要 service-role key。

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
- `/calendar` 在桌面显示双月视图，在手机端自然堆叠；创建预约和关闭提醒有明确反馈。
- `/sales/performance` 的团队筛选、季度/全年切换和目标调整可操作，图表不依赖颜色传达唯一含义。
- 中英文切换后菜单、错误、无障碍标签、后台和业务页只显示当前语言；人员姓名仍同时显示中英文。
- 关系推进和关单 Playbook 在手机端自然堆叠，每阶段显示 3–5 条建议。
- `/contracts` 搜索、分页、续约提醒和日历入口可用；`/products` 包含五个默认产品并支持会话内自定义。
- `/analytics/consumption` 的月/季/年切换和 Dashboard 消费看板一致。

## 4. 使用 Sites 发布

项目包含 `.openai/hosting.json`，应通过 Sites 保存和发布已通过构建的同一份源码。首次发布时创建站点并把生成的 `project_id` 写回该文件；后续复用同一站点。运行时变量通过 Sites 的环境/secret 管理设置，不要提交 `.env.local`。

优先发布为私有验收环境。只有在远程 Supabase、正式 Turnstile、管理员初始化和上述质量门禁都完成后，才考虑公开域名。当前仓库没有有效 `project_id`，因此不能把本地 Supabase 地址打包后直接发布。

## 5. 发布后检查

1. 打开 `/login`，确认页面不显示演示账号。
2. 使用真实管理员登录并检查 `/dashboard`、`/admin/guardians`、`/admin/users`、`/settings/security`。
3. 检查 `/calendar` 的双月切换、日程创建、提醒完成和移动端布局。
4. 检查 `/sales/performance` 的周期、团队、四级关系目标、两套 Playbook、预测和漏斗分析。
5. 检查 `/contracts`、`/products`、`/analytics/consumption` 和首页消费看板。
6. 在登录页和顶栏切换中英文，检查当前语言单语显示与人员姓名双语例外。
7. 在注册页验证账户名可用与重复错误都显示在账户名字段附近。
8. 使用无管理员角色账号请求 `/admin`，应被重定向到 `/dashboard`。
9. 等待或缩短 JWT 有效期，确认 refresh token 能恢复会话。
10. 触发密码重置邮件，确认链接回到正式域名 `/reset-password`。
11. 检查 Supabase Auth 日志、Turnstile 验证率和托管平台错误日志。

## 6. 回滚与密钥事件

- 发布失败时回滚到上一个已验证的 Sites 版本，不要在生产环境现场修改构建产物。
- 若 anon key 泄漏，按 Supabase 项目策略轮换并重新构建；若 service-role key 泄漏，立即轮换、审计管理员操作并撤销所有相关 CI secrets。
- 若怀疑账号泄漏，禁用用户、撤销会话、检查 `app_metadata` 与 Auth 日志，再恢复访问。

## 正式上线前的硬阻断项

必须先完成 `ARCHITECTURE_UI_REVIEW.md` 中的 P0 项：应用数据库和迁移、workspace RLS、服务端分页、真实设置/MFA、权限矩阵以及 Chromium 1228 浏览器回归。未完成时仅可用于内部 UI/认证验收。
