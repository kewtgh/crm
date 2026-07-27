# Lumina Education CRM v2.8.1 部署指引

## 1. 发布前提

- Node.js 24.x；开发、CI 与服务器统一使用 `.nvmrc` 固定的 `24.18.0`。
- npm 12.x；`package.json`、`engine-strict`、CI 与完整发布门禁固定使用 `12.0.1`。
- 独立 Supabase 项目（Auth、Postgres、private Storage）、HTTPS 域名、密钥管理、备份与告警。
- 正式 Turnstile、邮件投递，以及每个明确启用连接器的独立凭据。
- 数据库必须按顺序应用到 `202607280055`，且不得跳过 `050` 的隐私导出修复、`052` 的 Worker 最小读取权限、`053` 的企业目录与连接器验证凭证、`054` 的时区完整性约束或 `055` 的 MFA 恢复码与超级管理员直执/回收站能力。

当前工作树是 v2.8.1 release candidate。`055` 已在隔离本地环境应用，生产构建、源码契约、
部署单测与固定浏览器完整门禁通过；本轮证据见 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)。

本地 CRM 使用 `http://localhost:3200`，本地 Supabase 使用 56321–56324。
`GET /api/health` 必须返回 `version=2.8.1`。本地开发密钥、Mailpit 与 Studio 禁止暴露到公网。

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

企业与可观测性边界必须分别显式启用：

```dotenv
SSO_ENABLED=false
SSO_ALLOWED_DOMAINS=staff.example.com
SCIM_ENABLED=false
SCIM_BEARER_TOKEN=independent-random-token-at-least-32-bytes
OBSERVABILITY_ENABLED=false
OBSERVABILITY_WEBHOOK_URL=https://telemetry.example.net/lumina/events
OBSERVABILITY_WEBHOOK_TOKEN=independent-random-token-at-least-32-bytes
OBSERVABILITY_SAMPLE_RATE=1
```

正式 SSO 需要先在 Supabase Auth 配置并验证 SAML IdP；应用只负责同源、允许域、Turnstile、
限流、PKCE、活跃 membership 与 MFA 路径。SCIM token 只交给受信任的企业目录服务，SCIM
仅可预配受限销售员工角色，不能授予 `ADMIN` / `SUPER_ADMIN` 或创建客户账号。遥测接收器
只能接收允许列表中的 request ID、路由模板、方法、状态、时延、结果与稳定错误码，不得接收
查询串、Cookie、请求体、账号标识或 CRM 业务内容。

`NEXT_PUBLIC_*` 只能保存公开值。service role、Turnstile secret、限流/可信设备 HMAC、邮件及
连接器 token 不得进入浏览器、提交、构建日志或客户端 bundle。初始化后删除 `ADMIN_PASSWORD`。

## 3. 数据库与身份

1. 先备份，并在隔离暂存项目演练完整迁移与向前修复。
2. 保持公开 signup 关闭；只允许管理员建立员工身份。
3. 配置正式 APP URL、密码重置回调、SMTP 和显示六位 `{{ .Token }}` 的 OTP 模板。
4. 管理员必须 TOTP/AAL2；普通员工可选 MFA，否则在新设备完成邮箱 OTP。
5. 确认 `crm-avatars` 与 `crm-exports` 为 private。
6. 按文件名顺序应用全部迁移到 `202607280055`：

```bash
npx supabase db push --linked
npx supabase db lint --linked --level warning
```

`043–045` 修正 Worker readiness；`044/049/050` 完成隐私执行和导出凭证；`046` 完成多币种
导出；`048` 建立新业务域；`051` 补齐自动化预览/重试、门户同意、通信幂等、质量规则、增长
绩效与连接器对账；`052` 修复日历与隐私导出 Worker 通过 PostgREST 读取来源记录所需的最小
`service_role` 权限；`053` 增加受限企业目录、SSO profile 兼容和不可变连接器 sandbox
验证凭证；`054` 清理历史异常时区并将用户偏好限制在应用实际支持的集合中；`055` 增加 MFA
恢复码、超级管理员直执和 30 天回收站。最终数据库测试总数应为 464，任一失败都不得部署
应用。pgTAP 必须先在隔离数据库或 CI 完整运行；生产更新只执行明确 project ref 的
forward-only push、dry-run 与 linked schema lint，不在生产库运行 destructive reset。

首次初始化运行 `npm run auth:bootstrap-admin`，确认 `SUPER_ADMIN` membership、
`must_change_password=true` 与 username，随后删除临时密码。首次登录必须改密并配置 TOTP。

## 4. 构建与发布门

```bash
npm ci
npm run release:gate
```

