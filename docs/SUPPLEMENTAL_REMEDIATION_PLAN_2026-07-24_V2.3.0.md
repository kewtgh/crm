# Lumina Education CRM v2.3.0 补充整改计划

- 输入：`SUPPLEMENTAL_AUDIT_2026-07-24_V2.3.0.md`
- 目标：关闭补充审计的 4 项问题，并重新执行完整发布门禁
- 状态：已完成；最终逐项复核见
  `FINAL_SUPPLEMENTAL_REAUDIT_2026-07-24_V2.3.0.md`

## 执行计划

1. **通知策略单一事实源**
   - 在设置仓储增加通知偏好归一化，修复历史上安全渠道全关的数据。
   - 收紧设置 API schema，只接受已支持的通知类别和合法免打扰时间。
   - 服务端拒绝安全邮件与站内通知同时关闭。
   - 前端禁用“最后一个开启渠道”的关闭动作，并保持中英文解释与控件关联。

2. **MFA 注册生命周期**
   - `enroll` 前清理当前用户的未验证 TOTP 因子。
   - 在同一个服务端操作中创建因子和 challenge；challenge 失败时删除新因子。
   - 调整强制 MFA 角色规则：禁止删除已验证因子，但允许清除未验证残留。
   - 首次 MFA 与设置页改用合并响应；设置页增加取消未完成配置。

3. **头像失败反馈**
   - 无效文件选择时清空临时 blob 预览和待上传文件。
   - 保持服务端 5 MB、PNG/JPEG/WebP 校验不变。

4. **回归契约与 Chromium 1228**
   - 增加通知服务端不变量、MFA 清理/回滚、头像预览复位的静态契约。
   - 将找回密码、重设密码、账户、通知、隐私、管理员用户和管理员安全页纳入真实浏览器检查。
   - 增加安全通知最后渠道不可关闭的交互断言。
   - 修复扩大矩阵后发现的管理员安全页 10px 指标说明与审计动作标签。

5. **有界的一键生产部署**
   - 增加 `npm run deploy:production`，自动 fast-forward Git pull、锁文件安装、检查、构建、
     linked migration、原子 release 切换、systemd 重启和健康检查。
   - 每个子进程和整次部署均设置 1–3600 秒范围内的硬超时；超时终止进程树并明确报错。
   - 切换后失败自动恢复上一应用 release；数据库只允许向前迁移，不执行危险的自动回滚。
   - 增加 Web systemd unit，并为 Web/Worker 设置启动和停止持续时间上限。

6. **完整验收与最终复核**
   - 执行 typecheck、lint、production build、Node contracts、npm audit、数据库与业务烟测。
   - 启动已验证 production build，执行精确 Chromium 1228、HTTP、导出、认证设备和资源检查。
   - 保存新报告，逐项回填本计划状态；再次检查是否仍有未完成或低级 UI/UX 问题。

## 完成定义

- 4 项问题均有代码和回归证据。
- 浏览器报告记录精确 executable、Chromium revision、控制库版本、构建哈希和临时身份清理结果。
- 完整 release gate 通过，且补充计划逐项复核后无遗留。

## 执行结果

| 计划项 | 结果 |
| --- | --- |
| 通知策略 | UI 保留最后一个安全通知渠道；API 拒绝全关；历史异常值读取时恢复站内通知 |
| MFA 生命周期 | 注册前清理未验证 TOTP；factor/challenge 合并且失败回滚；未验证因子可取消 |
| 头像反馈 | 无效二次选择会撤销临时文件与 blob 预览 |
| UI 与 QA | 恢复、设置和管理页面纳入矩阵；管理员安全页 10px 文字修复；单动作上限 12 秒 |
| 一键部署 | `npm run deploy:production`、原子 release、systemd、阶段/总时限和应用回滚完成 |
| 最终验收 | build、类型、Lint、29 contracts、audit、HTTP、导出、资源、认证设备和 Chromium 通过 |
