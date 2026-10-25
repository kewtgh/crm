# M2.1 Dynamic Validation Gate 验收

2026-10-26（Asia/Taipei）。M2 基线 `36106f72ea9b0c1cd7f79503205ae3fa83ed7c90`；Agent `0.2.0-alpha.1` / CRM `3.44.0` 均保持不变。

**外部 CI 已实际执行，最终两个 job 成功；动态矩阵为 16 PASS / 0 FAIL / 9 NOT_RUN。M3 完整集成仍为 NO_GO。** Rootless、重启 / 磁盘故障和目标发行包线没有认证，不能由 workflow 成功推导为已通过。

## 候选与证据

| 项目 | 实际值 |
| --- | --- |
| 测试完整 SHA | `19589e49106dd98efa369951685b4022a88c37d1` |
| 分支 / 事件 | `validation/deployment-v2-m2.1` / push，已获用户授权；未推送 main |
| Run / attempt | [40211829783](https://github.com/kewtgh/crm/actions/runs/40211829783) / 1 |
| UTC 起止 | 2026-10-25T16:28:22Z → 2026-10-25T16:30:11Z |
| native-linux / dynamic-linux | job 121224497099 / 121224497195，均 success |
| Runner | GitHub-hosted x64、Ubuntu 24.04、kernel 6.17.0、systemd 255；Runner 2.338.0 |
| Runner image | ubuntu-24.04 / 20261012.334.1；不是生产 Ubuntu 26.04 |
| Node / SQLite | 24.22.1 / 3.53.4 |
| 源码聚合 SHA-256 | `d2f2a579cd30afd1eb6ca87fdac4c6d48b2fa6c7673ba79596bffb96f5e1ba54` |
| runtime-manifest SHA-256 | `6b4ee77c0c92769423f32dd46530b1da48be9174bbff91cfb43e04101e3b019c` |
| Artifact | ID 12606262374，1163 bytes ZIP，14 天保留 |
| ZIP SHA-256 | `b2a648c58d21e9197d9d6d75beccac3dcfd36089b53b2b59194dc53f401a06f0` |
| JSON SHA-256 | `ba2cb3c597cc10fe219867bac0d398d03d761d70c326786d227ee52899486b6d` |

已下载并核对 GitHub ZIP digest、完整 SHA / run / attempt、正向提取结果和本地相同候选的源码聚合摘要。[已审最小化 JSON](ci-summary.json) 与 [机器验收记录](verification.json) 长期保存；原始日志、ZIP 和历次下载只留忽略的 `work/deployment-v2-m2.1/`。最终报告提交是文档提交，测试 SHA 始终指向上表候选。

runtime 摘要绑定本次私有 Node / JavaScript manifest，未上传完整 payload。GitHub job / artifact 证据不是正式发行签名、SBOM 或独立来源 attestation。

## PASS / FAIL / NOT_RUN 矩阵

| 能力 | 结果 | 方法与证明边界 |
| --- | --- | --- |
| M1 保留测试 | PASS，34 passed / 0 failed / 1 NOT_RUN | 当前候选原生 Linux；其中 11 项观测注入只算模拟；旧 transient oneshot opt-in 仍跳过 |
| M2 SQLite / flock / 文件系统 / crypto / 信号 | PASS，23 passed / 0 failed / 1 NOT_RUN | 当前候选原生 Linux，无 Mock 计作系统验收；原 opt-in systemd 单测跳过，固定 unit 由独立动态 fixture 验证 |
| Compose parser / workload | PASS | 真实 2.40.3 parser、固定预构建镜像、Runner rootful daemon；不证明 Rootless |
| 类型 / Lint / 隐私 | PASS | Agent 严格类型、新脚本 JS checkJs、Lint、14 项公开隐私、8 项发布 / fixture 合约；publisher 另经 Node 语法检查；Python 实际导入与 AST 检查通过 |
| fixed-oneshot / cli-exit | PASS | 原样 render-unit、真实 user manager；CLI 退出后任务完成，grant CONSUMED / receipt PROVEN |
| pty-hangup | PASS | 真实 controlling PTY，关闭 master 后 kernel SIGHUP 终止会话 leader，manager 任务继续；不等于 SSH 网络断开或整个登录 manager 消失 |
| concurrent-admission / dispatch / kernel-flock | PASS | 4 CLI 最多一个准入、4 个派发、实际锁冲突 PROJECT_LOCK_BUSY；不是多任务队列 |
| grant-once | PASS | 重复派发不产生第二个 intent / receipt，原 receipt 字节不变 |
| timeout | PASS | INTENT 后 SIGSTOP，原 unit 15 秒超时；回收执行进程、grant 不复位、重复启动不重放；不将 timeout 推断为无效果 |
| explicit-reconcile | PASS | INTENT 后真实 SIGKILL；显式新 reconcile grant 消耗后保留 UNKNOWN / RECOVERY_REQUIRED、零 receipt，无自动重放 |
| receipt-reconcile | PASS | 测试 SQLite trigger 中断完成事务，receipt 保留；移除 trigger 后显式核对完成，receipt 字节 / mtime 不变；不是磁盘故障 |
| idle-zero-agent | PASS | MainPID=0，真实进程表无 payload worker，没有新增空闲 Agent daemon |
| unit-budget-config | PASS | 实际 Agent cgroup：memory.max=134217728、cpu.max=100000/100000、pids.max=32 |
| unit-memory / cpu / tasks-enforced | PASS | 独立同预算压力 unit：memory.events.max 增加且 memory.current 受限、cpu.stat 节流增加、pids.events.max 增加且 spawn 被 EAGAIN 拒绝 |
| child-group-cleanup | PASS | 独立同预算、同 KillMode 压力 unit 中真实 sleep 子进程存在，超时后 cgroup 清空；Agent 受限协议不产生任意子任务 |
| Rootless 隔离 / 配置 / RAM / CPU / tasks | NOT_RUN，5 项 | Runner 缺 dockerd-rootless.sh / rootlesskit；匹配既有 Engine 的 extras 安装尝试未补齐，不更换 Engine、不借 rootful 代替 |
| reboot / power-loss / disk-fault | NOT_RUN，3 项 | 未提供可丢弃重启 / 断电 / ENOSPC / EIO 设施，未转到生产执行 |
| target-ubuntu-profile | NOT_RUN，1 项 | Ubuntu 24.04 不证明 Ubuntu 26.04 / Docker 29.1.3 / Compose 2.40.3 / Buildx 0.30.1 整体兼容 |

动态 25 项逐项状态在 ci-summary.json；表中合并展示不改变 16 / 0 / 9 计数。单元测试、模拟、真实系统测试分开报告。

## 资源实测

| 测量 | 实际值 | 范围 |
| --- | --- | --- |
| Agent cgroup memory peak | 18,456,576 B，约 17.60 MiB | 短 worker，采样及可取得的 unit 完成计数；不含提交 CLI / CI 协调程序 |
| Agent 进程树 RSS 采样峰值 | 62,488,576 B，约 59.59 MiB | 共享映射计入 RSS，与 cgroup charge 口径不同 |
| Agent 进程 / tasks 采样峰值 | 1 个进程 / 7 tasks | 单 worker + Node 线程；离散采样不是全时进程树上界证明 |
| Agent cgroup CPU usage | 153,644 µs | 观测执行计数，不等于配置值 CPUQuota |
| Alpha site 文件逻辑合计 | 75,557 B | SQLite、虚构 request / receipt、审阅 unit 等；不是只有 SQLite 或物理分配块 |
| 私有 payload 文件逻辑合计 | 126,940,053 B，约 121.06 MiB | 包含 Node；Agent 运行模块与 M2 相同 |
| RAM 压力 memory.current | 134,107,136 B，低于 134,217,728 B | 同预算压力 unit，内核 max 事件增加 7 次 |
| 压力测试 swap.current | 2,158,592 B | 原 unit 无 MemorySwapMax；RAM 门禁通过不证明总 RAM + swap 为 128 MiB，也不宣称必然 OOM |
| Rootless 进程树 / 数据盘 | NOT_RUN | daemon 未准备成功，不填 0 或估算冒充实测 |

128 MiB / 1 CPU / 32 tasks 未提高。内存测试使用真实 controller 压力证据：有 swap 时没有 OOM 不等于 RAM 不受限，也不能隐去 swap 开销。M3 需明确总资源预算和 swap 政策，本次没有修改 Alpha unit 的 swap 设置。

## 失败记录与最小修复

六轮均为获准分支的实际 run；保留此前失败，没有重写或删除证据。

| Run | 完整候选 SHA | 结果 / 发现 |
| --- | --- | --- |
| [40209957474](https://github.com/kewtgh/crm/actions/runs/40209957474) | `ee29aa41c39fc5166b7dcf964d2e8c8b0c7c7085` | native 成功；动态准备失败，25 NOT_RUN；补固定阶段 / exit code 证据 |
| [40210249038](https://github.com/kewtgh/crm/actions/runs/40210249038) | `204cfaa723d3191be2ca3316212b20fad8feafd2` | 确认 USER_MANAGER_HEALTH / degraded / exit1；修正测试误判，保留 degraded，不清除系统失败 unit |
| [40210474932](https://github.com/kewtgh/crm/actions/runs/40210474932) | `a71170b005d46ee46e274451fbcc8878e4332a7b` | 12 PASS / 4 FAIL / 9 NOT_RUN；timeout 真实产生 receipt，修正“超时无效果”假设；RAM 检查改用 kernel 压力证据 |
| [40211163250](https://github.com/kewtgh/crm/actions/runs/40211163250) | `f676324f6e608d9b094e5478c2ad12d98920e508` | 15 PASS / 1 FAIL / 9 NOT_RUN；PTY 失败，Rootless 明确缺两个程序 |
| [40211504326](https://github.com/kewtgh/crm/actions/runs/40211504326) | `24e1ef4fcf7669a8630e34c1ecbdc199166cb797` | cwd / 计数采集改进后 PTY 仍失败；未将 cwd 猜测认定为根因 |
| [40211829783](https://github.com/kewtgh/crm/actions/runs/40211829783) | `19589e49106dd98efa369951685b4022a88c37d1` | 重命名遮蔽 stdlib 的 pty.py，补真实 Python import 回归；两个 job success，16 PASS / 0 FAIL / 9 NOT_RUN |

修复均在测试 / 证据命名空间。Agent src、M1、V1、生产 unit 模板及版本无变更；没有降低安全条件、复位 consumed grant、重放 UNKNOWN、提高预算或添加生产常驻服务。

## 无生产副作用与 M3 决策

本次访问范围：本地仓库 / 已有本机 Docker 的无网络只读 Bash 语法容器、GitHub 仓库与托管临时 VM；没有生产访问或生产凭据。VM 使用新身份、私有状态和固定虚构任务，EXIT trap 停止 fixture user manager / linger，平台销毁 VM；没有更换生产或其他项目资源。

**生产新增文件、unit、进程、数据库实例和磁盘均为 0。** 证明范围限于改动及本次执行入口 / 命令，不声称已诊断生产现场。原始日志未公开，发布只允许固定枚举、版本数字、摘要、数值及运行上下文；14 项隐私门禁通过。

**NO_GO：M3 完整集成、生产安装和真实 CRM 发布。GO：继续准备隔离虚构集成 fixture。** 前置条件：

1. 有受控 Rootless 程序的非生产环境，补齐独立 UID / socket / data-root、user manager / cgroup v2、三项内核限额压力及 daemon / 镜像资源证据；不借 rootful 成绩。
2. 专用可丢弃环境的 manager / OS 重启、磁盘故障与持久性验证；PTY SIGHUP 和 SQL abort 不替代这些能力。
3. 明确 RAM / swap 总预算、目标发行包线和运输 load 的资源边界。
4. 正式 trust roots / 来源、安装与兼容回退、V1 fence / owner 交接及真实适配器仍依原设计验收；checkpoint 不作为业务迁移 / 容器切换证据。
