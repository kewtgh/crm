# Supabase 退出审计与本机 PostgreSQL 目标架构

- 日期：2026-07-29
- 范围：当前 `main`（应用版本 2.9.1）
- 目标：CRM Web、Worker 与 PostgreSQL 部署在同一台 VPS，解除 Supabase 平台依赖
- 本文阶段：阶段 1——依赖审计与目标架构

## 1. 结论

当前系统不是“使用 Supabase 托管 PostgreSQL 的普通应用”，而是以 Supabase Auth、PostgREST、
RLS、Storage、数据库 RPC、Supabase CLI 和 `service_role` 共同组成运行时边界的系统。

退出 Supabase 必须按以下顺序进行：

1. 建立标准 PostgreSQL 连接、事务、Repository 和 migration 基础设施；
2. 建立自有账户、凭据、会话、MFA 和权限上下文，并保持现有用户 UUID；
3. 把 PostgREST 查询和 RPC 分批迁到应用服务或标准 PostgreSQL 函数；
4. 替换 Storage 与 Worker 的 `service_role` 通道；
5. 重写 readiness、部署、备份和恢复流程；
6. 最后迁移数据并切换生产流量。

不能先复制数据、删除 RLS 或停用 Supabase Auth。现有外键、默认值、函数和策略大量依赖
`auth.users`、`auth.uid()`、`auth.jwt()` 和 Supabase 数据库角色；顺序错误会同时破坏身份完整性、
权限判断和事务函数。

## 2. 审计基线

### 2.1 数据库对象

| 对象 | 当前数量或状态 | 说明 |
| --- | ---: | --- |
| migration 文件 | 61 | `supabase/migrations/*.sql` |
| SQL 回归测试 | 12 | `supabase/tests/*.sql`，由 Supabase CLI/pgTAP 执行 |
| seed | 1 | `supabase/seed.sql` |
| 表 | 96 | 全部位于 `public` |
| 视图 | 1 | `monthly_consumption` |
| 显式命名索引 | 89 | 包括普通、唯一和部分索引 |
| PostgreSQL 函数 | 214 个唯一函数名 | 包含 RPC、触发器函数、权限 helper 和内部函数 |
| 生产代码直接调用的 RPC | 133 个唯一函数名 | 应用和生产 Worker；不含只在 smoke/QA 中出现的额外调用 |
| 非直接生产 RPC 函数 | 81 个 | 内部 helper、触发器、兼容函数、测试或间接调用 |
| `CREATE POLICY` 语句 | 173 | 分布在 19 个 migration 文件 |
| 启用 RLS 的表 | 96/96 | 82 张显式启用，14 张由 migration 动态循环启用 |
| `CREATE TRIGGER` 语句 | 41 | 另有循环为 14 张表动态创建审计触发器 |
| 扩展 | 3 | `citext`、`pgcrypto`、可选 `pg_cron` |

计数按 migration 历史中的唯一对象名或语句计算。重复的 `CREATE OR REPLACE` 不重复计入函数
名称，但语句计数保留历史迁移事实。

### 2.2 代码依赖面

| 范围 | 直接依赖文件数 | 主要依赖 |
| --- | ---: | --- |
| `app`、`components`、`lib`、`worker` | 84 | Auth、REST、RPC、Storage、错误语义 |
| 生产脚本 | 12 | Worker、管理员初始化、发布、schema gate |
| QA/测试脚本 | 10 | Auth 管理接口、AAL2、PostgREST、Storage、本地 Supabase |

项目没有运行时 `@supabase/supabase-js`。`lib/supabase-server.ts` 使用 `fetch` 自行实现了
Supabase REST/Auth/Admin 客户端，因此“没有 Supabase JS SDK”不等于已解耦。

当前核心环境变量为：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRM_WORKSPACE_ID`

生产部署还要求：

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF`

## 3. 能力替换矩阵

