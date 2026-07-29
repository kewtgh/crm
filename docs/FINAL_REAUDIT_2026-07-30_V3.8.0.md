# Lumina CRM v3.8.0 最终复审

- 复审日期：2026-07-30
- 原始审计：`AUDIT_2026-07-30_V3.8.0.md`
- 执行计划：`REMEDIATION_AND_PRODUCT_PLAN_2026-07-30_V3.8.0.md`
- 版本：3.8.0 release candidate

## 1. 计划闭环

| 工作包 | 最终状态 | 复审结论 |
| --- | --- | --- |
| WP-1 rootless 隔离 | 完成 | 所有 Lumina Docker client 固定到用户 socket；发布与维护同时验证 rootless、systemd cgroup、data root |
| WP-2 Compose 运维 | 完成 | disk timer 路径、监控目标和阈值已修复并纳入合同 |
| WP-3 恢复证据 | 完成 | 远端/本地保留严格校验；数据库与同批对象归档解密、tar 完整性和清理闭环 |
| WP-4 退出与共享 UI | 完成 | 退出使用 CSRF 客户端且保留非 JS redirect；搜索与进度语义一致 |
| WP-5 内核与镜像 | 完成 | 删除未使用的 v3.6 内核；当前合同替代旧测试；运行镜像只带必需脚本 |
| WP-6 验证 | 完成 | 定向合同、类型、lint、迁移、Compose、单次 build 和 Chromium 受影响阶段均通过 |
| WP-7 版本交付 | 完成 | 审计、计划、复审、状态和 3.8.0 版本统一，提交前 diff 检查通过 |

## 2. 二次检查发现并补齐的遗漏

首次 rootless 改造后，storage prepare/cleanup unit 仍保留 `ProtectHome=true`。systemd 会由此
隐藏 `/run/user`，导致 unit 无法访问 rootless Docker socket。最终复审已将所有需要 Docker
的 unit 改为 `ProtectHome=read-only`，同时保留 `/run/user` 的只读可见性；常驻应用 unit
增加启动失败重试，以覆盖 lingering user service 在启动时稍晚就绪的情况。部署合同已锁定
该要求。

再次扫描当前生产路径后，没有发现残留的 `/opt/lumina-crm/current`、rootful
`docker.service` 依赖、rootful socket 连接或 3.7.0 版本标识。runbook 中的 rootful socket
只作为明确禁止项，测试中的 rootful socket 只作为必须拒绝的负例。磁盘监控不访问 Docker，
因此继续使用更严格的 `ProtectHome=true`。

## 3. 最终验证证据

- TypeScript：通过。
- ESLint：通过。
- 当前部署合同：9/9 通过。
- 应用/安全合同：44/44 通过；CAPTCHA 合同：6/6 通过。
- 迁移清单：74 个有序、checksum 管理的迁移通过。
- Compose ops profile：渲染通过。
- 生产构建：一次通过。
- `ms-playwright/chromium-1228` 通知/退出阶段：通过；无 error/warning，测试身份清理 1/1。
- `git diff --check`：通过。

## 4. 外部门禁

代码仓库不能代替真实 VPS 完成 rootless user service、subuid/subgid、cgroup v2 delegation、
文件权限、DNS/TLS、Cloudflare/Caddy origin、S3 lifecycle、真实邮件/IdP 和生产恢复演练。
这些事项必须按 `DEPLOYMENT.md` 与 `BACKUP_RESTORE.md` 在生产变更窗口验证。任何 rootful
Docker 连接、对象归档缺失或恢复测试失败均为发布阻断，不允许降级绕过。
