# Lumina CRM v3.5.0 最终复审

- 日期：2026-07-30
- 基线：`1a53b9b` / v3.4.0
- 目标：v3.5.0
- 输入：`AUDIT_2026-07-30_V3.5.0.md` 与
  `REMEDIATION_AND_PRODUCT_PLAN_2026-07-30_V3.5.0.md`
- 结论：计划项已完成；未发现遗漏、半实现或需要继续扩大的同源缺陷

## 1. 计划完成度

| 工作包 | 结果 |
| --- | --- |
| WP-1 workspace 业务时区 | 完成；065–067 覆盖数据、权限、事务上下文与稳定 date-only 文本契约 |
| WP-2 组织设置 | 完成；管理员页面/API/AAL2/Origin/RPC 审计、时区与 Turnstile 策略均闭合 |
| WP-3 可靠交互与时间体验 | 完成；共用抽屉和直接写调用方、个人时区显示、财务示例均修复 |
| WP-4 任务队列完整性 | 完成；12 条摘要明确披露并链接完整表 |
| WP-5 发布 | 完成；版本、迁移、资料、合同、构建、部署合同和定向 Chromium 均有证据 |

用户补充的大陆网络需求也已纳入 068。Turnstile 默认开启；管理员关闭后，登录、SSO 与找回
密码直接使用自托管 ALTCHA。服务端拒绝关闭策略下的旧 Turnstile proof，因此这不是
CAPTCHA bypass。Cloudflare One 邮箱身份/访问保护被保留为独立安全层。

## 2. 实施中发现并补齐的遗漏

1. Worker 最初缺少读取 workspace 时区的列权限。065 已应用后没有改写校验和，而是用 066
   前向补充 `id/business_timezone` 最小读取权限。
2. PostgreSQL `date` 经 JSON 网关会成为带时区的 JavaScript `Date`。067 将业务日期 RPC
   固定为 `YYYY-MM-DD` 文本，消除前一日 UTC 序列化问题。
3. 组织摘要在 375px 下裁切默认币种。最终改为两列换行网格，页面 overflow 为 false。
4. 通用 switch 的装饰层拦截指针，且缺少清晰焦点/禁用态。现已禁止装饰层接收指针并补齐
   `focus-visible` 与 disabled 样式。
5. ALTCHA blob Worker 被 CSP 拦截。CSP 仅新增 `worker-src 'self' blob:`，没有扩大脚本、
   frame 或 connect 来源。
6. CAPTCHA 策略交互会产生审计外键，旧 QA 清理无法删除临时账号。清理现在保留审计行、
   将临时 actor 置空，再删除身份；遗留 1 个身份已精确清理，剩余 0。

## 3. 最终验证记录

| 门禁 | 结果 |
| --- | --- |
| 依赖审计 | `npm audit --audit-level=low`：0 vulnerabilities |
| 迁移序列 | 73 个有序迁移；head `202607300068_workspace_turnstile_policy.sql`；本地前向应用成功 |
| 业务时区数据库探针 | `Asia/Taipei` 业务日 `2026-07-30`；用户事务与 Worker 事务均通过 |
| TypeScript | 通过 |
| ESLint | 通过 |
| 核心/版本合同 | 41/41 通过 |
| CAPTCHA 合同 | 6/6 通过，含 disabled stale-proof 拒绝、ALTCHA 防篡改/重放 |
| 部署合同 | 19/19 通过 |
| 生产构建 | v3.5.0 通过；包含 `/admin/workspace` 页面与 API |
| Chromium 首轮相关页面 | admin/tasks/contracts 共 6/6 页面/视口通过；视觉复查发现并修复移动摘要裁切 |
| Chromium 最终安全场景 | Chromium 1228 / `149.0.7827.55`；组织设置桌面/移动 2/2，通过关闭 Turnstile、登录 ALTCHA、恢复原值；0 errors、0 warnings、身份 1/1 清理 |

最终浏览器报告保存在 Git-ignored 的
`work/browser-qa-chromium-1228/v350-turnstile-pass/report.json`。报告记录应用版本 3.5.0、
migration head 068、浏览器可执行文件、源码指纹与构建 hash。测试结束后的只读检查确认
`turnstileEnabled=true`，QA 服务器已关闭。

## 4. 最终边界

按仓库指令，本次没有运行完整十阶段 Chromium 矩阵或完整数据库套件；直接受影响页面、
数据库时区路径和 CAPTCHA 交互已由更小的定向验证覆盖。没有为了重复证明已通过的类别再次
扩大审计。

仍需环境所有者在真实 VPS 完成 DNS/TLS、Cloudflare One 策略、真实 Turnstile key、
邮件/IdP/SCIM、独立备份与恢复演练以及代表性容量/P95 验证。生产应用 068 后，应由 AAL2
管理员确认业务时区和验证码策略；大陆用户场景可关闭 Turnstile，但必须保留有效的
`ALTCHA_HMAC_SECRET`。