门禁必须包含：typecheck、ESLint、production build、37 条源码契约、17 条部署单测、
schema lint、464 条 pgTAP、dependency audit、业务/HTTP/export/device-auth smoke、生产资源 MIME，以及已安装
`ms-playwright/chromium-1228` 的真实 UI/权限/无障碍矩阵。Smoke 会写入并清理隔离数据，
只能对专用环境执行。

浏览器证据必须记录 Git SHA、工作树状态/摘要、部署源码指纹、APP_VERSION、migration head、
build hash、精确 Chromium revision/executable 与 base URL，并覆盖 1440/1024/375、中英文、
键盘/焦点、页面与记录命令、危险操作确认、跨设备语言偏好、合同、日历、消息、设置、运营、
自动化、门户及高风险流程。证据保存在
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

集成同步正式启用后，管理员必须先执行不含 CRM 记录的 sandbox 验证。处理器只返回稳定
`READY` 状态和受限 capability 列表；应用保存状态、耗时、响应 SHA-256、执行者与 24 小时
有效期。没有当前成功凭证时，UI、API 和 Worker 都不得手工或后台排队同步。

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
- SSO 未配置时登录页不显示企业入口；SCIM 未启用时所有端点拒绝访问；行动中心只展示当前
  capability 范围内的真实工作。
- readiness 为 200，所有启用 Worker 有新鲜成功心跳。
- 1440/1024/375 无横向溢出、未命名控件、焦点丢失、低于 12px 正文或错误吞没。

## 8. 专用服务器发布

生产更新固定从 `git@github.com:kewtgh/crm.git` 的远端 `main` 部署明确 commit。干净 source
checkout 只负责 fetch/fast-forward 和建立 worktree；每个 release 在
`/opt/lumina-crm/releases/<UTC>-<commit>` 中安装、检查、构建和迁移，完成前不会改动
`/opt/lumina-crm/current`。`current` 始终以同文件系统 rename 原子切换。

Cloudflare Tunnel 已独立运行，部署流程只管理 `lumina-crm.service`、
`lumina-crm-workers.service` 与 `lumina-crm-workers.timer`。它不会管理或重启
`cloudflared-lumina.service`、HunterAI、Docker、v2rayA、PostgreSQL或服务器。

### 8.1 首次服务器初始化

首次部署负责创建运行用户、source checkout、首个可运行 release、`current` symlink、环境
文件、runtime ProxyAgent drop-in 和 Cloudflare Tunnel；这些工作已经在当前生产服务器完成。
下面的一次性安装只为已有服务器增加持久化更新 runner。以 root 执行，并逐项检查目标路径：

```bash
install -d -o lumina-crm -g lumina-crm -m 0750 /opt/lumina-crm/releases
install -d -o lumina-crm -g lumina-crm -m 0750 /var/lib/lumina-crm/deployments
install -d -o lumina-crm -g lumina-crm -m 0750 /var/log/lumina-crm/deployments
install -o lumina-crm -g lumina-crm -m 0640 /dev/null /var/lock/lumina-crm-deploy.lock
sudo install -m 0644 deploy/systemd/lumina-crm.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/lumina-crm-workers.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/lumina-crm-workers.timer /etc/systemd/system/
sudo install -m 0644 deploy/systemd/lumina-crm-deploy.service /etc/systemd/system/
sudo install -o root -g root -m 0440 deploy/sudoers/lumina-crm-deploy /etc/sudoers.d/lumina-crm-deploy
sudo visudo -cf /etc/sudoers.d/lumina-crm-deploy
sudo install -o root -g lumina-crm -m 0640 deploy/deploy.env.example /etc/lumina-crm/deploy.env
sudoedit /etc/lumina-crm/deploy.env
sudo systemctl daemon-reload
sudo systemctl enable lumina-crm.service lumina-crm-workers.timer
sudo -u lumina-crm /usr/bin/npm --prefix /opt/lumina-crm/source run deploy:production:dry-run
```

不要在每次应用更新时重新安装 unit。需要明确升级仓库 unit 模板时才替换 base unit 并
`daemon-reload`；已有的
`/etc/systemd/system/lumina-crm.service.d/10-runtime.conf` 和
`lumina-crm-workers.service.d/10-runtime.conf` 必须保留。安装后验证有效配置：

```bash
systemctl cat lumina-crm.service
systemctl cat lumina-crm-workers.service
systemctl show lumina-crm.service -p ExecStart -p Environment
systemctl show lumina-crm-workers.service -p Environment
```

Web 的有效 `ExecStart` 必须含
`npm run start -- --port 3200 --hostname 127.0.0.1`；Web 和 Worker 的有效 Environment
必须含 `LUMINA_HTTPS_PROXY=http://127.0.0.1:20271` 与
`NODE_OPTIONS=--import=/opt/lumina-crm/runtime-proxy/register-proxy.mjs`。

