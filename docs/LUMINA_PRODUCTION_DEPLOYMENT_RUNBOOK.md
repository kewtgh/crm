# Lumina CRM 生产部署运行手册

> 2026-10-24 控制平面兼容性修复：本节优先于下方历史手工 merge、运行时安装与重试步骤。
> 应用版本保持 3.40.0；开发基线为 `796cc43e63784eb8891ca6420572cd563cb2ac80`。
> [共享宿主机契约](../deploy/libexec/host-runtime-contract.json)、[兼容性审计与计划](HOST_COMPATIBILITY_REPAIR_PLAN.md)、
> [完整英文操作流程](DEPLOYMENT.md)。本次仓库修改不代表已在生产执行升级或部署。

## 0. Host Preflight → 人工审批升级 → Production Deploy

### 0.1 先诊断，不先改源码或创建请求

以 `lumina-crm` 账户运行。即使当前 Node 为不兼容的 24.22.0，诊断也会输出结构化结果。

```sh
npm run deploy:production:host-check
npm run deploy:production:host-upgrade-plan
# 对已 fetch 到本地的完整目标 SHA，只读检查，不 merge、不执行目标程序：
npm run deploy:production:host-check -- --target=FULL_REVIEWED_SHA
```

输出逐项包含 `component/current/required/status/blocking/remediation`。`blocking=true` 必须先解决；
`SUPPORTED` 表示已满足支持范围，较新的推荐补丁可安排独立升级，不应无条件阻止部署。

| 组件 | 必须满足 | 当前推荐 |
| --- | --- | --- |
| Node | `>=24.22.1 <25`，CLI 和 systemd 使用同一解析后的可执行文件 | 24.22.1 LTS |
| npm | `>=12.2.1 <13` | 12.2.1 |
| Docker Engine | `>=29.1.3 <29.2` 或 `>=29.8.2 <30`；CRM Rootless、systemd cgroup v2 | 29.9.2 |
| Compose | `>=2.40.3 <3` 或 `>=5.6.0 <6` | 5.6.1 |
| Buildx | `>=0.30.1 <0.31` 或 `>=0.37.2 <0.39` | 0.38.1 |
| BuildKit | 审计白名单 `v0.33.1` / `v0.34.1`，同时满足维护程序支持、driver/network/proxy、所有权与配置哈希 | `moby/buildkit:v0.34.1` |

Ubuntu docker.io 29.1.3、Compose 2.40.3、Buildx 0.30.1 是明确基线；包后缀 `+ds1-0ubuntu1`、
`-0ubuntu1` 可解析，预发布与未审核版本仍拒绝。版本达标后还必须通过只读能力探测：实际命令选项、
Compose 安全配置解析、Rootless 数据根与 cgroup。未检测项为 NOT_CHECKED 或 DEPENDENCY_BLOCKED。
已知维护源码/旧 bundle 与 unit 可为 LEGACY_SUPPORTED，不要求与每次应用 Git 更新字节相同；
未知代码、drop-in、未完成安装、维护程序不支持当前 Builder 的真实不兼容仍阻断。
禁止默认更换 Ubuntu Docker 为 Docker CE，或替换 containerd/runc/rootlesskit。禁止修改 marker 消除故障。

诊断检查 CRM 专属 socket、目录权限、Docker 数据根、Builder endpoint、实际 daemon image/network、
配置哈希、root-owned 维护 bundle、systemd unit 与未审核 drop-in、锁、未完成升级和磁盘阈值。
它不启动服务、不引导 Builder、不安装依赖、不执行 prune，也不修改 `request.json/latest.json`。
部署 CLI 在创建请求前检查宿主机；fetch 后再以固定路径的 `git show` 读取目标静态契约和源码哈希，
通过后才允许 fast-forward。不能用执行目标脚本来“探测”其要求。已检查的完整 SHA 会绑定请求。

### 0.2 系统依赖升级必须单独批准

升级计划默认只有输出，没有 apply 系统包的入口。操作者必须记录当前版本、目标版本、包来源、
签名/校验和、可执行路径及其他服务影响，再明确批准 Node/npm/Docker/Compose/Buildx 的系统升级。
按实际 Ubuntu 版本选取官方稳定包；禁止把一条全系统升级命令当成项目部署步骤。
Docker 处于支持范围时可以暂缓推荐补丁，避免无必要地重启共享 daemon。
已批准的系统包动作也必须在独立维护窗口、CRM 部署服务未运行且按固定顺序排他持有三把锁时执行。
部署 CLI 不会提权或调用宿主机包管理器。

```sh
/usr/bin/node --version
npm --version
sudo -u lumina-crm /usr/bin/node --version
systemctl cat lumina-crm-deploy.service
```

只修改交互终端的 nvm/PATH 不够：当前 unit 明确使用 `/usr/bin/node`，Bootstrap 会将自己的
`process.execPath` 传给目标控制器。三者必须一致并满足目标范围。不要更改其他账户、HunterAI
或共享 Rootful Docker 的配置/运行状态；任何可能影响共享系统包的动作需额外的宿主机维护审批。

首次采用该协议前，操作者还需预置三个固定锁：`/var/lib/lumina-crm/request-admission.lock`、
`deploy.lock`、`maintenance.lock`。它们须为 `lumina-crm` 所有、普通文件、无符号链接、无组/全局写权限。
只以排他创建方式新建缺失文件，不能 truncate、替换或删除现有锁 inode。
升级与安装的加锁顺序固定为 admission → deployment → maintenance；内核持锁证据必须真实存在。

