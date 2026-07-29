# 本机 PostgreSQL 完整重构与迁移执行计划

> **Archived / obsolete production architecture:** this plan describes the retired host
> PostgreSQL/Node deployment. Use `docs/DEPLOYMENT.md` for the v3.7 Compose architecture.

- 日期：2026-07-29
- 输入审计：`docs/SUPABASE_EXIT_AUDIT_AND_TARGET_ARCHITECTURE_2026-07-29.md`
- 数据假设：现有生产数据库为测试数据，可销毁并从空库重建
- 目标版本：3.0.0
- 终态：运行时、测试、Worker、部署和运维不再依赖 Supabase

## 1. 完成定义

只有同时满足以下条件，迁移才算完成：

1. Web/API/Worker 不调用 Supabase Auth、PostgREST、Storage、Realtime 或 Edge Functions；
2. 运行时不需要 Supabase URL、anon key、service role 或 Supabase CLI 凭据；
3. PostgreSQL 使用项目内标准 migration 从空库完整建立；
4. 用户、密码、Session、密码重置、邮箱验证、TOTP、恢复码和撤销由应用管理；
5. 所有业务数据访问通过标准 PostgreSQL driver/Kysely；
6. 文件通过对象存储抽象访问；
7. Worker 使用独立低权限数据库账户；
8. readiness 能独立报告环境、认证数据库、业务数据库、Worker 和队列状态；
9. 部署使用 migration advisory lock，不再 link Supabase project；
10. 每日加密备份、异地上传、通知和真实恢复测试均有可执行实现；
11. 历次开发计划的未完成项完成或被明确记录为经批准的后续项；
12. typecheck、lint、targeted tests、标准 PostgreSQL migration 测试和受影响浏览器流程通过；
13. 版本、README、部署文档和实施状态一致；
14. 全部修改形成一个可审计的 Git 提交。

## 2. 目标结构

```text
app / API / worker
        ↓
domain service + authorization context
        ↓
repository / query gateway
        ↓
Kysely + node-postgres
        ↓
127.0.0.1:5432 PostgreSQL 18
```

新增核心目录：

```text
db/
  migrations/
  bootstrap/
  tests/
lib/
  db/
  auth/
  storage/
scripts/
  db-migrate.mjs
  db-bootstrap.mjs
  db-reset-test.mjs
  backup-postgres.mjs
  verify-postgres-backup.mjs
deploy/
  postgresql/
  systemd/
```

数据库角色：

| 角色 | 用途 | 禁止 |
| --- | --- | --- |
| `crm_app` | Web/API 普通业务查询和受控函数 | DDL、角色管理、BYPASSRLS |
| `crm_system` | Web 内部认证、公开 portal 和管理补偿操作 | DDL、BYPASSRLS、任意函数 |
| `crm_worker` | 队列 claim/complete/fail、来源读取、heartbeat | DDL、认证凭据写入 |
| `crm_migrator` | migration DDL | 供 Web/Worker 使用 |
| `crm_backup` | 全库逻辑备份，只读且唯一允许 BYPASSRLS | Web/Worker 使用、写入、DDL |

## 3. 工作包

### WP-1：依赖与配置

修改：

- 增加 `pg`、Kysely、Argon2id 和 S3 兼容对象存储依赖；
- 删除 Supabase CLI 依赖；
- 环境变量改为数据库、Session、TOTP、CSRF 和对象存储配置；
- CSP 删除 Supabase HTTP/WebSocket origin；
- 增加运行时配置验证和 secret 独立性验证。

验收：

- 活跃代码和 package scripts 不要求任何 `SUPABASE_*`；
- production 配置缺失时返回明确、无敏感信息的错误。

### WP-2：标准 PostgreSQL 数据层

实现：

- app/system/worker 连接池；
- request transaction 和 `AuthorizationContext`；
- 参数化 SQL；
- Kysely 数据库类型入口；
- RPC 调用器；
- Repository 查询 gateway，支持现有分页、筛选、嵌套关系、写入和 count 语义；
- PostgreSQL 错误到现有 API error code 的映射；
- 连接超时、query timeout、事务回滚和关闭钩子。

为控制一次性风险，现有 Repository 的业务接口保持不变。内部 Supabase HTTP 调用替换为
本地 PostgreSQL query gateway；完成后不存在网络 PostgREST 请求。

验收：

- 普通、system 和 worker 查询使用不同 pool；
- 所有 SQL 值参数化；
- workspace/user 上下文不可由客户端覆盖；
- 现有 Repository 调用者无需了解数据库连接。

### WP-3：标准 Schema 与 migration

由于旧库无真实数据，采用 clean rebuild：

