# 开发 / 生产隔离下的环境复现与 CI 验证

本阶段只定义验证架构，没有启动 VM、运行新的集成测试或连接生产。Windows 本地测试、真实 Compose parser 测试和 Mock 测试均不得填写为本文件的 VM 验收通过。

## 目标环境与软件来源

兼容基线为用户指定的 Ubuntu 26.04、Ubuntu Docker 29.1.3、Compose 2.40.3、Buildx 0.30.1、Rootless Docker、systemd、cgroup v2。Ubuntu 发行包与 Docker CE 发行包不是可互换的测试输入。

2026-10-25 查询的官方包目录可对应以下上游 / 发行版本。这证明包系存在，不证明当前生产安装，也不代替后续下载、签名和完整依赖锁定：

| 组件 | 目标 | 官方资料中的发行包 | M1 必须补充的锁定项 |
| --- | --- | --- | --- |
| Ubuntu | 26.04 LTS / resolute | 官方 cloud image / ISO | 镜像 URL、签名、SHA-256、架构、kernel、systemd、镜像构建时间 |
| Engine | 29.1.3 | `docker.io`，目录列有 `29.1.3-0ubuntu4.1` 安全更新 | 实际 pocket / source、DEB hash、client / server build、containerd / runc 依赖 |
| Compose | 2.40.3 | `docker-compose-v2`，`2.40.3+ds1-0ubuntu1` | 实际 plugin 路径、所有者、DEB hash、version 原文与语义版本 |
| Buildx | 0.30.1 | `docker-buildx`，`0.30.1-0ubuntu1` | DEB hash、plugin build、是否安装但不参与日常发布 |
| Rootless 支持 | 真正项目用户 daemon | 发行包及其依赖 | RootlessKit / uidmap / 网络 / 存储实现、subuid / subgid、AppArmor / userns 策略 |
| Agent | 独立版本 | 私有 Node 24.22.1、SQLite 实际版本 | Agent / runtime / verifier 摘要及 schema epoch |