| 当前能力 | 当前实现 | 目标实现 | 迁移边界 |
| --- | --- | --- | --- |
| Supabase PostgreSQL | 托管 PostgreSQL 17 | VPS 上的 PostgreSQL 18 | 使用当前受支持版本，端口只监听 loopback |
| PostgREST 查询 | 手写 `/rest/v1/*` URL | `pg` Pool + Kysely Repository | 所有查询必须显式带 workspace/owner 范围 |
| Supabase RPC | 133 个生产 RPC | 应用服务事务或标准 PostgreSQL 函数 | 原子队列、并发控制和强约束函数优先保留 |
| Supabase Auth | GoTrue Auth API | 应用自建账户、凭据、会话和 MFA | 保持用户 UUID，不能复制成无边界的普通用户表 |
| JWT/RLS 上下文 | `auth.uid/jwt/role` | 服务端 Session + 应用权限层 | 关键数据可保留标准 PostgreSQL RLS 作为纵深防御 |
| `authenticated`/`anon` | Supabase 数据库角色 | 无客户端数据库角色 | 浏览器永远不获得数据库凭据 |
| `service_role` | 管理 API、Worker、公共 portal | 最小权限的 app/worker 数据库角色 | 不允许新的 BYPASSRLS 等价万能密钥 |
| Supabase Storage | `crm-avatars`、`crm-exports` | S3 兼容对象存储 | 数据库只保存 object key、类型、大小、校验和 |
| Storage signed URL | Supabase 签名接口 | S3 presigned URL 或应用流式下载 | 保持短时效和用户授权检查 |
| Realtime | 未使用 | 不实现 | 无迁移工作 |
| Edge Functions | 未使用 | 不实现 | 无迁移工作 |
| pg_cron | 可选提醒任务 | systemd timer + Worker | 避免数据库内和系统定时器双重调度 |
| Supabase migrations | `supabase db push` | 项目内标准 SQL migration runner | advisory lock、migration 表、失败即停止 |
| Supabase readiness | Auth health + service RPC | Session/DB/Worker/Queue 分组件检查 | 数据库失败需返回精确原因 |
| Supabase 本地 QA | Supabase CLI + Docker | 临时 PostgreSQL 数据库 + 应用测试 fixture | pgTAP 可保留，但不再依赖 Supabase 容器命名 |

## 4. 逐项依赖审计

### 4.1 PostgreSQL Schema

96 张表按业务域如下。

#### 身份、权限与安全

`workspaces`、`workspace_memberships`、`user_profiles`、`user_preferences`、
`sales_team_members`、`record_collaborators`、`trusted_login_devices`、
`mfa_recovery_codes`、`login_throttle_buckets`、`recovery_throttle_buckets`、
`captcha_challenges`、`staff_identity_changes`、`staff_identity_repair_jobs`、
`enterprise_directory_users`。

这些表并不是完整的认证系统。密码凭据、Supabase refresh session、邮箱确认和 TOTP factor
仍保存在 Supabase Auth 内部表。

#### CRM、学校、联系人、学生与家庭

`organizations`、`contacts`、`contact_consents`、`households`、`household_members`、`students`、
`student_guardian_relationships`、`student_academic_records`、`grade_progression_rules`、
`progression_batches`、`progression_batch_items`、`leads`、`lead_conversions`、
`admission_journeys`、`opportunities`、`opportunity_stage_history`、`crm_activities`、
`crm_tasks`、`appointments`、`appointment_attendees`。

学校当前由 `organizations` 表承载，没有独立 `schools` 表。学生通过 `person_id` 关联联系人，
家庭通过 household/member/guardian 关系表连接联系人和学生。

#### 销售、合同、财务与关系经营

`products`、`product_prices`、`product_bundles`、`product_bundle_items`、`quotes`、
`quote_versions`、`contracts`、`contract_versions`、`contract_documents`、
`contract_renewal_playbooks`、`payments`、`refunds`、`receivable_schedules`、
`reconciliation_items`、`exchange_rate_snapshots`、`performance_targets`、
`performance_allocations`、`performance_contributions`、`account_plans`、
`relationship_milestones`、`relationship_target_settings`、`growth_campaigns`、
`lead_attribution_touches`。

