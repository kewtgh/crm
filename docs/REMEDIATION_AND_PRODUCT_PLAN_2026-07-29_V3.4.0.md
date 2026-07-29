# Lumina CRM v3.4.0 修复与产品增强计划

- 日期：2026-07-29
- 输入：`AUDIT_2026-07-29_V3.4.0.md`
- 目标版本：3.4.0
- 状态：已完成

## 1. 完成定义

1. 通知 outbox 与日历投递都具有稳定供应商幂等 header 和明确 timeout。
2. 相互独立的 Worker 类别并行执行；单类任务使用受限并发，不产生无界 Promise 扇出。
3. 生产运行时拒绝超过审定上限的 batch/concurrency 配置，默认配置落在 4 分钟服务预算内。
4. 原有数据库租约、lease token、失败退避、heartbeat 和逐任务隔离语义保持不变。
5. CRM loading 与根级错误页在中英文环境均可理解；员工创建 pending 期间不能产生不确定关闭。
6. v3.4 定向契约、类型检查、lint、部署契约、一次最终 build 和直接相关 Chromium 阶段通过。
7. 最终逐项复查本计划，更新版本/README/实现状态/部署资料并提交。

## 2. 实施工作包

### WP-1：共享 Worker 安全原语

- [x] 新增保序、有限并发的任务映射 helper，并验证实际并发不超过上限。
- [x] 新增邮件 Webhook helper，统一稳定幂等 header、Bearer token、JSON body 与 timeout。
- [x] 对非法 concurrency、空幂等键和非法 timeout 失败关闭。

### WP-2：投递 Worker 与 cycle 预算

- [x] 通知 outbox 使用邮件 helper，关闭无 timeout 与无标准幂等 header 缺口。
- [x] 日历投递使用同一合同，保留供应商 receipt 与数据库 lease token 完成语义。
- [x] Webhook/集成 Worker 接入受限并发，保留逐任务失败隔离。
- [x] Worker cycle 并行启动相互独立类别，聚合全部失败后再使 cycle 失败。
- [x] runtime environment 与生产示例加入 concurrency、batch 上限和交叉时间预算。

### WP-3：错误态 UI/UX 完整性

- [x] CRM loading 使用现有中英文词典，不再固定播报英文。
- [x] global error 提供无需 Provider 的双语兜底并标注语言片段。
- [x] 员工创建 pending 时禁止 Escape/关闭/取消；用户修改字段时清理对应陈旧错误。

### WP-4：回归、资料与发布

- [x] 新增 v3.4 行为契约并纳入 `test:contracts`。
- [x] 更新 README、实现状态、部署说明、环境示例与版本常量。
- [x] 运行定向契约、typecheck、lint、部署契约和一次最终 build。
- [x] 使用固定 `ms-playwright/chromium-1228` 复测直接相关 public/admin/notification 阶段。
- [x] 对照审计与本计划补漏，保存最终复审，更新版本并提交。

## 3. 验证矩阵

| 风险 | 最小证据 |
| --- | --- |
| 外部请求永久悬挂 | helper 单元契约 + Worker 源码/运行契约 |
| 供应商重复副作用 | 稳定 `Idempotency-Key` header 契约 |
| cycle 被 4 分钟上界中止 | 有限并发实测 + 类别并行契约 + batch 配置拒绝 |
| 并发导致丢失失败 | 保序结果与逐任务 catch 契约 + heartbeat 聚合 |
| 错误态语言错位 | 词典/UI 契约 + public Chromium |
| 管理员不确定提交 | dialog pending 交互契约 + admin Chromium |
| 综合回归 | typecheck、lint、deploy test、一次 build |

## 4. 停止条件

上述工作包、定向回归、类型、lint、一次最终构建和直接相关浏览器阶段通过后停止扩大检查。
不因本轮 scoped 实现重复十阶段 Chromium 矩阵或完整数据库套件；若验证暴露同源缺陷，只扩展
到直接影响范围。

## 5. 执行结果

全部工作包已完成。实现中复查发现“单项最大值仍可与低 concurrency 组合成超预算配置”，
因此在最初上限之外补充了按实际波次数与单条 timeout 计算的 210 秒交叉预算校验。最终
36/36 核心/版本契约、5/5 CAPTCHA、类型、lint、19/19 部署契约和一次生产 build 通过。
固定 Chromium 1228 的 public/admin/notification 直接相关阶段为 0 error、0 warning，测试
身份 2/2 清理。完整证据与遗漏复查见 `FINAL_REAUDIT_2026-07-29_V3.4.0.md`。
