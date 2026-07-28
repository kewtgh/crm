# Lumina CRM v2.9.0 整合修改计划

计划日期：2026-07-29
依据：[v2.9.0 增量全面审计](AUDIT_2026-07-29_V2.9.0.md)

## 目标与不可变约束

- 版本统一升级到 2.9.0。
- 不放宽 workspace、RLS、capability、AAL2、service-role 或 SCIM bearer 边界。
- 不执行生产部署，不修改生产凭据，不触碰 v2rayA、HunterAI、Cloudflare 或其他服务。
- 不以吞掉补偿错误、模拟连接或静态文本断言代替真实行为。
- 保留 v2.8.4 的部署、Worker、readiness、30 天 session 和固定 Chromium 1228 架构。

## 第一阶段：canonical origin 与浏览器安全策略

- 新增可测试的 application-origin/Supabase-origin 解析器。
- 生产 mutation 只接受 `APP_URL`，开发才回退到请求 origin。
- password recovery、refresh、SSO callback、portal invitation 与 SCIM location 使用相同
  canonical origin。
- 强化核心运行配置：公开 App 与 Supabase endpoint 必须是 HTTPS origin；只对 loopback
  本地开发允许 HTTP；拒绝 username/password、路径、query 和 hash。
- CSP 的 Supabase allowlist 从通配域改为精确配置 origin。

验收：伪造请求 Host 不会改变 mutation 允许来源、邮件回调、portal URL、redirect 或 SCIM
location；自定义 Supabase HTTPS origin 可用，其他项目 origin 被 CSP 拒绝。

## 第二阶段：会话刷新与密码安全闭环

- 给客户端 refresh 加 single-flight，任何数量的并发 401 只产生一个 refresh 请求。
- 捕获 refresh/network/JSON 解析异常并统一为 `ApiClientError`。
- 密码成功更新后执行全局 session revoke、trusted-device revoke，清除 access、refresh、
  persistence、trusted-device、pending verification 与 MFA remember cookie。
- 设置页跳转到登录页，并展示成功或需要检查其他会话的双语回执。
- 更新设置说明，明确密码更新后必须重新登录。

验收：并发测试证明只有一次 refresh；密码更新响应不保留任何本地认证态；撤销不完整不会
显示“全部安全动作成功”。

## 第三阶段：SCIM 并发补偿保护

- restore 限定 `id + workspace_id + just-written version`。
- 要求 `return=representation` 并验证确实恢复。
- 恢复旧业务值时仍把版本增加到下一版本，消除版本退回造成的 ABA 窗口。
- restore 未命中或失败时返回 `IDENTITY_COMPENSATION_REQUIRED`，不再写旧绑定身份。
- 只有目录行成功恢复后才允许恢复旧身份投影。
- 员工创建失败若无法删除 Auth 身份，必须尽力封禁并标记 SUSPENDED，记录补偿待处理审计，
  返回稳定运营错误，不得静默声称回滚。
- 增加源码/行为契约，覆盖并发版本冲突与补偿失败。

验收：N+1 补偿不能覆盖 N+2；新提交优先，异常进入稳定运营错误。

## 第四阶段：URL 状态和认证 UX

- `usePagedResource` 支持 back/forward 与外部 search-param 变更。
- 保留自身 URL 写入去重、请求取消、搜索防抖和超页纠正。
- 密码与 SSO 提交互斥；恢复成功后阻止重复提交。
- 在 Chromium 流程中增加/保留相关交互检查，不更换浏览器 revision。

验收：修改筛选后浏览器返回可恢复先前状态；认证不会同时发起两条登录流程；单次 token
不会被成功表单再次提交。

## 第五阶段：测试、文档、版本和发布门禁

- 新增 Node 行为测试与源码契约，更新既有版本断言。
- 运行 typecheck、lint、contracts、production build、完整 Node 测试和 assets QA。
- 启动本地 Supabase 后运行 schema lint、全部 pgTAP 与 smoke；若本机基础设施失败，保留
  精确错误而不虚报通过。
- 对验证后的生产构建运行 `npm run qa:chromium-1228`，报告保存在既有 Git-ignored 路径，
  包含精确 executable/revision。
- 更新 README、implementation status、审计、计划与最终遗漏复审。
- 对照本计划逐项反查，修正遗漏后提交。

## 完成定义

审计中的全部修复与建议功能均有实现和相称测试；外部生产输入明确分离；版本、文档和运行
证据一致；最终提交不包含生产部署动作或无关工作树修改。

## 执行结果

五个阶段均已执行完成，并在最终遗漏复核中补入两项实施期发现：SCIM 补偿版本必须单调递增，
以及员工创建 Auth 删除失败必须 fail closed。实际验证结果：

- TypeScript、ESLint、生产构建通过；
- 45/45 源码与行为契约、19/19 部署契约、2/2 root/login HTTP 契约，共 66/66 Node 测试通过；
- Supabase schema lint 0 项，12 个 pgTAP 文件 468/468；
- phase 2、v0.9、v1.0 HTTP 安全、v1.1、导出与真实设备认证冒烟通过；
- 真实设备冒烟实际证明改密后全局 session/可信设备撤销、六类安全 Cookie 清除、旧 refresh
  token 失效与新密码重新认证；
- 26 个生产 CSS/JS、5 个 PNG、metadata 与 legacy favicon redirect 验证通过；
- 固定 `ms-playwright/chromium-1228` 十阶段、80 页面/视口通过，0 error、0 warning，新增列表
  back/forward 交互通过，9/9 临时身份清理。

在线 `npm audit` 因运行策略拒绝向外部 npm 服务发送依赖元数据，未通过其他命令规避；本地
`npm ls --all --omit=optional` 已通过。生产部署与真实外部供应商连接不在本次授权范围内。
