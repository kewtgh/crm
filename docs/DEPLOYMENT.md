# Lumina Education CRM v2.4.0 部署指引

## 1. 发布前提

- Node.js 24.x；开发、CI 与服务器统一使用 `.nvmrc` 固定的 `24.18.0`。
- 独立 Supabase 项目（Auth、Postgres、private Storage）、HTTPS 域名、密钥管理、备份与告警。
- 正式 Turnstile、邮件投递，以及每个明确启用连接器的独立凭据。
- 数据库必须按顺序应用到 `202607210052`，且不得跳过 `050` 的隐私导出修复或 `052` 的 Worker 最小读取权限。

当前工作树是 v2.4.0 release candidate。`050/051`、schema lint 与完整数据库行为套件已经
在隔离本地环境通过；本轮完整门禁证据见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)。

本地 CRM 使用 `http://localhost:3200`，本地 Supabase 使用 56321–56324。
`GET /api/health` 必须返回 `version=2.4.0`。本地开发密钥、Mailpit 与 Studio 禁止暴露到公网。

## 2. 环境变量

以 [.env.example](../.env.example) 为唯一字段清单。应用必需值：

```dotenv
APP_URL=https://crm.example.com
NEXT_PUBLIC_TURNSTILE_SITE_KEY=production-site-key
TURNSTILE_SECRET_KEY=production-server-secret
TURNSTILE_EXPECTED_HOSTNAME=crm.example.com
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=public-anon-key
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
CRM_WORKSPACE_ID=workspace-uuid
LOGIN_THROTTLE_HASH_SECRET=independent-random-secret-at-least-32-bytes
TRUSTED_DEVICE_HASH_SECRET=different-independent-random-secret-at-least-32-bytes
```

邮件使用 `EMAIL_DELIVERY_WEBHOOK_URL` / `EMAIL_DELIVERY_WEBHOOK_TOKEN`。Webhook 与同步
Worker 由对应 enable flag 显式启用；未启用的可选 Worker 不参与 readiness，启用后缺凭据、
心跳过期或队列不健康必须阻断发布。支付、会计、电子签和 AI 均不得用测试值伪装已连接。

`NEXT_PUBLIC_*` 只能保存公开值。service role、Turnstile secret、限流/可信设备 HMAC、邮件及
连接器 token 不得进入浏览器、提交、构建日志或客户端 bundle。初始化后删除 `ADMIN_PASSWORD`。

## 3. 数据库与身份

1. 先备份，并在隔离暂存项目演练完整迁移与向前修复。
2. 保持公开 signup 关闭；只允许管理员建立员工身份。
3. 配置正式 APP URL、密码重置回调、SMTP 和显示六位 `{{ .Token }}` 的 OTP 模板。
4. 管理员必须 TOTP/AAL2；普通员工可选 MFA，否则在新设备完成邮箱 OTP。
5. 确认 `crm-avatars` 与 `crm-exports` 为 private。
6. 按文件名顺序应用全部迁移到 `202607210052`：

```bash
npx supabase db push --linked
npx supabase db lint --linked --level warning
npx supabase test db --linked
```

`043–045` 修正 Worker readiness；`044/049/050` 完成隐私执行和导出凭证；`046` 完成多币种
导出；`048` 建立新业务域；`051` 补齐自动化预览/重试、门户同意、通信幂等、质量规则、增长
绩效与连接器对账；`052` 修复日历与隐私导出 Worker 通过 PostgREST 读取来源记录所需的最小
`service_role` 权限。最终数据库测试总数应为 433，任一失败都不得部署应用。

首次初始化运行 `npm run auth:bootstrap-admin`，确认 `SUPER_ADMIN` membership、
`must_change_password=true` 与 username，随后删除临时密码。首次登录必须改密并配置 TOTP。

## 4. 构建与发布门

```bash
npm ci
npm run release:gate
```

门禁必须包含：typecheck、ESLint、production build、31 条 Node 契约、schema lint、433 条
pgTAP、dependency audit、业务/HTTP/export/device-auth smoke、生产资源 MIME，以及已安装
`ms-playwright/chromium-1228` 的真实 UI/权限/无障碍矩阵。Smoke 会写入并清理隔离数据，
只能对专用环境执行。

浏览器证据必须记录 Git SHA、APP_VERSION、migration head、build hash、精确 Chromium
revision/executable 与 base URL，并覆盖 1440/1024/375、中英文、键盘/焦点、合同、日历、
消息、设置、运营、自动化、门户及高风险流程。证据保存在
`work/browser-qa-chromium-1228/phases/`，合并报告为同级 `report.json`。

### 4.1 分阶段与卡死保护

