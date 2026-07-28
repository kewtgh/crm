# Lumina CRM v2.8.4 最终遗漏复审

复审日期：2026-07-28
依据：[全面审计](AUDIT_2026-07-28_V2.8.4.md) 与
[整合修改计划](REMEDIATION_AND_PRODUCT_PLAN_2026-07-28_V2.8.4.md)

## 结论

原审计中的 4 个 P0、2 个 P1 和测试缺口均已完成实现与回归。再次逐项反查计划、源码、
systemd、数据库、运行证据和文档后，没有发现仓库范围内遗漏或半完成项。版本已统一为 2.8.4。

没有执行生产部署；没有修改、停止或重启 v2rayA、HunterAI 或任何无关服务器服务。

## 最终反查发现并补齐的遗漏

1. **通用有界进程仍可能继承开发终端代理。**
   已将直连环境策略下沉至 `bounded-process`，因此 build、test、lint、smoke、release gate
   子阶段和 Chromium QA 都自动清除代理与 `NODE_OPTIONS`。
2. **release gate 自己启动 Web 时绕过通用执行层。**
   已在 gate 入口清理自身进程环境，再启动生产 Web；源码契约覆盖该边界。
3. **只枚举已知代理名可能漏掉第三方变量。**
   清理/拒绝逻辑现覆盖任何以 `PROXY` 或 `PROXY_COMMAND` 结尾的环境名；systemd 同时显式
   清除 HTTP/HTTPS/ALL/NO/FTP/RSYNC、npm 与 Global Agent 常见变量。
4. **计划最初把 SSH Git 代理写成 URL rewrite。**
   已按最终实现纠正为单命令 `core.sshCommand` + `/usr/bin/nc` HTTP CONNECT，继续使用现有
   SSH deploy key，不持久写入 global/local Git config。

## 需求追踪

| 需求 | 实现与证据 | 状态 |
| --- | --- | --- |
| 所有登录至少 30 天 | 统一 session helper；密码、设备、MFA、SSO、rotation；真实 device-auth smoke | 完成 |
| 记住设备不控制 session | checkbox 只写 trusted-device 选择；未勾选仍有 30 天 refresh | 完成 |
| 登录与帮助中心邮箱 | 中英文 `support@ewaya.comm` 与 `mailto:` | 完成 |
| Web/Worker/readiness/runner 默认直连 | 三个 unit 的 `UnsetEnvironment`、direct child env、release gate 清理 | 完成 |
| 仅 Git pull 使用代理 | 单次临时 `git -c core.sshCommand=... pull --ff-only origin main` | 完成 |
| 不持久写 Git 代理 | 无 `git config`；无 fetch/merge、reset、force 或 rebase | 完成 |
| 保留部署安全机制 | lock、clean/main/origin/SHA、原子切换、状态、恢复、回滚、权限与 retention | 完成 |
| readiness 精确归因 | 10 秒独立 Auth/DB 探测、组件状态、稳定原因码、15 秒 runner 请求边界 | 完成 |
| missing/stale 不重计 | forward-only migration 056 与 pgTAP | 完成 |
| UI/UX 低级问题 | 登录策略说明、可点击支持、12px 下限、完整响应式/交互 QA | 完成 |
| 文档与测试 | README、deployment、status、审计、计划、最终复审和可执行回归 | 完成 |

## 最终门禁

- 完整 release gate：通过，382 秒。
- TypeScript / ESLint / production build：通过。
- Node：60/60（39 源码契约、19 部署单测、2 HTTP redirect/login 契约）。
- dependency audit：0 vulnerabilities。
- Supabase schema lint：0 findings。
- pgTAP：12 文件、468/468。
- 业务、HTTP、安全、export、真实 device-auth smoke：全部通过。
- production assets：26 个 CSS/JS 与 5 个 PNG、metadata、legacy redirect 全部通过。
- 固定 `ms-playwright/chromium-1228`：10 阶段、80 页面/视口、0 errors、0 warnings，
  QA 身份 9/9 清理；报告保存在 Git-ignored
  `work/browser-qa-chromium-1228/report.json`。

## 仍需外部授权的上线输入

生产 Supabase 备份/迁移、正式 IdP/邮件/Turnstile/连接器凭据、生产 unit 安装、旧 Lumina
drop-in 清理、hosted readiness 和正式部署都属于上线操作，不应在本次“不要执行生产部署”
范围内伪造为已完成。生产操作清单已保存在部署文档。
