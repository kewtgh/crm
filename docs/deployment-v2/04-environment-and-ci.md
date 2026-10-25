# 开发 / 生产隔离下的环境复现与 CI 验证

M0 v0.2 将验证位置与证据能力分开。开发 / CI 测试不在生产宿主机运行；生产只允许受审只读适配。当前所有新增 Linux / 按需生命周期 / 现场适配能力均为 NOT_RUN，没有因本次文档修订获得运行认证。

## 目标环境与软件来源

适配目标为管理员声明的 Ubuntu 26.04、Ubuntu Docker 29.1.3、Compose 2.40.3、Buildx 0.30.1 和现有项目 Rootless / systemd / cgroup 边界。声明不等于完整认证；Ubuntu 发行包与 Docker CE 包不能互换后仍声称相同环境。生产不安装测试依赖，也不为复现迁移数据根。

2026-10-25 查询的官方包目录可对应以下上游 / 发行版本。这证明包系存在，不证明当前生产安装，也不代替后续下载、签名和完整依赖锁定：

| 组件 | 目标 | 官方资料中的发行包 | M1 必须补充的锁定项 |
| --- | --- | --- | --- |
| Ubuntu | 26.04 LTS / resolute | 已有外部 host / runner；使用镜像时取官方来源 | host / runner 来源、架构、kernel、systemd；仅镜像场景补 URL / 签名 / SHA-256 / 构建时间 |
| Engine | 29.1.3 | `docker.io`，目录列有 `29.1.3-0ubuntu4.1` 安全更新 | 实际 pocket / source、DEB hash、client / server build、containerd / runc 依赖 |
| Compose | 2.40.3 | `docker-compose-v2`，`2.40.3+ds1-0ubuntu1` | 实际 plugin 路径、所有者、DEB hash、version 原文与语义版本 |
| Buildx | 0.30.1 | `docker-buildx`，`0.30.1-0ubuntu1` | DEB hash、plugin build、是否安装但不参与日常发布 |
| Rootless 支持 | 真正项目用户 daemon | 发行包及其依赖 | RootlessKit / uidmap / 网络 / 存储实现、subuid / subgid、AppArmor / userns 策略 |
| Agent | 独立版本 | 私有 Node 24.22.1、SQLite 实际版本 | Agent / runtime / verifier 摘要及 schema epoch |

