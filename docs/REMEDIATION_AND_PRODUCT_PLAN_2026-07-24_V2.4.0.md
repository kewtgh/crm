# Lumina Education CRM v2.4.0 整改与产品计划

- 输入：`AUDIT_2026-07-24_V2.4.0.md`
- 目标：关闭全部 6 类确认问题及执行中发现的遗漏，固化防卡死测试方案并完成可复验发布候选
- 状态：已完成

## 执行计划

1. **有界测试与发布基础设施**
   - 新增跨平台有界子进程执行器。
   - 支持总时限、无输出时限、固定间隔心跳和 Windows/POSIX 进程树终止。
   - 标准 `build`、`test`、`qa:chromium-1228` 默认通过该执行器。
   - 重写 release gate：每一阶段有独立上限，整次门禁有总预算，失败明确报告阶段与原因。
   - CI 为安装、类型、Lint、测试和依赖审计分别设置步骤时限。

2. **应用网络可靠性**
   - 增加通用 bounded fetch/signal helper。
   - 为 Supabase 用户态和 service-role 请求统一设置硬超时并归一化 504。
   - 覆盖登录、设备验证、刷新、密码恢复、头像、当前密码验证和浏览器认证表单。
   - 表单区分网络失败与请求超时，恢复 pending 状态并允许重试。

3. **API 错误脱敏**
   - 错误响应只暴露稳定 code、field、requestId 和结构化 details。
   - 移除底层 `message` 的顶层透传，保持现有前端错误码契约。

4. **头像业务完整性**
   - 校验 PNG/JPEG/WebP 魔数而非只相信 MIME。
   - 成功保存新路径后删除不同的旧对象；清理失败不回滚已完成的头像更新。
   - 增加无效签名和旧对象回收静态契约。

5. **UI/UX 与浏览器覆盖**
   - 为“找回密码”新增独立中英文 metadata。
   - 将遗漏的报告、质量、重复项、分配、分析、帮助和管理页加入 Chromium 1228。
   - 对高价值遗漏页补充 375px 移动检查，继续强制标题、标签、对比度、12px 字号和溢出规则。

6. **验证、遗漏复查与交付**
   - 执行有界 typecheck、Lint、production build、Node contracts 和 npm audit。
   - 启动已验证 production build，执行有界 Chromium 1228、HTTP、资源与关键业务 smoke。
   - 保存新报告，逐项复查本计划，不完整项不得标记完成。
   - 更新 README、部署、实现状态和版本，最后创建 Git commit。

## 固定时限基线

| 入口/阶段 | 总上限 | 无输出上限 |
| --- | ---: | ---: |
| typecheck | 120 秒 | 60 秒 |
| ESLint | 180 秒 | 90 秒 |
| production build | 240 秒 | 90 秒 |
| Node contracts | 120 秒 | 60 秒 |
| Chromium 1228 | 整体 480 秒；单阶段 45–90 秒 | 30–45 秒 |
| pgTAP | 300 秒 | 120 秒 |
| 完整 release gate | 900 秒 | 每阶段独立控制 |

所有值只允许在安全范围内显式调整，不能配置为无限等待。超时或静默卡死必须终止子进程树并
返回非零退出码。

## 完成定义

- 6 项确认问题均有实现和回归契约。
- 直接运行标准测试入口也不会无限等待。
- Chromium 报告记录 revision、executable、版本、Git SHA、build hash 和身份清理结果。
- 最终复查没有遗漏、半实现或只写文档未落地的条目。
- README、部署说明、实现状态、版本和 commit 与实际代码一致。

## 执行结果

| 计划项 | 实现与证据 | 状态 |
| --- | --- | --- |
| 有界测试与发布 | 通用执行器、总/静默时限、心跳、跨平台进程树终止；所有标准检查、smoke、资源 QA 和 release gate 均已接入 | 完成 |
| 网络可靠性 | Supabase 用户态/service role、登录、OTP、刷新、恢复、头像、密码、用户水合及客户端认证全部有硬超时 | 完成 |
| API 脱敏 | 响应保留稳定 code/field/requestId/details，不透传顶层底层 message/error | 完成 |
| 头像完整性 | PNG/JPEG/WebP 魔数验证；成功更新后清理不同旧对象 | 完成 |
| UI/UX | 独立找回密码 metadata；修复低于 12px、低对比度、移动治理区和状态徽章溢出 | 完成 |
| Chromium 覆盖 | 10 个可独立恢复阶段、75 页面/视口、232 秒、0 errors/warnings、身份清理 9/9 | 完成 |
| 最终反查 | 补齐 `lib/auth.ts` 网络超时、有界 npm CLI 定位及 localhost Secure Cookie QA 约定 | 完成 |
| 发布材料 | v2.4.0 package/runtime、README、部署、实现状态、审计、计划、最终复审同步 | 完成 |

所有验证均按“单阶段执行、单阶段汇报”完成，没有以一条沉默的 20–30 分钟命令代替检查。
实际最长的 Chromium 总矩阵拆为 10 段，单段实际约 5–47 秒；pgTAP 实际约 10 秒。
