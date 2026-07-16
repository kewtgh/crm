# Lumina CRM 部署指引（v0.5.0）

## 部署判定

v0.5.0 已具备真实认证、工作区/RLS、审计和若干核心业务纵切，但仍有 fixture 领域和外部邮件/合同服务缺口。可以发布到私有验收环境；在本文“正式上线门禁”全部完成前，不应导入真实敏感客户资料或开放公网生产使用。

## 1. 准备独立基础设施

- Node.js 22.13 或更高版本。
- 此 CRM 独占的 Supabase 项目；不得复用其他项目的容器、数据库或 Auth 用户池。
- 正式 HTTPS 域名和 Cloudflare Turnstile 正式站点。
- Supabase Auth 发信服务，Site URL/Redirect URL 至少包含正式域名和 `/reset-password`。
- 邮件 outbox 消费者；应用会创建邮件任务，但不会伪装为已经发送。
- 数据库备份、日志与告警。

## 2. 安装并应用数据库迁移

```bash
npm ci
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

检查 `supabase/migrations/` 全部按顺序应用。确认：

- `workspace_memberships`、核心业务表和 storage policies 已启用 RLS；
- `crm-avatars` 是私有 bucket；
- `lumina-crm-due-reminders` 的 `pg_cron` 任务存在。若目标计划不提供 `pg_cron`，在隔离的可信任务运行器中定时执行 `npm run reminders:process`；service-role key 只能存在于该任务运行器，不能放入浏览器或普通应用运行时；
- `notification_outbox` 由单独邮件发送器消费，并保留重试和失败记录。

## 3. 配置运行时变量

普通应用运行时长期保留：

```text
CRM_DEMO_MODE=false
APP_URL=https://crm.example.com
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>
TURNSTILE_SECRET_KEY=<secret key>
TURNSTILE_EXPECTED_HOSTNAME=crm.example.com
```

`NEXT_PUBLIC_*` 会进入浏览器包，只能放公开值。不要部署 `.env.local`，不要启用 demo mode，也不要在正式环境使用 Turnstile 测试密钥。

## 4. 一次性创建真实超级管理员

环境变量不会创建 Supabase Auth 用户。在可信本地终端或一次性 CI 任务中临时提供：

```text
SUPABASE_SERVICE_ROLE_KEY
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_CHINESE_NAME
ADMIN_ENGLISH_NAME
ADMIN_USERNAME
ADMIN_ROTATE_PASSWORD=false
```

运行：

```bash
npm run auth:bootstrap-admin
```

确认 Auth 用户真实存在，`app_metadata.role=SUPER_ADMIN`、`app_metadata.account_status=ACTIVE`，账户名唯一且不等于姓名。首次登录后修改密码，并立即从本地、CI 和托管 secrets 删除 `ADMIN_PASSWORD`。普通应用运行时也应删除 `SUPABASE_SERVICE_ROLE_KEY`。管理员层级为 `SUPER_ADMIN`/`ADMIN`；销售层级为 `SALES_DIRECTOR`、`SALES_MANAGER`、`SALES_SPECIALIST`，支线为 `SALES_SUPPORT`。

## 5. 质量门禁

```bash
npm run typecheck
npm run lint
npm test
npm audit
```

随后使用指定的 `ms-playwright/chromium-1228` 验收 1440px 桌面和 375×812 手机：

- 登录/注册错误位于对应表单；URL 不出现错误或凭据；Turnstile 失败后自动刷新。
- 手机端 Turnstile、协议、抽屉、表格和双月日历无文档级横向溢出。
- 中英文切换覆盖菜单、后台、错误、ARIA 与页面标题；仅人员姓名同时显示中英文。
- 学校/联系人/任务和合同的搜索、排序、分页、CSV 与查重访问真实接口。
- 日程创建/完成、合同续约提醒、产品创建/停用、月/季/年消费看板能在刷新后保持。
- 设置、头像、通知、密码、其他设备退出与 MFA 错误都在当前设置表单显示。
- 合同签订/导出、业绩汇总/分配会创建审批；申请人不能审批自己的请求。
- 销售经理目标分配不得超额或重复，销售支持使用 assisted attribution。
- 四级客户关系目标、每阶段 3–5 条关系建议和 3–5 条关单建议在手机端可读。

## 6. 使用 Sites 发布私有验收版本

仓库包含 `.openai/hosting.json`，应通过 Sites 发布与上述构建完全相同的源码。当前文件没有 `project_id`，首次发布必须先创建站点并把返回的 `project_id` 写回；运行时变量通过 Sites secrets 管理，不写入仓库。

优先发布私有版本。公开发布属于外部状态变更，必须在远程 Supabase、正式 Turnstile、管理员初始化、邮件 outbox、备份和全部门禁完成后再授权执行。本次只提供指引，没有创建或发布 Sites 项目。

## 7. 发布后检查与回滚

1. 使用超级管理员、普通管理员、销售总监、经理、专员和销售支持各一个测试账号完成权限矩阵。
2. 使用第二管理员批准第一管理员提交的审批，确认 maker/checker 生效。
3. 创建一条短期测试合同和预约，确认 reminders、站内通知、outbox 与实际邮件消费者链路。
4. 触发密码重置、邮箱修改、MFA 和其他设备退出，检查 Auth 日志。
5. 观察 Turnstile 验证率、数据库慢查询、RLS 拒绝、提醒失败与托管错误日志。
6. 回滚时发布上一个已验证的 Sites 版本；数据库使用向前修复迁移，不在生产库手工改表。

密钥泄漏时立即轮换并审计。service-role key 泄漏还需要检查所有管理员操作、撤销相关任务凭据；账号泄漏需禁用用户并撤销会话。

## 正式上线门禁

- 将学生、家庭、线索、商机、导入/合并、数据质量和管理员用户管理从 fixture 迁移到真实 workspace/RLS 架构。
- 完成合同文件生成、审批后导出、电子签和回写。
- 上线邮件 outbox 消费者与死信/重试监控。
- 完成第二管理员 maker/checker、全角色 UAT、备份恢复演练、法律/隐私评审、高数据量与 Chromium 1228 可访问性回归。