来源：[Ubuntu Docker 包目录](https://packages.ubuntu.com/search?arch=amd64&keywords=docker&searchon=names&suite=resolute)、[Buildx 包详情](https://packages.ubuntu.com/resolute/docker-buildx)。发行包 revision 可能变化，以上不是自动安装命令；M1 必须冻结实际来源和完整包锁。若旧 revision 无法可靠取得，环境标记 `BASELINE_UNAVAILABLE`，不能换成 Docker CE 或新版后继续声称目标基线通过。

M1 的 `environment-lock` 至少包含 OS image digest、APT signed Release / Packages 摘要、全部安装 DEB 版本与 hash、CPU 架构、kernel、systemd、容器栈、文件系统与 cgroup 配置。资料和包缓存放在独立测试基础设施，不把私有主机配置复制进仓库。

## 真实 VM 形态

使用能真实启动 Ubuntu 的 QEMU/KVM 或独立虚拟化平台 VM，systemd 为 PID 1，有自己的 kernel / cgroup 树 / 磁盘 / 项目 UID。测试 runner 位于 VM 外或受限测试管理层；root 操作只发生在专用测试 VM 中。

Docker Desktop、普通 Ubuntu 容器、DIND 和仅运行 Compose CLI 的 Ubuntu runner 不能证明上述内核、user manager、controller 委派及重启行为。`runs-on: ubuntu-latest` 也不是环境锁。现有 CI 保留其用途，新增明确的 VM job，而不是改名冒充完整集成。

初始容量预算为 4 vCPU、8 GiB RAM、至少 40 GiB 独立虚拟磁盘；M1 根据实际构建 / 运行峰值修订并冻结。应用构建可在独立 builder 完成，兼容 VM 只需要发布运行负载。磁盘 / 内存不足场景使用专门可丢弃的受限卷或 VM 快照，不在开发主机或 runner 主机制造耗尽。

Rootless 验收必须实际检查 user manager、linger 启动行为、固定项目 socket、rootless security option、systemd cgroup driver、v2 controllers，并实际运行容器观察 CPU / memory / pids 限制。仅 `docker info`、unit active 或静态配置不算资源限制生效。[Docker Rootless 资源控制条件](https://docs.docker.com/engine/security/rootless/tips/)

VM 只存放独立虚构 CRM 数据、本地邮件 sink 与受控 edge fixture。不得复制生产数据库、密钥、合同、真实公司身份或隧道配置。创建可验证的“其他项目”虚构容器 / 卷 / unit 作为隔离 canary，测试后核对其身份、数据和配置未变。

## 流水线分层

| 层 | 触发与输入 | 能证明的内容 | 通过不能替代什么 |
| --- | --- | --- | --- |
| L0 / 快速协议测试 | PR；无生产凭据 | schema、状态转移、幂等、错误分类、脱敏、签名拒绝、路径约束 | 真实 Docker / systemd / DB 副作用 |
| L1 / 原生 CLI 集成 | PR；固定 Compose 2.40.3 binary | 实际 parser、unit / byte 归一化、真实 Git 旧工具 fixture | rootless daemon、kernel 与资源控制 |
| L2 / 目标 VM 集成 | 受信提交；完整环境锁 | 真正安装 / 运行 Agent、应用部署、真实 PostgreSQL 迁移、服务重启与隔离 | 生产环境漂移与实际公网可达 |
| L3 / 故障与跨版本 VM | Agent release candidate、协议变更 | kill / power loss / 部分切换 / 版本升级回退，证据恢复 | 生产管理员验收 |
| L4 / 管理员现场验收 | 独立维护窗口，受审制品与计划 | 真实站点适配与试点接受 | 不能回填成 Codex 已执行 |

L0 可使用 Mock 测试状态边界；L2 / L3 的副作用、迁移账本、systemd 和断电结果必须来自真实 VM。发布报告逐项列出 executed / passed / failed / not-run，禁止将缺失 VM job 视为可忽略的 skip 后发行正式 Agent。

测试 VM 构造可复用受审 golden image，但每个 job 克隆干净磁盘并在结束后销毁。Provisioning、应用构建、Agent 发行各有独立锁文件和权限。不得让应用 PR 隐式更新 Agent release、受信根或测试基础镜像。

## 必须执行的真实场景

| 类别 | 场景 | 验证依据 |
| --- | --- | --- |
| 正常发布 | 无迁移发布；有兼容迁移发布；同 key 重复请求；CLI 断线 | 真实镜像 digest、一次 operation、schema / receipt、终态和 accepted 同事务 |
| 隔离 | 非项目 socket / UID / data-root、错误 network / volume、外部 canary | 首因准确、未越界调用；canary 数据 / 身份 / unit 不变 |
| Preflight | EACCES、缺失文件、daemon 失败、无 user bus、JSON 失效、资源委派缺失、版本后缀 | FAIL / UNKNOWN / NOT_RUN 正确，依赖链无重复误报 |
| Compose | 真实 2.40.3 安全模型、quoted tmpfs、memory units、模型失配、无效 YAML | CLI 真实结果；逐安全字段一致；不删除检查取得通过 |
| 迁移 | advisory lock 竞争、SQL 回滚、提交后断线、逐项部分提交 | DB 中 SQL / ledger / receipt 同事务，已提交项计数始终一次 |
| 控制器崩溃 | 每个 intent 前后、派发前后、PROVEN 前后、接受事务前后 kill -9 | 新 Agent 先 reconcile；不得自动重放未知副作用 |
| 整机故障 | VM 强制断电、冷启动、journal 恢复、虚拟盘 EIO / ENOSPC | 本地事实不矛盾；数据库已提交但本地未写入时靠真实 receipt 恢复 |
| 激活 | Web 已替换 / Worker 未替换，daemon API 返回丢失，旧任务仍运行 | 正确识别混合版本；新操作受阻；只允许明确计划续跑 |
| 验收 | 内部正常 / edge 不通；错误构建但同 semver；readiness / Worker / 队列退化 | 不误接受；只验收续跑零迁移、零重启 |
| Agent 发行 | 签名、payload、workflow 身份、repo ID、兼容字段篡改；离线验证 | 拒绝发生在解包 / 激活前；不联网补信任材料 |
| Agent 升级 | 相邻受支持版本、失败激活、状态 epoch 不兼容、旧状态备份 | 回退用当前兼容状态；禁止覆盖较新执行历史 |
| V1 迁移 | V1 未解决状态、遗留单位保持原样、两入口竞争、shadow comparison | V2 shadow 零写入；共享锁 / owner 检查；未知旧状态不可导入为成功 |
| GC / 诊断 | GC 失败、诊断缺权限 / Agent 不可用 / 时限耗尽 | 不改变发布接受结果；诊断无启动、迁移、安装、环境泄露 |

测试 harness 在测试 VM 中允许精确 failpoint，但 failpoint 必须禁用于正式 Agent，发行检查验证其不存在或不可启用。除可控 failpoint 外，必须有黑盒进程终止和 VM 断电测试，避免只测试模拟分支。

## CI 信任与证据

不在长期自托管主机上直接执行不受信 fork PR。公开 PR 先运行无凭据的托管快速检查；完整 VM 可在无内部网络、无凭据、销毁即清空的环境运行。受保护 release workflow 使用固定 action / runner 镜像身份，签名权限只授予受信发行任务。管理员审批过的默认分支任务也只能访问测试网络，绝无生产凭据。

GitHub 官方提醒自托管 runner 不保证一次性干净 VM，不受信代码可持久化污染；本设计使用外层受限调度和每次重建的测试 VM，不依赖长期 runner 的“清理脚本”作为隔离保证。[GitHub 自托管安全边界](https://docs.github.com/en/actions/reference/security/secure-use)

原始 console、journals、快照、数据库测试明细留在受限存储。公开 CI artifact 只上传经过 schema 白名单重建的 `compatibility-summary`：Agent / app artifact digest、环境锁 digest、测试 case ID、结果、有限版本和故障类别。不得 upload 整个 `work/`、原始 `docker inspect`、env 或 unreviewed screenshot。

测试结果要绑定确切 Agent payload、应用 digest、环境锁与测试清单 digest。同名 tag、同 semver 或旧环境的通过不能复用为另一制品认证。更新任何安全策略、runtime、Compose adapter、state schema 或 migration protocol，需要对应场景重新验证。

## 时限与执行授权

M1 先给出 VM provision、L2、L3 各自的测量预算和取消 / 证据回收办法，再执行相应里程碑。预计超过 60 秒的可选审计须事先获得范围与时间批准；本文件列举场景不等于当前授权启动整套测试。每项命令有 timeout，超时记结果不明 / 未通过，先检查是否已完成，不重复启动副作用。

正式 Agent RC 的完整集成清单是必需的发行工作，但不得在一个小修复任务中无界反复执行。后续改动按影响选择已有认证场景；只有新的失败或改动才扩大验证。