来源：[Ubuntu Docker 包目录](https://packages.ubuntu.com/search?arch=amd64&keywords=docker&searchon=names&suite=resolute)、[Buildx 包详情](https://packages.ubuntu.com/resolute/docker-buildx)。这些是 v0.1 查询的官方包参考，不是生产 DEB revision 的现场证明或安装指令。M1 仅在外部测试侧冻结实际输入；无法可靠取得目标包时记 BASELINE_UNAVAILABLE / NOT_RUN，不换版本冒充通过，也不修改生产以迎合测试环境。

外部 `environment-lock` 至少包含 provider / runner image 身份、OS / kernel / systemd、CPU 架构、容器栈版本及包 hash、文件系统、cgroup / user manager 条件；使用 VM 时另记 OS image digest 与 boot 方式。生产只读报告另列实际可观测匹配项，不复制私有配置、全机包列表或数据来制造“完全复刻”。

## 外部环境策略

优先复用已有外部托管 CI 和可用的非生产 Linux 环境，不新增生产依赖或预设购买一台构建服务器。普通 CI 提供真实 Linux / Compose 集成；需要 user manager、Rootless / cgroup、重启的场景只进入条件满足的非生产 Linux 主机或 VM。完整 VM 是隔离重启 / 断电的一种可选形态，不是所有测试的强制部署形态。

生产宿主机明确禁止测试 QEMU/KVM、额外 Ubuntu VM、DIND 和 CI Runner。测试资源不足不允许改用生产、借用同机其他业务的 daemon / PostgreSQL / Temporal，或在生产跑“轻量试部署”。外部专用 Linux 也不能未经批准重启共享 CI host；破坏性场景只运行在可丢弃 VM 或明确专用且已授权的非生产机器。

Docker Desktop、普通容器、DIND、Mock、仅 Compose parser 和浮动 `ubuntu-latest` 不能证明目标 Ubuntu 的完整 systemd / cgroup / rootless 行为。可运行什么就认证什么；不足项 NOT_RUN，不能将普通容器 job 改名为完整兼容测试。

Rootless 动态认证实际核实 user manager / linger、项目 socket 与 data-root、systemd cgroup driver / v2 controllers，并运行虚构容器检查 CPU / memory / pids 限制。仅配置或 info 不证明限制生效。[Docker Rootless 资源控制条件](https://docs.docker.com/engine/security/rootless/tips/)

测试使用独立虚构数据库、mail sink 和受控 edge fixture；可建立虚构邻居 canary 检查不越界，不复制生产数据或访问真实邻居。正式应用构建留在已有外部 CI，生产不执行 npm ci、Buildx 或 release gate；制品运输仅比较管理员已有文件传递、CI artifact 与已有允许 registry，不以新仓库 / 服务器为前提。

## 流水线分层

| 层 | 触发与输入 | 能证明的内容 | 通过不能替代什么 |
| --- | --- | --- | --- |
| L0 / 开发测试 | 开发机 / 无凭据 PR | 协议、状态转移、幂等、故障模拟、脱敏、签名拒绝、嵌入式存储 | Linux flock、真实 systemd / Rootless / 整机故障 |
| L1 / 外部 Linux CI | 现有外部 runner，固定原生 Compose 与明确 daemon 条件 | 真实 parser、安全归一化、Linux 文件 / 锁；有 daemon 时另测真实虚构工作负载 | Rootless / user manager / cgroup / 重启，除非另有对应实测 |
| L2 / 非生产系统集成 | 受信提交；具备真实 systemd / Rootless / cgroup 的外部 Linux 主机或 VM | oneshot 生命周期、终端断开、串行化、资源限制；M3 才测完整应用 / 真实虚构 PG | 未实际执行的 reboot / power loss、生产适配 |
| L3 / 非生产崩溃与跨版本 | 可丢弃 VM 或单独批准的专用非生产机器 | 真实重启 / 断电、部分切换、升级回退与证据恢复 | 生产可用性；普通容器测试不能替代本层 |
| P0 / 生产只读适配 | 管理员手动运行受审诊断，严格有界 | 版本 / 身份 / 已有配置的观测匹配，未完成操作 / 权限 / 容量的只读结果 | 不能证明任务派发、负载、限额生效、崩溃恢复或授予写入资格 |

L0 模拟和 L1 真实 CLI 分开标记；L2 / L3 要有实际系统证据。每条结果绑定位置、方法、环境锁、制品 digest、时间和 PASS / FAIL / NOT_RUN，管理员声明另标 OPERATOR_DECLARED。P0 的配置匹配不能补齐 L2 / L3。缺适当外部环境时允许继续开发 / alpha 研究，禁止宣称已兼容或批准生产写入版 Agent。

应用构建、Agent 发行和外部测试资源各有权限边界。不让应用 PR 更新 Agent / trust roots / 基础镜像。使用 VM 时可复用受审 golden image、每次克隆销毁；使用非 VM 主机时要有项目隔离和可复原目录，不能为方便测试改变已有业务或共享环境。

## 按需生命周期与真实测试矩阵

M1 只实现未来测试 harness / 诊断 MVP 和可行性验证，不替换 V1。oneshot 的进程 / 持久化小型 harness 不等于完整应用发布验证；后者留在 M3。当前下列动态测试均 NOT_RUN。

| ID / 阶段 | 位置与真实方法 | 必须观察的判定 | 缺条件时 |
| --- | --- | --- | --- |
| M1-01 / CLI | L1 固定 Compose 2.40.3 实际 config | 安全字段、quoted tmpfs、memory 等价、错误首因准确；可无 daemon | 记录未测功能，不提升为 Rootless 认证 |
| M1-02 / detach | L2 真正 user systemd oneshot + 终止 CLI / 断开测试会话 | worker 继续由 manager 管理；CLI 无保活子进程；完成后无新增闲置进程 | NOT_RUN，常驻模式不能因此视为必要 |
| M1-03 / exit | L2 成功 / 失败 / timeout / kill 主进程与本地子进程 | unit 状态与业务状态分离；进程回收；未知副作用不记 NO_EFFECT | 阻断生命周期认证 |
| M1-04 / dispatch | L1 / L2 真实 SQLite 与 Linux 锁，提交前后 / 派发前后终止进程 | 请求找回；一次性 grant 只领取一次；重复启动不重放 | 模拟可补开发覆盖，不能替代实际 Linux 锁 |
| M1-05 / concurrency | L2 多 CLI、unit 重复启动、installer 竞争 | 一个逻辑写入通道、单未解决 operation；BUSY 精确；无双执行 | 未通过则不得发行写入版 |
| M1-06 / restart | L3 实际停止再启动 OS / user manager | 文件保留；status 不启动任务；旧 INTENT 进入显式恢复；无自动迁移 | NOT_RUN，不在生产重启验证 |
| M1-07 / storage | L2 / L3 可丢弃磁盘的 journal、ENOSPC / EIO、真实断电 | 原子状态；只读诊断不恢复 hot journal；证据预算不足前置阻断 | 未测断电单列 NOT_RUN；不声称断电持久性 |
| M1-08 / resources | L2 使用与候选相同限额观察 RSS / CPU / task / 暂存峰值 | 满足资源预算；Docker daemon 负载另计；不越界 canary | 记录测量缺口，不在生产压测 |
| M1-09 / transport | L1 比较现有 CI artifact / 管理员文件包 / 已有 registry 的验证链 | 可离线验证内容与来源；无需新增生产服务器；M2 冻结具体运输适配器 | 无可行输入则保留决策未定，不搭生产 registry |
| M1-10 / diagnostics | L1 / L2 文件快照、API allowlist 与故意缺权限 | 仅指定报告输出；不创建 unit / DB / 容器、不联网、不扫描邻居 | 只读性未认证，不建议生产执行 collector |

M1 不以常驻 daemon 作默认对照依赖。如果 oneshot 出现可复现的必要需求缺口，先比较固定 unit / 状态派发修正；只有缺口仍存在，才提交常驻方案的证据、资源差异和替代设计，重新评审，不能直接增加长期服务。

## M3 必需的完整应用场景

| 类别 | 场景 | 验证依据 |
| --- | --- | --- |
| 正常发布 | 无迁移发布；有兼容迁移发布；同 key 重复请求；CLI 断线 | 真实镜像 digest、一次 operation、schema / receipt、终态和 accepted 同事务 |
| 隔离 | 非项目 socket / UID / data-root、错误 network / volume、外部 canary | 首因准确、未越界调用；canary 数据 / 身份 / unit 不变 |
| Preflight | EACCES、缺失文件、daemon 失败、无 user bus、JSON 失效、资源委派缺失、版本后缀 | FAIL / UNKNOWN / NOT_RUN 正确，依赖链无重复误报 |
| Compose | 真实 2.40.3 安全模型、quoted tmpfs、memory units、模型失配、无效 YAML | CLI 真实结果；逐安全字段一致；不删除检查取得通过 |
| 迁移 | advisory lock 竞争、SQL 回滚、提交后断线、逐项部分提交 | SQL / 既有 ledger 同事务；不创建控制状态表；已提交项不重放，归属不明明确暂停 |
| 控制器崩溃 | 每个 intent 前后、派发前后、PROVEN 前后、接受事务前后 kill -9 | 新 Agent 先 reconcile；不得自动重放未知副作用 |
| 整机故障 | L3 可丢弃 VM / 专用非生产机器断电、冷启动、journal 与受限盘故障 | 本地事实不矛盾；数据库提交窗口靠真实 ledger 核实，不能证明执行归属则需显式恢复 |
| 激活 | Web 已替换 / Worker 未替换，daemon API 返回丢失，旧任务仍运行 | 正确识别混合版本；新操作受阻；只允许明确计划续跑 |
| 验收 | 内部正常 / edge 不通；错误构建但同 semver；readiness / Worker / 队列退化 | 不误接受；只验收续跑零迁移、零重启 |
| Agent 发行 | 签名、payload、workflow 身份、repo ID、兼容字段篡改；选定运输模式的离线验证 | 来源、内容、身份均验证；不依赖新 registry / 服务器或生产 release gate |
| Agent 升级 | 相邻受支持版本、失败激活、状态 epoch 不兼容、旧状态备份 | 回退用当前兼容状态；禁止覆盖较新执行历史 |
| V1 迁移 | V1 未解决状态、遗留单位保持原样、两入口竞争、shadow comparison | V2 shadow 零写入；共享锁 / owner 检查；未知旧状态不可导入为成功 |
| GC / 诊断 | GC 失败、诊断缺权限 / Agent 不可用 / 时限耗尽 | 不改变发布接受结果；诊断无启动、迁移、安装、环境泄露 |

非生产 harness 可用精确 failpoint，但必须禁用于正式 Agent。黑盒进程终止、真实 OS 重启和断电分开记录；只有模拟分支不算动态门槛通过。生产不得开启 failpoint、压力 / 崩溃 / reboot 测试或破坏性回退演练。

## 资源预算与停止点

以下是未来 M1 的任务预算上限，尚非测量结果或资源采购授权；超出先收敛 / 报告，不把开销转移到生产。

| 位置 | 可复用资源与候选上限 | 时限 / 磁盘 | 不可做 |
| --- | --- | --- | --- |
| 开发机 L0 | 已有 Node 24；不安装额外生产依赖 | 单项可选检查 55 秒 watchdog，临时目录不超过 1 GiB | 把 Windows 模拟当 Linux 认证 |
| 外部 CI L1 | 既有 runner；候选 2 vCPU / 4 GiB | 每 job 20 分钟；测试 scratch 12 GiB；正式应用构建使用原 CI 预算 | 新建生产 runner / 服务器，未批准付费扩容 |
| 非生产 L2 | 已有或另行批准的专用 Linux；候选 4 vCPU / 8 GiB | 每组 30 分钟，scratch 20 GiB；包含虚构 canary | 影响其他共享任务 / 在生产代跑 |
| 非生产 L3 | 仅已有或另行批准的可丢弃环境 | 每组 45 分钟；使用 VM 时磁盘上限 40 GiB、单并发 | 为满足 gate 在生产建 VM 或重启生产 |
| 生产 P0 | 无 Agent daemon / DB 服务；一个短诊断进程 | 总计 45 秒、候选 RSS 128 MiB、报告 1 MiB；顺序采集、默认无网络 | 负载测试、创建持久状态库、安装 unit、读取业务数据库 |

Agent 正式部署的生产预算另见 [最小增量](06-release-and-agent-lifecycle.md#生产最小增量与资源预算)，不与测试设施预算混为一谈。只读 P0 的安全上限也要先在 L1 / L2 测量，不能为了取得测量数据在生产压测。

## 生产适配与发行门禁

P0 仅对确切 CRM UID / socket / data-root、既有工具版本、已有 user manager / cgroup 条件、空间和固定路径元数据做只读匹配。缺少 V2 文件 / unit 在尚未安装阶段应报告 NOT_INSTALLED 或 NOT_RUN，不能启动服务去验证。无权限为 UNKNOWN，不采集另一个项目补全信息，不连接 rootful socket。

L0 / L1 通过可发行标明限制的开发 alpha；生产写入版必须具备候选摘要绑定的 L2 / L3 关键生命周期、持久化、迁移恢复与隔离证据，再结合 P0 现场匹配。完整能力缺失就是阻断，不批准跳过、用生产试点补测或称普通容器兼容完整 Ubuntu。后续真实业务发布需 M5 单独批准，属于变更窗口，不是测试层。

## CI 信任与证据

不在长期自托管主机上直接执行不受信 fork PR。公开 PR 先用无凭据的外部托管检查；若使用可丢弃 VM，也只在生产网络之外。受保护 release workflow 固定 action / runner 身份，签名权限仅授予受信发行任务；所有外部系统测试都没有生产凭据或生产网络访问。

GitHub 官方提醒自托管 runner 不保证一次性干净 VM，不受信代码可持久化污染。复用外部 CI 也必须隔离不受信代码；L2 / L3 仅在受信任务、可复原非生产环境运行，不以共享 runner 清理脚本替代隔离。[GitHub 自托管安全边界](https://docs.github.com/en/actions/reference/security/secure-use)

原始 console、journals、快照、数据库测试明细留在受限存储。公开 CI artifact 只上传经过 schema 白名单重建的 `compatibility-summary`：Agent / app artifact digest、环境锁 digest、测试 case ID、结果、有限版本和故障类别。不得 upload 整个 `work/`、原始 `docker inspect`、env 或 unreviewed screenshot。

测试结果要绑定确切 Agent payload、应用 digest、环境锁与测试清单 digest。同名 tag、同 semver 或旧环境的通过不能复用为另一制品认证。更新任何安全策略、runtime、Compose adapter、state schema 或 migration protocol，需要对应场景重新验证。

## 时限与执行授权

M1 先提交可用外部资源、上述预算的实际适配、任务取消和证据回收办法。没有 L2 / L3 资源可以交付明确 NOT_RUN 的能力清单与阻断结论，不要求为开发新购服务器。预计超过 60 秒的可选审计仍须事先批准；本文件不授权当前启动这些任务。超时先检查是否已完成，不重复副作用。

正式 Agent RC 的完整集成清单是必需的发行工作，但不得在一个小修复任务中无界反复执行。后续改动按影响选择已有认证场景；只有新的失败或改动才扩大验证。