deploy unit 将 home 设为只读，以便 Git SSH 读取部署用户既有 key/known_hosts，但不能修改
home；npm 与 XDG 缓存固定写入 `/var/lib/lumina-crm/npm-cache` 和
`/var/lib/lumina-crm/cache`。GitHub deploy key 与 `known_hosts` 必须在一次性初始化时以
`lumina-crm` 完成非交互验证，不能只存在于调用者的临时 SSH agent。不要改成全局 npm cache，
也不要为部署开放任意 home 写权限。

`/usr/bin/node` 必须为 Node.js 24.x，`/usr/bin/npm` 必须为 npm 12.x。source、npm、测试、
构建和 release 均由 `lumina-crm` 执行；sudoers 只允许启动持久化 runner、重启 Lumina Web、
启用 Timer 和执行一次 Lumina Worker，不授予任意 root shell，也不含 secret。
deploy unit 不能设置 `NoNewPrivileges=true`，否则上述精确 sudo 命令也会被内核阻止；Web 和
Worker unit 继续保留该限制，deploy unit 则通过无通配符 sudoers、只读 home、strict filesystem
和固定 `ExecStart` 缩小边界。

### 8.2 环境文件

应用运行只读取 `/etc/lumina-crm/production.env`。部署期另读
`/etc/lumina-crm/deploy.env`，后者只保存 Supabase CLI 凭据：

```dotenv
SUPABASE_ACCESS_TOKEN=replace-with-supabase-cli-access-token
SUPABASE_DB_PASSWORD=replace-with-production-database-password
SUPABASE_PROJECT_REF=ectxevxmcwzvwsjkwnld
```

按 `deploy/deploy.env.example` 创建，两个文件均使用 regular file、`root:lumina-crm` 与
`0640`（也接受同等或更严格且部署用户可读的模式）。禁止 symlink、world-readable、把
deploy-only secret 复制进 release、写进 sudoers、命令行或 Git。runner 只在日志中显示缺失/
不匹配的键名，并对捕获输出脱敏；不会加载 source 或 release 中的开发 `.env`。`deploy.env`
只接受上面三个 Supabase 键；两个文件都不能覆盖 PATH、`NODE_OPTIONS`、代理、npm/XDG cache、
`NODE_ENV`、shell preload 或其他 runner 执行环境。

```bash
sudo chown root:lumina-crm /etc/lumina-crm/production.env /etc/lumina-crm/deploy.env
sudo chmod 0640 /etc/lumina-crm/production.env /etc/lumina-crm/deploy.env
```

### 8.3 后续一键更新

以 `lumina-crm` 从 `/opt/lumina-crm/source` 输入一行：

```bash
npm run deploy:production
```

controller 创建唯一 request ID，并让静态 `lumina-crm-deploy.service` 持久执行。SSH 断开
只终止日志跟随，不终止 systemd runner；没有静默后台任务。需要主动断开时可用
`npm run deploy:production:detach`，它只在 runner 已持久接受请求后返回。

runner 使用 `/var/lock/lumina-crm-deploy.lock` 的 non-blocking `flock`；同一时间只允许一个
部署。锁或 pending request 已存在时明确失败，不通过进程名匹配。

部署阶段为：

1. 校验 Linux、非 root、固定目录、Node/npm、环境文件、现有 release、systemd 和 loopback；
2. 拒绝任何 tracked/untracked 修改、错误分支或错误 origin，fetch 远端 `main` 并只做
   `merge --ff-only`，不提交、rebase、force reset；
3. 从远端明确 SHA 建立 `<UTC>-<SHA12>` 的 detached immutable worktree；
4. 用 lockfile、`--strict-allow-scripts` 和 `package.json#allowScripts` 内经审查的精确版本
   allowlist 安装完整依赖，不设置用户级/全局脚本许可；
5. 执行 typecheck、ESLint、37 条源码契约、17 条部署单测、moderate audit 和 production build；
6. 对 project ref `ectxevxmcwzvwsjkwnld` 显式 link，先 migration dry-run，再执行
   forward-only push 和 linked schema lint，并在切换前删除 release 内的 Supabase CLI link cache；
7. 验证 build artifact、Git SHA、package version、`APP_VERSION` 和 npm policy；
8. 原子切换 `current`，仅重启 Lumina Web、启用 Timer 并运行一次 Worker；
   如旧 Worker 周期仍在执行，会先有界等待其自然结束，再启动新 release 的验证周期；
