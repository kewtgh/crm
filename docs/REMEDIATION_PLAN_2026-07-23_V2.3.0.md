# Lumina Education CRM v2.3.0 整改与验证计划

- 输入：`AUDIT_2026-07-23_V2.2.1.md`
- 目标：关闭全部本轮发现，不扩大未经验证的业务域，完成可重复的安全发布
- 状态：已完成；最终逐项复核见 `FINAL_REAUDIT_2026-07-23_V2.3.0.md`

## 执行计划

1. **供应链安全**
   - 升级 Next.js 与 `eslint-config-next` 到 16.2.11。
   - 固定 `sharp` 0.35.3、`postcss` 8.5.14；升级安全线内的
     `brace-expansion`、`fast-uri`。
   - 验收：`npm audit --audit-level=moderate` 为 0。

2. **会话期限一致性**
   - 新增 HttpOnly persistence marker 和共享 session-cookie helper。
   - 登录、可信设备复用、设备 OTP、MFA 验证和 refresh 根据用户原始选择设置 session/
     persistent cookie。
   - 登出、密码更新和 refresh 失败清除 persistence marker。
   - 增加静态契约测试，防止 refresh 再次无条件设置 30 天 cookie。

3. **API 隐私缓存**
   - `apiRoute` 成功、规范化错误和异常响应统一 `Cache-Control: no-store`。
   - 补齐未经过包装器的认证刷新与登出响应。
   - 保持显式缓存响应不被覆盖，并增加契约测试。

4. **环境配置闭环**
   - 本地环境生成器补齐 payment Webhook secret、可选 worker/AI 显式开关和导出上限。
   - `.env.example`、运行时检查器与生成器保持一致。
   - 增加配置契约测试。

5. **MFA 指南与基础 UX/业务一致性**
   - 首次 MFA 配置和账户安全页共用 TOTP/Authenticator 指南，列出推荐终端和 secret
     防泄漏、设备自动校时要求。
   - 把 MFA 与修改密码的成功/错误状态拆分到各自操作附近。
   - 首次登录、账户设置和找回密码共用 12 位 + 大写 + 小写 + 数字密码策略。
   - 头像说明和客户端校验与服务端 5 MB、PNG/JPEG/WebP 契约保持一致。
   - 固定 `playwright-core` 开发依赖，移除易失 npx cache 路径，但继续只运行 Chromium 1228。
   - 修复日历、合同、关系目标、设置和集成页面 8–11px 文字与灰色状态对比度。
   - 补齐 Chromium QA 自动化事件/身份清理，并在所有 cleanup 检查完成后写入报告。

6. **版本与文档**
   - 发布版本 v2.3.0；同步 package、运行时版本、README 和实施状态。
   - 保存最终遗漏复审，逐项对照本计划。

7. **完整验收**
   - typecheck、lint、production build、26+ Node contracts。
   - npm audit、schema lint、433 pgTAP、phase2/v0.9 业务烟测。
   - 在已验证 production build 上执行 HTTP、导出、真实 device-auth smoke。
   - 执行仓库指定 `npm run qa:chromium-1228`，保留精确 Chromium revision、可访问性、
     响应式、角色边界和交互报告。
   - 再次复核计划；任何遗漏先补齐再形成最终结论。

## 完成定义

- 本文所有步骤均有代码或测试证据。
- 不以模拟供应商成功代替真实边界；未配置的外部连接继续明确显示未连接。
- 完整 release gate 通过；若仅受当前机器外部并发状态影响，必须给出精确失败阶段和已独立
  通过的等价门禁，不得虚报。