### 0.3 独立原子安装 root-owned 维护程序

已兼容维护程序无需重装。普通 Git 更新不会安装维护程序。确需升级时，独立审核修复包，再将安装器及契约声明的五个
维护资产按原目录布局放入 root 所有、不可由部署账户修改的审核暂存目录。
不要直接对部署账户可写的工作树执行 root 安装器。操作者替换下列路径/哈希占位值：

```sh
/usr/bin/node ROOT_REVIEWED_PACKAGE/scripts/install-host-maintenance.mjs
sudo /usr/bin/node ROOT_REVIEWED_PACKAGE/scripts/install-host-maintenance.mjs --approve=PLAN_SHA256
# 安装中断后，使用原审批哈希与操作 ID；不能盲目覆盖回旧程序：
sudo /usr/bin/node ROOT_REVIEWED_PACKAGE/scripts/install-host-maintenance.mjs --approve=PLAN_SHA256 --resume=OPERATION_UUID
```

安装计划绑定所有源文件和旧 launcher 哈希。程序写入不可变内容寻址 bundle，原子替换固定普通
launcher，并写 root-owned 完成凭证。旧 launcher 与阶段日志保存在 `/var/log/lumina-crm-host-install/`。
激活或完成凭证中断时，Host Preflight 会继续阻止部署；通过原操作恢复完成安装审计。

### 0.4 明确审批 CRM Builder 替换及缓存风险

以 `lumina-crm` 身份加载已审核的 `deploy.env` 中宿主机设置，确保 `DOCKER_HOST` 是其本人
`unix:///run/user/UID/docker.sock`，`DOCKER_CONFIG=/var/lib/lumina-crm/docker-config`，
`BUILDX_CONFIG=/var/lib/lumina-crm/docker-config/buildx`。不能回退到默认 context 或其他用户 daemon。

```sh
npm run deploy:production:builder-plan
npm run deploy:production:builder-replace -- --approve=PLAN_SHA256 --acknowledge-cache-loss
# 中断后先检查日志，恢复同一操作，不重新删除 Builder：
npm run deploy:production:builder-replace -- --approve=PLAN_SHA256 --acknowledge-cache-loss --resume=OPERATION_UUID
npm run deploy:production:host-check
```

