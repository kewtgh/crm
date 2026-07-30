# Lumina CRM v2.5.0 最终遗漏复审

- 复审日期：2026-07-26
- 输入：`AUDIT_2026-07-26_V2.5.0.md` 与
  `REMEDIATION_AND_PRODUCT_PLAN_2026-07-26_V2.5.0.md`
- 迁移头：`202607260053_v250_enterprise_operations`
- 结论：原审计的 P1/P2/P3 和四项产品扩展建议均已在本地实现范围内关闭；没有发现仍可由
  本仓库代码、迁移或测试继续完成的遗漏。

## 1. 逐项关闭证据

| 计划项 | 代码/迁移证据 | 验收证据 | 状态 |
| --- | --- | --- | --- |
| 安全与运行时配置 | `lib/return-to.ts`、`lib/runtime-environment.ts`、refresh route、auth device smoke | 编码/反斜杠跳转契约；空值/占位/hostname/独立 secret 契约；HTTP readiness | 完成 |
| 架构、国际化与 UI/UX | `lib/auth.ts` 请求缓存、`lib/operations-types.ts`、`components/audit-event-row.tsx`、财务/运营/设置 CSS 与组件 | 35 条 Node 契约；Chromium 行动中心、财务、设置、运营、管理员桌面/移动检查 | 完成 |
| 可观测性 | `lib/observability.ts` 与 `lib/api.ts`；运营就绪状态 | allow-list 静态契约、route template、稳定错误码、2 秒隔离；最终服务日志抽查 | 完成 |
| SSO/SCIM | SSO start/callback、`lib/enterprise-identity.ts`、SCIM discovery/Users、`lib/scim.ts`、`053` | production build 路由、Node 安全契约、pgTAP RLS/角色/身份 profile 契约 | 完成 |
| 角色化行动中心 | page/API/repository/component、导航与仪表盘入口 | Chromium 桌面/375px、权限角色矩阵、空状态与筛选器可读性 | 完成 |
| 连接器 sandbox | integrations API/repository/worker、不可变 receipts 与 UI | pgTAP 不可变/权限/字段边界；Node 契约；未配置状态不伪装连接 | 完成 |
| 发布与验收 | PR database CI、full-release-gate、固定浏览器 staged script | 干净数据库 53 个迁移、schema lint 0、460 pgTAP、全部 smoke、78 页浏览器 | 完成 |

## 2. 原审计问题回查

### P1

- return-to 只接受解析后同源相对路径，拒绝协议相对、反斜杠、控制字符及多层编码绕过。
- 核心/投递/Webhook/同步/可观测性/SSO/SCIM 配置均有类型、范围、占位值和跨字段检查。
  空或畸形 URL 不再让 readiness 抛异常。

### P2

- 当前用户水合以请求级 `cache()` 去重，授权仍读取真实 Auth、profile 和 active membership。
- 数据库动态队列键中英文齐全，并由共享枚举及 executable contract 防止再次漂移。
- CI 增加干净 Supabase migration/schema/pgTAP；固定浏览器完整门禁独立运行。
- 移动运营中心分为五个首屏可导航分区；异常和就绪摘要不再埋在超长列表中。
- 审计事件显示业务动作/对象，UUID 和原始动作/表名收入 12px 可展开技术详情。

### P3

- 财务空分区有明确空状态且零记录时不渲染分页。
- 移动设置导航支持 sticky、横向 snap 和 44px 触控目标；全局搜索触控区已改善。
- 设备鉴权 smoke 默认跟随 `AUTH_SMOKE_BASE_URL` / `APP_URL` / 3200。
- 运营枚举与审计展示已从大型模块拆为共享静态类型和纯展示组件。

## 3. 新功能回查

- 可观测性：只发送无 PII 的允许列表事件；外部 webhook 显式启用、独立凭据、采样、硬超时、
  失败隔离。未配置时仅结构化本地日志。
- 企业身份：SSO 由 Supabase Auth 验证 SAML；应用实施 PKCE、签名短期 cookie、同源、允许域、
  Turnstile、限流、membership 与 MFA。SCIM token 恒定时间比较，只允许销售员工角色并以停用
  代替删除。
- 行动中心：复用真实 Dashboard 聚合和 capability，不自动改业务数据，不向销售支持泄露管理动作。
- 连接器验证：请求不含 CRM 记录；状态、耗时、能力、SHA-256、执行者与 24 小时有效期写入
  不可变凭证；UI/API/Worker 同步均有当前成功凭证门。

## 4. 最终验证记录

| 检查 | 结果 |
| --- | --- |
| TypeScript / ESLint / production build | 通过 |
| Node contracts | 35/35 |
| Dependency tree | 未变化；lockfile 仅版本号 2.4.0 → 2.5.0；既有在线审计基线为 0 vulnerabilities |
| Clean migration application | 通过至 `053` |
| schema lint | 0 findings |
| pgTAP | 460/460，10 files |
| business / HTTP / export / device-auth / assets | 全部通过；assets 26/26 |
| Chromium 1228 | 78/78，10/10 phases，0 errors，0 warnings，身份清理 9/9 |
| 浏览器运行时 | `ms-playwright/chromium-1228`，Chromium `149.0.7827.55`，`playwright-core 1.61.1` |

浏览器合并证据保存在 Git 忽略的
`work/browser-qa-chromium-1228/report.json`，build hash 为
`2ec64ff09a11e7f4fd6fe5320ec368542c83c984dbf2ef9271ff05c869c5c53f`。

## 5. 验收中额外关闭的问题

1. 新配置验证器对空 URL 的 refine 会抛 `Invalid URL`，把可执行的 503 readiness 误变为 500。
   已增加异常边界和“不完整配置不得抛异常”契约。
2. 为 SSO 增加的受控登录标识在极快输入与 Turnstile 水合重渲染时可能被清空。已恢复非受控
   登录输入，SSO 点击时只通过 ref 读取当前邮箱；真实设备鉴权全流程通过。
3. 新行动中心筛选器为 11px，新审计技术标签为 9px。固定 Chromium 阶段分别捕获后均提升到
   12px；技术标签同时改为默认折叠，最终矩阵无低字号问题。

## 6. 非代码外部边界

以下不是未完成开发，不能在缺少真实供应商和生产授权时假装完成：

- 正式 SAML IdP metadata/证书、SCIM 调用方和轮换 token；
- telemetry 接收器、留存/告警策略及数据处理审批；
- 邮件、Webhook、支付、会计、电子签和同步处理器真实凭据；
- 生产备份恢复演练、迁移窗口、systemd 心跳和 hosted readiness 200；
- 对外部 npm advisory 服务重新查询依赖元数据（本次因未获单独外发授权而未刷新；依赖树未改）。

这些边界在 `.env.example`、`docs/DEPLOYMENT.md` 和 readiness 中均以 disabled/unconfigured
呈现，不会显示虚假“已连接”。