禁止用一个没有进度信号的长进程替代分阶段验收。标准入口和 release gate 都会终止超时或
长期无输出的子进程树，并每 10–15 秒输出心跳：

| 阶段 | 总上限 | 无输出上限 |
| --- | ---: | ---: |
| typecheck | 120 秒 | 60 秒 |
| ESLint | 180 秒 | 90 秒 |
| production build | 240 秒 | 90 秒 |
| Node contracts | 120 秒 | 60 秒 |
| 单个业务/HTTP smoke | 90–240 秒 | 45–90 秒 |
| pgTAP | 300 秒 | 120 秒 |
| Chromium 1228 | 整体 480 秒；10 个阶段各 45–90 秒 | 30–45 秒 |
| 完整 release gate | 900 秒 | 每阶段独立控制 |

需要定位浏览器阶段时可运行
`$env:QA_PHASE='05-manager-insights'; npm run qa:chromium-1228:staged`；已有十阶段报告只需
重新合并时可运行 `$env:QA_MERGE_ONLY='1'; npm run qa:chromium-1228:staged`。本地生产
QA 必须使用 `http://localhost:3200`，以正确验证生产模式 Secure Cookie。

## 5. Worker 与外部集成

```bash
npm run workers:process
```

四个核心处理器始终运行：提醒、通知 outbox、日历投递和生成文件。Webhook inbox 与集成同步
只在显式启用时运行和纳入 readiness。任一启用处理器失败都要写失败心跳并令命令失败；不得
手工改库伪造健康。

导出位于私有桶并使用短期签名 URL。Webhook 必须使用供应商独立 HMAC、稳定事件 ID、规范
签名包、重放窗口和原子幂等摄取。连接器对账必须写不可变 receipt；相同事件 ID 若内容不同
应明确失败。

## 6. 健康、监控与备份

- `GET /api/health`：liveness 与版本。
- `GET /api/health?mode=ready`：Auth、数据库、环境、队列 SLA、stuck/failed job，以及启用的
  Worker/连接器；不健康时返回 503 和可执行修复建议。
- 告警覆盖 5xx、限流、RLS 拒绝、审批/隐私执行失败、失败与卡死任务、最老积压、心跳过期、
  邮件/Webhook 失败和存储容量。
- 启用 PITR 或每日备份，并定期恢复验证 Auth、RLS、合同、付款、隐私、审计与私有文件。

## 7. 上线验收

- 公开注册拒绝；认证错误保持 JSON/表单内错误和 request ID。
- Turnstile、首次改密、MFA、邮箱 OTP、可信设备、角色、团队与 workspace 边界生效。
- 合同、付款、退款、导入、去重、审批、任务和日历均可审计且权限与 UI 一致。
- 五类隐私请求有真实执行证据；限制立即阻断发送/导出；删除保留法定证据。
- 多币种报表不混加；10,001+ 行导出完整或明确失败，并有行数与 SHA-256。
- 自动化预览无副作用，失败可重试；门户授权前不泄露家庭数据；通信重试重新检查同意。
- 数据质量八类规则可配置和分配；连接器状态、重放保护和对账 receipt 可核验。
- readiness 为 200，所有启用 Worker 有新鲜成功心跳。
- 1440/1024/375 无横向溢出、未命名控件、焦点丢失、低于 12px 正文或错误吞没。

## 8. 专用服务器发布

本项目部署到专用服务器，不保留 Sites 项目绑定或本地“部署版本”。服务器应从已验证 Git
commit 构建不可变 release 目录，再由 `/opt/lumina-crm/current` 原子切换到该目录：

1. 在服务器密钥管理或 `/etc/lumina-crm/production.env` 保存正式 secrets，权限设为仅服务账号可读。
2. 按 `.nvmrc` 安装 Node.js `24.18.0`，再对精确 commit 执行锁文件安装、生产构建和迁移门禁。
   当前运行命令需要仓库中的 `vinext`，因此 release 目录使用完整 `npm ci`，不得在构建后删除
   启动所需依赖。
3. 使用 systemd 管理 Web 服务，并安装 `deploy/systemd/lumina-crm.service`、
   `lumina-crm-workers.service` 与 `.timer`。
4. `systemctl enable --now lumina-crm-workers.timer` 后检查 timer、Worker journal 和 readiness。
5. 切换流量后重复 liveness、readiness、核心 smoke 与 Chromium 抽查。

### 8.1 首次服务器初始化