1. 建立 `app_auth` 认证 schema 和账户根表；
2. 将现有 61 个 migration 转换为标准 PostgreSQL migration；
3. `auth.users` 外键指向 `app_auth.accounts`；
4. Supabase JWT helper 替换为 transaction-local 应用上下文；
5. 删除 Storage schema、Supabase role 和 pg_cron 平台依赖；
6. 增加最终认证、Session、token、TOTP 和登录审计表；
7. 保留业务 FK、UNIQUE、CHECK、索引、事务函数和审计触发器；
8. migration history 保存文件 checksum；
9. migration runner 使用 advisory lock。

验收：

- 全空 PostgreSQL 18 数据库可一次建立到 head；
- 重跑 migration 为 no-op；
- 文件 checksum 改变会失败；
- app/system/worker 权限结构测试通过；
- schema 中没有 `auth.uid/auth.jwt/auth.role` 或 `storage.*`。

### WP-4：自建认证与权限

实现：

- `app_auth.accounts`
- `app_auth.password_credentials`
- `app_auth.sessions`
- `app_auth.email_tokens`
- `app_auth.totp_factors`
- `app_auth.login_events`
- Argon2id 密码 hash/verify/rehash；
- opaque Session token，只保存 token hash；
- Session idle/absolute expiry、轮换、单个/其他/全局撤销；
- CSRF double-submit + Session 绑定 + Origin 验证；
- 邮箱验证、设备验证和密码重置的一次性 token；
- TOTP secret AEAD 加密、challenge/verify、recovery code；
- 管理员创建、停用、恢复和密码初始化；
- 保留角色、capability、AAL2、SCIM 和 trusted device 语义；
- SSO adapter 边界；未配置 provider 时保持关闭并明确报告。

现有 Supabase 测试用户无需迁移。管理员通过新的 bootstrap 命令建立。

验收：

- `/auth/v1` 调用为零；
- 旧 Supabase token 无效；
- 登录、改密、重置、Session 刷新/撤销、MFA、停用和权限测试通过；
- 密码、Session token、email token、TOTP secret 不以明文落库。

### WP-5：Storage

实现 `ObjectStore`：

- S3 兼容生产实现；
- release 目录外的本机实现，用于开发和明确选择的单机部署；
- key allowlist、路径规范化、内容类型/大小/signature 校验；
- 头像 CRUD；
- CSV/XLSX/PDF 导出上传、短时下载、过期删除；
- object metadata、SHA-256 和数据库 job 一致性。

验收：

- `/storage/v1` 调用为零；
- 路径穿越测试通过；
- 头像和导出授权测试通过；
- 删除/过期可重复执行。

### WP-6：Worker、报告、导入导出和 readiness

修改全部六类 Worker：

- 使用 `crm_worker` pool；
- 保留 lease token、`SKIP LOCKED`、幂等和 heartbeat；
- 去掉 service role header；
- systemd timer 成为唯一调度器；
- readiness 直接检查 PostgreSQL 和队列表；
- 数据库故障、migration 缺失、Worker stale/missing、queue failed/stuck 分别报告。

验收：

- Worker 脚本无 HTTP 数据库调用；
- 并发 claim 不重复；
- 失败和重试记录完整；
- readiness 返回精确组件原因。

### WP-7：部署、备份与恢复

保留现有 release、atomic symlink、systemd 和应用回退骨架，替换 migration 阶段：

```text
git pull --ff-only
→ npm ci
→ targeted checks
→ build
→ recent-backup gate
→ advisory-lock migration
→ atomic release switch
→ restart Web / run Worker
→ liveness / readiness
→ failure restores previous application release
```

新增：

- PostgreSQL loopback 配置样例；
- app/system/worker/migrator role bootstrap；
- 每日 `pg_dump --format=custom`；
- AES/age 加密；
- S3 兼容异地上传；
- 14–30 天保留；
- 成功/失败 webhook；
- 独立临时数据库 `pg_restore` 验证；
- backup 和 restore systemd service/timer；
- 恢复 runbook、RPO/RTO；
- 慢查询、日志轮转、磁盘告警和 VACUUM/ANALYZE 指引。

验收：

- deploy runner 不执行 Supabase CLI；
- 最近成功备份可作为迁移 gate；
- restore verification 有机器可读结果；
- 应用回退不声称数据库已回退。

### WP-8：测试体系

新增或迁移：

- migration-from-empty；
- schema checksum；
- 数据库角色权限；
- Repository filter/pagination/relation；
- 认证、Session、CSRF、MFA、停用；
- Worker lease/幂等；
- Storage 路径和授权；
- readiness；
- backup/restore command contract；
- deployment/rollback；
- 一次受影响的 pinned Chromium 1228 浏览器流程。

不运行与改动无关的重复完整矩阵。每类验证只运行一次；失败后只重跑受影响部分。

### WP-9：历次计划复核与功能收口

检查：