#### 审批、通知、导入导出和异步任务

`approval_requests`、`approval_actions`、`reminders`、`user_notifications`、
`notification_outbox`、`generated_jobs`、`import_batches`、`import_rows`、
`import_mapping_profiles`、`calendar_deliveries`、`worker_heartbeats`、
`mutation_receipts`。

#### 自动化、集成、通信和 portal

`automation_rules`、`automation_events`、`automation_runs`、`webhook_inbox`、
`integration_connections`、`integration_sync_jobs`、`connector_validation_receipts`、
`connector_reconciliation_receipts`、`communication_threads`、`communication_messages`、
`portal_invitations`、`portal_access_consents`、`portal_update_requests`。

#### 数据治理、隐私和建议

`audit_events`、`privacy_requests`、`privacy_executions`、`privacy_restrictions`、
`data_quality_issues`、`data_quality_rule_configs`、`data_quality_daily_snapshots`、
`shared_views`、`ai_suggestion_runs`、`ai_suggestions`、`ai_suggestion_decisions`、
`next_action_generation_batches`、`next_action_evaluations`、`next_best_actions`。

### 4.2 Supabase Auth

当前认证功能覆盖：

- 密码登录和 username-to-email 解析；
- access/refresh token Cookie；
- refresh token 续期；
- local/global/other-session 登出；
- 密码重置邮件；
- 首次登录强制改密；
- 邮箱 OTP 设备验证；
- trusted device；
- TOTP enroll/challenge/verify/unenroll；
- AAL2 权限门槛；
- MFA recovery code；
- 管理员创建、更新、停用和删除用户；
- SSO PKCE 启动与回调；
- SCIM 预配、绑定和停用。

主要入口包括：

- `lib/auth.ts`
- `lib/auth-session.ts`
- `lib/login-identity.ts`
- `app/api/auth/*`
- `app/api/settings/password/route.ts`
- `app/api/settings/mfa/route.ts`
- `app/api/settings/sessions/route.ts`
- `lib/admin-users-repository.ts`
- `lib/scim.ts`

Cookie 已使用 HttpOnly、SameSite=Lax，并在生产启用 Secure；但是 Cookie 内仍是 Supabase JWT
和 refresh token。`mutationIsTrusted()` 目前依赖 Origin/Sec-Fetch-Site 校验，自建 Session 阶段
应增加独立 CSRF token，并保留 Origin 校验作为第二道边界。

### 4.3 RLS 与权限

现有 96 张表全部启用 RLS。42 个 migration 文件直接依赖 Supabase Auth 上下文，历史 SQL 中
可见：

- `auth.users`：126 次；
- `auth.uid()`：435 次；
- `auth.jwt()`：15 次；
- `auth.role()`：14 次；
- `service_role`：69 次，分布在 29 个 migration 文件。

应用角色语义必须保持：

- `SUPER_ADMIN`
- `ADMIN`
- `SALES_DIRECTOR`
- `SALES_MANAGER`
- `SALES_SPECIALIST`
- `SALES_SUPPORT`

应用已有 capability 映射和 AAL2 capability 集合。目标架构应保留这些语义，并把检查集中到
服务层。每个 Repository 方法必须接收不可省略的 `AuthorizationContext`，至少包含：

```ts
type AuthorizationContext = {
  userId: string;
  workspaceId: string;
  role: AppRole;
  aal: "aal1" | "aal2";
};
```

不允许 Repository 从客户端 body/query 中接受 `userId` 或 `workspaceId` 作为可信权限上下文。

### 4.4 RPC、函数与触发器

生产代码直接调用 133 个 RPC。它们分为四类：

1. 查询/快照：dashboard、metrics、列表、timeline、报告；
2. 业务事务：审批、合同、学生升年、去重、隐私、portal、automation；
3. 原子队列：claim/complete/fail、lease、heartbeat；
4. 安全服务：登录限流、验证码、trusted device、身份补偿。

迁移策略：

