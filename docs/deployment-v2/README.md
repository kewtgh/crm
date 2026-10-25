# Lumina CRM Deployment V2：离线开发与隔离生产设计

日期：2026-10-25。设计版本：0.2，M0 约束修订。原审计代码基线：`926819e566c5736e83817cd55e45dbf3e5337e66`；修订前文档提交：`97bbb7c`；CRM `3.44.0`。

本目录的 M0 v0.2 是第一阶段设计基线：现有系统审计、架构决策、协议和后续实施计划，固定于 `0e786b1`。其“未开始 M1”等文字属于当时的历史记录。M1 交付见 [M1 验收报告](m1/acceptance.md)，当前独立离线 Alpha 见 [M2 验收报告](m2/acceptance.md)；未安装 V2、修改 V1 或访问生产。设计中的正式 V2 路径、命令和 unit 仍不能作为当前生产操作命令。

## 当前架构与约束来源

设计输入是共享 Ubuntu 26.04 主机：同机其他业务使用 Rootful Docker 及其数据库 / 工作流组件，CRM 使用既有专属非 root 身份的 Rootless Docker、容器化 Web / Worker / PostgreSQL，以及项目自己的 socket、数据根、BuildKit、Caddy 和 Cloudflare Tunnel。既有软件基线为 Ubuntu Docker Engine 29.1.3、Compose 2.40.3、Buildx 0.30.1。

这是管理员声明的生产约束，不是 Codex 现场采集的认证。真实 UID、宿主机身份、socket / data-root 路径及资源标识只进入受控 site policy / Git 忽略的适配材料，公开设计使用项目角色。适配时必须匹配管理员指定的确切 UID 和边界，不能只检查“任意非 root”。历史附件中的主机 Node Web / Worker、外部 Supabase 方案仅属早期规划，不覆盖当前容器化架构；复用 systemd 只用于管理部署进程。

生产宿主机不运行测试 QEMU/KVM、额外 Ubuntu VM、Docker-in-Docker 或 CI Runner，也不因 V2 引入独立生产构建服务器。不得重装 Docker / PostgreSQL / Caddy、迁移数据根，或修改同机其他项目的任何容器、网络、卷、服务和数据库。

## 结论

日常发布的最小职责是：验证一个已构建的发布制品，在已配置好的隔离环境中推进一次有证据的状态转换，再确认实际运行版本。源码更新、生产构建、部署器升级、基础设施维护和历史故障归档应退出这条路径。

V1 已有重要安全保障，包括项目隔离、进程锁、迁移校验、兼容性回退约束、内部与公网健康分离、原子文件写入。主要问题是这些保障依赖应用源码中的执行器，并通过多个文件、安装组件和跨版本协议共同解释部署结果。继续叠加兼容分支无法消除这个依赖方向。

V2 采用以下设计基线：

1. 独立版本的 Deployment Agent，包含私有运行时；应用发布制品不能修改或升级 Agent。
2. CI 构建应用镜像和签名发布描述；具体分发方式由 M1/M2 在外部验证，不预设新增镜像仓库或服务器。生产不执行常规构建、npm ci、Buildx 或 release gate。
3. 一个本地事务状态库保存部署请求、步骤证据、接受版本和归档事实；JSON 报告是派生输出。
4. 首选现有 systemd 按需启动的 oneshot Agent，无新增常驻监听进程；同一项目写锁与 SQLite 约束串行化准入、执行、恢复和升级。结果不明必须先核实。
5. 精简 Preflight 只检查本次操作的必要条件，逐项区分失败、未知和因依赖未执行。
6. 开发机做协议 / 故障模拟，外部 CI 做真实 Linux / Compose；systemd、Rootless、cgroup 和重启 / 崩溃测试仅在具备条件的非生产 Linux 主机或 VM 完成。缺基础设施就记 NOT_RUN，保留对应发行阻断，不转移到生产补测。

部署状态首选一个 CRM 专属 SQLite 文件及必要 journal / lock；SQLite 是嵌入式存储，不增加数据库实例、容器或服务。不把控制平面请求、状态、日志写入 CRM 业务 PostgreSQL，也不使用其他项目的 PostgreSQL / Temporal。业务迁移仍沿用真实迁移账本，执行归属不明时保留歧义，不为恢复方便创建控制平面数据库表。

## 交付导航

| 文档 | 解决的问题 |
| --- | --- |
| [01 当前架构与根因审计](01-current-system-audit.md) | 入口、依赖、状态、主机维护、数据与验收路径；证据和风险边界 |
| [02 目标架构与模块边界](02-target-architecture.md) | 按需 Agent、资源复用 / 隔离、事务存储选型、Preflight |
| [03 统一状态机与恢复协议](03-state-machine-and-recovery.md) | 唯一事实来源、事务、幂等、迁移崩溃窗口、接受与补偿 |
| [04 环境复现与 CI](04-environment-and-ci.md) | 开发 / 外部 CI / 非生产 Linux / 生产只读适配四层及测试预算 |
| [05 只读诊断工具规范](05-diagnostics-spec.md) | 独立诊断包、采集白名单、脱敏 JSON、权限与时限 |
| [06 制品与 Agent 生命周期](06-release-and-agent-lifecycle.md) | 来源验证、最小生产文件 / 进程 / 磁盘清单、独立安装回退 |
| [07 迁移、里程碑与验收](07-migration-milestones-and-acceptance.md) | 新版 M1 范围、资源预算、证据门槛、V1/V2 迁移 |
| [08 历史机制处置清单](08-retirement-inventory.md) | 保留、重写、合并、延后删除的逐项映射 |
| [M1 实施与验收](m1/acceptance.md) | 独立原型 / 诊断 MVP、本地实测、能力清单、资源和 M2 Go / No-Go |
| [M2 Offline Alpha](m2/acceptance.md) | 独立私有 runtime、状态协议、固定 oneshot、离线 verifier、真实本地 Linux 子集与 M3 前置 |

