# Lumina CRM v3.2.0 最终复审

- 日期：2026-07-29
- 复审输入：`AUDIT_2026-07-29_V3.2.0.md`
- 执行计划：`REMEDIATION_AND_PRODUCT_PLAN_2026-07-29_V3.2.0.md`
- 版本：3.2.0
- 结论：仓库内计划完整执行，可以提交为 v3.2.0 release candidate

## 1. 遗漏与完整性检查

| 工作包 | 复审结果 | 完成证据 |
| --- | --- | --- |
| WP-1 日历动作安全解析 | 完成，无遗漏 | 独立 Zod 解析模块；损坏 JSON 进入失败校验并返回 400；解析契约通过 |
| WP-2 预约端到端幂等 | 完成，无遗漏 | 请求键、SHA-256 指纹、条件唯一索引、RPC 重放/冲突语义、API/Repository/UI 全链路 |
| WP-3 沟通投递完整性 | 完成，无遗漏 | 同步操作锁、未修改草稿稳定键、供应商 `Idempotency-Key`、10 秒请求上限 |
| WP-4 收件箱容量与 UI | 完成，无遗漏 | RPC/API/UI 统一 `items/total/truncated`；双语状态提示；重复图标已删除 |
| WP-5 回归、资料与发布 | 完成，无遗漏 | 迁移、数据库、契约、类型、lint、build、固定 Chromium 及资料均已关闭 |

复查 API 错误映射、数据库事务边界、UI 失败重试和计划勾选项后，没有发现只完成客户端但遗漏
服务端/数据库约束的项目，也没有发现计划描述与实现不一致的半完成路径。

## 2. 最终验证记录

| 验证 | 最终结果 |
| --- | --- |
| `npm run db:migrations:verify` | 68 个有序、checksum 管理迁移通过；head 为 `202607290063_v320_delivery_integrity` |
| `npm run db:migrate` | 063 已在本地 PostgreSQL 前向应用 |
| `npm run db:smoke` | 通过；含预约同键重放、同键异负载冲突及收件箱容量语义 |
| `npm run db:validate` | 通过；96 张 public 表，0 无效约束/索引、0 重复身份、0 孤儿身份 |
| `npm run test:contracts` | 28/28 核心/版本契约与 5/5 CAPTCHA 契约通过 |
| `npm run test:deploy` | 19/19 部署契约通过 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm run build` | 通过；最终 v3.2.0 应用/API 路由生成成功 |
| Chromium 1228 定向阶段 | 13 页面/视口，0 error、0 warning，测试身份 1/1 清理 |
| 人工截图复核 | 消息页 1440px/375px 单搜索图标，无横向溢出、重叠或截断 |
| `git diff --check` | 通过 |

浏览器报告保存在 Git 忽略目录
`work/browser-qa-chromium-1228/phases/02-manager-core-a/report.json`。报告记录：

- runtime：`ms-playwright/chromium-1228`
- browser：`149.0.7827.55`
- app version：`3.2.0`
- migration head：`202607290063_v320_delivery_integrity`
- build hash：`908d86dd3226d4103bd7c6d36897250330a121f6279b51fa60d56ccd6935014c`

其余九个 Chromium 阶段保留的是旧构建证据。本次只修改日历与沟通链路，并已通过直接相关
阶段；依据仓库的时间边界规则，没有把定向修复扩张为重复十阶段矩阵。

## 3. 仍保留的生产门禁

以下不是仓库内遗漏，不能用本地代码或模拟测试宣称完成：

1. 与真实邮件供应商确认并验收其 `Idempotency-Key` 合同、超时和回执语义。
2. 在真实 VPS 验收 Caddy/systemd、DNS/TLS、生产数据库角色、真实 IdP/SCIM 与连接器凭据。
3. 使用独立对象存储执行离机备份生命周期和恢复演练。
4. 使用代表性数据与真实供应商延迟验证容量和 P95 指标。

## 4. 后续功能建议

这些建议已评估但不应在没有业务数据时继续扩大 v3.2.0：

1. 若用户经常命中 100 条上限，引入游标分页，而不是只继续增大同步快照。
2. 若真实吞吐或供应商延迟证明同步投递不足，把沟通消息接入现有租约 Worker，并保留当前
   消息 ID 作为端到端幂等键。
3. 热点文件只在下一次相关改动时按可测试边界拆分；不为降低行数进行无目标重写。

## 5. 发布判断

审计发现已关闭，计划无遗漏，最终验证与人工 UI 复核均通过。v3.2.0 可以提交；上线仍必须
遵守第 3 节生产门禁。