- 查询/快照函数迁到 Repository/Service SQL；
- 只包装一次简单 insert/update 的 RPC 迁到应用服务事务；
- 需要 `FOR UPDATE SKIP LOCKED`、lease token、幂等回执、并发版本检查的函数暂时保留；
- FK、UNIQUE、CHECK、不可变审计和跨行一致性仍由 PostgreSQL 约束/触发器保证；
- 所有保留函数去除 `auth.*` 和 `service_role` 判断，显式接收 actor/workspace，并只授权给
  对应的 app/worker 数据库角色。

生产 RPC 完整清单：

`admin_dashboard_metrics`、`apply_account_recovery_throttle`、`apply_login_throttle`、
`apply_student_progression`、`assign_data_quality_issue`、`bulk_complete_crm_tasks`、
`business_improvement_snapshot`、`cancel_student_progression`、`change_opportunity_stage`、
`claim_calendar_deliveries_leased`、`claim_generated_jobs_leased`、
`claim_integration_sync_jobs`、`claim_notification_outbox_leased`、
`claim_webhook_events_leased`、`communication_inbox_snapshot`、`complete_appointment`、
`complete_calendar_delivery_leased`、`complete_generated_job_leased`、
`complete_identity_repair`、`complete_initial_password_change`、
`complete_integration_sync_job`、`complete_notification_outbox_leased`、
`complete_privacy_export_execution`、`complete_staff_identity_change`、
`complete_webhook_event_leased`、`configure_data_quality_rule`、`configure_integration`、
`consumption_report`、`contract_summary`、`convert_lead_to_opportunity`、
`create_appointment_with_delivery`、`create_approval`、`create_communication_thread`、
`create_contract_draft`、`create_contract_renewal`、`create_crm_export_approval`、
`create_crm_task`、`create_guardian_portal_invitation`、`create_product_bundle`、
`create_product_with_price`、`crm_duplicate_check`、`crm_record_history`、
`crm_resource_metrics`、`crm_task_workspace`、`customer_timeline`、`dashboard_snapshot`、
`decide_ai_suggestion`、`decide_approval`、`decide_next_best_action`、
`decide_portal_update`、`delete_shared_view`、`duplicate_merge_preview`、
`explain_record_access`、`fail_calendar_delivery_leased`、`fail_generated_job_leased`、
`fail_integration_sync_job`、`fail_notification_outbox_leased`、
`fail_privacy_export_execution`、`fail_webhook_event_leased`、
`generate_next_best_actions`、`generate_rule_suggestions`、`growth_performance_snapshot`、
`growth_snapshot`、`idempotent_merge_duplicate_records`、`idempotent_set_product_active`、
`import_dry_run`、`ingest_webhook_event`、`list_assignable_crm_users`、
`list_current_user_trusted_login_devices`、`list_staff_users`、`list_students_page`、
`manage_privacy_request`、`marketing_export_rows`、`operational_retryable_jobs_page`、
`operational_snapshot`、`performance_export_rows_v220`、`prepare_staff_identity_change`、
`preview_automation_rule`、`preview_student_progression`、`process_due_reminders`、
`product_catalog_snapshot`、`queue_communication_message`、`record_customer_activity`、
`record_exchange_rate_snapshot`、`record_inbound_communication`、
`record_worker_heartbeat`、`remove_household_member`、`remove_student_guardian`、
`renewal_playbook_context`、`request_integration_sync`、
`request_marketing_contact_export`、`resolve_data_quality_issue`、
`restore_crm_recycle_bin`、`retry_automation_run`、`retry_communication_message`、
`retry_operational_job`、`revoke_current_user_trusted_login_device`、
`revoke_guardian_portal_invitation`、`revoke_other_current_user_trusted_login_devices`、
`rollback_staff_identity_change`、`run_automation_event`、`run_data_quality_rules`、
`sales_performance_report_v220`、`save_contact_consent`、`save_crm_record`、
`save_household_member`、`save_performance_plan`、`save_progression_rule`、
`save_relationship_targets`、`save_renewal_playbook`、`save_shared_view`、
`save_student_guardian`、`service_accept_portal_consent`、
`service_complete_communication`、`service_consume_captcha_attestation`、
`service_consume_trusted_login_device`、`service_fail_communication`、
`service_issue_captcha_challenge`、`service_portal_snapshot`、
`service_readiness_snapshot_for_workers`、`service_register_trusted_login_device`、
`service_revoke_user_trusted_login_devices`、`service_submit_portal_update`、
`service_verify_captcha_challenge`、`set_product_price`、`submit_performance_plan`、
`super_admin_execute_approval`、`update_appointment_delivery`、
`update_household_record`、`update_progression_batch_item`、`update_student_record`、
`upsert_relationship_milestone`、`workspace_relationship_health`。