## 边界与责任

| 责任方 | 可以执行 | 不属于本阶段授权 |
| --- | --- | --- |
| 开发环境 / Codex | 仓库审计、保存设计、独立 M1 实验与本地验证 | 连接生产、运行生产 SSH / Docker / systemd / 数据库命令 |
| 外部 CI / 非生产 Linux | 使用虚构数据做真实 Linux / Compose 和有条件的 systemd / Rootless / 崩溃测试 | 在生产宿主机建 VM、DIND 或 Runner；生产凭据、网络访问、数据副本 |
| 生产只读适配 | 管理员手动执行受审、有界诊断，输出脱敏报告 | 安装 Agent、创建状态库 / unit、加载测试镜像、写数据库、重启服务或运行 release gate |
| 管理员后续变更窗口 | 单独批准具体 CRM 专属程序、一个按需 unit、有限状态与真实业务发布 | 被普通发布隐式触发的系统安装、Agent 更新、测试设施或共享服务变更 |

生产只读适配和后续真实发布是不同授权阶段。只读适配通过不授权安装、试部署或故障注入；后续如实施 V2，只允许逐项批准的 CRM 专属增量，不改既有主机组件。现有业务迁移属于真实发布副作用，必须列入批准计划；基础设施替换、角色初始化和恢复不属于日常发布。

公开仓库只保存架构、代码引用、虚构示例和最小化验收结论。管理员诊断包、原始执行证据和任何真实环境材料留在管理员受控存储或 Git 忽略的 `work/`，不直接提交。

## 简化准则

每个阻断条件必须说明它防止哪一种本次操作风险。只影响生产构建的 Buildx / BuildKit 条件不能阻断镜像发布；历史归档不能成为永久的应用运行依赖；推荐版本不能伪装成必需版本。

第一版不引入远程控制平台、管理网页、多主机调度、自动基础设施修复、自动反向迁移或自动 Agent 更新。默认没有 Agent daemon、API socket、timer、数据库服务或生产测试设施；只有非生产证据证明按需方案无法满足必要要求，才另立设计评审考虑常驻服务。

## M0 历史完成情况

原阶段已完成仓库审计；本次按约束修订现有设计，不扩展审计或实现。具体范围与校验结果见 [M0 v0.2 验证记录](07-migration-milestones-and-acceptance.md#m0-v02-本次验证记录)。

本次交付为 M0 v0.2 文档修订。新版 M1 从外部测试能力清单、诊断规范和按需生命周期验证开始；未实现 V2、未申请新服务器 / 仓库、未运行外部 Linux 测试或生产适配。上述动态能力均为 NOT_RUN，不能从文档检查或管理员架构声明推导为通过。CRM 应用版本继续为 `3.44.0`，Agent 另行版本化。

## M1 历史状态

[独立 M1 实验](../../deployment-v2-m1/README.md) 已实现虚构任务 / SQLite / 一次性 grant、非生产 opt-in transient oneshot harness、只读诊断 MVP、运输验证实验与托管 CI 定义。Windows 实际测试 33 passed、2 项 Linux 动态测试 NOT_RUN；真实 Compose parser 通过，不代表 daemon / Rootless 兼容。

外部 M1 Linux CI 尚未执行，systemd / cgroup / Rootless / 重启门槛仍 NOT_RUN；M2 可继续离线 alpha，生产发行和现场诊断 NO_GO。本次生产新增文件 / 服务 / 进程 / 数据库 / 磁盘均为 0。设计保持 v0.2，CRM 仍为 `3.44.0`；M1 实验独立为 `0.1.0-experimental`。

## M2 历史状态

[Agent `0.2.0-alpha.1`](../../deployment-v2-agent/README.md) 已实现独立私有 Node / JavaScript 包、SQLite 单一事务、一次性 grant、固定 oneshot 导出 / 派发、只读状态诊断和离线目录 v1 verifier。M1 全部保留，并新增本地 Docker Desktop 隔离 Linux 的实际 flock / 文件系统 / SQLite / Compose 证据；这不是外部 CI 或目标 Ubuntu / Rootless 认证。

精确结果见 [M2 能力与资源验收](m2/acceptance.md)。M3 完整系统集成仍 NO_GO，外部 CI / systemd / Rootless / reboot / 磁盘故障及正式发行缺口不能由 Mock 或普通容器补齐。没有生产增量，CRM 继续为 `3.44.0`。

## M2.1 动态验证

[执行计划与安全边界](m2.1/plan.md) 复用 GitHub 托管的独立可丢弃 Linux VM，验证现有 Alpha 的 user oneshot、真实 PTY 断线、内核锁、恢复和 Rootless 资源边界。Agent 版本与应用版本保持不变。必须先获准推送候选，再取得该 SHA 对应 run；准备代码不构成动态验收。

[M2.1 最终验收](m2.1/acceptance.md)：获准执行候选 `19589e4` 的 Run 40211829783，两个 job 成功，动态 16 PASS / 0 FAIL / 9 NOT_RUN。Rootless、重启 / 磁盘故障和目标发行包线未认证，M3 完整集成继续 NO_GO；生产新增资源为 0。