只允许替换所有权已核实的 `lumina-crm-buildkit`。计划验证旧镜像、marker、root-owned BuildKit
配置 fingerprint、唯一 endpoint、driver/network/proxy，并绑定审批哈希。删除使用
[`buildx rm --keep-state`](https://docs.docker.com/reference/cli/docker/buildx/rm/) 保留 Builder 状态；
仍须明确接受跨版本缓存可能不能复用的风险。程序不会删除数据卷、PostgreSQL、应用镜像或其他 Builder。

替换在同一组锁内记录移除/创建/验证/marker 更新的 durable intent。新 Builder 带唯一操作 nonce，
在验证实际 daemon 镜像和网络后才能完成。创建/验证失败可显式恢复；若旧删除结果仍不确定、出现
未知 Builder/nonce、配置已变或日志不完整，继续拒绝，不会错误重删新 Builder。阶段与失败记录保留于
`/var/lib/lumina-crm/storage-maintenance/`。未完成操作会阻止部署，不能通过释放锁绕过。

### 0.5 早期拒绝归档与正常发布

新控制器在业务操作前写入绑定 Request ID、launch、Bootstrap attempt、nonce、目标 SHA 与 PID 的
入口凭证。只有 `REJECTED + NOT_STARTED`、子进程退出/PID、独立 Bootstrap 日志及历史记录相互一致，
且没有迁移、切换、接收、其他已准入控制器或最终归档失败，才能归档。`controllerStarted=true` 本身
既不被忽略，也不再被错误地当成业务副作用的唯一判断。

```sh
npm run deploy:production:status
npm run deploy:production:archive-early -- --request=REQUEST_UUID
npm run deploy:production:archive-early -- --request=REQUEST_UUID --approve=EVIDENCE_PLAN_SHA256
npm run deploy:production:host-check
npm run deploy:production
```

归档默认生成计划，批准后在锁内保留原请求、Request ID 和完整阶段日志，保持 `latest.json` 不变。
重命名完成但归档日志未完成时，新请求仍被阻止；重复原归档命令/审批完成恢复，再发起新 ID。
不要修改 latest 状态、手删 request、伪造凭证或绕过锁。已迁移/已切换/已接收或证据不完整的请求
继续沿用 `accept/recover/reconcile` 的原有规则，不会自动重放初始化或迁移。

新请求使用交接协议 2（nonce、attempt、入口凭证），协议 1 保持兼容。仅允许固定的 `796cc43`
旧 Bootstrap 走协议 0：必须验证源码哈希、精确参数、实际父子进程/UID/可执行文件、systemd invocation
及无 drop-in 的已审核 unit、内核锁、原请求和独立持久化 intent、干净目标 SHA、从旧 SHA fast-forward
的 reflog 及进程时间关系。缺少 nonce 本身不构成放行理由，协议 2 请求不允许降级。

### 0.6 无旧入口凭证的 Legacy Transition Failure

只能处理目录中明确审计的旧 Bootstrap → c164ff1 入口身份拒绝。普通 `archive-early` 规则不放宽。
先将完整修复 checkout 独立审核，放入 root 所有、部署账户不可写的 `ROOT_REVIEWED_PACKAGE`。
不要先 reset-failed、重启部署或清理日志。必须从原状态和 systemd 日志取得真实 request/invocation，
以下占位值不是自动推断或补造的证据：

```sh
REQUEST=ORIGINAL_REQUEST_UUID
INVOCATION=FAILED_SYSTEMD_INVOCATION_32_HEX
REPAIR=ROOT_REVIEWED_PACKAGE
TARGET=FULL_REVIEWED_REPAIR_SHA

# 管理员：只读计划；明确 --capture 才落盘 root 所有的完整 invocation 证据。
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" journal --invocation="$INVOCATION"
sudo /usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" journal --invocation="$INVOCATION" --capture
sudo chgrp lumina-crm "/etc/lumina-crm/transition-evidence/$INVOCATION.json"
sudo chmod 0640 "/etc/lumina-crm/transition-evidence/$INVOCATION.json"

# lumina-crm：加载已审核宿主机设置；审阅计划的全部证据后批准其哈希。
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" archive --request="$REQUEST" --invocation="$INVOCATION"
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" archive --request="$REQUEST" --invocation="$INVOCATION" --approve=ARCHIVE_PLAN_SHA256

# 旧 CLI 无法通过错误门槛时，用独立工具审核目标静态数据，明确批准仅更新源码。
git -C /opt/lumina-crm/source fetch origin main
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" adopt --target="$TARGET"
/usr/bin/node "$REPAIR/scripts/deploy-legacy-transition.mjs" adopt --target="$TARGET" --approve=ADOPTION_PLAN_SHA256 --operation=NEW_OPERATION_UUID
cd /opt/lumina-crm/source
npm run deploy:production:host-check
npm run deploy:production
```

审查同时要求原 request/latest/独立 Bootstrap 一致、固定旧/目标源码执行顺序、完整可信 invocation
输出与 systemd manager 退出字段、唯一子进程 PID、明确未捕获的入口错误栈、兼容 Node 诊断；
没有对应 Deployment Journal/日志/准入凭证/其他已启动 attempt；Web/Worker 健康、镜像及 revision
匹配最后接受的 3.40.0，immutable image ID 相同，容器创建早于失败 attempt。不能只凭“没有 Journal”。
日志截断、证据缺失、新容器、迁移/切换/接受或控制平面最终归档失败都会拒绝，并输出缺失/失败项。
此时保留全部私有证据，交由操作者独立审计；有业务操作时按原 schema 约束使用 accept/recover/reconcile。
不要重放初始化/迁移，也不要把普通失败解释为本过渡故障。

批准归档持有 admission → deployment → maintenance 三把锁，在 `legacy-transition-REQUEST_UUID/`
保存原始 request/latest 字节、完整私有证据、重命名后的请求与阶段日志。latest 保持 BOOTSTRAP_FAILED、
controllerStarted=true、recoverySafe=false；不会伪造旧入口凭证。落盘中断重复原命令与审批哈希恢复，
不完整阶段或丢失归档仍阻断新请求。源码 adopt 另存 intent/completion 日志，中断使用相同审批及 operation
UUID 恢复；它不启动应用、不改 last-success。最后普通 deploy 创建全新 Request ID。
仓库测试不能证明当前生产遗留请求已安全；必须现场证据检查通过后才允许归档。

> v3.37.7 deployment recovery update: [current operator commands and safety rules](DEPLOYMENT_RELIABILITY_OPERATIONS.md)
> supersede historical unconditional rollback/retry guidance below. [Release notes](RELEASE_V3.37.7.md).
> Forward migrations require proven image/schema compatibility; public-edge failure can leave a healthy candidate pending acceptance.

> 适用场景：在一台已运行其他生产系统的 Ubuntu 服务器上，以独立、可回滚、最小权限方式部署 Lumina CRM。  
> 本文基于 2026 年 7 月实际部署过程整理，只保留服务器与基础设施部署经验，不包含任何因代码缺陷而进行的仓库修改。

---

## 1. 文档目标

本文用于后续重复部署、服务器迁移、灾难恢复和生产故障排查，重点解决以下问题：

- 如何在不影响现有 ExampleApp、Temporal、PostgreSQL、Cloudflare Tunnel 和 Docker 资源的前提下部署 Lumina CRM；
- 如何使用独立服务账户和 Rootless Docker 隔离运行时；
- 如何处理受限网络环境中的 GitHub、Docker Registry 和镜像构建代理；
- 如何组织生产环境变量、Secret、Compose、Caddy 和 Cloudflare Tunnel；
- 如何判断故障发生在应用、Caddy、Tunnel、DNS、邮件 Worker 还是外部提供商；
- 如何安全重复执行初始化和发布，不破坏已有数据。

---

## 2. 最终生产架构

```text
Internet
  |
  v
crm.example.com
  |
  v
Cloudflare Tunnel
  |
  v
Host Caddy: 127.0.0.1:3211
  |
  v
Lumina Web: 127.0.0.1:3200
  |
  +--> Lumina PostgreSQL（Compose 私有网络）
  |
  +--> Lumina Worker（Compose 私有网络）
  |
  +--> Object storage volume
  |
  +--> Email Delivery Worker（独立 Cloudflare Worker）
          |
          v
        Resend
```

### 2.1 主要隔离边界

- ExampleApp继续运行在原有Rootful Docker环境；
- Lumina CRM运行在`lumina-crm`服务账户的Rootless Docker中；
- 两套系统不共享Docker daemon、Compose project、network、volume、container、image、PostgreSQL、Temporal、BuildKit builder、Cloudflare Tunnel和registry proxy relay；
- Lumina Web仅发布到`127.0.0.1:3200`；
- Caddy仅监听`127.0.0.1:3211`；
- 公网只通过Lumina专用Cloudflare Tunnel进入。

---

## 3. 强制安全约束

### 3.1 禁止操作

严禁执行：

```bash
docker system prune
docker system prune -a
docker volume prune
docker network prune
docker builder prune
docker compose down -v
```

严禁：

- 操作ExampleApp容器、镜像、网络或卷；
- 修改ExampleApp PostgreSQL或Temporal；
- 停止或重启ExampleApp的Cloudflare Tunnel；
- 修改ExampleApp的代理relay；
- 把`lumina-crm`加入`docker`组；
- 让Lumina使用Rootful Docker socket；
- 将Lumina secret放入Git；
- 在聊天、命令历史、systemd命令行或日志中暴露Tunnel token、Webhook token、API key或数据库密码。

### 3.2 资源命名

Lumina资源应使用固定前缀：

```text
lumina-crm
lumina-crm-backend
lumina-crm-edge
lumina-crm-postgres-data
lumina-crm-objects
lumina-crm-backups
lumina-crm-buildkit
```

任何清理命令必须同时校验：

- `com.lumina.crm.managed=true`
- `com.lumina.crm.repository=kewtgh/crm`
- Compose project为Lumina目标项目

---

## 4. 服务器基线

本次部署采用：

```text
Operator account: ExampleUser
Service account:  lumina-crm
Lumina UID/GID:   1001/1001
Source:           /opt/lumina-crm/source
Config:           /etc/lumina-crm
Secrets:          /etc/lumina-crm/secrets
State:            /var/lib/lumina-crm
Logs:             /var/log/lumina-crm
Rootless socket:  /run/user/1001/docker.sock
```

### 4.1 目录权限

推荐目录结构：

```bash
sudo install -d -o root       -g root       -m 0755 /opt/lumina-crm
sudo install -d -o lumina-crm -g lumina-crm -m 0750 /opt/lumina-crm/source

sudo install -d -o root       -g lumina-crm -m 0750 /etc/lumina-crm
sudo install -d -o root       -g lumina-crm -m 0750 /etc/lumina-crm/secrets

sudo install -d -o lumina-crm -g lumina-crm -m 0750 /var/lib/lumina-crm
sudo install -d -o lumina-crm -g lumina-crm -m 0750 /var/lib/lumina-crm/deployments
sudo install -d -o lumina-crm -g lumina-crm -m 0750 /var/lib/lumina-crm/objects
sudo install -d -o lumina-crm -g lumina-crm -m 0750 /var/log/lumina-crm
```

### 4.2 服务账户约束

```bash
id lumina-crm
loginctl show-user lumina-crm
```

应确认：

- 不属于`docker`组；
- 不属于`sudo`组；
- 已配置subuid/subgid；
- 已启用linger；
- user systemd manager正常；
- Rootless Docker数据目录位于`/var/lib/lumina-crm/docker`。

---

## 5. Rootless Docker

### 5.1 必备组件

```bash
sudo apt-get install -y \
  docker.io \
  uidmap \
  rootlesskit \
  slirp4netns \
  dbus-user-session
```

确认：

```bash
command -v newuidmap
command -v newgidmap
command -v rootlesskit
command -v slirp4netns
```

### 5.2 用户运行时环境

```bash
sudo loginctl enable-linger lumina-crm
sudo systemctl start user@1001.service
```

常用环境：

```bash
export HOME=/var/lib/lumina-crm
export XDG_RUNTIME_DIR=/run/user/1001
export DOCKER_HOST=unix:///run/user/1001/docker.sock
export DOCKER_CONFIG=/var/lib/lumina-crm/docker-config
export BUILDX_CONFIG=/var/lib/lumina-crm/docker-config/buildx
```

### 5.3 验证Rootless边界

```bash
sudo -u lumina-crm \
  env \
    HOME=/var/lib/lumina-crm \
    XDG_RUNTIME_DIR=/run/user/1001 \
    DOCKER_HOST=unix:///run/user/1001/docker.sock \
  docker info
```

应确认：

```text
rootless
cgroup driver: systemd
Docker Root Dir: /var/lib/lumina-crm/docker
```

不要让该命令连接到`/var/run/docker.sock`。

---

## 6. 网络代理与镜像构建

受限网络环境下，应区分三类代理用途。

### 6.1 Git代理

本次GitHub访问使用：

```text
http://127.0.0.1:20271
```

仅针对单次Git命令：

```bash
git \
  -c http.proxy=http://127.0.0.1:20271 \
  -c https.proxy=http://127.0.0.1:20271 \
  fetch origin
```

生产部署变量可保存：

```dotenv
LUMINA_GIT_PROXY=http://127.0.0.1:20271
```

不要把代理写入全局Git配置，避免影响其他服务账户。

### 6.2 Rootless Docker Registry代理

Rootless dockerd的代理应通过用户级systemd drop-in提供：

```text
/var/lib/lumina-crm/.config/systemd/user/docker.service.d/20-proxy.conf
```

示例：

```ini
[Service]
Environment="HTTP_PROXY=http://<lumina-registry-relay>:<port>"
Environment="HTTPS_PROXY=http://<lumina-registry-relay>:<port>"
Environment="NO_PROXY=localhost,127.0.0.1,::1,10.0.2.0/24,172.17.0.0/16,172.18.0.0/16"
```

修改后：

```bash
sudo -u lumina-crm \
  env \
    HOME=/var/lib/lumina-crm \
    XDG_RUNTIME_DIR=/run/user/1001 \
  systemctl --user daemon-reload

sudo -u lumina-crm \
  env \
    HOME=/var/lib/lumina-crm \
    XDG_RUNTIME_DIR=/run/user/1001 \
  systemctl --user restart docker.service
```

### 6.3 BuildKit代理

镜像拉取代理和Dockerfile构建阶段代理不是同一层。

本次采用独立BuildKit relay，并让Lumina builder使用`network=host`。

生产变量示例：

```dotenv
LUMINA_DOCKER_PROXY=http://192.0.2.1:20273
```

核心经验：

- 不要复用ExampleApp的registry relay；
- 不要假设dockerd代理会自动进入BuildKit容器；
- 构建前单独验证Docker Hub token endpoint；
- `NO_PROXY`必须覆盖本地、Compose网络与Docker子网；
- 代理问题应在构建前preflight失败，而不是等待镜像构建超时。

---

## 7. 仓库获取与版本固定

### 7.1 Clone

```bash
sudo -u lumina-crm \
  env \
    HOME=/var/lib/lumina-crm \
  git \
    -c http.proxy=http://127.0.0.1:20271 \
    -c https.proxy=http://127.0.0.1:20271 \
    clone \
    https://github.com/kewtgh/crm.git \
    /opt/lumina-crm/source
```

### 7.2 更新

常规发布由部署 CLI 负责 fetch、目标静态 Host Preflight 与 fast-forward，不再先手工 merge 再探测宿主机。
以下步骤只读取目标数据，不执行目标程序；完整审批与恢复流程见第 0 节。

```sh
cd /opt/lumina-crm/source
git status --short
git fetch origin main
git rev-parse origin/main
npm run deploy:production:host-check -- --target=FULL_REVIEWED_SHA
# 通过并完成所有必要的独立升级审批后：
npm run deploy:production
```

CLI 在锁内再次检查并把当次已验证的完整 SHA 写入请求。Bootstrap 重查该 SHA，只有目标宿主机契约
通过才 fast-forward；分支随后前进不会改变已绑定请求的目标。不要仅记录“main 最新”。

---

## 8. 生产配置文件

### 8.1 Secret文件布局

```text
/etc/lumina-crm/secrets/
├── postgres-superuser-password.txt
├── production.env
├── worker.env
├── database-bootstrap.env
├── migration.env
├── bootstrap-admin.env
├── backup.env
├── restore.env
└── email-worker-deploy.env
```

推荐权限：

```text
Directory: root:lumina-crm 0750
Files:     root:lumina-crm 0640
Password:  root:lumina-crm 0640 or stricter
```

### 8.2 职责划分

#### `production.env`

供Web容器使用，包括：

- 应用公网URL；
- Turnstile/ALTCHA；
- Web数据库角色；
- System数据库角色；
- workspace；
- 登录安全密钥；
- 对象存储；
- Web当前所需的邮件Webhook URL/token；
- 非Secret功能开关。

#### `worker.env`

供后台Worker使用，包括：

- Worker数据库角色；
- workspace；
- 对象存储；
- 邮件Webhook URL/token；
- Worker并发和批量参数；
- 可选Webhook、集成、观测功能配置。

#### `email-worker-deploy.env`

只用于Cloudflare Email Worker部署，包括：

- Worker名称；
- Worker公网Base URL；
- CRM应用URL；
- From/Reply-To；
- 品牌名；
- delivery path；
- health path；
- Cloudflare账户ID；
- Cloudflare部署API token。

它不保存：

```text
RESEND_API_KEY
LUMINA_WEBHOOK_TOKEN
```

这两个值只保存在Cloudflare Worker Secrets。

### 8.3 Secret关系

```text
production.env.EMAIL_DELIVERY_WEBHOOK_TOKEN
worker.env.EMAIL_DELIVERY_WEBHOOK_TOKEN
=
Cloudflare Email Worker secret LUMINA_WEBHOOK_TOKEN
```

```text
RESEND_API_KEY
=
仅Cloudflare Email Worker Secret
```

不要通过日志或`ps`输出这些值。

---

## 9. 首次初始化

初始化流程应按固定顺序执行：

```text
1. 环境和Secret校验
2. Rootless Docker检查
3. BuildKit检查
4. 镜像构建
5. 容器化验证
6. PostgreSQL启动与健康检查
7. 数据库角色bootstrap
8. migration verify
9. migrations
10. administrator bootstrap
11. Web启动与健康检查
12. Worker启动与健康检查
13. loopback readiness
14. public liveness
15. 接受发布状态
```

命令：

```bash
sudo -u lumina-crm \
  env \
    HOME=/var/lib/lumina-crm \
    XDG_RUNTIME_DIR=/run/user/1001 \
  bash -lc '
    cd /opt/lumina-crm/source
    npm run deploy:production:initialize
  '
```

### 9.1 可重复执行原则

首次初始化失败后，可在修复外部依赖后重新执行。

不要因为某个后期健康检查失败而：

- 重建数据库；
- 删除卷；
- 重跑破坏性bootstrap；
- 删除管理员；
- 修改已应用migration；
- 清理镜像和构建缓存。

如果日志显示：

```text
all migrations already current
administrator synchronized
web healthy
worker healthy
```

应只修复失败的外部层。

---

## 10. Caddy本地反向代理

### 10.1 为什么需要Caddy

Lumina Web只监听`127.0.0.1:3200`，Cloudflare Tunnel回源到`127.0.0.1:3211`。

Caddy负责：

- 固定Host；
- 隐藏Web直连端口；
- 为Tunnel提供稳定本地origin；
- 将错误Host拒绝为404；
- 保持公网入口与Compose解耦。

### 10.2 安装注意事项

Ubuntu上的Caddy软件包可能自动启动默认服务并占用80/443。

安装时使用临时`policy-rc.d`阻止自动启动，安装后禁用默认服务：

```bash
sudo systemctl disable --now caddy.service caddy-api.service 2>/dev/null || true
```

不要让默认Caddy服务监听80/443，以免影响现有系统。

### 10.3 配置文件位置

不要把Caddy配置放进`/etc/lumina-crm`，因为该目录是`root:lumina-crm 0750`，`caddy`用户无法读取；也不应把`caddy`加入`lumina-crm`组。

使用：

```text
/etc/caddy/lumina-crm/Caddyfile
```

权限：

```bash
sudo install -d -o root -g caddy -m 0750 /etc/caddy/lumina-crm
sudo chown root:caddy /etc/caddy/lumina-crm/Caddyfile
sudo chmod 0640 /etc/caddy/lumina-crm/Caddyfile
```

### 10.4 Caddyfile

```caddy
http://:3211 {
    bind 127.0.0.1

    route {
        @lumina host crm.example.com
        reverse_proxy @lumina 127.0.0.1:3200

        respond "Not Found" 404
    }
}
```

使用`:3211`而不是将Host直接写进site address，可避免Host匹配与本地URL authority不一致时出现空`200`响应。

### 10.5 独立systemd服务

```text
/etc/systemd/system/lumina-caddy.service
```

核心配置：

```ini
[Unit]
Description=Lumina CRM local Caddy reverse proxy
Wants=network-online.target
After=network-online.target
Before=cloudflared-lumina.service

[Service]
Type=notify
User=caddy
Group=caddy
Environment=HOME=/var/lib/caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/lumina-crm/Caddyfile --adapter caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/lumina-crm/Caddyfile --adapter caddyfile
Restart=on-failure
RestartSec=2s
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

### 10.6 验证

```bash
sudo -u caddy \
  caddy validate \
    --config /etc/caddy/lumina-crm/Caddyfile \
    --adapter caddyfile

sudo systemctl enable --now lumina-caddy.service
```

正确Host：

```bash
curl -sS \
  -H 'Host: crm.example.com' \
  http://127.0.0.1:3211/api/health
```

预期：

```json
{"status":"ok","version":"<current-version>","checkedAt":"..."}
```

错误Host：

```bash
curl -sS \
  -o /dev/null \
  -w 'HTTP %{http_code}\n' \
  http://127.0.0.1:3211/api/health
```

预期：

```text
HTTP 404
```

---

## 11. Cloudflare Tunnel

### 11.1 最终模式

采用Direct Tunnel，不再使用：

```text
Tunnel origin → Cloudflare Worker转发 → crm.example.com
```

最终为：

```text
crm.example.com
→ Cloudflare Tunnel
→ http://127.0.0.1:3211
```

### 11.2 清理旧入口

只清理`crm.example.com`对应的旧资源：

- Worker Custom Domain；
- Worker Route；
- 旧Tunnel中的Published Application；
- 冲突的A/AAAA/CNAME。

不要删除其他域名、Tunnel或Worker。

### 11.3 新Tunnel配置

建议：

```text
Tunnel name: lumina-crm-production
Public hostname: crm.example.com
Service: http://127.0.0.1:3211
HTTP Host Header: crm.example.com
Connect Timeout: 10s
```

### 11.4 独立连接器

如果服务器已有rootful Docker内的`cloudflared`，不要停止、复用或替换。

使用独立二进制：

```text
/usr/local/bin/cloudflared-lumina
```

独立账户：

```text
cloudflared-lumina
```

token文件：

```text
/etc/cloudflared-lumina/token
```

权限：

```text
root:cloudflared-lumina 0640
```

不要把token直接放进`ExecStart`或命令行。

### 11.5 systemd服务

```ini
[Unit]
Description=Lumina CRM Cloudflare Tunnel
Wants=network-online.target
After=network-online.target lumina-caddy.service
Requires=lumina-caddy.service
StartLimitIntervalSec=0

[Service]
Type=notify
User=cloudflared-lumina
Group=cloudflared-lumina
ExecStart=/usr/local/bin/cloudflared-lumina tunnel --no-autoupdate --loglevel info run --token-file /etc/cloudflared-lumina/token
Restart=always
RestartSec=5s
TimeoutStartSec=0
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
```

### 11.6 公网验证

```bash
env \
  -u HTTP_PROXY \
  -u HTTPS_PROXY \
  -u ALL_PROXY \
  -u http_proxy \
  -u https_proxy \
  -u all_proxy \
  curl \
    --silent \
    --show-error \
    --dump-header /tmp/lumina-public.headers \
    --output /tmp/lumina-public.body \
    https://crm.example.com/api/health
```

预期HTTP 200，正文版本必须与本次发布版本一致。

### 11.7 常见状态码

| 状态 | 典型含义 |
|---|---|
| 404 | Worker Route、Host Header或Ingress规则不匹配 |
| 502 | Tunnel已连接，但origin不可达或Caddy配置错误 |
| 530 | Tunnel/DNS/Worker Route冲突，或Tunnel未连接 |
| 200空正文 | Caddy没有匹配到处理器；检查site address、Host matcher和route顺序 |
| Access登录页 | Cloudflare Access覆盖了健康检查路径 |

部署器需要公开访问`https://crm.example.com/api/health`，因此不要在初始化完成前让该路径要求交互式Access登录。

---

## 12. Email Delivery Worker

### 12.1 独立职责

邮件投递Worker与CRM Tunnel是两个独立Cloudflare对象。

不要使用`crm.example.com`作为邮件Worker Custom Domain，应使用单独域名，例如`<email-worker-host>`。

### 12.2 服务器部署配置

```text
/etc/lumina-crm/secrets/email-worker-deploy.env
```

部署命令：

```bash
sudo -u lumina-crm \
  env HOME=/var/lib/lumina-crm \
  bash -lc '
    cd /opt/lumina-crm/source/infrastructure/email-delivery-worker
    npm run deploy:production:dry-run
    npm run deploy:production
  '
```

### 12.3 健康检查

```bash
sudo -u lumina-crm \
  env HOME=/var/lib/lumina-crm \
  bash -eu <<'EOF2'
set -a
. /etc/lumina-crm/secrets/email-worker-deploy.env
set +a

curl -fsS "${WORKER_PUBLIC_BASE_URL}${HEALTH_PATH}"
EOF2
```

预期：

```json
{"status":"ok","service":"lumina-email-delivery"}
```

健康检查不会发送邮件。

### 12.4 核对CRM调用URL

`worker.env`中的`EMAIL_DELIVERY_WEBHOOK_URL`必须等于：

```text
WORKER_PUBLIC_BASE_URL + DELIVERY_PATH
```

比较时不要打印真实URL。

### 12.5 Token轮换

若Token曾出现在聊天、shell history、`ps`输出、systemd unit或日志中，必须立即轮换。

轮换步骤：

1. 生成新随机token；
2. 更新Cloudflare Worker secret `LUMINA_WEBHOOK_TOKEN`；
3. 更新`production.env`和`worker.env`中的`EMAIL_DELIVERY_WEBHOOK_TOKEN`；
4. 重启Lumina Web和Worker；
5. 进行健康检查和实际受控发送测试；
6. 确认旧token无法再建立新调用。

---

## 13. 生产验收

### 13.1 分层检查

#### A. Rootless Docker

```bash
sudo -u lumina-crm \
  env \
    HOME=/var/lib/lumina-crm \
    XDG_RUNTIME_DIR=/run/user/1001 \
    DOCKER_HOST=unix:///run/user/1001/docker.sock \
  docker info
```

#### B. Compose

```bash
sudo -u lumina-crm \
  env \
    HOME=/var/lib/lumina-crm \
    XDG_RUNTIME_DIR=/run/user/1001 \
    DOCKER_HOST=unix:///run/user/1001/docker.sock \
  docker compose \
    --project-name lumina-crm \
    --env-file /var/lib/lumina-crm/deployments/compose.env \
    -f /opt/lumina-crm/source/compose.production.yml \
    ps
```

#### C. Web直连

```bash
curl -fsS http://127.0.0.1:3200/api/health
```

#### D. Caddy

```bash
curl -fsS \
  -H 'Host: crm.example.com' \
  http://127.0.0.1:3211/api/health
```

#### E. Tunnel

```bash
curl -fsS https://crm.example.com/api/health
```

#### F. Email Worker

```bash
curl -fsS "https://<email-worker-host>/<health-path>"
```

### 13.2 版本一致性

至少核对：

```text
Git HEAD
package version
runtime health version
image tag
accepted release
```

不要只看容器“healthy”。

### 13.3 管理员初始化

首次bootstrap成功后应清空一次性密码：

```bash
sudo sed -i \
  's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/' \
  /etc/lumina-crm/secrets/bootstrap-admin.env
```

不要在普通发布中打开`ADMIN_ROTATE_PASSWORD=true`。

---

## 14. 故障定位顺序

始终从内向外排查：

```text
PostgreSQL
→ Worker/Web容器
→ 127.0.0.1:3200
→ Caddy 127.0.0.1:3211
→ Tunnel connector
→ Cloudflare DNS/Route
→ crm.example.com
→ Email Worker
→ Resend
```

不要一看到公网错误就重建应用。

### 14.1 Web正常、3211失败

检查：

```bash
systemctl status lumina-caddy.service
ss -lntp | grep 3211
journalctl -u lumina-caddy.service
```

### 14.2 3211正常、公网530

检查：

- Tunnel是否Healthy；
- DNS是否指向新Tunnel；
- 是否残留Worker Route；
- 是否残留旧Published Application；
- 新连接器是否使用正确token。

### 14.3 公网502

检查：

- Tunnel origin URL；
- HTTP Host Header；
- Caddy监听地址；
- `cloudflared-lumina`用户是否能访问`127.0.0.1:3211`。

### 14.4 邮件服务未配置

分别检查：

```text
production.env
worker.env
email-worker-deploy.env
Cloudflare Worker Secrets
```

不要根据单个文件判断整条链路。

### 14.5 Worker健康但邮件失败

Worker健康只证明进程、数据库、heartbeat和队列基本正常，不一定证明Email Worker已部署、Token匹配、Resend API Key有效、From域名已验证或Resend接受当前收件人。

---

## 15. 回滚原则

### 15.1 应用回滚

只回滚：

- Lumina应用镜像；
- Lumina Compose服务；
- Lumina接受的release状态。

不要回滚：

- PostgreSQL volume；
- 已应用migration；
- 管理员密码；
- Cloudflare Tunnel；
- ExampleApp。

### 15.2 Tunnel回滚

重建Tunnel时：

1. 保留旧Tunnel；
2. 创建新Tunnel；
3. 验证本地Caddy；
4. 验证新Tunnel公网健康；
5. 再删除仅属于旧CRM入口的route/domain；
6. 旧Tunnel若承载其他hostname，不得删除。

### 15.3 Secret回滚

Secret更新前：

- 备份文件权限和owner；
- 不将备份放入Git；
- 不输出内容；
- 文件原子替换；
- 仅重启受影响服务。

---

## 16. 本次部署的关键经验

### 16.1 先确认失败层，不要重新部署全部系统

本次后期失败仅发生在公网liveness。此前已通过镜像构建、PostgreSQL、migration、管理员bootstrap、Web、Worker和loopback readiness。

因此正确做法是只修复Caddy/Tunnel，而不是重建数据库或重新初始化。

### 16.2 监听端口与进程存在是最直接证据

当`curl 127.0.0.1:3211`立即失败时，问题不是Cloudflare，而是Caddy未运行或未监听。

### 16.3 systemd unit不存在时不要继续修改它

先执行：

```bash
systemctl cat <unit>
systemctl list-unit-files | grep <name>
```

确认存在后再使用`sed`或drop-in。

### 16.4 目录execute权限比文件read权限更重要

即使Caddyfile为`root:caddy 0640`，如果父目录是`root:lumina-crm 0750`，Caddy仍然无法访问。

不要放宽整个Secret目录，也不要增加不必要的附加组；把非Secret配置移到正确目录。

### 16.5 Caddy空200可能是路由未匹配

如果上游返回完整JSON，但Caddy响应：

```text
HTTP/1.1 200
Content-Length: 0
```

说明Caddy没有进入`reverse_proxy`处理器。

使用`http://:3211`配合明确Host matcher和`route`，并对未匹配请求返回404。

### 16.6 现有cloudflared进程可能属于别的系统

通过`ps`、`/proc/<pid>/cgroup`和parent process确认它是否运行在Rootful Docker中。

不要因为`systemctl list-units cloudflared*`为空，就认定服务器没有Tunnel。

### 16.7 Token出现在命令行即视为泄露

远程管理Tunnel如果使用：

```bash
cloudflared tunnel run --token <token>
```

token会出现在`ps`中。应使用`--token-file`并设置严格文件权限。

### 16.8 部署成功不等于所有外部能力可用

CRM应用健康、邮件Worker健康、Resend可用性是不同的验收项，应分别验证。

---

## 17. 后续部署检查表

### 发布前

- [ ] ExampleApp基线已记录；
- [ ] Lumina Rootless Docker连接正确；
- [ ] 源码worktree clean；
- [ ] 目标commit明确；
- [ ] 所有Secret文件存在且权限正确；
- [ ] registry代理和BuildKit代理通过preflight；
- [ ] Caddy本地origin可用；
- [ ] Tunnel配置没有旧Worker Route冲突；
- [ ] Email Worker健康；
- [ ] 数据库备份策略可用。

### 发布中

- [ ] 不使用Rootful Docker；
- [ ] 不执行全局prune；
- [ ] 不删除volume；
- [ ] 不修改已应用migration；
- [ ] 记录deployment ID、request ID、commit和image；
- [ ] 每个stage有明确成功或失败证据。

### 发布后

- [ ] Web直连200；
- [ ] Caddy 200；
- [ ] 公网200；
- [ ] runtime版本正确；
- [ ] Worker健康；
- [ ] Email Worker健康；
- [ ] 管理员登录正常；
- [ ] 一次性管理员密码已清空；
- [ ] ExampleApp容器restart count未变化；
- [ ] Lumina日志无持续重启；
- [ ] accepted release状态存在。

---

## 18. 最小日常运维命令

### 查看Lumina容器

```bash
sudo -u lumina-crm \
  env \
    HOME=/var/lib/lumina-crm \
    XDG_RUNTIME_DIR=/run/user/1001 \
    DOCKER_HOST=unix:///run/user/1001/docker.sock \
  docker ps
```

### 查看Caddy

```bash
sudo systemctl status lumina-caddy.service --no-pager --full
sudo journalctl -u lumina-caddy.service -n 100 --no-pager
```

### 查看Tunnel

```bash
sudo systemctl status cloudflared-lumina.service --no-pager --full
sudo journalctl -u cloudflared-lumina.service -n 100 --no-pager
```

### 本地健康

```bash
curl -fsS http://127.0.0.1:3200/api/health
curl -fsS -H 'Host: crm.example.com' http://127.0.0.1:3211/api/health
```

### 公网健康

```bash
curl -fsS https://crm.example.com/api/health
```

---

## 19. 文档维护要求

后续每次生产部署完成后，应更新：

- Ubuntu版本；
- Docker版本；
- Node/npm版本；
- Rootless Docker路径；
- Compose project；
- 当前端口；
- Caddy unit名称；
- Tunnel unit名称；
- Secret文件清单；
- 外部邮件Worker域名；
- 当前发布版本；
- 最近一次成功deployment ID；
- 已验证的恢复流程。

本文不得记录：

- Tunnel token；
- Cloudflare API token；
- Resend API key；
- Webhook token；
- 数据库密码；
- 管理员密码；
- 真实Secret文件内容。