### 4.5 Storage

当前有两个私有 bucket：

| bucket | 内容 | 限制 | 当前访问方式 |
| --- | --- | --- | --- |
| `crm-avatars` | PNG/JPEG/WebP 头像 | 5 MiB | 用户 JWT + Storage RLS |
| `crm-exports` | CSV/XLSX/PDF 导出 | 20 MiB | Worker service role 上传，60 秒签名 URL 下载 |

数据库元数据分别保存在 `user_preferences.avatar_path` 和
`generated_jobs.artifact_path`。目标应引入 `ObjectStore` 接口：

```ts
interface ObjectStore {
  put(key: string, body: Uint8Array, metadata: ObjectMetadata): Promise<void>;
  get(key: string): Promise<ObjectBody>;
  delete(key: string): Promise<void>;
  signDownload(key: string, expiresInSeconds: number): Promise<string>;
}
```

生产默认使用 S3 兼容对象存储。本机文件实现只允许作为开发或明确批准的过渡方案，并必须放在
release 目录外的持久化路径。

### 4.6 Realtime 与 Edge Functions

- 没有 `supabase_realtime` publication；
- 没有 Realtime channel/client；
- 没有 `supabase/functions` 目录；
- 没有 `/functions/v1` 调用。

本次退出不需要实现 Realtime 或 Edge Function 替代品。

### 4.7 Worker、导入导出、报告和定时任务

生产 Worker 共六类：

- `REMINDERS`
- `NOTIFICATION_OUTBOX`
- `CALENDAR_DELIVERIES`
- `GENERATED_JOBS`
- `WEBHOOK_INBOX`（按 feature flag）
- `INTEGRATION_SYNC`（按 feature flag）

systemd timer 每五分钟运行一次 `scripts/process-worker-cycle.mjs`。每个 Worker 当前通过
PostgREST + `SUPABASE_SERVICE_ROLE_KEY` claim/complete/fail 队列，并写 heartbeat。

`pg_cron` migration 还会尝试每分钟调用 `process_due_reminders(100)`；目标架构应只保留一种
调度来源，建议统一使用 systemd timer。

导出 Worker 还负责：

- 读取合同、绩效、营销、CRM 和隐私数据；
- 生成 CSV/XLSX/PDF；
- 计算 SHA-256；
- 上传 `crm-exports`；
- 更新 job/隐私执行回执；
- 到期删除对象和元数据；
- 发送用户通知。

这些职责必须在 Storage 和数据库解耦后一起回归，不能只改上传代码。

### 4.8 Readiness、迁移与部署

当前 readiness：

1. 验证 Supabase URL、anon key、service role；
2. 调用 `/auth/v1/health`；
3. 以 service role 调用 `service_readiness_snapshot_for_workers`；
4. 检查 database、missing/stale workers、failed/stuck queues；
5. 返回组件级失败原因。

目标 readiness：

- `environment`：验证 `DATABASE_URL`、Session/TOTP 加密密钥、对象存储和启用的集成；
- `auth`：验证 Session store 可读写所需的数据库能力，不再探测外部 Auth 服务；
- `database`：带短超时的 `SELECT 1`、migration head 和必要扩展；
- `workers`：直接读取 heartbeat；
- `queues`：直接统计 failed/stuck job；
- 每个组件继续返回独立的 code、状态和 remediation。

