# Deployment V2 M2 Offline Alpha 验收

日期：2026-10-25。M0 `0e786b1`，M1 `e93cc03`，Agent `0.2.0-alpha.1`，CRM `3.44.0`。实际代码入口见 [独立 Agent](../../../deployment-v2-agent/README.md)，协议见 [状态与离线格式](protocol-and-release.md)。

**M2 离线 Alpha 可独立构建和测试；生产安装、生产诊断和 V1 接管均未授权。M3 完整系统集成 NO_GO，允许继续准备虚构集成 fixture。** 缺口是对应外部系统能力及发行证据，没有通过增加常驻服务或放宽预算绕过。

## 实际交付

| 交付 | 实现与限制 |
| --- | --- |
| 独立版本 / runtime | 单独 package / lockfile / CHANGELOG；固定 Node 24.22.1 私有二进制、纯 JavaScript payload、每文件摘要；无 CRM / V1 / M1 运行 import |
| 固定 CLI / worker | 仅虚构 checkpoint、计划 / 准入 / 状态 / 恢复 / unit 导出与派发；没有 app deploy、migrate、upgrade、shell 或任意 unit 属性接口 |
| SQLite 单一状态 | 事务 projection / events、revision CAS、一次性 grant、不可变请求 / intent / receipt；业务接受指针始终 NULL |
| 进程与恢复 | 真实进程 kill / Unix SIGTERM、活跃执行者拒绝恢复、Linux boot / start ticks 身份、receipt 存在但 SQLite 完成回滚后的采证恢复；无超时自动重放 |
| 固定 oneshot | `flock --no-fork` → 私有 Node / worker；固定 unit / 进程身份、锁顺序、属性和路径核验。只渲染 / 检查已有 unit，不安装 / reload / enable |
| 离线运输 v1 | AGENT / APPLICATION 角色分离、独立 verifier、Ed25519、固定来源字段和文件 / OCI 图；测试 key 仅显式非生产测试模式可用 |
| 独立诊断 | M1 主机诊断完整保留；新增只读 Alpha state 报告、journal 拒读与腐坏 / epoch / 缺失 / 权限分类；一个短进程内 worker thread |
| 真实 Linux 入口 | 新增 [外部 workflow](../../../.github/workflows/deployment-v2-agent.yml) 与本地 Docker Desktop 隔离入口；源只读、普通用户、无网络、无业务数据 / socket mount |

唯一应用配置改动是 `tsconfig.json` 排除独立 Agent namespace，防止 NodeNext / native SQLite 合约混入应用编译。根依赖和应用版本不变，M1 全部代码与测试保留。没有改 V1 脚本 / 状态 / 归档、现有 Bootstrap / Runner、其他项目、生产 Docker / systemd / PostgreSQL。

## 实际测试层级

最终计数、命令和源码摘要统一保存在 [verification.json](verification.json)；能力逐项记录于 [capability-matrix.json](capability-matrix.json)。下列层级不能互相替代。

本次最终 M2 测试为 Windows 24 项中 21 passed / 0 failed / 3 NOT_RUN，Linux 24 项中 23 passed / 0 failed / 1 NOT_RUN。保留的 M1 Linux 测试为 35 项中 34 passed / 0 failed / 1 NOT_RUN，其中 11 项观测注入仍单列模拟；M2 无观测 Mock，静态边界检查另计。类型、Lint、应用类型隔离与 14 项公开隐私门禁均通过。文档终检覆盖 19 份 Markdown、140 个本地链接、48 张表和 7 个 JSON 文件。

| 位置 | 实际方法 | 能证明的内容 |
| --- | --- | --- |
| Windows 原生 | 包内真实 Node / SQLite / 文件 / crypto / 子进程；M2 针对性测试 | 请求 / grant / CAS、真实进程终止与事务回滚、独立 bundle、签名拒绝、隐私 / 预算；不证明 Linux 锁 |
| 本地 Linux 容器 | 固定官方 Node 24.22.1 Debian 12 镜像、真实 kernel flock、可执行 tmpfs、普通用户 | M1 全部测试和 M2 实际 Linux 子集、Unix SIGTERM、文件 / 目录 fsync 正常路径；不是外部 CI 或目标 Ubuntu |
| Linux Compose parser | 官方 2.40.3 Linux 二进制，SHA-256 固定；没有 daemon socket | 实际 config、安全模型和错误 tmpfs YAML 回归；不是容器隔离认证 |
| Compose 实际工作负载 | 固定 2.40.3 客户端、本地 Docker Desktop、预构建固定 Node 镜像；独立虚构容器 | 真实 Linux 任务、只读根、cgroup 文件中的 128 MiB / 32 PID 配置；不证明 Rootless 或限额压力行为 |
| 外部 Linux CI | workflow 已实现，候选代码没有推送执行 | 实际 run 为 NOT_RUN；历史应用 CI 不能认证 M2 |
| 非生产 L2 / L3 | 没有受审 fixed unit / Rootless 目标 / 可丢弃重启或磁盘故障环境的执行证据 | systemd / 会话断线 / cgroup 生效 / 重启 / power loss / ENOSPC / EIO 均 NOT_RUN |
| 生产 P0 | 未运行、未安装 | 生产适配 NOT_RUN；本包不获准在生产运行 |

M1 的 11 项注入 Linux 观测只算模拟测试；原生与模拟结果在 verification 中分别列出。M2 的动态状态测试使用真实 SQLite / 进程 / 文件 / 签名；静态边界检查另列，未将其计为系统能力。