9. 验证有效 systemd/drop-in、Web active/running/enabled、Worker result、
   Timer active/waiting/enabled 和端口只监听 `127.0.0.1:3200`；
10. 重试本地 liveness、完整 readiness 与公网 liveness，要求 HTTP 200、版本匹配、五项
    readiness 全部健康、无 stale/missing worker、failed/stuck job 或缺失配置；
11. 成功后保留最近 5 个 release，并始终保护 current、上一可用和正在构建的 release；
12. 输出 deployment ID、前后 commit、版本、release path、结果及
    `LUMINA_PRODUCTION_DEPLOY_OK`。

production runner 的整体硬上限为 60 分钟；Git 3 分钟、安装/检查/构建/迁移各最多 10 分钟、
systemd 2 分钟、本地 liveness 90 秒、readiness 与公网 health 各 3 分钟。每阶段有 UTC 日志
和 15 秒心跳；超时会终止当前进程组并进入同一失败恢复逻辑，不能通过环境变量放宽为无限等待。

生产 runner 不重复浏览器、业务 smoke 或 pgTAP：这些高成本/会写数据的检查已由目标 commit
的 CI/发布门在隔离环境完成；服务器仍执行不会写业务数据的源码/部署契约和静态门禁，不会
为了加速而绕过 typecheck、lint、audit、build、migration dry-run 或 schema lint。

### 8.4 状态、日志与当前版本

```bash
npm run deploy:production:status
npm run deploy:production:logs
npm run deploy:production:logs -- --follow
readlink -f /opt/lumina-crm/current
cat /opt/lumina-crm/current/.lumina-release.json
systemctl status lumina-crm-deploy.service --no-pager
```

状态位于 `/var/lib/lumina-crm/deployments`，每次独立日志位于
`/var/log/lumina-crm/deployments/<deployment-id>.log`，journald 同时保留 runner 输出。
SSH 中断后重新执行 status/logs 即可取得同一 deployment ID、阶段、最终退出状态与机器标志。
`PENDING_RECOVERABLE` 表示 request 已持久写入但 runner 尚未接受，可修复 systemd/锁问题后
重跑原命令。若 runner 自身在切换前异常终止，恢复流程会清理未完成 worktree；若在切换后
终止，则先恢复、重启并验证上一应用 release，再重新执行原 request，同时明确保留数据库
forward migration 警告。不要手工删除状态文件来伪造成功。

仓库侧可随时执行无副作用配置检查：

```bash
npm run deploy:production:dry-run
```

该命令不访问网络，不创建 request/release，不改 symlink、服务或数据库。

## 9. 失败与回滚

切换前发生环境、Git、安装、质量、build、migration 或 schema lint 失败时，runner 删除本次
未完成 worktree，保持 `current` 和正常服务不变，也不重启服务。migration push 可能已完成而
随后 lint 失败，或 runner 可能在 push 过程中中断；runner 会在调用实际 push 前先持久记录
保守的“数据库可能已有 forward change”标记，日志不会声称数据库已回滚。

切换后的 systemd、本地或公网健康检查失败时，runner 原子恢复上一 release，重启 Web、保持
Timer enabled、运行并验证 Worker，再次检查上一版本的本地 liveness/readiness、公网 health、
ProxyAgent 和 loopback。结果分别使用：

```text
LUMINA_PRODUCTION_DEPLOY_FAILED
LUMINA_PRODUCTION_ROLLBACK_OK
LUMINA_PRODUCTION_ROLLBACK_FAILED
```

上一 release 不存在时安全失败，不删除当前可运行版本。自动/手工回滚从不删除表、schema
或数据，也不执行 `supabase db reset`；migration 不一定能随应用文件回退，必须用向前兼容
迁移或人工审核后的 forward fix。

手工应用回滚使用与部署相同的锁、持久 runner、日志和完整恢复验证：

```bash
npm run deploy:production:rollback
```

常见失败先查看 status、部署日志和
`journalctl -u lumina-crm-deploy.service -u lumina-crm.service -u lumina-crm-workers.service`。
修正缺失环境键、source dirty、npm 版本、Supabase link/migration、systemd drop-in、Worker
心跳或 health 后再启动新请求。不得以 `|| true`、跳过 migration/health、删除 request/state、
强制改 symlink 或手工伪造 readiness 绕过失败。

清理只针对确认未引用的 Lumina release/worktree。禁止执行 `docker system prune`、
`docker builder prune`、`docker volume prune`、`docker compose down -v`、全局
`npm cache clean`、删除 `/opt/hunterai`、共享镜像/数据库 volume、重启整台服务器，或触碰
HunterAI、Cloudflare Tunnel、Docker、v2rayA 与 PostgreSQL。

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
