# 客户模板与群发：接入边界和配置

客户通信 → 模板发信与群发：选择最多 50 位客户、选择模板、逐人预览、确认入队。每位客户一条线程和消息，姓名/对接人取自真实档案；任何客户资料变化要求重新预览。服务模板不能绕过既有通信目的和同意规则；推广模板使用 MARKETING。数据库和 Worker 的既有退订、DNC、幂等、租约与重试规则保持有效。失败结果逐人显示，重试同一批次不重复已入队消息。

## 两条发送路径

- `EMAIL_PROVIDER=RESEND`（默认）：既有 `RESEND_API_KEY`，不改变原部署脚本或默认行为。
- `EMAIL_PROVIDER=SMTP_RELAY`：Worker 将同样的独立收件请求发送到管理员配置的受控 HTTPS 中继；`EMAIL_RELAY_URL` 和至少 32 字符的 `EMAIL_RELAY_TOKEN` 必须配置。中继自行持有企业邮箱凭据/OAuth，不能放在 CRM 浏览器端或提交到仓库。

中继接口使用 POST、Bearer token、`idempotency-key`，JSON 结构兼容 Resend 单封发送：`from`、单元素 `to`、`subject`、`html`、`text`、可选 `reply_to`。成功返回 `200 {"id":"provider-receipt-id"}`；禁止重定向；4xx 永久失败、5xx 重试。**中继必须持久化幂等键和原始消息摘要，重复调用返回原回执，不重复发送；相同键不同消息必须拒绝。**SMTP 本身不提供端到端幂等，需要中继处理发送结果不确定的情况，不能在超时后盲目重发。

这是发送适配接口，不是已上线的 SMTP 服务。需要已有或单独部署的中继，仓库不会自动建立外部账号、生成授权或真实发送邮件。默认 `deploy:production` 脚本仍针对 Resend。启用中继时由管理员通过既有 Wrangler 配置/秘密管理工具手动配置并部署 Worker，先使用隔离的测试邮箱检查回执、幂等和失败行为。

## 服务商建议

| 服务商 | 中继端接入建议 | 状态 |
| --- | --- | --- |
| 腾讯企业邮箱 | 管理员提供账号对应的 SMTP/授权码和 TLS 配置 | 可通过中继，不含现成账号 |
| 阿里企业邮箱 | 使用账号所在区域的官方 SMTP 参数/授权码 | 可通过中继，不含现成账号 |
| Outlook / Microsoft 365 | 优先 Microsoft Graph 或 OAuth SMTP；遵守租户策略 | 需注册应用与管理员授权 |
| Gmail / Google Workspace | Gmail API / OAuth；适用账号可用应用专用密码 | 需账号授权与组织策略确认 |
| Zoho Mail | 使用账号控制台显示的区域 SMTP 参数或 OAuth | 需账号授权 |
| Resend | 原生 API，验证发信域名、配额和幂等键 | 已有原生适配，默认 |

不要在服务模板里混入推广内容来规避营销授权。收件人仍按自身目的/渠道授权检查；“群发”不等于可任意联系。收件同步、附件、OAuth 刷新生命周期和完整多邮箱客户端尚未实现，需要另行设计及账号配置。

官方参考：[Resend 幂等键](https://resend.com/docs/dashboard/emails/idempotency-keys)、[Zoho SMTP](https://www.zoho.com/mail/help/zoho-smtp.html)。其他供应商参数应由实际账号管理员从官方控制台核实，不硬编码地区或租户相关配置。
