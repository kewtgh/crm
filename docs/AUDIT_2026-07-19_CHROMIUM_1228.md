# Lumina Education CRM 实机综合审计

- 审计日期：2026-07-19
- 审计基线：`cca30365e24708cba8577ea39b44d930f83e8527`
- 浏览器：本机 `ms-playwright/chromium-1228`
- Chromium：`149.0.7827.55`
- 初始覆盖：17 个公开/认证页面，1440px 与 375px，中文/英文、键盘焦点、移动导航、权限可见性、横向溢出、文字尺寸和运行时错误
- 最终证据：`work/browser-qa-chromium-1228/report.json` 及同目录截图

本文件以真实浏览器结果取代此前“浏览器环境不可用”的记录，并明确推翻
`FINAL_REAUDIT_2026-07-19_V1.2.0.md` 中“没有已知可执行缺陷”的结论。

## 总体结论

TypeScript、ESLint、生产构建、Node 契约、pgTAP、schema lint、业务 smoke
和依赖安全检查均通过，认证、RLS、幂等、审计、CSP、持久限流和队列健康基础较强。
但是发布门禁没有覆盖页面静态资源与客户端水合，真实浏览器发现发布阻断、模块边界、
权限体验、财务统计、移动布局、可访问性和产品范围等问题。审计当时版本不能被视为完整生产就绪；本文件末尾的整改复验记录给出当前状态。

## P0：发布阻断

### REL-01 Windows 生产静态资源不可用

`npm run build` 成功，但 Windows 上执行 `npm run start` 后，HTML 引用的
`/assets/*.css` 和 `/assets/*.js` 全部返回 404，页面无法加载样式或客户端水合。
当前 Vinext 静态缓存使用 `path.relative()` 的 Windows 反斜杠作为键，却使用 URL
正斜杠查询。现有 HTTP smoke 只验证 `/login` HTML 与 API，没有验证 HTML 引用资源，
因此 release gate 出现假阳性。

### REL-02 托管运行环境未配置

当前 Sites 版本与审计 commit 一致，但托管运行时环境变量为空。Supabase、Turnstile、
`APP_URL`、限流密钥及生产 worker 调度没有可验证配置。生产认证与核心 API 会 fail closed，
readiness 不能达到 200。

### ARCH-01 客户端/服务端模块边界破坏

`lib/saved-views.ts` 同时导出浏览器 schema 和 Supabase 服务端访问函数。
`components/data-table.tsx` 在客户端导入该模块，Vinext 开发构建因此将
`next/headers`/`AsyncLocalStorage` 带入浏览器。`/tasks`、`/schools`、`/people`
实机进入错误边界。

### SCOPE-01 PRD 与实现基线冲突

原始 PRD 将学生、家庭、监护关系、Lead、学籍升级、CSV/XLSX 导入、PDF/XLSX
报告和基础 AI 列为核心范围；当前测试反而断言对应路由必须不存在。若 PRD 有效，
这是核心业务范围缺失；若已废弃，则必须有正式 ADR/替代产品基线。此次整改按用户要求
恢复原始教育 CRM 产品基线。

## P1：业务正确性与权限

### DATA-01 产品指标存在 1000 行截断与币种遗漏

产品仓库直接读取全部产品和付款，受 Supabase `max_rows=1000` 限制。
统计按产品和币种聚合后只选产品主价格币种，其他币种付款不会进入客户数和收入。
应改为数据库端精确聚合，按币种展示并提供显式基础币种折算快照。

### AUTHZ-01 UI 能力与 API 权限漂移

`SALES_SPECIALIST` 实机仍可见产品“管理价格”、新建报价等最终会被 API 拒绝的操作。
财务、导入、数据质量、关系目标等页面也存在类似问题。权限必须由共享 capability
矩阵驱动，服务端仍作为最终边界；被禁止的操作应隐藏或解释，而不是提交后才失败。

### AUTHZ-02 MFA 与敏感角色不一致

销售总监和经理可进入要求 AAL2 的敏感操作，但强制 MFA 引导只覆盖超级管理员和管理员。
敏感角色范围、页面引导、API 和数据库门禁必须一致。

### ERR-01 错误信息丢失

API 客户端保留 error code、request ID 和 details，但多个页面用通用“保存失败”覆盖，
用户无法区分字段错误、权限、MFA、冲突和网络问题。应提供统一错误呈现器和可复制 request ID。

### PRIV-01 隐私文案与功能不一致

隐私政策声称可在账户设置管理访问、导出和删除请求；当前隐私设置仅提供政策链接和撤销会话。
需要真实的数据主体请求工作流、身份复核、状态和审计，或删除不实文案。

## P1：浏览器、UI 与可访问性

### UI-01 Turnstile 失败无恢复

