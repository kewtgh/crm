# Lumina CRM v2.5.0 整改与产品实施计划

- 输入：`AUDIT_2026-07-26_V2.5.0.md`
- 目标：关闭全部 P1/P2/P3，交付可验证的新能力基础，不把未配置外部服务伪装为已启用
- 状态：已完成并通过最终遗漏复审

## 1. 安全与运行时配置

1. 建立共享 return-to 解析器：只允许同源绝对结果，拒绝反斜杠、控制字符、协议相对地址和编码绕过。
2. 为核心、邮件、Webhook、同步和可观测性环境组建立完整 Zod schema：URL、token、正整数、范围、
   占位值与跨字段 hostname 校验。
3. 让 readiness 返回无敏感值的字段级失败原因，并增加占位配置回归。
4. 统一设备鉴权 smoke 默认 URL 与项目标准端口。

## 2. 架构、国际化与 UI/UX

1. 为当前用户水合增加请求级 memoization，保持每次请求仍验证 Auth 和 membership。
2. 把数据库队列、Worker、连接器枚举变成共享类型；补齐中英文动态翻译并在测试中枚举验证。
3. 移动运营中心增加五个角色化分区导航，桌面布局不退化；异常摘要保持首屏可见。
4. 审计记录增加业务对象与动作语义，底层表名/UUID 收入可展开技术详情。
5. 财务空分区显示明确空状态且不渲染无意义分页；改善移动设置标签和全局搜索可发现性。
6. 在不扩大回归面的前提下拆出大型模块中的静态配置与纯展示组件。

## 3. 可观测性

1. 新增无 PII 的结构化遥测事件模型，记录 request ID、路由模板、方法、状态、时延和稳定错误码。
2. API 包装器统一发送完成/失败事件；未启用外部接收器时仅输出结构化服务日志。
3. 支持显式启用的有界外部 telemetry webhook，带独立 token、采样率和失败隔离。
4. 在管理员运营中心显示配置/启用状态，不显示虚假“已连接”。

## 4. 企业身份（SSO/SCIM）

1. SSO 使用 Supabase 企业 SSO 边界；登录页只有在服务端确认配置后显示入口。
2. SSO 启动必须经过 Turnstile、登录限流、同源校验和允许域验证；回调会再次验证 Supabase user、
   active membership、角色和首次改密/MFA 路径后才写 HttpOnly session。
3. SCIM 由独立 feature flag 和至少 32 字节 bearer token 保护，使用恒定时间比较。
4. 实现 Users list/get/create/replace/patch/deactivate 的最小 SCIM 2.0 契约；只管理员工身份，不创建客户账号。
5. SCIM 操作写入不可变审计和外部 ID 映射；错误使用 SCIM 标准响应且不泄露底层消息。

## 5. 角色化行动中心

1. 建立 `/action-center` 页面和 API，复用真实任务、审批、续约、隐私与运营数据。
2. 根据 capability/AAL2 过滤敏感项目；销售支持不得看到管理员或隐私管理动作。
3. 支持类型/紧急度筛选、深链接和空状态；移动端提供紧凑列表。
4. 仪表盘新增行动中心入口，但保留既有精确指标。

## 6. 连接器 sandbox 验证

1. 新增不可变 connector validation receipt，记录 provider、状态、时延、响应摘要 hash 和执行者。
2. 只有显式启用同步处理器且通过 AAL2 的管理角色可验证；请求有硬超时且不发送 CRM 记录。
3. 处理器必须返回受限 capability 列表和稳定状态；失败也生成不含秘密的凭证。
4. 集成 UI 显示最近验证结果，只有已连接且最近验证成功的连接器可手工同步。

## 7. 发布与验收

1. 新增迁移和 pgTAP 权限/业务断言；更新 Node 契约和动态国际化检查。
2. CI 增加本地 Supabase schema lint/pgTAP；全栈门禁使用固定 Chromium 1228 自托管环境。
3. 依次执行 typecheck、Lint、production build、dependency audit、schema lint、pgTAP、全部业务/HTTP/
   export/device-auth smoke、生产资源和十阶段 Chromium。
4. 人工复核移动运营中心、财务空状态、企业身份禁用态和行动中心。
5. 最终遗漏复审必须对照本文件逐条给出代码、迁移、测试或外部边界证据。

## 外部边界

- 本地实现和测试不得把 SSO IdP、SCIM 调用方、telemetry 接收器或连接器处理器标记为生产已连接。
- 正式启用仍要求真实凭据、供应商 metadata/证书、数据处理审批、灾备与 hosted readiness。
- SAML 签名验证由配置后的 Supabase Auth 企业 SSO 完成；应用不自行实现不安全的 XML 签名解析。

## 执行结果（2026-07-26）

- 计划 1–7 已全部落地；实施状态见 `IMPLEMENTATION_STATUS.md`，最终逐项复审见
  `FINAL_REAUDIT_2026-07-26_V2.5.0.md`。
- 最终验证：TypeScript、ESLint、production build、35/35 Node、schema lint 0、
  460/460 pgTAP、全部业务/HTTP/export/device-auth smoke、26 项生产资源均通过。
- 固定浏览器：`ms-playwright/chromium-1228`、Chromium `149.0.7827.55`，
  10/10 阶段、78/78 页面/视口、0 errors、0 warnings、身份清理 9/9。
- 验收过程额外发现并关闭两项遗漏：空 URL 的 Zod refine 会令 readiness 500；受控登录输入会在
  快速输入/水合时序下丢值。浏览器还直接关闭行动中心筛选器和审计技术详情低于 12px 的问题。
- 生产外部服务保持禁用；真实 IdP、SCIM 调用方、telemetry 接收器和连接器处理器未被伪装为已连接。