- `planning-source/.../04_ENGINEERING_TASK_PLAN.md`
- `planning-source/.../05_ACCEPTANCE_CRITERIA.md`
- `docs/IMPLEMENTATION_STATUS.md`
- 所有 `REMEDIATION*PLAN*.md`
- 所有最新 `AUDIT`/`FINAL_REAUDIT` 文档

方法：

1. 提取未勾选项目、延期项、文档声称完成但代码无入口的项目；
2. 以源码、migration、API、UI、Worker 和测试证据逐项核对；
3. 与 Supabase 退出发现合并为一个收口清单；
4. 在本次范围内完成缺口；
5. 只有需要外部供应商凭据或生产基础设施的动作可保留为部署操作，并给出可执行 runbook，
   不能以“代码已完成”代替实际外部配置。

验收：

- 没有未解释的 `[ ]` 或模糊“未来完成”状态；
- 产品入口、API、数据库和测试状态一致；
- 建议新功能均有实现或明确的外部依赖边界。

## 4. 执行顺序

1. 保存审计和本计划；
2. 安装依赖、建立 DB/auth/storage 基础；
3. 转换 migration 并通过空库测试；
4. 迁移认证；
5. 迁移 Repository/RPC；
6. 迁移 Storage/Worker/readiness；
7. 重写部署/备份/恢复；
8. 复核旧计划并补齐功能；
9. 定向测试、typecheck、lint、build；
10. 更新版本和文档；
11. 检查 Git diff、提交；
12. 确认提交成功后执行操作系统关机。

## 5. 回滚策略

当前数据可丢弃，因此数据库回滚为：

- 丢弃测试数据库；
- 使用上一个 Git 提交的 migration 从空库重建；
- 不维护 Supabase 与 PostgreSQL 双写；
- 不实现增量 CDC。

应用发布仍保持现有上一 release 回退。正式使用自建 PostgreSQL 后，任何破坏性 migration
必须改用 expand/contract 和备份前置门槛；“测试数据库可重建”的例外在本次切换完成后失效。

## 6. 不可降低的安全边界

- PostgreSQL 不监听公网；
- 浏览器不获得数据库或对象存储长期凭据；
- migration 凭据不进入 Web/Worker 环境；
- app/system/worker 均无 BYPASSRLS；
- 密码、Session、reset token、TOTP secret 不明文保存；
- 管理员高风险操作保留 AAL2；
- 对象下载在签名或流式返回前重新验证授权；
- 备份加密密钥与数据库主机分离；
- 未通过真实恢复测试不得宣布生产就绪。

## 7. 执行结果

完成日期：2026-07-29

| 工作包 | 状态 | 执行结果 |
| --- | --- | --- |
| WP-1 依赖与配置 | 完成 | 移除活动 SDK/CLI/密钥依赖；新增标准数据库、认证、对象存储配置 |
| WP-2 数据层 | 完成 | `pg`/Kysely、app/system/worker pool、事务授权上下文和兼容 gateway |
| WP-3 Schema/migration | 完成 | 65 个有序迁移；空库建立、checksum、advisory lock、幂等重跑通过 |
| WP-4 认证与权限 | 完成 | Argon2id、opaque Session、CSRF、email token、TOTP、OIDC、SCIM、管理流程 |
| WP-5 Storage | 完成 | release 外本机存储与 S3 兼容实现；头像、导出和短时签名下载接入 |
| WP-6 Worker/readiness | 完成 | 六类 Worker 改用数据库角色；4 个启用 Worker 实际周期与心跳通过 |
| WP-7 运维 | 完成 | PostgreSQL 18 基线、Caddy、systemd、加密异地备份、月度恢复、磁盘告警 |
| WP-8 测试 | 完成 | 空库、认证/RLS、业务 Schema、Worker、备份恢复、部署契约通过 |
| WP-9 旧计划复核 | 完成 | 历史产品建议均已有入口；新发现四类运维缺口和两类 Schema/权限缺口已关闭 |

实施中经验证调整：

1. 采用当期受支持的 PostgreSQL 18.4，而不是草案中的 17；
2. 由于旧库只有测试数据，不开发无价值的全量/增量/CDC 脚本，直接从空库建立；
3. 为保证 RLS 表完整备份，仅 `crm_backup` 使用 `BYPASSRLS`，并以显式只读 GRANT、
   `NOSUPERUSER`、`NOCREATEDB`、`NOCREATEROLE`、`NOREPLICATION` 限制；
4. 业务外键验证、备份 Schema `USAGE`、Caddy、恢复定时器、磁盘告警和一次性管理员凭据清理
   是实施期发现并补入的计划遗漏；
5. 按仓库的有界验证规则没有重复运行与改动无关的十阶段浏览器矩阵；受影响的真实认证设备
   Chromium 流程已通过。生产 VPS 切换仍按部署手册执行 hosted readiness。