当前生产 runner 会：

- link 固定 Supabase project ref；
- `supabase db push --dry-run`；
- `supabase db push`；
- `supabase db lint`；
- 删除 Supabase link cache；
- 切换 release 并验证 Web/Worker/readiness。

release、atomic symlink、systemd 和失败恢复骨架可以保留。migration 阶段应替换为：

1. 使用独立 migration 账户；
2. 获取 PostgreSQL advisory lock；
3. 校验 migration history 与 checksum；
4. 执行 forward-only 标准 SQL migration；
5. 失败时停止切换 release；
6. 数据库已前进时继续明确报告“应用可回退，数据库不自动回退”。

### 4.9 备份与恢复

仓库目前没有自主管理 PostgreSQL 所需的：

- `pg_dump` 备份脚本；
- 加密和异地上传；
- backup systemd service/timer；
- 成功/失败通知；
- `pg_restore` 恢复演练；
- WAL 归档/PITR；
- 恢复 runbook 和 RTO/RPO 记录。

因此在备份、异地复制和真实恢复演练通过之前，自建 PostgreSQL 不得成为生产唯一数据源。

## 5. 目标技术架构

### 5.1 数据访问

采用：

```text
Next Web / API / Worker
          ↓
Domain Service（业务、权限、事务边界）
          ↓
Repository（只能接收 AuthorizationContext）
          ↓
Kysely + node-postgres
          ↓
127.0.0.1:5432 PostgreSQL 18
```

选择 Kysely + `pg`，而不是在本阶段采用 Prisma，原因是当前 Schema 含大量函数、触发器、
部分索引、视图和手写 SQL 事务。Kysely 能提供类型化查询而不要求同时重塑整个数据库模型。
复杂查询和保留函数可继续使用参数化 SQL。

连接角色：

| 角色 | 权限 |
| --- | --- |
| `crm_app` | 业务查询/写入、执行明确授权的函数；无 DDL、无角色管理 |
| `crm_worker` | 只读 Worker 来源数据、执行 claim/complete/fail 和 heartbeat 函数 |
| `crm_migrator` | migration 所需 DDL；应用进程不可获得此凭据 |
| `postgres` | 仅主机管理和灾难恢复，不供应用/部署日常使用 |

PostgreSQL 只监听 `127.0.0.1`/`::1`，VPS 防火墙不开放 5432。

### 5.2 认证模型

新增清晰的认证域，建议最少包含：

| 表 | 责任 |
| --- | --- |
| `auth_accounts` | 用户 UUID、username、主邮箱、状态、创建/停用时间 |
| `auth_password_credentials` | Argon2id hash、参数、密码版本、更新时间 |
| `auth_sessions` | opaque token hash、user、AAL、过期、最近活动、撤销信息 |
| `auth_email_tokens` | 邮箱验证、设备验证和密码重置的一次性 token hash |
| `auth_totp_factors` | 加密 TOTP secret、验证状态、最后使用时间 |
| `auth_login_events` | 成功/失败、原因、来源摘要、session/user |

现有 `workspace_memberships`、`user_profiles`、`trusted_login_devices`、
`mfa_recovery_codes` 和 throttle 表按职责保留或迁入认证域。

关键规则：

- 保持 Supabase `auth.users.id` 作为新 `auth_accounts.id`，避免重写大量业务外键；
- 密码只能通过重置或已验证的迁移通道建立，不能导入未知/不可验证的 hash；
- Session Cookie 保存高熵 opaque token，不保存数据库主键或可伪造声明；
- 数据库只保存 token 的 SHA-256/HMAC hash；
- 密码使用 Argon2id；
- TOTP secret 使用独立 AEAD key 加密，key 不进入数据库；
- Session 支持单个撤销、撤销其他会话、全局撤销和密码版本失效；
- CSRF token 与 Session 绑定，所有 mutation 同时验证 CSRF 与 Origin；
- 管理员和现有 AAL2 capability 继续强制 MFA；
- 登录、改密、MFA、停用、恢复和会话撤销写入审计事件。

