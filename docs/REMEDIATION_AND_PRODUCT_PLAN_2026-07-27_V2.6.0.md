# Lumina CRM v2.6.0 整改与产品实施计划

- 输入：`AUDIT_2026-07-27_V2.6.0.md`
- 目标：关闭全部 P1/P2/P3，并交付审计中列出的四项产品/工程扩展
- 执行状态：已实现；最终证据由 `IMPLEMENTATION_STATUS.md` 与 Git 忽略的浏览器报告记录

## 1. 时区与业务时间完整性

1. 建立浏览器/服务端共享的时区模块，集中定义受支持时区、格式化与本地时间转 UTC。
2. 转换后做本地年月日时分往返校验；不存在的 DST 时间返回稳定 `INVALID_LOCAL_TIME`，
   不得静默移动。
3. 设置 API 使用共享时区枚举；读取历史异常值时安全回退。
4. 新增 `054` 迁移：清理异常时区并增加数据库 CHECK；为 API、转换和数据库约束增加契约。

## 2. 跨设备语言偏好

1. 为设置 API 增加仅更新 locale 的最小分支，保持同源和登录校验。
2. 认证布局把服务端偏好传给 AppShell；客户端只在不一致时同步国际化上下文。
3. 顶栏语言切换先保存认证偏好，再更新界面；公开登录/法律页面保持本地切换。
4. Cookie/LocalStorage 写入失败互相隔离，不因非关键存储阻断界面切换。

## 3. 统一命令搜索

1. 从经过 capability 过滤的可见导航生成页面命令。
2. Ctrl/⌘K 同时按当前语言匹配页面与远程业务记录，并标明“页面/记录”来源。
3. 页面命令即时可用；远程请求有加载状态、取消和错误隔离，不遮住本地结果。
4. 保持桌面/移动键盘导航、`aria-activedescendant` 和权限边界。

## 4. 破坏性操作与可访问性

1. 在 UI 基础层新增 `ConfirmDialog`：`alertdialog`、标题/说明关联、初始焦点、Tab 陷阱、
   Escape、滚动锁定与触发点焦点恢复。
2. 替换三个 `window.confirm`；为日历取消、门户撤销、保存视图删除等易误触操作补确认。
3. 对学生/家庭归档复用同一确认层，不再点击即归档。
4. 为侧栏和设置导航补 `aria-current`，404 接入中英文目录。
5. 仪表盘任务完成增加逐项 pending/idempotent UI，避免重复请求和计数漂移。

## 5. 发布工程与品牌资源

1. 让 bounded runner 可注入进程工厂，以无真实子进程的确定性契约验证无输出终止。
2. 浏览器证据增加工作树状态和源码指纹；分阶段合并签名必须包含这些字段。
3. 生产资源检查覆盖 Logo、Favicon、OG 图片和 `/favicon.ico` 重定向，验证 HTTP、MIME、
   PNG 签名和 HTML metadata 引用。
4. 更新 Node 契约，防止时区、偏好、命令搜索、确认层、品牌资源与证据字段回退。

## 6. 文档、版本和验收

1. 版本升级至 v2.6.0，更新 README、部署和实施状态。
2. 依次执行 TypeScript、ESLint、Node 契约、production build、dependency audit。
3. 启动本项目独立端口的本地 Supabase，应用到 `054`，执行 schema lint 和完整 pgTAP。
4. 执行业务、HTTP、export、device-auth smoke 和生产资源门禁。
5. 启动已验证生产构建后运行仓库指定的 `npm run qa:chromium-1228`，保留
   `work/browser-qa-chromium-1228/` 精确运行时证据。
6. 对照本计划逐项复审遗漏；任何新发现先修复、重跑受影响门禁，再写最终遗漏复审。

## 7. 执行期供应链复审

1. 将 React、React DOM 与 RSC 升级到 19.2.8，将 PostCSS 升级到 8.5.23。
2. 不接受会降级 Next 或破坏插件 API 的 `audit fix --force`；保持 ESLint 9 的已声明兼容线。
3. 用本地 `brace-expansion` 兼容桥接包调用安全 5.0.8，同时暴露旧函数 API 与新
   `expand` API；加入执行契约。
4. 要求完整生产/开发依赖 `npm audit` 为 0，且 ESLint、构建与 Node 契约全部重跑。

## 已执行范围

以上 1–7 节均已落到源码、迁移、测试与文档。数据库已应用到 `054`，schema lint 为 0，
pgTAP 为 464/464，Node 契约为 37/37，依赖审计为 0；最终 production asset、HTTP、
device-auth 与 Chromium 数值以同一轮完整 release gate 和浏览器报告为准。

## 外部边界

- 不启用或伪装 SSO、SCIM、telemetry、邮件、支付、会计、电子签和连接器生产服务。
- 不把本地“脏工作树已验证”表述为“精确提交已验证”；报告必须如实记录源码状态。
- 不下载或替换浏览器；固定使用已安装的 `ms-playwright/chromium-1228`。