Turnstile 脚本失败时登录页只留下空白“安全验证”区域，没有失败状态、重试按钮或帮助信息。

### UI-02 移动财务摘要被裁切

375px 下财务 KPI 区域内容宽 424px、可视宽 349px，最后一项被裁切且没有明显滚动提示。

### A11Y-01 字号与对比度不足

多个正式页面最小字号为 8–10px；侧栏分组文字约 2.65:1，版本信息约 3.14:1，
普通正文绿色/灰色也有低于 4.5:1 的情况。桌面和移动均有低于建议触控尺寸的交互控件。

### UI-03 登录页视觉和失败态可优化

桌面主标题中文断行不稳定；安全验证加载失败会产生过大空白；帮助与恢复入口层级偏弱。

## P2：架构、性能与质量门禁

### PERF-01 本地化资源和全局 CSS 体积偏大

根客户端同时打包中英文完整字典；`globals.css` 超过 120KB 且包含大量单行密集规则。
应按当前语言加载字典，并逐步将路由/组件样式拆分为可维护模块。

### VALID-01 动态资源 ID 校验不一致

若干动态 API 未在进入 PostgREST/RPC 前统一校验 UUID，错误 ID 可能变成泛化 500。

### TEST-01 测试以源码正则为主，缺少真实组件和浏览器门禁

Node 测试大量检查源文本；release gate 没有真实 CSS/JS、客户端水合、权限可见性、
移动布局、axe 或视觉回归。实机 QA 不应再依赖人工临时脚本。

### IMP-01 导入导出能力低于业务基线

当前导入仅 CSV 且 500 行；导出主要为 CSV。产品基线要求 CSV/XLSX、至少 10,000 行、
可恢复批次、私有 PDF/XLSX 输出。

## 正向发现

- HttpOnly/SameSite 会话、Supabase 身份复核、workspace membership 和 RLS 边界清晰。
- Origin、Turnstile、持久限流、AAL2、CSP nonce、Webhook HMAC/重放和危险操作幂等基础完整。
- 数据库测试覆盖较好；整改后的 222 条 pgTAP、schema lint 和多组业务 smoke 全部通过。
- 移动抽屉焦点约束、Escape 关闭和焦点恢复通过；中英文切换通过。
- 实机未发现无名称按钮或无标签表单控件，页面未出现 document 级横向溢出。

## 建议纳入 v2.0 的能力

1. 共享 capability 权限中心和“为什么不能操作”说明。
2. 学生、家庭、监护关系、学籍时间线及幂等升年级。
3. Lead 捕获、资格判定、转化与学校/家庭双 Pipeline。
4. CSV/XLSX 10,000 行导入、字段模板、断点恢复和逐行修复。
5. PDF/XLSX 私有报告与下载生命周期。
6. 数据主体访问、导出、更正、删除请求中心。
7. 多币种财务台账、汇率快照和精确数据库聚合。
8. 带证据、置信度、Prompt/规则版本、人工接受/编辑/拒绝和审计的智能建议。
9. 浏览器水合、静态资源、权限矩阵、移动布局和可访问性自动门禁。

## 整改与最终复验（2026-07-19）

上述 REL-01、ARCH-01、SCOPE-01、DATA-01、AUTHZ-01/02、ERR-01、PRIV-01、
UI-01/02/03、A11Y-01、PERF-01、VALID-01、TEST-01 和 IMP-01 均已按
`REMEDIATION_AND_EXPANSION_PLAN_V2.0.0.md` 完成仓库内整改。最终遗漏复审还补齐：

- 学籍升级批次与 AI 建议的精确 count 和 10/20/50 服务端分页；
- 支持角色工作台中泄漏的管理员审批链接；
- 选择器占位文字、顶部角色和侧栏版本文字对比度；
- 旧核心工作流的统一 request ID/MFA/冲突/网络错误呈现；
- v2、移动与 WCAG 收口规则从密集全局 CSS 拆分。

最终指定浏览器门禁使用：

`C:\Users\Horolf\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe`

结果为 Chromium `149.0.7827.55`、23/23 页面/视口检查通过、0 个 console/page/network
错误、0 个无名称控件、0 个小于 12px 的功能文字、0 个实色背景文字对比度失败、
0 个标题跳级和 0 个 document 横向溢出。经理身份以真实 TOTP 提升至 AAL2；支持角色
验证受限导航隐藏、直接路由重定向和允许的 Lead 页面；移动菜单和抽屉进入/Escape/焦点
恢复通过；2/2 临时身份已删除。

REL-02 仍是生产环境所有者门禁：Sites runtime secrets、独立 Supabase 迁移/备份、
六 worker 调度和 readiness 200 无法由仓库源码伪造。