关键原生负例包括：四 CLI 同时准入最多一个；陈旧 revision / Agent / plan 拒绝；consumed grant 不能复位；SIGKILL 后普通 worker 不重新执行；真实 SQLite 完成事务 abort 时 receipt 保留、projection / evidence 一起回滚，显式 reconcile 找回真实效果且 receipt 次数仍为一。该事务 abort 是数据库故障注入，不冒充磁盘故障或断电。

## 本地 Docker 与环境首因

开发机 Docker Desktop 正常运行。初次 sandbox 查询因 Docker 配置和 named pipe 的 EACCES 失败；取得必要的本机访问权限后，只读查询确认 Engine 29.9.2、Linux、cgroup v2 / cgroupfs、默认 Compose 5.6.1。没有重启 / 重装 Docker，也没有修改任何已有容器、网络或卷。

该环境不等于 Ubuntu 26.04 / Ubuntu Docker 29.1.3 / Rootless / systemd。矩阵明确记录本地 target-profile 不匹配，不能因为 Linux 子集通过就视为目标兼容。

M2 首轮私有 Node 无法启动，最小对照取得 `noexec → spawn EACCES`，不是 SQLite 或 Docker daemon 故障。仅将本次测试容器的 tmpfs 显式设为 exec，保留 nosuid / nodev、普通用户、无网络、只读源与资源上限；生产挂载和 Docker 全局配置没有改变。随后真实 Linux 回归通过。M1 使用宿主已有 Node 的测试与私有 runtime 测试条件也据此分开记录。

固定 Linux Compose 制品下载曾在每次时限处停止，确认 partial 后续传，并最终匹配 `dba9d98e1ba5bfe11d88c99b9bd32fc4a0624a30fafe68eea34d61a3e42fd372`。未执行未完成二进制、未替换默认插件、未把网络失败写成 parser 失败。

## 资源、只读与隐私

[资源对比](resource-comparison.json) 保存 M1 基线与 M2 Windows / Linux 实测，以及相同源码绑定。SQLite 从 M1 单效果 fixture 的 32 KiB 增为 M2 72 KiB，增加的是 grant / step / evidence / event 与索引约束；仍只有嵌入式文件，没有数据库服务。

M2 包含已复制的私有 Node，Windows 约 90 MiB、Linux 约 121 MiB；M1 未交付私有 Node，因此没有把两个不同内容的包做体积百分比比较。最大 Agent payload 候选 384 MiB，实际值见 JSON。未生成正式 Node 来源 attestation、SBOM、安装 / 回退签名包或 production trust roots。

状态诊断只有一个 Node 进程和一个短 worker thread；读取前验证 scope / 文件类型 / owner / mode / inode，拒绝 journal / WAL / SHM，正常 SQLite readOnly 连接只查询受限表和枚举。文件 digest 快照证实除指定新报告外既有虚构文件不变；已有报告不覆盖。没有 network / DB URL / env / 路径 / UID / PID / 原请求或执行身份导出。

45 秒、128 MiB 和 64 KiB 输出预算未提高；worker heap 24 MiB / young 2 MiB，main 有 watchdog，超时终止该短线程。heap 约束不是 RSS 硬限制，内核 hard RSS / 磁盘挂起仍 NOT_RUN。[Node worker resource limits](https://nodejs.org/download/release/latest-v24.x/docs/api/worker_threads.html#worker_threadsresourcelimits)

M1 主机诊断的两进程 RSS 与 M2 state-only RSS 的覆盖范围不同；减少进程基线的效果只用于状态报告，不宣称整套主机采集同比下降。worker 资源值也是执行进程的测量，手动 Linux CLI 锁包装进程不包含在该 RSS 内；正常 unit 通过 flock no-fork 避免 Node 锁代理，但真实 unit 资源仍需 L2 实测。

只读诊断使用严格 draft-07 Schema 和现有 Ajv 6 完整验证该 dialect；M1 原有 2020-12 子集测试没有被改写为完整认证。原始日志、测试目录、二进制与管理员材料只留忽略的 `work/`，新 CI 不上传 artifact。

## M3 前置与 Go / No-Go

**NO_GO：开始完整应用发布 / 恢复系统验收，或进入任何生产安装 / 运行。GO：继续离线准备 M3 虚构 fixture 和对应外部环境。**

1. 在受审、与生产隔离的外部环境执行当前候选 CI，绑定确切 payload / source / environment digest；浮动 Ubuntu runner 通过也不自动等于目标 Ubuntu 发行包线。
2. 取得真实 user manager 与受审 fixed unit，验证 CLI 退出、真实终端断线、重复派发、超时、子进程清理、空闲零新增进程及 cgroup 预算；Rootless 需实际专属 daemon / 委派，不能借用其他项目。
3. 在可丢弃非生产目标验证 reboot / power loss / ENOSPC / EIO；普通 tmpfs / 进程 kill / SQL abort 不能替代持久磁盘证据。
4. 单独冻结正式 CI attestation / trust roots、私有 runtime 来源 / SBOM、安装与兼容回退，以及真实运输 load 的 manifest / config / rootfs 身份与 Docker 空间峰值。测试 key 不转为生产根。
5. M3 才实现虚构应用迁移 / 激活适配器并验证既有账本恢复；M2 checkpoint receipt 不能作为业务证据。继续保留 M0 的 V1 fence / owner 交接和管理员变更窗口门槛。

本次生产新增文件、unit、进程、数据库实例和磁盘均为 0；没有创建生产 VM、DIND、Runner、Registry 或构建服务器。未运行全应用 / 浏览器 / 业务数据库回归，因为它们不属于本阶段改动范围。