保留一个只用于拉取代码的干净 checkout，例如 `/opt/lumina-crm/source`；部署脚本会把不可变
worktree 写入 `/opt/lumina-crm/releases`，并只在全部构建与迁移门禁通过后原子更新
`/opt/lumina-crm/current`。服务账号必须可以写入 `/opt/lumina-crm`，正式环境文件继续放在
`/etc/lumina-crm/production.env`。

首次安装 systemd unit：

```bash
sudo install -m 0644 deploy/systemd/lumina-crm.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/lumina-crm-workers.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/lumina-crm-workers.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable lumina-crm.service lumina-crm-workers.timer
```

`/usr/bin/node` 与 `/usr/bin/npm` 必须指向 Node.js 24；若服务器使用只在交互式 shell 生效的
nvm 路径，应先创建稳定的系统级可执行路径，不能让 systemd 依赖用户 shell 初始化脚本。
生产 Supabase 必须已在 source checkout 中完成 `supabase link`，部署账号需通过环境变量取得
所需访问凭据。

### 8.2 后续一键部署

在 source checkout 输入且只需输入一行：

```bash
npm run deploy:production
```

该命令依次执行：

1. 拒绝有受跟踪修改或错误分支的生产 checkout；
2. `git pull --ff-only origin main`；
3. 建立精确 Git SHA 的独立 release worktree；
4. `npm ci`、typecheck、lint、Node contracts、依赖审计与 production build；
5. linked Supabase migration 与 schema lint；
6. 原子切换 `current`，重启 Web、启用 Worker timer 并执行一次 Worker；
7. 校验新版本 liveness 与完整 readiness。

构建、迁移或检查失败时不会切换服务。切换后的 systemd 或健康检查失败时，脚本会把
`current` 恢复到上一 release 并重启旧版本。数据库迁移继续遵循只向前兼容规则，不做危险的
自动数据库回滚。

### 8.3 强制持续时间上限

脚本不包含无限等待。默认硬上限：

| 阶段 | 上限 |
| --- | ---: |
| 整次部署 | 900 秒 |
| Git pull / worktree | 60 秒 |
| 依赖安装 | 240 秒 |
| 单项检查 | 180 秒 |
| 构建 | 240 秒 |
| 迁移 / schema lint | 各 180 秒 |
| systemd 操作 | 各 60 秒 |
| liveness | 60 秒 |
| readiness | 120 秒 |

超时会终止当前子进程树、输出卡住的阶段并以非零状态退出。所有值都可通过
`DEPLOY_TOTAL_TIMEOUT_SECONDS`、`DEPLOY_PULL_TIMEOUT_SECONDS`、
`DEPLOY_INSTALL_TIMEOUT_SECONDS`、`DEPLOY_CHECK_TIMEOUT_SECONDS`、
`DEPLOY_BUILD_TIMEOUT_SECONDS`、`DEPLOY_MIGRATION_TIMEOUT_SECONDS`、
`DEPLOY_SYSTEMD_TIMEOUT_SECONDS`、`DEPLOY_LIVENESS_TIMEOUT_SECONDS` 和
`DEPLOY_READINESS_TIMEOUT_SECONDS` 调整，但每项强制限制在 1–3600 秒，不能配置成无限期。
使用 `npm run deploy:production -- --help` 可在不部署的情况下查看当前约定。

数据库或浏览器门禁未通过时，不得为了“完成发布”而跳过验证。本地仓库只保存源码、配置
模板和验证证据，不保存生产 secrets、构建目录或服务器 release 副本。

## 9. 回滚

1. 停止新写入流量和 Worker。
2. 将 `/opt/lumina-crm/current` 原子切回上一已验证 release，并重启对应 systemd 服务。
3. 数据库优先用向前修复迁移；只在恢复演练确认后使用备份恢复。
4. 不删除审批、审计、合同版本、付款、通知、隐私或 Webhook 历史来回滚界面。
5. 恢复后重跑全部发布门、readiness、权限、业务与浏览器矩阵。

## 10. GitHub Actions

高频生产 Worker 不再由 GitHub Actions 每五分钟启动一次临时 runner；该模式会重复 checkout、
Node 初始化和依赖安装，而且未配置 production secrets 时仍会持续计费失败。生产环境改由
专用服务器的 systemd timer 按业务 SLA 调用 Worker 入口，原生产 Worker workflow
已删除。

CI 对纯 Markdown/`docs/**` 变更不再运行，并在 `npm ci` 阶段关闭重复 audit/funding 请求；
依赖安全仍由后续独立 `npm audit` 门禁负责。

仓库门禁不临时下载浏览器；本开发环境直接使用已安装的精确
`ms-playwright/chromium-1228`。缺少 in-app Browser 会话不构成阻断；只有精确运行时确实缺失
或执行失败时才应报告浏览器门禁失败。
