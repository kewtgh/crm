# Lumina CRM v3.3.0 最终复审

- 日期：2026-07-29
- 复审输入：`AUDIT_2026-07-29_V3.3.0.md`
- 执行计划：`REMEDIATION_AND_PRODUCT_PLAN_2026-07-29_V3.3.0.md`
- 版本：3.3.0
- 结论：仓库内计划完整执行，可以提交为 v3.3.0 release candidate

## 1. 遗漏与完整性检查

| 工作包 | 复审结果 | 完成证据 |
| --- | --- | --- |
| WP-1 会话创建幂等 | 完成，无遗漏 | 请求键、SHA-256 指纹、条件唯一索引、RPC 重放/冲突语义、API/Repository/UI 全链路 |
| WP-2 投递所有权 | 完成，无遗漏 | `shouldDeliver`、20 秒安全窗口、成功/失败/活动重放跳过供应商、显式失败重试 |
| WP-3 两级分页 | 完成，无遗漏 | 会话摘要 `items/total/page/pageSize`；单会话固定消息页；稳定排序 |
| WP-4 UI/UX 状态一致性 | 完成，无遗漏 | 两级可访问 Pagination；写后保持 query/page/selected；加载期禁写；失败提示在刷新后保留 |
| WP-5 回归与发布 | 完成，无遗漏 | 迁移、数据库、契约、类型、lint、build、固定 Chromium 和资料全部关闭 |

复查 API 错误映射、数据库事务/行锁、客户端失败重试、搜索写后刷新、空数据与分页数据路径后，
没有发现只完成客户端但遗漏服务端/数据库约束的项目，也没有发现计划描述与实现不一致的
半完成路径。

## 2. 最终验证记录

| 验证 | 最终结果 |
| --- | --- |
| `npm run db:migrations:verify` | 69 个有序、checksum 管理迁移通过；head 为 `202607290064_v330_communication_scalability` |
| `npm run db:migrate` | 064 已在本地 PostgreSQL 前向应用；原有 68 个保持 current |
| `npm run db:smoke` | 通过；含会话同键重放/冲突、即时/成功消息重放投递权、会话与消息分页 |
| `npm run db:validate` | 通过；96 张 public 表，0 无效约束/索引、0 重复身份、0 孤儿身份 |
| `npm run test:contracts` | 31/31 核心/版本契约与 5/5 CAPTCHA 契约通过 |
| `npm run test:deploy` | 19/19 部署契约通过 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 最终源码通过 |
| `npm run build` | 通过；最终 v3.3.0 应用/API 路由生成成功 |
| Chromium 1228 定向阶段 | 13 页面/视口，0 error、0 warning，测试身份 1/1 清理 |
| 人工截图复核 | 消息页 1440px/375px 无横向溢出、重叠、重复图标或不可达控件 |
| `npm audit --audit-level=low` | 0 vulnerabilities |
| `git diff --check` | 通过 |

浏览器报告保存在 Git 忽略目录
`work/browser-qa-chromium-1228/phases/02-manager-core-a/report.json`。报告记录：

- runtime：`ms-playwright/chromium-1228`
- executable：固定 `chromium-1228/chrome-win64/chrome.exe`
- browser：`149.0.7827.55`
- app version：`3.3.0`
- migration head：`202607290064_v330_communication_scalability`
- build hash：`8074a4cdba0f22782e63343f4bb9e0aead55ca1b721e889cdfb93f1da88d5f8b`
- source fingerprint：`332c41b0674918dcb028e26b7cf8e70cae4671fe6647d815fc33b753225bf5fc`

测试身份当前没有沟通记录，因此截图验证空状态、布局和响应式边界；两级分页的有数据行为由
真实 PostgreSQL 三消息夹具和 v3.3 源码契约证明。其余九个 Chromium 阶段仍是旧构建证据，
本次只修改沟通链路并已通过直接相关阶段；依据仓库时间边界规则，没有重复十阶段矩阵。

## 3. 实施中发现并关闭的问题

1. 064 首次应用时，PostgreSQL 拒绝 SQL 函数中直接引用 CTE 列的 `OFFSET`。事务自动回滚，
   数据库 head 保持 063；改成标量子查询后迁移校验和前向应用通过。
2. 数据库 smoke 的预期冲突最初使整个测试事务进入 aborted 状态；加入 savepoint 后正确证明
   冲突且不污染后续断言。
3. 跨连接的系统完成动作无法看到未提交用户消息；测试改为先提交用户请求，再由系统角色完成，
   最后在新用户事务重放，模拟真实请求边界。
4. UI 复看发现切换会话加载期间可对旧详情提交，以及失败刷新会清除错误提示；均在最终 build
   前关闭并通过 lint/Chromium。

## 4. 仍保留的生产门禁

以下不是仓库内遗漏，不能用本地代码或模拟测试宣称完成：

1. 与真实邮件供应商验收 `Idempotency-Key`、超时、回执和重放合同。
2. 在真实 VPS 验收 Caddy/systemd、DNS/TLS、生产数据库角色、真实 IdP/SCIM 与连接器凭据。
3. 使用独立对象存储执行离机备份生命周期和恢复演练。
4. 使用代表性数据与真实供应商延迟验证容量和 P95 指标；若数据证明同步路径不足，再把消息
   投递接入现有租约 Worker，而不是提前引入第二套基础设施。

## 5. 发布判断

审计发现和纳入的新功能已关闭，计划无遗漏，最终验证与人工 UI 复核均通过。v3.3.0 可以
提交；上线仍必须遵守第 4 节生产门禁。
