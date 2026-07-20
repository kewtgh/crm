# Lumina Education CRM v2.2.0 最终遗漏复审

- 复审日期：2026-07-21
- 输入：`AUDIT_2026-07-20_V2.1.1.md` 与 `REMEDIATION_AND_EXPANSION_PLAN_V2.2.0.md`
- 结论：仓库内整改与扩展功能已完成；复审新发现的两项缺口已通过向前修复关闭。

## 新发现并关闭的遗漏

1. 日历投递和隐私导出 Worker 通过 PostgREST 使用 `service_role`，但 BYPASSRLS 不等于拥有
   SQL 表权限。真实 Worker 周期因此无法读取 appointment/attendee 等来源记录。
   `202607210052_worker_source_read_permissions.sql` 仅为两个 Worker 实际读取的十张来源表
   增加 `SELECT`，没有扩大匿名或员工权限；日历 Worker 同时保留更明确的 403/错误码诊断。
2. `pagination_behavior.sql` 假设验证数据库不存在既有失败任务，真实队列中的 6 条记录会
   造成总数和末页断言假失败。测试现于回滚事务内隔离自身 retryable-job fixture，不再依赖
   执行顺序或数据库初始状态。

## 最终仓库门禁证据

| 门禁 | 结果 |
| --- | --- |
| TypeScript / ESLint | 通过 |
| Production build / Node contracts | 通过；26/26 |
| Migration head | `202607210052`，本地/已应用一致 |
| PostgreSQL schema lint | 通过；0 findings |
| pgTAP | 9 个文件，433/433 |
| Dependency audit | 通过；0 vulnerabilities |
| 业务、HTTP、v1.1 与导出 smoke | 通过 |
| Production assets/MIME | 通过；25 个资源 |
| Core Worker cycle | 通过；修复后 6/6 重试投递及新建 1/1 投递成功 |
| Local readiness | 200；environment/auth/database/workers/queues 均为 true |

本地邮件验证使用仅绑定 `127.0.0.1` 的临时 sink；它只证明投递协议和 Worker 闭环，不会被
保存为生产配置，也不代表真实邮件供应商已连接。

## 仍需外部执行的发布门禁

- 仓库和 `AGENTS.md` 已确认开发环境存在固定 `ms-playwright/chromium-1228`，且浏览器矩阵
  脚本已就绪。当前助手会话的高优先级 Browser 技能禁止从 shell 调用独立 Playwright，
  同时其允许的浏览器客户端没有暴露任何 backend。这是工具策略冲突，不是缺少浏览器。
- 因固定 Chromium 矩阵及同运行时的 device-auth smoke 未在本会话执行，不能虚报 REL-02、
  REL-03 或完整 release gate 通过。
- 正式专用服务器发布还需要生产所有者提供真实 Supabase、Turnstile、邮件/连接器 secrets、
  备份演练、systemd timer 心跳，并在托管环境确认 readiness 200。旧 Sites 项目绑定和
  GitHub Actions 高频 Worker 调度已在后续额度审计中移除。

除上述明确外部门禁外，计划中没有发现未实现、只建模未闭环、依赖模拟成功或未保存文档的
仓库内项目。
