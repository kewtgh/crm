# Lumina CRM v2.6.0 最终遗漏复审

- 复审日期：2026-07-27
- 对照输入：本轮完整审计与整改/产品实施计划
- 复审原则：逐条反查源码、迁移、契约、生产构建、数据库、业务 smoke、真实生产资源和固定浏览器证据

## 结论

计划中的 P1/P2/P3 与四项建议能力均已实现，没有发现仍处于“仅写计划、未接业务路径”的项目。
复审过程中发现的版本断言、最新供应链公告、Next Image 编码引用和新增交互覆盖缺口也已纳入
本轮修复，不留到下一版本。

## 复审发现并补齐的遗漏

1. 历史 Node 契约多处把当前版本硬编码为 2.5.1，升级后产生伪回归；已统一为 2.6.0，同时
   保留真正属于 v2.5.1 品牌交付的历史语义测试。
2. 发布门禁刷新 npm 元数据后出现 React RSC、PostCSS 与 brace expansion high 公告；已用
   兼容补丁版本和双 API 安全桥接关闭，完整依赖审计为 0，Lint 不降级。
3. 品牌资源门禁最初只识别原始 HTML 路径，未识别 Next Image 的 `%2F` URL 编码；已同时
   接受标准原始/编码引用，实际 HTTP、MIME、PNG 签名和尺寸校验保持强制。
4. 静默进程契约在受限 Windows 环境不能可靠 spawn；运行器现可注入进程/终止函数，测试用
   内存事件流验证 idle watchdog 确实终止，不再把 `EPERM` 当功能结果。
5. 新能力最初只有源码契约；固定 Chromium 工作流现增加即时页面命令、危险操作 Escape/
   焦点恢复和认证语言偏好 reload 持久化交互。
6. 浏览器分阶段证据以前可混合不同工作树；合并签名现包含 Git 状态摘要、部署源码指纹、
   版本、迁移和构建 hash。文档修改不伪装成部署源码变化，完整工作树仍明确标为 dirty。
7. 生产资源复核发现 OG 图仍显示 v2.2.0，且 metadata 尺寸与 PNG 头不一致；已使用原图
   精确编辑为 v2.6.0、同步命名为 `og-v260.png`，并把 metadata/资源门禁统一为
   1728×910。
8. Chromium 新增焦点断言发现嵌套 ConfirmDialog 的 Escape 会继续冒泡并同时关闭底层抽屉；
   确认框现于捕获阶段消费 Escape，保留底层业务上下文并恢复到原触发按钮。
9. 最终计划对照发现认证语言切换的乐观顺序与“先持久化再更新界面”不一致；现仅在服务端
   偏好保存成功后切换，失败保持原语言并显示错误，避免设备间再次漂移。

## 计划逐项闭环

| 计划域 | 闭环证据 |
| --- | --- |
| 时区与 DST | 共享模块、API 稳定错误、054 CHECK、纽约/伦敦跳时契约 |
| 跨设备语言 | 最小设置 PATCH、认证布局恢复、本地存储异常隔离、reload 浏览器交互 |
| 命令搜索 | capability 过滤页面命令 + 远程记录、桌面/移动 listbox 与浏览器交互 |
| 危险操作 | 通用 ConfirmDialog、归档/移除/取消/撤销/删除接入、焦点浏览器交互 |
| 低级 UI/UX | `aria-current`、双语 404、任务逐项 pending、防 LocalStorage 中断 |
| 发布工程 | 确定性 watchdog、品牌真实资源门禁、源码/构建证据、分阶段一致性 |
| 供应链 | React/RSC 19.2.8、PostCSS 8.5.23、安全 brace expansion 5.0.8、audit 0 |
| 文档与版本 | package/lock/health v2.6.0，README、部署、实施状态与本复审 |

## 验收

- TypeScript：通过。
- ESLint：通过。
- Node 契约：37/37。
- Production build：通过。
- Dependency audit：0 vulnerabilities。
- PostgreSQL schema lint：0 findings。
- pgTAP：11 文件，464/464。
- 业务、HTTP、export、device-auth 与生产资源：最终完整 release gate 通过。
- 固定 Chromium 1228：10 阶段、78/78 页面/视口、0 errors、0 warnings、身份清理 9/9，
  Chromium 149.0.7827.55，耗时 242 秒；合并证据保存在
  `work/browser-qa-chromium-1228/report.json`。

## 保留的外部边界

SSO、SCIM、telemetry、邮件、支付、会计、电子签、AI 和连接器生产启用仍需要真实供应商
配置、数据处理批准、备份/恢复演练、调度心跳与托管环境验收。本轮没有伪造这些外部状态，
也没有执行生产部署。
