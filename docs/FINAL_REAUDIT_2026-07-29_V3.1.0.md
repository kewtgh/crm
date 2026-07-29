# Lumina CRM v3.1.0 最终遗漏复核

- 复核日期：2026-07-29
- 依据：`AUDIT_2026-07-29_V3.1.0.md` 与
  `REMEDIATION_AND_PRODUCT_PLAN_2026-07-29_V3.1.0.md`
- 版本：3.1.0
- 迁移头：`202607290062_v310_profile_rls_repair`

## 1. 结论

计划中的七个工作包均已实现，没有以文档建议、假数据或禁用入口代替功能。审计列出的
P1/P2/P3 缺口全部关闭；导入进度、分层健康接口、时区安全日历和安全错误关联四项增强均已
接入真实 API/UI/数据库或部署路径。

最终复核还发现三项实施期遗漏：资料读取 RLS 在历史 PostgreSQL 转换中被删除后未重建、
数据库检查硬编码旧迁移数量、设置 QA 引用已删除认证 helper。三项均已修复并重新验证，
最终差异审查还把日历提交锁从单纯 React state 补强为同步 `ref` 互斥，关闭同一事件循环
快速双击窗口。补充的一键部署复核又关闭生产模板/高权限密钥混用、systemd 对象目录只读、
数据库角色复用和不完整 Local/S3 配置四类风险；S3 模式也会预建 systemd 所需的空对象
沙箱目录。当前没有已知的仓库内 P0/P1/P2 未完成项。

## 2. 计划对照

| 工作包 | 状态 | 关键证据 |
| --- | --- | --- |
| WP-1 导入真实性 | 完成 | 100 行动态轮次、终态检查、进度、六字段 Zod 上界、10,000 行规则契约 |
| WP-2 头像补偿 | 完成 | UUID 版本键；put/资料更新同一补偿范围；成功后才清理旧对象 |
| WP-3 资料原子性 | 完成 | 061 RPC；062 RLS 修复；真实成功与 NOT NULL 故障回滚 |
| WP-4 readiness/诊断 | 完成 | loopback 规则；公网 Host 404 无 checks；500 允许名单事件 |
| WP-5 日历 | 完成 | 用户时区月边界、exact count、truncated 警告、提交锁 |
| WP-6 可访问性/维护 | 完成 | 移动 dialog/aria-modal；三个新增纯规则/QA 小模块 |
| WP-7 回归/发布 | 完成 | 版本、迁移、测试、最终 build、四个 Chromium 阶段与文档 |
| WP-8 一键部署 | 完成 | 专用生产模板、四角色约束、Local/S3 预检、对象根 systemd 权限、dry-run |

## 3. 最终验证

| 门禁 | 结果 |
| --- | --- |
| `npm run db:migrations:verify` | 67 个有序、checksum 管理迁移通过 |
| `npm run db:migrate` | 061/062 前向应用通过 |
| `npm run db:smoke` | 67 迁移、96 表；Argon2id/session/TOTP/RLS/资料事务回滚通过 |
| `npm run db:validate` | 0 无效约束/索引、0 重复身份、0 孤儿、五角色最小权限通过 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm run test:contracts` | 24/24 核心与 v3.1 + 5/5 CAPTCHA 通过 |
| `npm run test:deploy` | 19/19 通过 |
| `npm run deploy:production:dry-run` | 通过；未改动文件、服务、数据库或网络资源 |
| `npm run build` | v3.1.0 最终应用源码生产构建通过 |
| Chromium 1228 | 四阶段、46 页面/视口、0 error、0 warning、4/4 身份清理 |

Chromium 证据使用
`C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe`，
浏览器 `149.0.7827.55`，四阶段的源码指纹与 build hash 完全一致。报告保留在 Git 忽略的
`work/browser-qa-chromium-1228/phases/`。

## 4. 健康与外部边界

真实 HTTP 检查确认 `/api/health` 返回最小 200；loopback readiness 返回详细组件状态；
携带公网 Host 的 readiness 返回 404、`READINESS_LOCAL_ONLY` 且不含 `checks`。本地详细
readiness 当前为 503，因为测试环境没有新鲜 Worker 心跳；生产 VPS 上必须由 systemd 定时器
持续运行 Worker 后才能达到 200，不能由仓库伪造。

实际 VPS/Caddy/systemd 安装、DNS/TLS、真实供应商凭据、独立备份生命周期、恢复演练和
代表性容量测试仍是环境所有者的生产激活门禁，不属于本次源码提交可越权完成的事项。