SSO 不应再由 Supabase 代理。目标是独立 `EnterpriseIdentityProvider` adapter；首批可保持
feature flag 关闭，完成 OIDC/SAML provider 选择和验证后再启用。SCIM 数据模型和 API 可以
保留，但预配结果写入自有账户/身份表。

### 5.3 数据库逻辑边界

| 逻辑 | 目标位置 |
| --- | --- |
| 页面列表、搜索、排序、分页 | Repository |
| dashboard/metrics/report 查询 | Repository 或只读 SQL view |
| 权限/capability/AAL2 | 应用服务层 |
| workspace/owner 范围 | 应用服务 + Repository 强制参数 |
| 单表 CRUD | Repository |
| 跨表业务流程 | Domain Service + 数据库 transaction |
| 唯一性、FK、CHECK、金额/状态不变量 | PostgreSQL constraint |
| queue claim/lease/complete/fail | PostgreSQL 函数 |
| 幂等 key、并发 version、原子合并 | PostgreSQL 约束/函数 |
| 审计 | 应用写入 + 必要数据库触发器 |

初次迁移可保留 `public` 对象名以降低风险，但必须撤销 `PUBLIC CREATE`。Schema 重新分区不是
Supabase 退出的前置条件，避免在同一阶段同时改连接方式、对象名称和业务语义。

## 6. 分阶段实施与验收门槛

### 阶段 1：依赖审计与目标架构

- [x] 盘点数据库、Auth、RLS、Storage、Realtime、Edge Function、Worker、部署和 readiness；
- [x] 建立替换矩阵；
- [x] 选择 `pg` + Kysely；
- [x] 确定用户 UUID 保持策略和最小数据库角色。

### 阶段 2：标准 PostgreSQL 数据层

- [x] 增加 `pg`、Kysely、连接池和 transaction helper；
- [x] 建立 `db/migrations`、history/checksum 和 advisory lock；
- [x] 建立 `AuthorizationContext` 与 Repository 约束；
- [x] 完成全部 Repository 垂直切片迁移；
- [x] 在标准 PostgreSQL 18.4 空数据库运行 migration 测试；
- [x] 禁止新增旧平台 HTTP gateway 调用。

验收：目标切片不使用 Supabase HTTP API；目标测试通过；连接角色权限测试通过。

### 阶段 3：认证与权限替换

- [x] 创建账户、密码、Session、token、TOTP 和登录审计表；
- [x] 实现 Argon2id、opaque Session、CSRF、撤销和轮换；
- [x] 迁移登录、refresh、logout、reset、MFA 和管理员账户 API；
- [x] 保留角色、capability、AAL2 和停用语义；
- [x] 由于源库只有测试数据，改为安全 bootstrap，不迁移旧用户凭据；
- [x] 完成权限、跨 workspace、停用和会话撤销回归。

验收：应用认证路径不调用 `/auth/v1`；旧 access/refresh token 不再被接受。

### 阶段 4：Storage、RPC 和 Worker 解耦

- [x] 引入 `ObjectStore`；
- [x] 迁移头像和导出；
- [x] 分类并迁移 133 个生产 RPC；
- [x] Worker 改用 `crm_worker` 连接；
- [x] 删除万能平台角色运行时需求；
- [x] 移除重复数据库定时调度。

验收：生产路径不调用 `/rest/v1` 或 `/storage/v1`；队列并发/lease/幂等测试通过。

### 阶段 5：本机 PostgreSQL 运维体系

- [x] 提供并实测 loopback-only PostgreSQL 18.4 配置；
- [x] 创建 app/system/worker/migrator/backup 角色；
- [x] 设置连接、内存、慢查询、日志轮转和磁盘告警；
- [x] 建立 VACUUM/ANALYZE 运维指引；
- [x] 明确仅在观测到连接压力时引入 PgBouncer，本轮不安装。

验收：从非本机无法连接 5432；角色权限测试通过；磁盘和慢查询告警可验证。

### 阶段 6：数据迁移与校验

