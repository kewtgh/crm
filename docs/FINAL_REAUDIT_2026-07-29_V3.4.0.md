# Lumina CRM v3.4.0 最终复审

- 日期：2026-07-29
- 复审输入：`AUDIT_2026-07-29_V3.4.0.md`
- 执行计划：`REMEDIATION_AND_PRODUCT_PLAN_2026-07-29_V3.4.0.md`
- 版本：3.4.0
- 结论：仓库内计划完整执行，可以提交为 v3.4.0 release candidate

## 1. 计划遗漏与完整性检查

| 工作包 | 复审结果 | 完成证据 |
| --- | --- | --- |
| WP-1 共享 Worker 安全原语 | 完成，无遗漏 | 保序有限并发、整数边界、稳定 header、timeout 和失败关闭均有直接单元契约 |
| WP-2 投递与 cycle 预算 | 完成，无遗漏 | 通知/日历幂等与 timeout；四类外部 Worker 有限并发；类别并行；lease token/heartbeat 保留 |
| WP-3 错误态 UI/UX | 完成，无遗漏 | loading 复用词典；global error 双语；员工创建 pending 防关闭与字段错误清理 |
| WP-4 回归与发布 | 完成，无遗漏 | v3.4 契约、类型、lint、部署、build、Chromium、版本和资料全部关闭 |

第一次实现复查发现仅限制单个配置值仍不充分：`concurrency=1` 与允许的较大 batch 组合仍会
突破 systemd 预算。最终实现按 `ceil(batch/concurrency) × 单条 timeout` 计算每类外部等待
上界，超过 210 秒时将具体 delivery/webhook/integration 组标记为无效。该补漏有正反配置
契约，不依赖文档约定。

没有发现只添加 header 却遗漏 timeout、只并行 orchestrator 却仍串行处理任务、或只禁用
按钮却允许 Escape 关闭的半完成路径。数据库 migration 没有变化，因此依据仓库时间边界规则
没有重复完整数据库 smoke/validate 套件。

## 2. 最终验证记录

| 验证 | 最终结果 |
| --- | --- |
| `npm run db:migrations:verify` | 69 个有序、checksum 管理迁移通过；head 为 064 |
| `npm run db:migrate` | 本地 PostgreSQL 69 个 current，0 新应用 |
| `npm run test:contracts` | 36/36 核心/版本契约与 5/5 CAPTCHA 契约通过 |
| `npm run test:deploy` | 19/19 部署契约通过 |
| `npm run typecheck` | 最终 v3.4.0 源码通过 |
| `npm run lint` | 最终 v3.4.0 源码通过 |
| `npm run build` | 本轮唯一一次生产 build 通过，全部应用/API 路由生成成功 |
| `npm audit --audit-level=low` | 0 vulnerabilities |
| Chromium 1228 定向阶段 | public 6、admin 13、notification invariant 通过；0 error、0 warning；身份 2/2 清理 |
| `git diff --check` | 通过 |

浏览器证据保存在 Git 忽略目录 `work/browser-qa-chromium-1228/phases/`，三个直接相关阶段
共同记录：

- runtime：`ms-playwright/chromium-1228`
- executable：固定 `chromium-1228/chrome-win64/chrome.exe`
- browser：`149.0.7827.55`
- app version：`3.4.0`
- migration head：`202607290064_v330_communication_scalability`
- build hash：`dd2c563f02e4aeb2dd4bd7401ae25aa2daf14da21cdd3a3d67134f2d16f044e6`
- source fingerprint：`f758d82d62361382f252b2e8ad0a2776100c5273fe6175e43febe9565c4e6764`

`07-admin` 还直接确认员工创建 dialog 居中和导航完整性。第一次 admin 尝试在创建测试身份前
因本地 PostgreSQL 未启动而 `ECONNREFUSED`；检查确认 CRM 容器缺失后，只启动既有 Compose
服务并验证 69/69 migration current，再运行同一阶段成功。没有重建或删除数据卷。QA Web
服务最终已停止并确认 PID 清理。

## 3. 仍保留的生产门禁

1. 使用真实邮件供应商证明相同 `Idempotency-Key` 与相同 payload 返回原结果且不重复发送。
2. 在真实 VPS 验证类别并行后的 PostgreSQL 最大连接、210 秒预算、systemd 4 分钟边界与
   Worker heartbeat/队列告警。
3. 在产品确认 workspace 业务时区后，一次性迁移合同、报价、回款、同意保留期和报表的
   业务日；不能把个人显示时区当成组织规则进行局部修补。
4. 验收真实 Caddy/DNS/TLS、IdP/SCIM、独立备份生命周期、恢复演练和代表性容量/P95。

## 4. 发布判断

审计中纳入的 P1/P2/P3 缺口和产品增强已关闭，计划无遗漏，目标验证通过。v3.4.0 可以提交；
上线仍必须遵守第 3 节生产门禁。
