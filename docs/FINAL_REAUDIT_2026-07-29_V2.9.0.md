# Lumina CRM v2.9.0 最终遗漏复核

复核日期：2026-07-29
依据：[审计](AUDIT_2026-07-29_V2.9.0.md)与[整合修改计划](REMEDIATION_AND_PRODUCT_PLAN_2026-07-29_V2.9.0.md)

## 复核结论

审计列出的全部修复与建议能力均已实现，没有保留仅写入文档而未执行的产品建议。本轮没有
新增数据库迁移；既有 head `202607280056_v284_readiness_diagnostics` 与 468 项 pgTAP 保持
一致。生产部署、真实 IdP/邮件/Turnstile/Supabase 凭据、备份恢复和 systemd 安装仍属于明确
的外部上线输入，本次没有伪造或越权执行。

## 对照结果

| 审计项 | 最终状态 | 主要证据 |
| --- | --- | --- |
| AUTH-01 并发 refresh | 完成 | 共享 single-flight；真实 Promise 并发契约只执行一次 |
| AUTH-02 改密状态闭环 | 完成 | 全局 session 与可信设备撤销、全部安全 Cookie 清除、强制重新登录；真实设备冒烟验证旧 refresh token 失效 |
| ID-01 SCIM 并发补偿 | 完成 | `id + workspace + N+1` CAS；恢复值使用 N+2 单调版本；新版本优先并返回稳定补偿错误 |
| ID-02 员工创建补偿 | 完成 | 删除失败时封禁/SUSPENDED、补偿审计与稳定运营错误，不再静默回滚 |
| SEC-01 canonical origin | 完成 | 生产 mutation、redirect、SSO、portal、SCIM、邮件与 metadata 统一配置 origin |
| SEC-02 精确 CSP | 完成 | Supabase HTTP/WS 来源按已验证配置生成，不再放行通配项目域 |
| UX-01 可逆列表状态 | 完成 | 搜索 replace、离散筛选/分页 push、外部历史同步；Chromium back/forward 通过 |
| UX-02 重复认证提交 | 完成 | 登录/SSO/改密/两类恢复表单使用同步互斥，导航期间保持锁定 |

## 实施期遗漏检查

复核代码时发现并补齐：

1. SCIM 若恢复到旧版本号会形成 ABA 窗口；已改为恢复旧值但版本增加到 N+2，并增加真实纯
   函数行为测试。
2. React `pending` 状态不能阻止同一事件循环快速双击；已增加同步 ref 锁，而非只禁用按钮。
3. 员工创建的 Auth 删除失败原本无稳定补偿结果；已 fail closed 并留下审计信号。
4. 原设备认证冒烟只覆盖初始密码替换；已扩展为实际验证设置页改密撤销闭环。
5. 版本升级后 10 处历史测试仍把当前版本固定为 2.8.4；已统一为 2.9.0，同时保留历史控制
   测试名称与旧版文档链接。

## 最终验证

- TypeScript、ESLint、production build：通过。
- Node：66/66。
- Supabase schema lint：0 findings；pgTAP：468/468，12 files。
- 业务/HTTP/导出/真实设备认证冒烟：通过。
- 生产资产：26 个 CSS/JS、5 个 PNG、metadata、favicon redirect 全部通过。
- Chromium：固定 `ms-playwright/chromium-1228`，
  `C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe`，
  Chromium `149.0.7827.55`；10 阶段、80 页面/视口、0 error、0 warning、9/9 身份清理。

在线依赖公告查询因运行策略拒绝向外部 npm 服务发送依赖元数据而未执行；没有绕过该限制。
本地依赖树完整性检查通过。最终提交后将针对相同生产构建重新生成 clean-commit Chromium
证据。
