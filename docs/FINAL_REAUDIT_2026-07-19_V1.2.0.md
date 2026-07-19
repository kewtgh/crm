# Lumina CRM v1.2.0 最终复审

> 已被 v2.0.0 Chromium 实机审计、整改计划与最终遗漏复审取代。
> “无已知可执行缺陷”及浏览器环境阻断结论不再有效。

- 日期：2026-07-19
- 输入：综合审计、v1.2.0 实施计划、最终源码、迁移、自动化与本地生产运行证据。

## 结论

审计中可由仓库完成的缺陷与建议功能均已落地，没有发现未解释的 P0/P1/P2 源码遗漏。精确源码已完成本地提交；GitHub 推送和 Sites 私有部署等待对既有远端的明确外发授权。托管运行时当前没有生产环境变量。生产外部凭据、持续 worker 调度和真实浏览器运行时不是仓库可生成状态，继续按 fail-closed 方式显示并记录。

## 关闭映射

| 审计项 | 最终状态 | 证据摘要 |
| --- | --- | --- |
| REL-01 | 已关闭（代码） | 六 worker 统一周期、失败心跳、readiness 队列/心跳检查 |
| REL-02 | 实现关闭、发布待授权 | 精确 commit 已在本地生成；生产变量不使用本地测试值代替，推送与 private 部署等待明确授权 |
| REL-03 | 外部阻断 | HTTP/源码验收通过；实机矩阵记录在 Browser QA，不虚报 |
| CRM-01/02/03 | 已关闭 | 委派 RPC、编辑/归档/历史、任务详情、CRM 导出审批 |
| CRM-04 | 已关闭 | 源字段未修复时数据库拒绝正常 resolve |
| ERR-01 | 已关闭 | 显式加载失败、request ID、全局/路由错误与空状态分离 |
| SEC-01 | 已关闭 | 持久恢复限流、Turnstile、429 与 `Retry-After` |
| UI/A11Y | 已关闭（源码） | token、移动焦点、combobox/menu/dialog、skip link、触控尺寸 |
| I18N/META | 已关闭 | 状态/字段/运维码本地化与主要路由双语 metadata |
| UX/IMP | 已关闭 | CSV 状态机、500 行限制、搜索式合并、影响预览、幂等危险操作 |
| SEARCH-01 | 已关闭 | 七类业务对象权限感知全局搜索 |
| 建议功能 | 已关闭 | 工作队列、团队容量、SLA、通知、批量完成、共享视图、规则建议 |

## 第二轮遗漏检查

- 已搜索永久 disabled、错误转空数组、原始 UUID 输入、原始状态码、未取消远程请求和 TODO/FIXME。
- 补修通知/个人菜单 Tab 焦点、移动离屏侧栏焦点、审批/审计/导出/数据质量/导入/360/消费/业绩/运维列表竞态。
- 关闭旧底层 merge、rollback、accept RPC，认证客户端只能调用幂等包装器。
- 修复 Windows 下 release gate 的 `spawn npm.cmd EINVAL`，改用当前 Node 执行 npm CLI。
- 修复 `.env.local` 中空 `WORKER_ID` 导致生成文件 worker 拒绝空跑的问题；未填写时生成安全实例 ID。
- 将 readiness 心跳测试改为事务内清理已有心跳，统一 worker 实测后重跑仍保持 177/177。
- 发布闸门现在检测生产服务提前退出，端口已占用时不会复用旧服务并产生假阳性；在干净端口重新全量通过。
- 更新 v1.2.0 社交分享卡，准确呈现任务工作队列、团队容量、SLA、审批和分析能力。
- 空库重建与增量末端迁移均使用同一 `039` 文件，schema lint 为 0。

## 自动化结果

- TypeScript：通过。
- ESLint：通过。
- Production build：通过。
- Node：22/22。
- pgTAP：177/177。
- schema lint：0。
- phase2、v0.9 业务 smoke、base HTTP、Webhook HTTP、v1.1 remediation：全部通过。
- 单一 `npm run release:gate`：通过。

## 仍需环境所有者验收

1. 使用正式凭据确认 readiness 200 和六 worker 持续新鲜。
2. 在可用浏览器完成 `BROWSER_QA_2026-07-19_V1.2.0.md` 的三宽度双语矩阵。
3. 验证生产邮件、日历、Webhook、同步、备份、告警和私有导出。