- [x] 源库仅有测试数据，按授权跳过全量导出/导入并从空库重建；
- [x] 无需增量迁移或 CDC；
- [x] clean cutover 流程写入部署手册；
- [x] 校验迁移数量、FK、索引、重复身份和孤儿关系；
- [x] migration 文件使用 SHA-256 checksum 并禁止改写已应用文件；
- [x] Storage 对象 key、路径、大小和 hash 由抽象层验证；
- [x] 空库迁移可幂等重跑，第二次为 0 applied/65 current。

验收：自动校验为零差异；人工抽查通过；重复运行不产生重复数据。

### 阶段 7：部署、备份和恢复

- [x] runner 使用标准 migration runner；
- [x] readiness 改为本机 PostgreSQL；
- [x] 每日 custom-format `pg_dump`；
- [x] 独立密钥加密并上传异地对象存储；
- [x] 14–30 天远端生命周期要求和短期本地保留；
- [x] 成功/失败通知；
- [x] 在隔离数据库做自动 `pg_restore`；
- [x] 记录 RPO、RTO 和恢复 runbook。

验收：一次真实恢复演练通过后，才允许进入生产切换阶段。

### 阶段 8：预生产与正式切换

1. [x] 本机独立环境从空库构建；
2. [x] 按测试数据可丢弃授权取消数据副本导入；
3. [x] 自动 Schema/约束/重复项/孤儿关系校验；
4. [x] 业务契约、权限、Worker、备份恢复测试；
5. [ ] 在实际 VPS 维护窗口停止旧测试系统写入；
6. [x] 无需最终增量迁移；
7. [ ] 在实际 VPS 安装 Caddy/systemd 并切换域名；
8. [ ] 在 hosted 环境验证登录、查询、写入、Worker、对象和备份通知；
9. [ ] 旧测试项目按运营方保留期设为只读；
10. [ ] 稳定观察期后由项目所有者关闭旧项目。

阶段 8 的未勾选项都是需要 VPS、DNS、真实密钥或提供商控制台权限的外部上线动作，不是仓库
开发缺口；可执行步骤已写入 `docs/DEPLOYMENT.md`。

## 7. 主要风险与控制

| 风险 | 级别 | 控制 |
| --- | --- | --- |
| 用户 ID 或外键变化 | 严重 | 保持原 UUID；迁移前后 FK/行数校验 |
| RLS 移除造成越权 | 严重 | AuthorizationContext、Repository 强制范围、权限回归 |
| Session/MFA 降级 | 严重 | 独立安全测试、token hash、AEAD、AAL2、撤销测试 |
| RPC 事务语义丢失 | 高 | 逐函数分类；锁/幂等/并发函数优先保留 |
| 万能平台角色被换成万能数据库账户 | 高 | app/system/worker 显式最小 GRANT；仅只读备份角色可绕过 RLS |
| Storage 对象丢失 | 高 | key/大小/hash 清单，双写或冻结后增量复制 |
| migration 与代码不兼容 | 高 | expand/contract、advisory lock、切换前检查 |
| 只有备份、无法恢复 | 严重 | 隔离环境真实恢复为生产前置门槛 |
| Web 与数据库同机资源竞争 | 中 | 连接上限、内存预算、磁盘/IO 告警 |

## 8. 审计阶段的初始执行边界（历史记录）

- 不连接或修改生产 Supabase；
- 不执行数据导出、导入或 schema push；
- 不删除 RLS、函数、触发器或 Storage bucket；
- 不改动现有登录、Worker 或生产部署行为；
- 不安装 PostgreSQL、对象存储或新 npm 依赖；
- 不运行完整浏览器矩阵或完整数据库回归。

以上边界只记录审计形成时尚未授权执行的动作。后续已经按
`POSTGRESQL_SELF_HOSTED_MIGRATION_EXECUTION_PLAN_2026-07-29.md` 完成阶段 2–7 的仓库实现、
空库重建和本地恢复演练；实际 VPS、DNS、真实供应商配置和旧项目关闭仍保持为阶段 8 外部
上线门禁。
